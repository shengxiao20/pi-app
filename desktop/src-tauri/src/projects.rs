use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

const CATALOG_VERSION: u32 = 1;
static NEXT_PROJECT_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Debug)]
pub enum ProjectError {
    Corrupt(serde_json::Error),
    InvalidDirectory(std::io::Error),
    BlankDisplayName,
    NotFound(String),
}

impl std::fmt::Display for ProjectError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Corrupt(error) => write!(formatter, "project catalog is corrupt: {error}"),
            Self::InvalidDirectory(error) => {
                write!(formatter, "project directory is invalid: {error}")
            }
            Self::BlankDisplayName => formatter.write_str("project display name cannot be blank"),
            Self::NotFound(id) => write!(formatter, "project not found: {id}"),
        }
    }
}

impl std::error::Error for ProjectError {}

impl From<serde_json::Error> for ProjectError {
    fn from(error: serde_json::Error) -> Self {
        Self::Corrupt(error)
    }
}

impl From<std::io::Error> for ProjectError {
    fn from(error: std::io::Error) -> Self {
        Self::InvalidDirectory(error)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub path: PathBuf,
    pub display_name: String,
    pub last_opened: u64,
}

#[derive(Debug, Deserialize, Serialize)]
struct CatalogFile {
    version: u32,
    projects: Vec<Project>,
}

/// A versioned, atomically persisted directory catalog. It owns only app metadata;
/// project directories and Pi session files are never written or deleted here.
pub struct ProjectCatalog {
    path: PathBuf,
    projects: Vec<Project>,
}

impl ProjectCatalog {
    pub fn load(app_data: impl AsRef<Path>) -> Result<Self, ProjectError> {
        let path = app_data.as_ref().join("projects.json");
        match fs::read(&path) {
            Ok(bytes) => {
                let catalog: CatalogFile = serde_json::from_slice(&bytes)?;
                if catalog.version != CATALOG_VERSION {
                    return Err(ProjectError::Corrupt(serde_json::Error::io(
                        std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            format!("unsupported catalog version {}", catalog.version),
                        ),
                    )));
                }
                Ok(Self {
                    path,
                    projects: catalog.projects,
                })
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Self {
                path,
                projects: vec![],
            }),
            Err(error) => Err(error.into()),
        }
    }

    pub fn contains_path(&self, path: &Path) -> bool {
        self.projects.iter().any(|project| project.path == path)
    }

    pub fn projects(&self) -> Vec<Project> {
        let mut projects = self.projects.clone();
        projects.sort_by_key(|project| std::cmp::Reverse(project.last_opened));
        projects
    }

    pub fn get(&self, id: &str) -> Result<Project, ProjectError> {
        self.projects
            .iter()
            .find(|project| project.id == id)
            .cloned()
            .ok_or_else(|| ProjectError::NotFound(id.into()))
    }

    pub fn upsert(&mut self, directory: impl AsRef<Path>) -> Result<Project, ProjectError> {
        let path = directory.as_ref().canonicalize()?;
        if !path.is_dir() {
            return Err(ProjectError::InvalidDirectory(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "path is not a directory",
            )));
        }
        let now = now();
        if let Some(index) = self
            .projects
            .iter()
            .position(|project| project.path == path)
        {
            self.projects[index].last_opened = now;
            let project = self.projects[index].clone();
            self.persist()?;
            return Ok(project);
        }
        let display_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.trim().is_empty())
            .unwrap_or("Project")
            .to_owned();
        let project = Project {
            id: new_id(),
            path,
            display_name,
            last_opened: now,
        };
        self.projects.push(project.clone());
        self.persist()?;
        Ok(project)
    }

    pub fn rename(&mut self, id: &str, display_name: String) -> Result<Project, ProjectError> {
        if display_name.trim().is_empty() {
            return Err(ProjectError::BlankDisplayName);
        }
        let project = self
            .projects
            .iter_mut()
            .find(|project| project.id == id)
            .ok_or_else(|| ProjectError::NotFound(id.into()))?;
        project.display_name = display_name.trim().to_owned();
        project.last_opened = now();
        let updated = project.clone();
        self.persist()?;
        Ok(updated)
    }

    pub fn touch(&mut self, id: &str) -> Result<Project, ProjectError> {
        let index = self
            .projects
            .iter()
            .position(|project| project.id == id)
            .ok_or_else(|| ProjectError::NotFound(id.into()))?;
        self.projects[index].last_opened = now();
        let project = self.projects[index].clone();
        self.persist()?;
        Ok(project)
    }

    pub fn remove(&mut self, id: &str) -> Result<Project, ProjectError> {
        let index = self
            .projects
            .iter()
            .position(|project| project.id == id)
            .ok_or_else(|| ProjectError::NotFound(id.into()))?;
        let project = self.projects.remove(index);
        self.persist()?;
        Ok(project)
    }

    fn persist(&self) -> Result<(), ProjectError> {
        let parent = self.path.parent().expect("catalog path has a parent");
        fs::create_dir_all(parent)?;
        let temporary = self.path.with_extension("json.tmp");
        let bytes = serde_json::to_vec_pretty(&CatalogFile {
            version: CATALOG_VERSION,
            projects: self.projects.clone(),
        })?;
        let mut file = File::create(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        fs::rename(temporary, &self.path)?;
        Ok(())
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is after epoch")
        .as_millis() as u64
}
fn new_id() -> String {
    format!(
        "project-{}-{}",
        now(),
        NEXT_PROJECT_ID.fetch_add(1, Ordering::Relaxed)
    )
}

#[cfg(test)]
mod tests {
    use super::ProjectCatalog;
    use std::fs;

    fn root(name: &str) -> std::path::PathBuf {
        let root =
            std::env::temp_dir().join(format!("pi-app-projects-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn persists_deduplicates_and_keeps_custom_names() {
        let root = root("round-trip");
        let first = root.join("first");
        let second = root.join("second");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        let app_data = root.join("app-data");
        let mut catalog = ProjectCatalog::load(&app_data).unwrap();
        let first_project = catalog.upsert(&first).unwrap();
        let second_project = catalog.upsert(&second).unwrap();
        catalog
            .rename(&first_project.id, "My first project".into())
            .unwrap();
        assert_eq!(catalog.upsert(&first).unwrap().id, first_project.id);
        let reloaded = ProjectCatalog::load(&app_data).unwrap();
        assert_eq!(reloaded.projects().len(), 2);
        assert_eq!(reloaded.projects()[0].id, first_project.id);
        assert_eq!(reloaded.projects()[0].display_name, "My first project");
        assert_ne!(first_project.id, second_project.id);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rename_remove_and_unknown_ids_are_persisted_or_rejected() {
        let root = root("mutations");
        let project_path = root.join("project");
        fs::create_dir_all(&project_path).unwrap();
        let app_data = root.join("app-data");
        let mut catalog = ProjectCatalog::load(&app_data).unwrap();
        let project = catalog.upsert(&project_path).unwrap();

        assert!(catalog.rename(&project.id, " ".into()).is_err());
        assert!(catalog.touch("missing").is_err());
        assert!(catalog.remove("missing").is_err());
        assert_eq!(catalog.get(&project.id).unwrap(), project);
        assert_eq!(catalog.remove(&project.id).unwrap(), project);
        assert!(ProjectCatalog::load(&app_data)
            .unwrap()
            .projects()
            .is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn malformed_catalog_and_invalid_path_are_explicit_errors() {
        let root = root("errors");
        let app_data = root.join("app-data");
        fs::create_dir_all(&app_data).unwrap();
        fs::write(app_data.join("projects.json"), b"not json").unwrap();
        assert!(ProjectCatalog::load(&app_data).is_err());
        let mut catalog = ProjectCatalog::load(root.join("empty")).unwrap();
        assert!(catalog.upsert(root.join("missing")).is_err());
        assert_eq!(
            fs::read(app_data.join("projects.json")).unwrap(),
            b"not json"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
