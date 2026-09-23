use std::{
    fs::{self, File},
    io::{self, BufRead, BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::SystemTime,
};

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct PersistedHistoryPage {
    pub messages: Vec<Value>,
    pub before: usize,
    pub has_more: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct PersistedSession {
    pub id: String,
    pub path: PathBuf,
    pub title: String,
}

#[derive(Debug)]
pub enum WorkspaceError {
    Io(io::Error),
    Json(serde_json::Error),
    SessionOutsideCurrentProject(PathBuf),
    InvalidSession(PathBuf),
}

impl std::fmt::Display for WorkspaceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "workspace storage error: {error}"),
            Self::Json(error) => write!(formatter, "workspace session is invalid JSON: {error}"),
            Self::SessionOutsideCurrentProject(path) => write!(
                formatter,
                "refusing to access Pi session outside the current project: {}",
                path.display()
            ),
            Self::InvalidSession(path) => write!(
                formatter,
                "Pi session has no valid session header: {}",
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

/// Pi's persisted sessions for this renderer's cwd. The directory is derived from
/// the handed-off session when one exists, preserving Pi's `--session-dir` choice.
const HISTORY_READ_BLOCK_BYTES: u64 = 64 * 1024;

pub struct WorkspaceStore {
    cwd: PathBuf,
    sessions_path: PathBuf,
}

impl WorkspaceStore {
    pub fn new(cwd: PathBuf, sessions_path: PathBuf) -> Self {
        Self { cwd, sessions_path }
    }

    pub fn list_sessions(&self) -> Result<Vec<PersistedSession>, WorkspaceError> {
        let entries = match fs::read_dir(&self.sessions_path) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
            Err(error) => return Err(error.into()),
        };
        let mut sessions = entries
            .map(|entry| entry.map_err(WorkspaceError::from))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|entry| entry.path())
            .filter(|path| {
                path.extension()
                    .is_some_and(|extension| extension == "jsonl")
            })
            .filter_map(|path| match self.read_session(path) {
                Ok(session) => Some(Ok(session)),
                Err(WorkspaceError::SessionOutsideCurrentProject(_)) => None,
                Err(error) => Some(Err(error)),
            })
            .collect::<Result<Vec<_>, _>>()?;
        sessions.sort_by_key(|session| {
            std::cmp::Reverse(
                fs::metadata(&session.path)
                    .and_then(|metadata| metadata.modified())
                    .unwrap_or(SystemTime::UNIX_EPOCH),
            )
        });
        Ok(sessions)
    }

    pub fn session_history(
        &self,
        session_path: PathBuf,
        before: Option<usize>,
        limit: usize,
    ) -> Result<PersistedHistoryPage, WorkspaceError> {
        if !self.session_for_current_project(&session_path)? {
            return Err(WorkspaceError::SessionOutsideCurrentProject(session_path));
        }
        let mut file = File::open(&session_path)?;
        let end = before
            .map(|offset| offset as u64)
            .unwrap_or(file.metadata()?.len())
            .min(file.metadata()?.len());
        let (entries, has_more) = read_history_tail(&mut file, end, limit, &session_path)?;
        let before = entries.first().map_or(0, |(offset, _)| *offset);
        Ok(PersistedHistoryPage {
            messages: entries.into_iter().map(|(_, message)| message).collect(),
            before,
            has_more,
        })
    }

    fn read_session(&self, path: PathBuf) -> Result<PersistedSession, WorkspaceError> {
        if !self.session_for_current_project(&path)? {
            return Err(WorkspaceError::SessionOutsideCurrentProject(path));
        }
        let entries = fs::read_to_string(&path)?;
        let mut lines = entries.lines();
        let header = lines
            .next()
            .map(serde_json::from_str::<Value>)
            .transpose()?
            .ok_or_else(|| WorkspaceError::InvalidSession(path.clone()))?;
        let id = header
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| WorkspaceError::InvalidSession(path.clone()))?;
        let title = lines
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .filter(|entry| entry.get("type").and_then(Value::as_str) == Some("session_info"))
            .filter_map(|entry| entry.get("name").and_then(Value::as_str).map(str::to_owned))
            .next_back()
            .unwrap_or_else(|| id.to_owned());
        Ok(PersistedSession {
            id: id.to_owned(),
            path,
            title,
        })
    }

    fn session_for_current_project(&self, path: &Path) -> Result<bool, WorkspaceError> {
        let canonical_path = fs::canonicalize(path)?;
        let canonical_sessions_path = fs::canonicalize(&self.sessions_path)?;
        if !canonical_path.starts_with(&canonical_sessions_path) {
            return Ok(false);
        }
        let mut header = String::new();
        BufReader::new(File::open(canonical_path)?)
            .read_line(&mut header)
            .map_err(WorkspaceError::from)?;
        let header = serde_json::from_str::<Value>(header.trim_end())?;
        Ok(header.get("cwd").and_then(Value::as_str) == self.cwd.to_str())
    }
}

/// Reads JSONL blocks backward until a page of persisted messages is complete.
/// The cursor is a byte offset at a record boundary, avoiding a full-file scan.
fn read_history_tail(
    file: &mut File,
    end: u64,
    limit: usize,
    session_path: &Path,
) -> Result<(Vec<(usize, Value)>, bool), WorkspaceError> {
    let mut start = end;
    let mut bytes = Vec::new();
    loop {
        let next_start = start.saturating_sub(HISTORY_READ_BLOCK_BYTES);
        let bytes_to_read = (start - next_start) as usize;
        let mut block = vec![0; bytes_to_read];
        file.seek(SeekFrom::Start(next_start))?;
        file.read_exact(&mut block)?;
        block.extend(bytes);
        bytes = block;
        start = next_start;

        let mut messages = Vec::new();
        let mut line_start = 0;
        let mut lines = Vec::new();
        for (index, byte) in bytes.iter().enumerate() {
            if *byte == b'\n' {
                lines.push((line_start, index));
                line_start = index + 1;
            }
        }
        if line_start < bytes.len() {
            lines.push((line_start, bytes.len()));
        }
        let first_complete_line = usize::from(start != 0);
        for index in (first_complete_line..lines.len()).rev() {
            let (line_start, line_end) = lines[index];
            if line_start == line_end {
                continue;
            }
            let entry = serde_json::from_slice::<Value>(&bytes[line_start..line_end])?;
            if entry.get("type").and_then(Value::as_str) != Some("message") {
                continue;
            }
            let message = entry
                .get("message")
                .cloned()
                .ok_or_else(|| WorkspaceError::InvalidSession(session_path.to_path_buf()))?;
            messages.push(((start as usize) + line_start, message));
            if messages.len() == limit {
                let has_more = start != 0
                    || lines[first_complete_line..index].iter().rev().any(
                        |(earlier_start, earlier_end)| {
                            serde_json::from_slice::<Value>(&bytes[*earlier_start..*earlier_end])
                                .is_ok_and(|entry| {
                                    entry.get("type").and_then(Value::as_str) == Some("message")
                                })
                        },
                    );
                messages.reverse();
                return Ok((messages, has_more));
            }
        }
        if start == 0 {
            messages.reverse();
            return Ok((messages, false));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::WorkspaceStore;
    use std::{
        fs,
        sync::atomic::{AtomicUsize, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    static TEMPORARY_ROOT_SEQUENCE: AtomicUsize = AtomicUsize::new(0);

    fn temporary_root() -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "pi-app-workspace-{}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            TEMPORARY_ROOT_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn lists_no_sessions_before_pi_creates_the_session_directory() {
        let root = temporary_root();
        let cwd = root.join("project");
        fs::create_dir_all(&cwd).unwrap();

        assert_eq!(
            WorkspaceStore::new(cwd, root.join("sessions"))
                .list_sessions()
                .unwrap(),
            vec![]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn uses_the_pi_session_id_when_a_session_has_no_explicit_name() {
        let root = temporary_root();
        let cwd = root.join("project");
        let sessions = root.join("sessions");
        fs::create_dir_all(&cwd).unwrap();
        fs::create_dir_all(&sessions).unwrap();
        let unnamed = sessions.join("unnamed.jsonl");
        fs::write(
            &unnamed,
            format!(
                "{{\"type\":\"session\",\"id\":\"pi-session-id\",\"cwd\":\"{}\"}}\n",
                cwd.display()
            ),
        )
        .unwrap();

        assert_eq!(
            WorkspaceStore::new(cwd, sessions).list_sessions().unwrap(),
            vec![super::PersistedSession {
                id: "pi-session-id".to_owned(),
                path: unnamed,
                title: "pi-session-id".to_owned(),
            }]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reads_every_persisted_message_in_chronological_order() {
        let root = temporary_root();
        let cwd = root.join("project");
        let sessions = root.join("sessions");
        fs::create_dir_all(&cwd).unwrap();
        fs::create_dir_all(&sessions).unwrap();
        let session = sessions.join("history.jsonl");
        fs::write(
            &session,
            format!(
                "{{\"type\":\"session\",\"id\":\"history\",\"cwd\":\"{}\"}}\n{{\"type\":\"message\",\"message\":{{\"role\":\"user\",\"content\":\"first\"}}}}\n{{\"type\":\"compaction\"}}\n{{\"type\":\"message\",\"message\":{{\"role\":\"assistant\",\"content\":\"last\"}}}}\n",
                cwd.display()
            ),
        )
        .unwrap();

        assert_eq!(
            WorkspaceStore::new(cwd.clone(), sessions)
                .session_history(session, None, 80)
                .unwrap(),
            super::PersistedHistoryPage {
                messages: vec![
                    serde_json::json!({ "role": "user", "content": "first" }),
                    serde_json::json!({ "role": "assistant", "content": "last" }),
                ],
                before: format!(
                    "{{\"type\":\"session\",\"id\":\"history\",\"cwd\":\"{}\"}}\n",
                    cwd.display()
                )
                .len(),
                has_more: false,
            }
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reads_a_tail_page_before_loading_earlier_persisted_messages() {
        let root = temporary_root();
        let cwd = root.join("project");
        let sessions = root.join("sessions");
        fs::create_dir_all(&cwd).unwrap();
        fs::create_dir_all(&sessions).unwrap();
        let session = sessions.join("paged.jsonl");
        let mut entries = format!(
            "{{\"type\":\"session\",\"id\":\"paged\",\"cwd\":\"{}\"}}\n",
            cwd.display()
        );
        for index in 0..5 {
            entries.push_str(&format!(
                "{{\"type\":\"message\",\"message\":{{\"role\":\"user\",\"content\":\"{index}\"}}}}\n"
            ));
        }
        let third_message_offset = entries
            .find("{\"type\":\"message\",\"message\":{\"role\":\"user\",\"content\":\"3\"}}")
            .unwrap();
        let first_message_offset = entries
            .find("{\"type\":\"message\",\"message\":{\"role\":\"user\",\"content\":\"1\"}}")
            .unwrap();
        fs::write(&session, entries).unwrap();
        let store = WorkspaceStore::new(cwd, sessions);

        let latest = store.session_history(session.clone(), None, 2).unwrap();
        assert_eq!(
            latest,
            super::PersistedHistoryPage {
                messages: vec![
                    serde_json::json!({ "role": "user", "content": "3" }),
                    serde_json::json!({ "role": "user", "content": "4" }),
                ],
                before: third_message_offset,
                has_more: true,
            }
        );
        assert_eq!(
            store
                .session_history(session, Some(latest.before), 2)
                .unwrap(),
            super::PersistedHistoryPage {
                messages: vec![
                    serde_json::json!({ "role": "user", "content": "1" }),
                    serde_json::json!({ "role": "user", "content": "2" }),
                ],
                before: first_message_offset,
                has_more: true,
            }
        );
        fs::remove_dir_all(root).unwrap();
    }
}
