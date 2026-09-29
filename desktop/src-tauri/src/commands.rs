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
    runtime::{RuntimeBridge, RuntimeError, RuntimeEvent, RuntimeRegistry, RuntimeTarget},
    tags::{SessionTagAssignment, Tag, TagError, TagStore},
    workspace::{PersistedHistoryPage, PersistedSession, WorkspaceError, WorkspaceStore},
};

/// App state owns exactly one canonical workspace and independent session
/// processes. Its opaque identity preserves runtime isolation without exposing a
/// user-manageable Project catalog.
pub struct AppState {
    runtimes: Arc<RuntimeRegistry<AgentBridge>>,
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

    /// Drains all session children before exit. Kept separate from Tauri's
    /// callback so lifecycle behavior has a direct, deterministic test seam.
    pub async fn shutdown_all(&self) -> Vec<RuntimeError> {
        self.runtimes.shutdown_all().await
    }

    fn with_inherited_cwd(inherited_cwd: Option<PathBuf>) -> Self {
        Self {
            runtimes: Arc::new(RuntimeRegistry::new()),
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

    async fn validate_target(
        &self,
        target: &RuntimeTarget,
    ) -> Result<CurrentWorkspace, CommandError> {
        let workspace = self.workspace().await?;
        if target.project_id != workspace.id {
            return Err(CommandError {
                message: "Runtime target is outside the current workspace.".into(),
            });
        }
        Ok(workspace)
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

impl From<RuntimeError> for CommandError {
    fn from(error: RuntimeError) -> Self {
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

/// Opens the native folder picker and atomically replaces the sole workspace.
/// Canceling leaves the current workspace intact.
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

#[tauri::command]
pub async fn start_agent(
    app: AppHandle,
    state: State<'_, AppState>,
    target: RuntimeTarget,
    session_path: Option<PathBuf>,
) -> Result<(), CommandError> {
    let workspace = state.validate_target(&target).await?;
    let bridge = Arc::new(AgentBridge::pi(&default_session_directory(&workspace.path)));
    let generation = state
        .runtimes
        .start(target.clone(), workspace.path, bridge.clone())
        .await?;

    if let Some(session_path) = session_path {
        let activation = restore_session(bridge.as_ref(), &target, &session_path).await;
        if let Err(error) = activation {
            if let Some(entry) = state.runtimes.remove_exact(&target, generation).await {
                let _ = entry.bridge.stop().await;
            }
            return Err(error.into());
        }
    }

    start_event_forwarder(app, state.runtimes.clone(), generation, bridge);
    Ok(())
}

async fn restore_session(
    bridge: &(impl RuntimeBridge + ?Sized),
    target: &RuntimeTarget,
    session_path: &std::path::Path,
) -> Result<(), RuntimeError> {
    let switch = bridge
        .send(serde_json::json!({
            "id": "restore-session",
            "type": "switch_session",
            "sessionPath": session_path,
        }))
        .await?;
    let data = switch.get("data").and_then(Value::as_object);
    if switch.get("success") != Some(&Value::Bool(true))
        || data.and_then(|data| data.get("cancelled")) == Some(&Value::Bool(true))
    {
        return Err(RuntimeError::Bridge(
            "Pi did not restore the requested session".into(),
        ));
    }
    let current = bridge
        .send(serde_json::json!({ "id": "verify-session", "type": "get_state" }))
        .await?;
    let metadata = current.get("data").and_then(Value::as_object);
    if current.get("success") != Some(&Value::Bool(true))
        || metadata.and_then(|data| data.get("sessionId"))
            != Some(&Value::String(target.session_id.clone()))
        || metadata.and_then(|data| data.get("sessionFile"))
            != Some(&Value::String(session_path.to_string_lossy().into_owned()))
    {
        return Err(RuntimeError::Bridge(
            "Pi restored a session different from the requested target".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn bind_session(
    state: State<'_, AppState>,
    target: RuntimeTarget,
    session_id: String,
) -> Result<RuntimeTarget, CommandError> {
    state.validate_target(&target).await?;
    state
        .runtimes
        .rekey(&target, session_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn send_rpc(
    state: State<'_, AppState>,
    target: RuntimeTarget,
    request: Value,
) -> Result<Value, CommandError> {
    state.validate_target(&target).await?;
    state
        .runtimes
        .send(&target, request)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn abort_agent(
    state: State<'_, AppState>,
    target: RuntimeTarget,
) -> Result<Value, CommandError> {
    state.validate_target(&target).await?;
    state.runtimes.abort(&target).await.map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use std::{
        future::Future,
        path::{Path, PathBuf},
        pin::Pin,
        sync::{Arc, Mutex},
    };

    use serde_json::{json, Value};

    use super::{restore_session, AppState, CurrentWorkspace};
    use crate::runtime::{RuntimeBridge, RuntimeError, RuntimeTarget};

    struct RestoreBridge {
        responses: Mutex<Vec<Result<Value, RuntimeError>>>,
        requests: Arc<Mutex<Vec<Value>>>,
    }

    impl RuntimeBridge for RestoreBridge {
        fn start<'a>(
            &'a self,
            _: &'a Path,
        ) -> Pin<Box<dyn Future<Output = Result<(), RuntimeError>> + Send + 'a>> {
            Box::pin(async { Ok(()) })
        }
        fn send<'a>(
            &'a self,
            request: Value,
        ) -> Pin<Box<dyn Future<Output = Result<Value, RuntimeError>> + Send + 'a>> {
            Box::pin(async move {
                self.requests.lock().unwrap().push(request);
                self.responses.lock().unwrap().remove(0)
            })
        }
        fn abort<'a>(
            &'a self,
        ) -> Pin<Box<dyn Future<Output = Result<Value, RuntimeError>> + Send + 'a>> {
            Box::pin(async { Ok(json!({})) })
        }
        fn stop<'a>(
            &'a self,
        ) -> Pin<Box<dyn Future<Output = Result<(), RuntimeError>> + Send + 'a>> {
            Box::pin(async { Ok(()) })
        }
    }

    fn target() -> RuntimeTarget {
        RuntimeTarget {
            project_id: "project-a".into(),
            session_id: "session-a".into(),
        }
    }

    #[tokio::test]
    async fn restore_switches_then_verifies_exact_persisted_identity() {
        let requests = Arc::new(Mutex::new(vec![]));
        let bridge = RestoreBridge {
            responses: Mutex::new(vec![
                Ok(json!({ "success": true, "data": {} })),
                Ok(
                    json!({ "success": true, "data": { "sessionId": "session-a", "sessionFile": "/sessions/a.jsonl" } }),
                ),
            ]),
            requests: requests.clone(),
        };
        restore_session(&bridge, &target(), Path::new("/sessions/a.jsonl"))
            .await
            .unwrap();
        assert_eq!(
            *requests.lock().unwrap(),
            vec![
                json!({ "id": "restore-session", "type": "switch_session", "sessionPath": "/sessions/a.jsonl" }),
                json!({ "id": "verify-session", "type": "get_state" }),
            ]
        );
    }

    #[tokio::test]
    async fn restore_rejects_cancelled_switch_without_state_request() {
        let requests = Arc::new(Mutex::new(vec![]));
        let bridge = RestoreBridge {
            responses: Mutex::new(vec![Ok(
                json!({ "success": true, "data": { "cancelled": true } }),
            )]),
            requests: requests.clone(),
        };
        assert!(
            restore_session(&bridge, &target(), Path::new("/sessions/a.jsonl"))
                .await
                .is_err()
        );
        assert_eq!(requests.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn restore_rejects_mismatched_pi_state() {
        let bridge = RestoreBridge {
            responses: Mutex::new(vec![
                Ok(json!({ "success": true, "data": {} })),
                Ok(
                    json!({ "success": true, "data": { "sessionId": "other", "sessionFile": "/sessions/a.jsonl" } }),
                ),
            ]),
            requests: Arc::new(Mutex::new(vec![])),
        };
        assert!(
            restore_session(&bridge, &target(), Path::new("/sessions/a.jsonl"))
                .await
                .is_err()
        );
    }

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

fn start_event_forwarder(
    app: AppHandle,
    runtimes: Arc<RuntimeRegistry<AgentBridge>>,
    generation: u64,
    bridge: Arc<AgentBridge>,
) {
    let mut events = bridge.subscribe_events();
    tauri::async_runtime::spawn(async move {
        while let Ok(event) = events.recv().await {
            let Some(target) = runtimes.target_for_generation(generation).await else {
                return;
            };
            let terminal = matches!(
                event.get("type").and_then(Value::as_str),
                Some("agent_settled") | Some("bridge_error")
            );
            app.emit(
                rpc_event_name(),
                RuntimeEvent {
                    project_id: target.project_id.clone(),
                    session_id: target.session_id.clone(),
                    generation,
                    event,
                },
            )
            .expect("Pi RPC event envelope must serialize for the Tauri webview");
            if terminal {
                if let Some(entry) = runtimes.remove_exact(&target, generation).await {
                    let _ = entry.bridge.stop().await;
                }
                return;
            }
        }
    });
}
