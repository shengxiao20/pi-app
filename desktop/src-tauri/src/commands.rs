use std::{path::PathBuf, sync::Arc};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

use crate::{
    rpc::bridge::{rpc_event_name, AgentBridge, BridgeError},
    workspace::{PersistedHistoryPage, PersistedSession, WorkspaceError, WorkspaceStore},
};

struct WorkspaceRuntime {
    bridge: Arc<AgentBridge>,
    cwd: PathBuf,
    workspace: WorkspaceStore,
}

impl WorkspaceRuntime {
    fn new(cwd: PathBuf) -> Self {
        let sessions_path = default_session_directory(&cwd);
        Self {
            bridge: Arc::new(AgentBridge::pi(&sessions_path)),
            workspace: WorkspaceStore::new(cwd.clone(), sessions_path),
            cwd,
        }
    }
}

/// The currently selected workspace. A GUI launch begins without one because macOS
/// starts application bundles from `/`; terminal and `/app` launches retain cwd.
pub struct AppState {
    runtime: Mutex<Option<WorkspaceRuntime>>,
}

impl AppState {
    pub fn new(cwd: PathBuf) -> Self {
        let runtime = std::env::var_os("PI_APP_INHERITED_CWD")
            .is_some()
            .then(|| WorkspaceRuntime::new(cwd));
        Self {
            runtime: Mutex::new(runtime),
        }
    }
}

fn default_session_directory(cwd: &std::path::Path) -> PathBuf {
    let safe_cwd = format!(
        "--{}--",
        cwd.to_string_lossy()
            .trim_start_matches(['/', '\\'])
            .replace(['/', '\\', ':'], "-")
    );
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .expect("Pi App desktop client requires a HOME directory")
        .join(".pi")
        .join("agent")
        .join("sessions")
        .join(safe_cwd)
}

#[derive(Serialize)]
pub struct CommandError {
    message: String,
}

impl CommandError {
    fn workspace_required() -> Self {
        Self {
            message: "Select a workspace before starting Pi".into(),
        }
    }
}

impl From<BridgeError> for CommandError {
    fn from(error: BridgeError) -> Self {
        Self {
            message: error.to_string(),
        }
    }
}

impl From<WorkspaceError> for CommandError {
    fn from(error: WorkspaceError) -> Self {
        Self {
            message: error.to_string(),
        }
    }
}

#[tauri::command]
pub async fn current_directory(
    state: State<'_, AppState>,
) -> Result<Option<PathBuf>, CommandError> {
    Ok(state
        .runtime
        .lock()
        .await
        .as_ref()
        .map(|runtime| runtime.cwd.clone()))
}

/// Opens the native folder picker and replaces the cwd-bound Pi runtime when a
/// directory is selected. Canceling the picker leaves the current workspace intact.
#[tauri::command]
pub async fn choose_workspace(state: State<'_, AppState>) -> Result<Option<PathBuf>, CommandError> {
    let selected = tokio::task::spawn_blocking(|| rfd::FileDialog::new().pick_folder())
        .await
        .expect("workspace picker task must not panic");
    let Some(cwd) = selected else {
        return Ok(None);
    };
    let cwd = cwd.canonicalize().map_err(WorkspaceError::from)?;
    let mut runtime = state.runtime.lock().await;
    if runtime.as_ref().is_some_and(|current| current.cwd == cwd) {
        return Ok(Some(cwd));
    }
    if let Some(current) = runtime.take() {
        current.bridge.stop_agent().await?;
    }
    *runtime = Some(WorkspaceRuntime::new(cwd.clone()));
    Ok(Some(cwd))
}

#[tauri::command]
pub async fn list_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<PersistedSession>, CommandError> {
    state
        .runtime
        .lock()
        .await
        .as_ref()
        .ok_or_else(CommandError::workspace_required)?
        .workspace
        .list_sessions()
        .map_err(Into::into)
}

#[tauri::command]
pub async fn session_history(
    state: State<'_, AppState>,
    session_path: PathBuf,
    before: Option<usize>,
    limit: usize,
) -> Result<PersistedHistoryPage, CommandError> {
    state
        .runtime
        .lock()
        .await
        .as_ref()
        .ok_or_else(CommandError::workspace_required)?
        .workspace
        .session_history(session_path, before, limit)
        .map_err(Into::into)
}

#[tauri::command]
pub async fn start_agent(app: AppHandle, state: State<'_, AppState>) -> Result<(), CommandError> {
    let runtime = state.runtime.lock().await;
    let runtime = runtime
        .as_ref()
        .ok_or_else(CommandError::workspace_required)?;
    let bridge = runtime.bridge.clone();
    let cwd = runtime.cwd.clone();
    bridge.start_agent(&cwd).await?;
    start_event_forwarder(app, bridge);
    Ok(())
}

#[tauri::command]
pub async fn send_rpc(state: State<'_, AppState>, request: Value) -> Result<Value, CommandError> {
    let bridge = state
        .runtime
        .lock()
        .await
        .as_ref()
        .ok_or_else(CommandError::workspace_required)?
        .bridge
        .clone();
    bridge.send_rpc(request).await.map_err(Into::into)
}

#[tauri::command]
pub async fn abort_agent(state: State<'_, AppState>) -> Result<Value, CommandError> {
    let bridge = state
        .runtime
        .lock()
        .await
        .as_ref()
        .ok_or_else(CommandError::workspace_required)?
        .bridge
        .clone();
    bridge.abort_agent().await.map_err(Into::into)
}

fn start_event_forwarder(app: AppHandle, bridge: Arc<AgentBridge>) {
    let mut events = bridge.subscribe_events();
    tauri::async_runtime::spawn(async move {
        while let Ok(event) = events.recv().await {
            app.emit(rpc_event_name(), event)
                .expect("Pi RPC event must serialize for the Tauri webview");
        }
    });
}
