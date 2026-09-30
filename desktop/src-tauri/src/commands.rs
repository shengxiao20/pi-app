use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    path::PathBuf,
    sync::Arc,
};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

use crate::{
    rpc::bridge::{rpc_event_name, AgentBridge, BridgeError},
    session_process::{SessionProcess, SessionProcessEvent, SessionProcessManager},
    tags::{SessionTagAssignment, Tag, TagError, TagStore},
    workspace::{PersistedHistoryPage, PersistedSession, WorkspaceError, WorkspaceStore},
};

/// The app has one visible workspace. Each active Pi session owns a separate
/// RPC child process, allowing one session to stream without blocking another.
pub struct AppState {
    processes: Arc<SessionProcessManager>,
    selected_directory: Mutex<Option<PathBuf>>,
}

impl AppState {
    pub fn new(cwd: PathBuf) -> Self {
        Self::with_inherited_cwd(
            std::env::var_os("PI_APP_INHERITED_CWD")
                .is_some()
                .then_some(cwd),
        )
    }

    pub async fn shutdown_all(&self) -> Vec<BridgeError> {
        self.processes.shutdown_all().await
    }

    fn with_inherited_cwd(inherited_cwd: Option<PathBuf>) -> Self {
        Self {
            processes: Arc::new(SessionProcessManager::new()),
            selected_directory: Mutex::new(inherited_cwd),
        }
    }

    async fn workspace(&self) -> Result<CurrentWorkspace, CommandError> {
        let path = self
            .selected_directory
            .lock()
            .await
            .clone()
            .ok_or_else(|| CommandError {
                message: "Select a workspace to start Pi.".into(),
            })?;
        CurrentWorkspace::new(path)
    }

    async fn workspace_store(&self) -> Result<WorkspaceStore, CommandError> {
        let workspace = self.workspace().await?;
        let sessions_path = default_session_directory(&workspace.path);
        Ok(WorkspaceStore::new(workspace.path, sessions_path))
    }

    fn tag_store(app: &AppHandle) -> Result<TagStore, CommandError> {
        let app_data = app.path().app_data_dir().map_err(|error| CommandError {
            message: error.to_string(),
        })?;
        std::fs::create_dir_all(&app_data).map_err(|error| CommandError {
            message: format!("Cannot create app data directory: {error}"),
        })?;
        TagStore::open(app_data.join("tags.sqlite")).map_err(Into::into)
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentWorkspace {
    id: String,
    path: PathBuf,
    display_name: String,
}

impl CurrentWorkspace {
    fn new(path: PathBuf) -> Result<Self, CommandError> {
        let path = path.canonicalize().map_err(|error| CommandError {
            message: format!("Workspace directory is invalid: {error}"),
        })?;
        if !path.is_dir() {
            return Err(CommandError {
                message: "Workspace path is not a directory.".into(),
            });
        }
        let mut hasher = DefaultHasher::new();
        path.hash(&mut hasher);
        let display_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.trim().is_empty())
            .unwrap_or("Workspace")
            .to_owned();
        Ok(Self {
            id: format!("workspace-{:016x}", hasher.finish()),
            path,
            display_name,
        })
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

#[derive(Debug, Serialize)]
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
impl From<TagError> for CommandError {
    fn from(error: TagError) -> Self {
        Self {
            message: error.to_string(),
        }
    }
}

#[tauri::command]
pub async fn current_workspace(
    state: State<'_, AppState>,
) -> Result<Option<CurrentWorkspace>, CommandError> {
    let directory = state.selected_directory.lock().await.clone();
    directory.map(CurrentWorkspace::new).transpose()
}

/// Opens the native folder picker and replaces the sole visible workspace.
#[tauri::command]
pub async fn choose_workspace(
    state: State<'_, AppState>,
) -> Result<Option<CurrentWorkspace>, CommandError> {
    let selected = tokio::task::spawn_blocking(|| rfd::FileDialog::new().pick_folder())
        .await
        .expect("workspace picker task must not panic");
    let Some(path) = selected else {
        return Ok(None);
    };
    let workspace = CurrentWorkspace::new(path)?;
    *state.selected_directory.lock().await = Some(workspace.path.clone());
    Ok(Some(workspace))
}

#[tauri::command]
pub async fn list_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<PersistedSession>, CommandError> {
    state
        .workspace_store()
        .await?
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
        .workspace_store()
        .await?
        .session_history(session_path, before, limit)
        .map_err(Into::into)
}

#[tauri::command]
pub async fn list_tags(app: AppHandle) -> Result<Vec<Tag>, CommandError> {
    AppState::tag_store(&app)?.list_tags().map_err(Into::into)
}
#[tauri::command]
pub async fn create_tag(app: AppHandle, name: String) -> Result<Tag, CommandError> {
    AppState::tag_store(&app)?
        .create_tag(&name)
        .map_err(Into::into)
}
#[tauri::command]
pub async fn rename_tag(app: AppHandle, id: i64, name: String) -> Result<Tag, CommandError> {
    AppState::tag_store(&app)?
        .rename_tag(id, &name)
        .map_err(Into::into)
}
#[tauri::command]
pub async fn delete_tag(app: AppHandle, id: i64) -> Result<(), CommandError> {
    AppState::tag_store(&app)?
        .delete_tag(id)
        .map_err(Into::into)
}
#[tauri::command]
pub async fn list_session_tag_assignments(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<SessionTagAssignment>, CommandError> {
    let workspace = state.workspace().await?;
    AppState::tag_store(&app)?
        .assignments(&workspace.path)
        .map_err(Into::into)
}
#[tauri::command]
pub async fn assign_session_tag(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    tag_id: Option<i64>,
) -> Result<(), CommandError> {
    let workspace = state.workspace().await?;
    AppState::tag_store(&app)?
        .assign(&workspace.path, &session_id, tag_id)
        .map_err(Into::into)
}

/// Starts the dedicated Pi process for one persisted session. Pi opens the
/// session itself through `--session`; no global `switch_session` is used.
#[tauri::command]
pub async fn start_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    session_path: PathBuf,
) -> Result<(), CommandError> {
    let workspace = state.workspace().await?;
    let process = state
        .processes
        .start(
            session_id.clone(),
            Some(&session_path),
            &default_session_directory(&workspace.path),
            &workspace.path,
        )
        .await?;
    start_event_forwarder(app, state.processes.clone(), session_id, process);
    Ok(())
}

/// Creates a Pi session in its own process, then registers that process by the
/// stable session ID Pi returned. The temporary process is never exposed to UI.
#[tauri::command]
pub async fn create_session(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<PersistedSession, CommandError> {
    let workspace = state.workspace().await?;
    let bridge = Arc::new(AgentBridge::pi(
        &default_session_directory(&workspace.path),
        None,
    ));
    bridge.start_agent(&workspace.path).await?;
    bridge
        .send_rpc(serde_json::json!({ "id": "create-session", "type": "new_session" }))
        .await?;
    let response = bridge
        .send_rpc(serde_json::json!({ "id": "create-session-state", "type": "get_state" }))
        .await?;
    let metadata = response
        .get("data")
        .and_then(Value::as_object)
        .ok_or_else(|| CommandError {
            message: "Pi did not return the new session state.".into(),
        })?;
    let id = metadata
        .get("sessionId")
        .and_then(Value::as_str)
        .ok_or_else(|| CommandError {
            message: "Pi did not return a new session id.".into(),
        })?
        .to_owned();
    let path = metadata
        .get("sessionFile")
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .ok_or_else(|| CommandError {
            message: "Pi did not return a new session file.".into(),
        })?;
    let process = state.processes.register(id.clone(), bridge).await?;
    start_event_forwarder(app, state.processes.clone(), id.clone(), process);
    Ok(PersistedSession {
        id: id.clone(),
        path,
        title: id,
    })
}

#[tauri::command]
pub async fn send_rpc(
    state: State<'_, AppState>,
    session_id: String,
    request: Value,
) -> Result<Value, CommandError> {
    Ok(state
        .processes
        .process(&session_id)
        .await?
        .bridge
        .send_rpc(request)
        .await?)
}

#[tauri::command]
pub async fn abort_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Value, CommandError> {
    Ok(state
        .processes
        .process(&session_id)
        .await?
        .bridge
        .abort_agent()
        .await?)
}

fn start_event_forwarder(
    app: AppHandle,
    processes: Arc<SessionProcessManager>,
    session_id: String,
    process: SessionProcess,
) {
    let mut events = process.bridge.subscribe_events();
    tauri::async_runtime::spawn(async move {
        while let Ok(event) = events.recv().await {
            let terminal = matches!(
                event.get("type").and_then(Value::as_str),
                Some("agent_settled") | Some("bridge_error")
            );
            app.emit(
                rpc_event_name(),
                SessionProcessEvent {
                    session_id: session_id.clone(),
                    instance_id: process.instance_id,
                    event,
                },
            )
            .expect("Pi RPC event envelope must serialize for the Tauri webview");
            if terminal {
                if let Some(process) = processes
                    .remove_if_current(&session_id, process.instance_id)
                    .await
                {
                    let _ = process.bridge.stop_agent().await;
                }
                return;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{AppState, CurrentWorkspace};
    use std::path::PathBuf;

    #[test]
    fn canonical_workspace_has_a_stable_opaque_identity() {
        let directory =
            std::env::temp_dir().join(format!("pi-app-current-workspace-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let first = CurrentWorkspace::new(directory.clone()).unwrap();
        let second = CurrentWorkspace::new(directory).unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(first.path, second.path);
    }

    #[test]
    fn inherited_cwd_is_the_initial_workspace_while_gui_start_has_none() {
        let terminal_cwd = PathBuf::from("/tmp/pi-app-terminal-workspace");
        assert_eq!(
            AppState::with_inherited_cwd(Some(terminal_cwd.clone()))
                .selected_directory
                .blocking_lock()
                .as_deref(),
            Some(terminal_cwd.as_path())
        );
        assert!(AppState::with_inherited_cwd(None)
            .selected_directory
            .blocking_lock()
            .is_none());
    }
}
