use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;

#[derive(Debug)]
pub enum TagError {
    Database(rusqlite::Error),
    BlankName,
}

impl std::fmt::Display for TagError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Database(error) => write!(formatter, "tag database error: {error}"),
            Self::BlankName => formatter.write_str("tag name cannot be blank"),
        }
    }
}

impl std::error::Error for TagError {}

impl From<rusqlite::Error> for TagError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Database(error)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: i64,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTagAssignment {
    pub session_id: String,
    pub tag_id: Option<i64>,
}

/// Versioned app-private metadata only. It never opens or writes Pi JSONL files.
pub struct TagStore {
    connection: Connection,
}

impl TagStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, TagError> {
        let connection = Connection::open(path)?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);
             CREATE TABLE IF NOT EXISTS tags (
               id INTEGER PRIMARY KEY,
               name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(trim(name) <> '')
             );
             CREATE TABLE IF NOT EXISTS session_tag_assignments (
               workspace_path TEXT NOT NULL,
               session_id TEXT NOT NULL,
               tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
               PRIMARY KEY (workspace_path, session_id)
             );
             INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);",
        )?;
        Ok(Self { connection })
    }

    pub fn list_tags(&self) -> Result<Vec<Tag>, TagError> {
        let mut statement = self
            .connection
            .prepare("SELECT id, name FROM tags ORDER BY name COLLATE NOCASE, id")?;
        let tags = statement
            .query_map([], |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(tags)
    }

    pub fn create_tag(&mut self, name: &str) -> Result<Tag, TagError> {
        let name = normalized_name(name)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute("INSERT INTO tags(name) VALUES (?1)", [&name])?;
        let tag = Tag {
            id: transaction.last_insert_rowid(),
            name,
        };
        transaction.commit()?;
        Ok(tag)
    }

    pub fn rename_tag(&mut self, id: i64, name: &str) -> Result<Tag, TagError> {
        let name = normalized_name(name)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute("UPDATE tags SET name = ?1 WHERE id = ?2", params![name, id])?;
        let tag =
            transaction.query_row("SELECT id, name FROM tags WHERE id = ?1", [id], |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                })
            })?;
        transaction.commit()?;
        Ok(tag)
    }

    pub fn delete_tag(&mut self, id: i64) -> Result<(), TagError> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute("DELETE FROM tags WHERE id = ?1", [id])?;
        transaction.commit()?;
        Ok(())
    }

    pub fn assign(
        &mut self,
        workspace_path: &Path,
        session_id: &str,
        tag_id: Option<i64>,
    ) -> Result<(), TagError> {
        let workspace_path = workspace_path.to_string_lossy();
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(tag_id) = tag_id {
            transaction.execute(
                "INSERT INTO session_tag_assignments(workspace_path, session_id, tag_id)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(workspace_path, session_id) DO UPDATE SET tag_id = excluded.tag_id",
                params![workspace_path, session_id, tag_id],
            )?;
        } else {
            transaction.execute(
                "DELETE FROM session_tag_assignments WHERE workspace_path = ?1 AND session_id = ?2",
                params![workspace_path, session_id],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn assignments(
        &self,
        workspace_path: &Path,
    ) -> Result<Vec<SessionTagAssignment>, TagError> {
        let mut statement = self.connection.prepare(
            "SELECT session_id, tag_id FROM session_tag_assignments WHERE workspace_path = ?1 ORDER BY session_id",
        )?;
        let assignments = statement
            .query_map([workspace_path.to_string_lossy().as_ref()], |row| {
                Ok(SessionTagAssignment {
                    session_id: row.get(0)?,
                    tag_id: Some(row.get(1)?),
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(assignments)
    }

    pub fn assignment(
        &self,
        workspace_path: &Path,
        session_id: &str,
    ) -> Result<Option<i64>, TagError> {
        Ok(self.connection.query_row(
            "SELECT tag_id FROM session_tag_assignments WHERE workspace_path = ?1 AND session_id = ?2",
            params![workspace_path.to_string_lossy(), session_id],
            |row| row.get(0),
        ).optional()?)
    }
}

fn normalized_name(name: &str) -> Result<String, TagError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(TagError::BlankName);
    }
    Ok(name.to_owned())
}

#[cfg(test)]
mod tests {
    use super::TagStore;
    use std::fs;

    fn database(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("pi-app-tags-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root.join("tags.sqlite")
    }

    #[test]
    fn schema_crud_uniqueness_and_delete_cascade_are_transactional() {
        let path = database("crud");
        let mut store = TagStore::open(&path).unwrap();
        let tag = store.create_tag("  Important ").unwrap();
        assert_eq!(store.list_tags().unwrap(), vec![tag.clone()]);
        assert!(store.create_tag("important").is_err());
        assert!(store.create_tag(" ").is_err());
        let tag = store.rename_tag(tag.id, "Now").unwrap();
        store
            .assign(
                std::path::Path::new("/workspace/a"),
                "same-id",
                Some(tag.id),
            )
            .unwrap();
        store.delete_tag(tag.id).unwrap();
        assert_eq!(
            store
                .assignment(std::path::Path::new("/workspace/a"), "same-id")
                .unwrap(),
            None
        );
    }

    #[test]
    fn assignments_are_isolated_by_canonical_workspace_identity() {
        let path = database("isolation");
        let mut store = TagStore::open(path).unwrap();
        let tag = store.create_tag("Work").unwrap();
        store
            .assign(std::path::Path::new("/workspace/a"), "shared", Some(tag.id))
            .unwrap();
        assert_eq!(
            store
                .assignment(std::path::Path::new("/workspace/a"), "shared")
                .unwrap(),
            Some(tag.id)
        );
        assert_eq!(
            store
                .assignment(std::path::Path::new("/workspace/b"), "shared")
                .unwrap(),
            None
        );
    }
}
