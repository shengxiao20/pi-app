use std::{path::PathBuf, sync::Arc};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

use crate::{
    projects::{Project, ProjectError},
    rpc::bridge::{rpc_event_name, AgentBridge, BridgeError},
    runtime::{
        ProjectRuntimeSnapshot, RuntimeBridge, RuntimeError, RuntimeEvent, RuntimeRegistry,
        RuntimeTarget,
    },
    workspace::{PersistedHistoryPage, PersistedSession, WorkspaceError, WorkspaceStore},
};

/// App state owns persisted project metadata and independent running session
/// processes. UI selection is deliberately not a runtime routing mechanism.
pub struct AppState {
    runtimes: Arc<RuntimeRegistry<AgentBridge>>,
    inherited_cwd: Option<PathBuf>,
    selected_directory: Mutex<Option<PathBuf>>,
    projects: Mutex<Option<crate::projects::ProjectCatalog>>,
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
            inherited_cwd: inherited_cwd.clone(),
            selected_directory: Mutex::new(inherited_cwd),
            projects: Mutex::new(None),
        }
    }

    fn catalog<'a>(
        &'a self,
        app: &AppHandle,
        catalog: &'a mut Option<crate::projects::ProjectCatalog>,
    ) -> Result<&'a mut crate::projects::ProjectCatalog, CommandError> {
        if catalog.is_none() {
            *catalog = Some(crate::projects::ProjectCatalog::load(
                app.path().app_data_dir().map_err(|error| CommandError {
                    message: error.to_string(),
                })?,
            )?);
        }
        Ok(catalog.as_mut().expect("catalog initialized"))
    }

    async fn initialize_inherited_project(&self, app: &AppHandle) -> Result<(), CommandError> {
        let Some(cwd) = &self.inherited_cwd else {
            return Ok(());
        };
        let mut catalog = self.projects.lock().await;
        self.catalog(app, &mut catalog)?.upsert(cwd)?;
        Ok(())
    }

    async fn project_workspace(
        &self,
        app: &AppHandle,
        project_id: &str,
    ) -> Result<WorkspaceStore, CommandError> {
        self.initialize_inherited_project(app).await?;
        let project = {
            let mut catalog = self.projects.lock().await;
            self.catalog(app, &mut catalog)?.get(project_id)?
        };
        let sessions_path = default_session_directory(&project.path);
        Ok(WorkspaceStore::new(project.path, sessions_path))
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

impl From<ProjectError> for CommandError {
    fn from(error: ProjectError) -> Self {
        Self {
            message: error.to_string(),
        }
    }
}

#[tauri::command]
pub async fn current_directory(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<PathBuf>, CommandError> {
    state.initialize_inherited_project(&app).await?;
    Ok(state.selected_directory.lock().await.clone())
}

#[tauri::command]
pub async fn list_projects(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<Project>, CommandError> {
    state.initialize_inherited_project(&app).await?;
    let mut catalog = state.projects.lock().await;
    Ok(state.catalog(&app, &mut catalog)?.projects())
}

#[tauri::command]
pub async fn add_project(
    app: AppHandle,
    state: State<'_, AppState>,
    path: PathBuf,
) -> Result<Project, CommandError> {
    let project = {
        let mut catalog = state.projects.lock().await;
        state.catalog(&app, &mut catalog)?.upsert(path)?
    };
    *state.selected_directory.lock().await = Some(project.path.clone());
    Ok(project)
}

#[tauri::command]
pub async fn select_project(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Project, CommandError> {
    let project = {
        let mut catalog = state.projects.lock().await;
        state.catalog(&app, &mut catalog)?.touch(&project_id)?
    };
    *state.selected_directory.lock().await = Some(project.path.clone());
    Ok(project)
}

#[tauri::command]
pub async fn rename_project(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    display_name: String,
) -> Result<Project, CommandError> {
    let mut catalog = state.projects.lock().await;
    Ok(state
        .catalog(&app, &mut catalog)?
        .rename(&project_id, display_name)?)
}

#[tauri::command]
pub async fn project_runtime_snapshot(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<ProjectRuntimeSnapshot, CommandError> {
    Ok(state.runtimes.project_snapshot(&project_id).await)
}

#[tauri::command]
pub async fn remove_project(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    snapshot: ProjectRuntimeSnapshot,
) -> Result<Project, CommandError> {
    if snapshot.project_id != project_id {
        return Err(CommandError {
            message: "Removal confirmation does not match the project".into(),
        });
    }
    let stop_errors = state.runtimes.drain_confirmed_project(&snapshot).await?;
    if !stop_errors.is_empty() {
        return Err(CommandError {
            message: stop_errors
                .into_iter()
                .map(|error| error.to_string())
                .collect::<Vec<_>>()
                .join("; "),
        });
    }
    let project = {
        let mut catalog = state.projects.lock().await;
        state.catalog(&app, &mut catalog)?.remove(&project_id)?
    };
    if state
        .selected_directory
        .lock()
        .await
        .as_ref()
        .is_some_and(|directory| directory == &project.path)
    {
        *state.selected_directory.lock().await = None;
    }
    Ok(project)
}

/// Opens the native folder picker and replaces the cwd-bound Pi runtime when a
/// directory is selected. Canceling the picker leaves the current workspace intact.
#[tauri::command]
pub async fn choose_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<PathBuf>, CommandError> {
    let selected = tokio::task::spawn_blocking(|| rfd::FileDialog::new().pick_folder())
        .await
        .expect("workspace picker task must not panic");
    let Some(cwd) = selected else {
        return Ok(None);
    };
    let project = {
        let mut catalog = state.projects.lock().await;
        state.catalog(&app, &mut catalog)?.upsert(cwd)?
    };
    *state.selected_directory.lock().await = Some(project.path.clone());
    Ok(Some(project.path))
}

#[tauri::command]
pub async fn list_sessions(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<PersistedSession>, CommandError> {
    state
        .project_workspace(&app, &project_id)
        .await?
        .list_sessions()
        .map_err(Into::into)
}

#[tauri::command]
pub async fn session_history(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    session_path: PathBuf,
    before: Option<usize>,
    limit: usize,
) -> Result<PersistedHistoryPage, CommandError> {
    state
        .project_workspace(&app, &project_id)
        .await?
        .session_history(session_path, before, limit)
        .map_err(Into::into)
}

#[tauri::command]
pub async fn start_agent(
    app: AppHandle,
    state: State<'_, AppState>,
    target: RuntimeTarget,
    session_path: Option<PathBuf>,
) -> Result<(), CommandError> {
    let project = {
        let mut catalog = state.projects.lock().await;
        state.catalog(&app, &mut catalog)?.get(&target.project_id)?
    };
    let bridge = Arc::new(AgentBridge::pi(&default_session_directory(&project.path)));
    let generation = state
        .runtimes
        .start(target.clone(), project.path, bridge.clone())
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

    use super::{restore_session, AppState};
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
    fn inherited_cwd_is_explicit_while_gui_start_has_no_project_source() {
        let terminal_cwd = PathBuf::from("/tmp/pi-app-terminal-project");
        assert_eq!(
            AppState::with_inherited_cwd(Some(terminal_cwd.clone())).inherited_cwd,
            Some(terminal_cwd)
        );
        assert_eq!(AppState::with_inherited_cwd(None).inherited_cwd, None);
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
