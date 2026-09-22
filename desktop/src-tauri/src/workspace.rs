use std::{
    fs, io,
    path::{Path, PathBuf},
};

use serde_json::Value;

#[derive(Debug)]
pub enum WorkspaceError {
    Io(io::Error),
    Json(serde_json::Error),
    SessionOutsideCurrentProject(PathBuf),
}

impl std::fmt::Display for WorkspaceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "workspace storage error: {error}"),
            Self::Json(error) => write!(formatter, "workspace session is invalid JSON: {error}"),
            Self::SessionOutsideCurrentProject(path) => write!(
                formatter,
                "refusing to delete Pi session outside the current project: {}",
                path.display()
            ),
        }
    }
}

impl std::error::Error for WorkspaceError {}
impl From<io::Error> for WorkspaceError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}
impl From<serde_json::Error> for WorkspaceError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

/// Validates that deleting a session cannot escape the active Pi project's session root.
pub struct WorkspaceStore {
    cwd: PathBuf,
    sessions_path: PathBuf,
}

impl WorkspaceStore {
    pub fn new(cwd: PathBuf, sessions_path: PathBuf) -> Self {
        Self { cwd, sessions_path }
    }

    pub fn delete_session(&self, session_path: PathBuf) -> Result<(), WorkspaceError> {
        if !self.session_for_current_project(&session_path)? {
            return Err(WorkspaceError::SessionOutsideCurrentProject(session_path));
        }
        fs::remove_file(session_path)?;
        Ok(())
    }

    fn session_for_current_project(&self, path: &Path) -> Result<bool, WorkspaceError> {
        let canonical_path = fs::canonicalize(path)?;
        let canonical_sessions_path = fs::canonicalize(&self.sessions_path)?;
        if !canonical_path.starts_with(&canonical_sessions_path) {
            return Ok(false);
        }
        let header = fs::read_to_string(canonical_path)?
            .lines()
            .next()
            .map(serde_json::from_str::<Value>)
            .transpose()?
            .ok_or_else(|| WorkspaceError::SessionOutsideCurrentProject(path.to_path_buf()))?;
        Ok(header.get("cwd").and_then(Value::as_str) == self.cwd.to_str())
    }
}

#[cfg(test)]
mod tests {
    use super::{WorkspaceError, WorkspaceStore};
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn deletes_only_a_session_for_the_current_project() {
        let root = std::env::temp_dir().join(format!(
            "pi-app-workspace-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let cwd = root.join("project");
        let sessions = root.join("sessions");
        fs::create_dir_all(&cwd).unwrap();
        fs::create_dir_all(&sessions).unwrap();
        let store = WorkspaceStore::new(cwd.clone(), sessions.clone());
        let current = sessions.join("current.jsonl");
        let foreign = sessions.join("foreign.jsonl");
        fs::write(
            &current,
            format!("{{\"type\":\"session\",\"cwd\":\"{}\"}}\n", cwd.display()),
        )
        .unwrap();
        fs::write(&foreign, "{\"type\":\"session\",\"cwd\":\"/other\"}\n").unwrap();
        store.delete_session(current.clone()).unwrap();
        assert!(!current.exists());
        assert!(matches!(
            store.delete_session(foreign),
            Err(WorkspaceError::SessionOutsideCurrentProject(_))
        ));
        fs::remove_dir_all(root).unwrap();
    }
}
