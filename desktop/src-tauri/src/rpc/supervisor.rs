use std::{collections::HashMap, error::Error, fmt, process::Stdio, sync::Arc};

use serde_json::Value;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::{Child, ChildStdin, Command},
    sync::{mpsc, oneshot, Mutex},
    time::{sleep, Duration},
};

use super::protocol::{JsonlDecoder, ProtocolError};

/// A parsed Pi RPC record that was not consumed as a response to a pending request.
#[derive(Debug, PartialEq)]
pub enum SupervisorEvent {
    Event(Value),
}

/// Failure while framing Pi JSONL records or supervising the Pi RPC child process.
#[derive(Debug)]
pub enum SupervisorError {
    MissingRequestId,
    ProcessExited { status: Option<i32> },
    Protocol(ProtocolError),
    Spawn(std::io::Error),
    StdinUnavailable,
    StdoutUnavailable,
    Write(std::io::Error),
}

impl fmt::Display for SupervisorError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingRequestId => write!(formatter, "Pi RPC request is missing a string id"),
            Self::ProcessExited { status } => write!(
                formatter,
                "Pi RPC process exited unexpectedly{}",
                status.map_or(String::new(), |code| format!(" with status {code}"))
            ),
            Self::Protocol(error) => error.fmt(formatter),
            Self::Spawn(error) => write!(formatter, "failed to start Pi RPC process: {error}"),
            Self::StdinUnavailable => write!(formatter, "Pi RPC process did not expose stdin"),
            Self::StdoutUnavailable => write!(formatter, "Pi RPC process did not expose stdout"),
            Self::Write(error) => write!(formatter, "failed to write Pi RPC request: {error}"),
        }
    }
}

impl Error for SupervisorError {}

impl From<ProtocolError> for SupervisorError {
    fn from(error: ProtocolError) -> Self {
        Self::Protocol(error)
    }
}

type PendingRequests = Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, SupervisorError>>>>>;

/// Owns one Pi RPC child process and its stdin/stdout protocol channels.
#[derive(Clone)]
pub struct RpcSupervisor {
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
    pending_requests: PendingRequests,
    events: Arc<Mutex<mpsc::UnboundedReceiver<Result<SupervisorEvent, SupervisorError>>>>,
}

impl RpcSupervisor {
    /// Starts a command with piped stdin/stdout and begins forwarding Pi RPC output.
    pub async fn start(mut command: Command) -> Result<Self, SupervisorError> {
        command.stdin(Stdio::piped()).stdout(Stdio::piped());
        let mut child = command.spawn().map_err(SupervisorError::Spawn)?;
        let stdin = child
            .stdin
            .take()
            .ok_or(SupervisorError::StdinUnavailable)?;
        let stdout = child
            .stdout
            .take()
            .ok_or(SupervisorError::StdoutUnavailable)?;
        let pending_requests = Arc::new(Mutex::new(HashMap::new()));
        let (event_sender, events) = mpsc::unbounded_channel();

        tokio::spawn(read_stdout(
            stdout,
            pending_requests.clone(),
            event_sender.clone(),
        ));
        let child = Arc::new(Mutex::new(child));
        tokio::spawn(wait_for_exit(
            child.clone(),
            pending_requests.clone(),
            event_sender,
        ));

        Ok(Self {
            child,
            stdin: Arc::new(Mutex::new(stdin)),
            pending_requests,
            events: Arc::new(Mutex::new(events)),
        })
    }

    /// Writes an identified command and waits for the Pi response carrying that same id.
    pub async fn request(&self, request: Value) -> Result<Value, SupervisorError> {
        let request_id = request
            .get("id")
            .and_then(Value::as_str)
            .ok_or(SupervisorError::MissingRequestId)?
            .to_owned();
        let (response_sender, response_receiver) = oneshot::channel();
        self.pending_requests
            .lock()
            .await
            .insert(request_id, response_sender);

        let mut request_bytes =
            serde_json::to_vec(&request).expect("Value always serializes to JSON");
        request_bytes.push(b'\n');
        self.stdin
            .lock()
            .await
            .write_all(&request_bytes)
            .await
            .map_err(SupervisorError::Write)?;
        self.stdin
            .lock()
            .await
            .flush()
            .await
            .map_err(SupervisorError::Write)?;

        response_receiver
            .await
            .unwrap_or(Err(SupervisorError::ProcessExited { status: None }))
    }

    /// Terminates this Pi RPC child process.
    pub async fn stop(&self) -> Result<(), SupervisorError> {
        self.child
            .lock()
            .await
            .kill()
            .await
            .map_err(SupervisorError::Spawn)
    }

    /// Returns the next uncorrelated Pi RPC event or terminal process error.
    pub async fn next_event(&self) -> Result<SupervisorEvent, SupervisorError> {
        self.events
            .lock()
            .await
            .recv()
            .await
            .unwrap_or(Err(SupervisorError::ProcessExited { status: None }))
    }
}

async fn read_stdout(
    mut stdout: tokio::process::ChildStdout,
    pending_requests: PendingRequests,
    event_sender: mpsc::UnboundedSender<Result<SupervisorEvent, SupervisorError>>,
) {
    let mut decoder = JsonlDecoder::default();
    let mut read_buffer = [0; 4096];

    loop {
        let read = match stdout.read(&mut read_buffer).await {
            Ok(read) => read,
            Err(error) => {
                let _ = event_sender.send(Err(SupervisorError::Write(error)));
                return;
            }
        };
        if read == 0 {
            return;
        }

        let frames = match decoder.push(&read_buffer[..read]) {
            Ok(frames) => frames,
            Err(error) => {
                let _ = event_sender.send(Err(error.into()));
                return;
            }
        };

        for frame in frames {
            if frame.get("type").and_then(Value::as_str) == Some("response") {
                if let Some(request_id) = frame.get("id").and_then(Value::as_str) {
                    if let Some(response_sender) = pending_requests.lock().await.remove(request_id)
                    {
                        let _ = response_sender.send(Ok(frame));
                        continue;
                    }
                }
            }

            let _ = event_sender.send(Ok(SupervisorEvent::Event(frame)));
        }
    }
}

async fn wait_for_exit(
    child: Arc<Mutex<Child>>,
    pending_requests: PendingRequests,
    event_sender: mpsc::UnboundedSender<Result<SupervisorEvent, SupervisorError>>,
) {
    let status = loop {
        match child.lock().await.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) => sleep(Duration::from_millis(50)).await,
            Err(error) => {
                let _ = event_sender.send(Err(SupervisorError::Spawn(error)));
                return;
            }
        }
    };
    for (_, response_sender) in pending_requests.lock().await.drain() {
        let _ = response_sender.send(Err(SupervisorError::ProcessExited { status }));
    }
    let _ = event_sender.send(Err(SupervisorError::ProcessExited { status }));
}

#[cfg(test)]
mod tests {
    use std::process::Stdio;

    use serde_json::json;
    use tokio::process::Command;

    use super::{RpcSupervisor, SupervisorError, SupervisorEvent};

    #[tokio::test]
    async fn correlates_a_response_with_its_request_id_and_forwards_streaming_events() {
        let supervisor = RpcSupervisor::start(fake_pi_command()).await.unwrap();
        let response = supervisor
            .request(json!({ "id": "request-7", "type": "get_state" }))
            .await
            .unwrap();

        assert_eq!(
            response,
            json!({ "id": "request-7", "type": "response", "data": { "ready": true } })
        );
        assert_eq!(
            supervisor.next_event().await.unwrap(),
            SupervisorEvent::Event(json!({ "type": "message_update", "delta": "hello" })),
        );
    }

    #[tokio::test]
    async fn fails_a_pending_request_when_the_process_exits_before_responding() {
        let mut command = Command::new("sh");
        command
            .arg("-c")
            .arg("read line; exit 23")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped());
        let supervisor = RpcSupervisor::start(command).await.unwrap();

        assert!(matches!(
            supervisor
                .request(json!({ "id": "request-8", "type": "get_state" }))
                .await,
            Err(SupervisorError::ProcessExited { status: Some(23) })
        ));
    }

    #[tokio::test]
    async fn reports_an_unexpected_process_exit() {
        let mut command = Command::new("sh");
        command
            .arg("-c")
            .arg("exit 17")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped());
        let supervisor = RpcSupervisor::start(command).await.unwrap();

        assert!(matches!(
            supervisor.next_event().await,
            Err(SupervisorError::ProcessExited { status: Some(17) })
        ));
    }

    fn fake_pi_command() -> Command {
        let mut command = Command::new("sh");
        command
            .arg("-c")
            .arg("read line; printf '%s\\n' '{\"type\":\"message_update\",\"delta\":\"hello\"}' '{\"id\":\"request-7\",\"type\":\"response\",\"data\":{\"ready\":true}}'; sleep 1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped());
        command
    }
}
