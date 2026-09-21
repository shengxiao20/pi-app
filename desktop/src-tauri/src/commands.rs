use std::{path::PathBuf, sync::Arc};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

use crate::rpc::bridge::{rpc_event_name, AgentBridge, BridgeError};

pub struct AppState {
    bridge: Arc<AgentBridge>,
    cwd: PathBuf,
    event_forwarder_started: Mutex<bool>,
}

impl AppState {
    pub fn new(cwd: PathBuf) -> Self {
        Self {
            bridge: Arc::new(AgentBridge::pi()),
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
