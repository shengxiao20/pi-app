use std::{
    ffi::OsString,
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
};

use serde_json::{json, Value};
use tokio::{
    process::Command,
    sync::{broadcast, Mutex},
};

use super::supervisor::{RpcSupervisor, SupervisorError, SupervisorEvent};

const RPC_EVENT_NAME: &str = "pi-rpc-event";

/// Starts one configured Pi RPC process and exposes its responses and streamed events.
pub struct AgentBridge {
    command: OsString,
    arguments: Vec<OsString>,
    supervisor: Mutex<Option<RpcSupervisor>>,
    events: broadcast::Sender<Value>,
    request_sequence: AtomicU64,
    stopped: Arc<AtomicBool>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum BridgeError {
    AlreadyStarted,
    NotStarted,
    Supervisor(String),
}

impl std::fmt::Display for BridgeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AlreadyStarted => write!(formatter, "Pi RPC agent is already running"),
            Self::NotStarted => write!(formatter, "Pi RPC agent has not been started"),
            Self::Supervisor(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for BridgeError {}

impl From<SupervisorError> for BridgeError {
    fn from(error: SupervisorError) -> Self {
        Self::Supervisor(error.to_string())
    }
}

impl AgentBridge {
    /// Creates a bridge for the Pi executable in the desktop process environment.
    pub fn pi(session_dir: &Path) -> Self {
        let (command, arguments) = pi_command(session_dir);
        Self::new(command, arguments)
    }

    pub fn new(
        command: impl Into<OsString>,
        arguments: impl IntoIterator<Item = OsString>,
    ) -> Self {
        let (events, _) = broadcast::channel(128);
        Self {
            command: command.into(),
            arguments: arguments.into_iter().collect(),
            supervisor: Mutex::new(None),
            events,
            request_sequence: AtomicU64::default(),
            stopped: Arc::new(AtomicBool::default()),
        }
    }

    pub async fn start_agent(&self, cwd: &Path) -> Result<(), BridgeError> {
        let mut supervisor_slot = self.supervisor.lock().await;
        if supervisor_slot.is_some() {
            return Err(BridgeError::AlreadyStarted);
        }

        let mut command = Command::new(&self.command);
        command.args(&self.arguments).current_dir(cwd);
        let supervisor = RpcSupervisor::start(command).await?;
        forward_events(
            supervisor.clone(),
            self.events.clone(),
            self.stopped.clone(),
        );
        *supervisor_slot = Some(supervisor);
        Ok(())
    }

    /// Stops the currently running Pi RPC process before replacing its workspace.
    pub async fn stop_agent(&self) -> Result<(), BridgeError> {
        self.stopped.store(true, Ordering::Relaxed);
        let supervisor = self.supervisor.lock().await.take();
        if let Some(supervisor) = supervisor {
            supervisor.stop().await?;
        }
        Ok(())
    }

    pub async fn send_rpc(&self, request: Value) -> Result<Value, BridgeError> {
        self.supervisor()
            .await?
            .request(request)
            .await
            .map_err(BridgeError::from)
    }

    pub async fn abort_agent(&self) -> Result<Value, BridgeError> {
        let id = self.request_sequence.fetch_add(1, Ordering::Relaxed);
        self.send_rpc(json!({ "id": format!("pi-app-abort-{id}"), "type": "abort" }))
            .await
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<Value> {
        self.events.subscribe()
    }

    async fn supervisor(&self) -> Result<RpcSupervisor, BridgeError> {
        self.supervisor
            .lock()
            .await
            .clone()
            .ok_or(BridgeError::NotStarted)
    }
}

/// Starts Pi through the user's zsh login/interactive environment on macOS. Finder and
/// Dock do not inherit shell configuration, while npm-installed Pi can depend on NVM's
/// PATH for both `pi` and its Node interpreter. `exec` keeps Pi's JSONL stdin/stdout
/// directly connected to the supervisor after shell initialization.
#[cfg(target_os = "macos")]
fn pi_command(session_dir: &Path) -> (OsString, Vec<OsString>) {
    (
        OsString::from("/bin/zsh"),
        vec![
            OsString::from("-ilc"),
            OsString::from("exec pi --mode rpc --session-dir \"$1\""),
            OsString::from("pi-app-rpc"),
            session_dir.as_os_str().to_owned(),
        ],
    )
}

#[cfg(not(target_os = "macos"))]
fn pi_command(session_dir: &Path) -> (OsString, Vec<OsString>) {
    (
        OsString::from("pi"),
        vec![
            OsString::from("--mode"),
            OsString::from("rpc"),
            OsString::from("--session-dir"),
            session_dir.as_os_str().to_owned(),
        ],
    )
}

fn forward_events(
    supervisor: RpcSupervisor,
    events: broadcast::Sender<Value>,
    stopped: Arc<AtomicBool>,
) {
    tokio::spawn(async move {
        loop {
            let event = match supervisor.next_event().await {
                Ok(SupervisorEvent::Event(event)) => event,
                Err(error) => json!({ "type": "bridge_error", "message": error.to_string() }),
            };
            let is_terminal = event.get("type") == Some(&Value::String("bridge_error".into()));
            if stopped.load(Ordering::Relaxed) {
                return;
            }
            let _ = events.send(event);
            if is_terminal {
                return;
            }
        }
    });
}

/// The event name emitted by the Tauri adapter for every uncorrelated Pi RPC record.
pub const fn rpc_event_name() -> &'static str {
    RPC_EVENT_NAME
}

#[cfg(test)]
mod tests {
    use std::{ffi::OsString, path::Path};

    use serde_json::json;

    use super::{pi_command, AgentBridge, BridgeError};

    #[cfg(target_os = "macos")]
    #[test]
    fn starts_pi_through_the_users_zsh_environment_on_macos() {
        let session_dir = Path::new("/tmp/pi app/sessions");
        let (command, arguments) = pi_command(session_dir);

        assert_eq!(command, "/bin/zsh");
        assert_eq!(
            arguments,
            [
                OsString::from("-ilc"),
                OsString::from("exec pi --mode rpc --session-dir \"$1\""),
                OsString::from("pi-app-rpc"),
                OsString::from("/tmp/pi app/sessions"),
            ]
        );
    }

    #[tokio::test]
    async fn bridges_fake_pi_responses_events_and_abort() {
        let bridge = AgentBridge::new(
            "sh",
            [OsString::from("-c"), OsString::from(fake_pi_script())],
        );
        let mut events = bridge.subscribe_events();
        bridge.start_agent(Path::new(".")).await.unwrap();

        assert_eq!(
            bridge
                .send_rpc(json!({ "id": "prompt-1", "type": "prompt", "message": "Hello" }))
                .await
                .unwrap(),
            json!({ "id": "prompt-1", "type": "response", "command": "prompt", "success": true })
        );
        assert_eq!(
            events.recv().await.unwrap(),
            json!({ "type": "message_update", "delta": "Hello from fake Pi" })
        );
        assert_eq!(
            bridge.abort_agent().await.unwrap(),
            json!({ "id": "pi-app-abort-0", "type": "response", "command": "abort", "success": true })
        );
    }

    #[tokio::test]
    async fn rejects_rpc_before_an_agent_starts() {
        let bridge = AgentBridge::new("sh", std::iter::empty());

        assert_eq!(
            bridge
                .send_rpc(json!({ "id": "state-1", "type": "get_state" }))
                .await
                .unwrap_err(),
            BridgeError::NotStarted
        );
    }

    fn fake_pi_script() -> &'static str {
        r#"while IFS= read -r line; do
id=$(printf '%s' "$line" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
type=$(printf '%s' "$line" | sed -n 's/.*"type":"\([^"]*\)".*/\1/p')
if [ "$type" = "prompt" ]; then
  printf '%s\n' '{"type":"message_update","delta":"Hello from fake Pi"}'
fi
printf '{"id":"%s","type":"response","command":"%s","success":true}\n' "$id" "$type"
done"#
    }
}
