use std::{
    collections::VecDeque,
    fs, io,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceProject {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSession {
    pub path: PathBuf,
    pub name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub projects: Vec<WorkspaceProject>,
    pub sessions: Vec<ImportedSession>,
}

#[derive(Debug)]
pub enum WorkspaceError {
    Io(io::Error),
    Json(serde_json::Error),
    InvalidName(&'static str),
    ProjectNotFound(String),
    SessionOutsideCurrentProject(PathBuf),
}

impl std::fmt::Display for WorkspaceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "workspace storage error: {error}"),
            Self::Json(error) => write!(formatter, "workspace metadata is invalid JSON: {error}"),
            Self::InvalidName(entity) => write!(formatter, "{entity} name must not be empty"),
            Self::ProjectNotFound(id) => {
                write!(formatter, "workspace project does not exist: {id}")
            }
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

/// Owns local project metadata and validates Pi JSONL sessions for one working directory.
pub struct WorkspaceStore {
    cwd: PathBuf,
    metadata_path: PathBuf,
    sessions_path: PathBuf,
}

impl WorkspaceStore {
    pub fn new(cwd: PathBuf, app_data_path: PathBuf, sessions_path: PathBuf) -> Self {
        Self {
            cwd,
            metadata_path: app_data_path.join("workspace-projects.json"),
            sessions_path,
        }
    }

    pub fn snapshot(&self) -> Result<WorkspaceSnapshot, WorkspaceError> {
        Ok(WorkspaceSnapshot {
            projects: self.projects()?,
            sessions: self.sessions()?,
        })
    }

    pub fn create_project(&self, name: String) -> Result<WorkspaceProject, WorkspaceError> {
        let name = required_name(name, "project")?;
        let mut projects = self.projects()?;
        let project = WorkspaceProject {
            id: format!(
                "project-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .expect("system clock must be after Unix epoch")
                    .as_nanos()
            ),
            name,
            path: self.cwd.clone(),
        };
        projects.push(project.clone());
        self.save_projects(&projects)?;
        Ok(project)
    }

    pub fn rename_project(
        &self,
        id: String,
        name: String,
    ) -> Result<WorkspaceProject, WorkspaceError> {
        let name = required_name(name, "project")?;
        let mut projects = self.projects()?;
        let project = projects
            .iter_mut()
            .find(|project| project.id == id)
            .ok_or_else(|| WorkspaceError::ProjectNotFound(id.clone()))?;
        project.name = name;
        let renamed = project.clone();
        self.save_projects(&projects)?;
        Ok(renamed)
    }

    pub fn delete_project(&self, id: String) -> Result<(), WorkspaceError> {
        let mut projects = self.projects()?;
        let count_before = projects.len();
        projects.retain(|project| project.id != id);
        if projects.len() == count_before {
            return Err(WorkspaceError::ProjectNotFound(id));
        }
        self.save_projects(&projects)
    }

    pub fn delete_session(&self, session_path: PathBuf) -> Result<(), WorkspaceError> {
        if self.session_for_current_project(&session_path)?.is_none() {
            return Err(WorkspaceError::SessionOutsideCurrentProject(session_path));
        }
        fs::remove_file(session_path)?;
        Ok(())
    }

    fn projects(&self) -> Result<Vec<WorkspaceProject>, WorkspaceError> {
        match fs::read(&self.metadata_path) {
            Ok(contents) => Ok(serde_json::from_slice(&contents)?),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(error.into()),
        }
    }

    fn save_projects(&self, projects: &[WorkspaceProject]) -> Result<(), WorkspaceError> {
        let parent = self
            .metadata_path
            .parent()
            .expect("workspace metadata path always has a parent");
        fs::create_dir_all(parent)?;
        fs::write(&self.metadata_path, serde_json::to_vec_pretty(projects)?)?;
        Ok(())
    }

    fn sessions(&self) -> Result<Vec<ImportedSession>, WorkspaceError> {
        let mut sessions = Vec::new();
        for path in jsonl_files(&self.sessions_path)? {
            if let Some(session) = self.session_for_current_project(&path)? {
                sessions.push(session);
            }
        }
        sessions.sort_by(|left, right| right.path.cmp(&left.path));
        Ok(sessions)
    }

    fn session_for_current_project(
        &self,
        path: &Path,
    ) -> Result<Option<ImportedSession>, WorkspaceError> {
        let canonical_path = fs::canonicalize(path)?;
        let canonical_sessions_path = fs::canonicalize(&self.sessions_path)?;
        if !canonical_path.starts_with(&canonical_sessions_path) {
            return Ok(None);
        }

        let contents = fs::read_to_string(&canonical_path)?;
        let mut records = contents.lines().map(serde_json::from_str::<Value>);
        let header = match records.next() {
            Some(record) => record?,
            None => return Ok(None),
        };
        if header.get("cwd").and_then(Value::as_str) != self.cwd.to_str() {
            return Ok(None);
        }
        let name = records.rev().find_map(|record| {
            let record = record.ok()?;
            (record.get("type").and_then(Value::as_str) == Some("session_info"))
                .then(|| record.get("name").and_then(Value::as_str))
                .flatten()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(ToOwned::to_owned)
        });
        Ok(Some(ImportedSession {
            path: canonical_path,
            name,
        }))
    }
}

fn required_name(name: String, entity: &'static str) -> Result<String, WorkspaceError> {
    let name = name.trim().to_owned();
    if name.is_empty() {
        return Err(WorkspaceError::InvalidName(entity));
    }
    Ok(name)
}

fn jsonl_files(root: &Path) -> Result<Vec<PathBuf>, WorkspaceError> {
    let mut paths = Vec::new();
    if !root.exists() {
        return Ok(paths);
    }
    let mut directories = VecDeque::from([root.to_path_buf()]);
    while let Some(directory) = directories.pop_front() {
        for entry in fs::read_dir(directory)? {
            let path = entry?.path();
            if path.is_dir() {
                directories.push_back(path);
            } else if path.extension().and_then(|extension| extension.to_str()) == Some("jsonl") {
                paths.push(path);
            }
        }
    }
    Ok(paths)
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{WorkspaceError, WorkspaceStore};

    fn fixture() -> (PathBuf, WorkspaceStore) {
        let root = std::env::temp_dir().join(format!(
            "pi-app-workspace-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&root);
        let cwd = root.join("project");
        let sessions = root.join("sessions");
        fs::create_dir_all(&cwd).unwrap();
        fs::create_dir_all(&sessions).unwrap();
        let store = WorkspaceStore::new(cwd, root.join("metadata"), sessions);
        (root, store)
    }

    #[test]
    fn persists_project_crud() {
        let (root, store) = fixture();
        let project = store.create_project(" Pi App ".into()).unwrap();
        assert_eq!(project.name, "Pi App");
        assert_eq!(
            store
                .rename_project(project.id.clone(), "Desktop".into())
                .unwrap()
                .name,
            "Desktop"
        );
        assert_eq!(store.snapshot().unwrap().projects.len(), 1);
        store.delete_project(project.id).unwrap();
        assert!(store.snapshot().unwrap().projects.is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn imports_and_deletes_only_sessions_for_the_current_project() {
        let (root, store) = fixture();
        let sessions = root.join("sessions");
        let current = sessions.join("current.jsonl");
        let foreign = sessions.join("foreign.jsonl");
        fs::write(
            &current,
            format!(
                "{{\"type\":\"session\",\"cwd\":\"{}\"}}\n{{\"type\":\"session_info\",\"name\":\"Imported\"}}\n",
                root.join("project").display()
            ),
        )
        .unwrap();
        fs::write(&foreign, "{\"type\":\"session\",\"cwd\":\"/other\"}\n").unwrap();

        let snapshot = store.snapshot().unwrap();
        assert_eq!(snapshot.sessions.len(), 1);
        assert_eq!(snapshot.sessions[0].name.as_deref(), Some("Imported"));
        store.delete_session(current.clone()).unwrap();
        assert!(!current.exists());
        assert!(matches!(
            store.delete_session(foreign),
            Err(WorkspaceError::SessionOutsideCurrentProject(_))
        ));
        fs::remove_dir_all(root).unwrap();
    }
}
