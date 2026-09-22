use std::{path::PathBuf, sync::Arc};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

use crate::{
    rpc::bridge::{rpc_event_name, AgentBridge, BridgeError},
    workspace::{PersistedHistoryPage, PersistedSession, WorkspaceError, WorkspaceStore},
};

pub struct AppState {
    bridge: Arc<AgentBridge>,
    cwd: PathBuf,
    launch_session: Option<PathBuf>,
    workspace: WorkspaceStore,
    event_forwarder_started: Mutex<bool>,
}

impl AppState {
    pub fn new(cwd: PathBuf, launch_session: Option<PathBuf>) -> Self {
        let sessions_path = launch_session
            .as_ref()
            .and_then(|session| session.parent().map(PathBuf::from))
            .unwrap_or_else(|| default_session_directory(&cwd));
        Self {
            bridge: Arc::new(AgentBridge::pi(&sessions_path)),
            workspace: WorkspaceStore::new(cwd.clone(), sessions_path),
            cwd,
            launch_session,
            event_forwarder_started: Mutex::new(false),
        }
    }
}

fn default_session_directory(cwd: &std::path::Path) -> PathBuf {
    let cwd = cwd
        .canonicalize()
        .expect("Pi App desktop client requires a canonical current working directory");
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
pub fn launch_session(state: State<'_, AppState>) -> Option<PathBuf> {
    state.launch_session.clone()
}

#[tauri::command]
pub fn current_directory(state: State<'_, AppState>) -> Result<PathBuf, CommandError> {
    state
        .cwd
        .canonicalize()
        .map_err(WorkspaceError::from)
        .map_err(Into::into)
}

#[tauri::command]
pub fn list_sessions(state: State<'_, AppState>) -> Result<Vec<PersistedSession>, CommandError> {
    state.workspace.list_sessions().map_err(Into::into)
}

#[tauri::command]
pub fn session_history(
    state: State<'_, AppState>,
    session_path: PathBuf,
    before: Option<usize>,
    limit: usize,
) -> Result<PersistedHistoryPage, CommandError> {
    state
        .workspace
        .session_history(session_path, before, limit)
        .map_err(Into::into)
}

#[tauri::command]
pub fn delete_session(
    state: State<'_, AppState>,
    session_path: PathBuf,
) -> Result<(), CommandError> {
    state
        .workspace
        .delete_session(session_path)
        .map_err(Into::into)
}

#[tauri::command]
pub async fn start_agent(app: AppHandle, state: State<'_, AppState>) -> Result<(), CommandError> {
    state.bridge.start_agent(&state.cwd).await?;
    start_event_forwarder(app, &state).await;
    Ok(())
}

#[tauri::command]
pub async fn send_rpc(state: State<'_, AppState>, request: Value) -> Result<Value, CommandError> {
    state.bridge.send_rpc(request).await.map_err(Into::into)
}

#[tauri::command]
pub async fn abort_agent(state: State<'_, AppState>) -> Result<Value, CommandError> {
    state.bridge.abort_agent().await.map_err(Into::into)
}

async fn start_event_forwarder(app: AppHandle, state: &AppState) {
    let mut event_forwarder_started = state.event_forwarder_started.lock().await;
    if *event_forwarder_started {
        return;
    }
    *event_forwarder_started = true;

    let mut events = state.bridge.subscribe_events();
    tauri::async_runtime::spawn(async move {
        while let Ok(event) = events.recv().await {
            app.emit(rpc_event_name(), event)
                .expect("Pi RPC event must serialize for the Tauri webview");
        }
    });
}
