use std::{path::PathBuf, sync::Arc};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

use crate::{
    rpc::bridge::{rpc_event_name, AgentBridge, BridgeError},
    workspace::{WorkspaceError, WorkspaceProject, WorkspaceSnapshot, WorkspaceStore},
};

pub struct AppState {
    bridge: Arc<AgentBridge>,
    cwd: PathBuf,
    workspace: WorkspaceStore,
    event_forwarder_started: Mutex<bool>,
}

impl AppState {
    pub fn new(cwd: PathBuf) -> Self {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .expect("Pi App desktop client requires a HOME directory");
        Self {
            bridge: Arc::new(AgentBridge::pi()),
            workspace: WorkspaceStore::new(
                cwd.clone(),
                home.join(".pi").join("app"),
                home.join(".pi").join("agent").join("sessions"),
            ),
            cwd,
            event_forwarder_started: Mutex::new(false),
        }
    }
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
pub fn load_workspace(state: State<'_, AppState>) -> Result<WorkspaceSnapshot, CommandError> {
    state.workspace.snapshot().map_err(Into::into)
}

#[tauri::command]
pub fn create_project(
    state: State<'_, AppState>,
    name: String,
) -> Result<WorkspaceProject, CommandError> {
    state.workspace.create_project(name).map_err(Into::into)
}

#[tauri::command]
pub fn rename_project(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<WorkspaceProject, CommandError> {
    state.workspace.rename_project(id, name).map_err(Into::into)
}

#[tauri::command]
pub fn delete_project(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    state.workspace.delete_project(id).map_err(Into::into)
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
