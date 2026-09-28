use std::{
    collections::HashMap,
    future::Future,
    path::PathBuf,
    pin::Pin,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::rpc::bridge::{AgentBridge, BridgeError};

/// Immutable identity for one independently running Pi process.
#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTarget {
    pub project_id: String,
    pub session_id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeEvent {
    pub project_id: String,
    pub session_id: String,
    pub generation: u64,
    pub event: serde_json::Value,
}

/// Immutable UI confirmation payload: a removal request must name precisely the
/// runtime generations it reviewed, so a changed task set cannot be drained.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeSnapshot {
    pub project_id: String,
    pub targets: Vec<RuntimeTarget>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum RuntimeError {
    AlreadyRunning(RuntimeTarget),
    NotRunning(RuntimeTarget),
    Bridge(String),
}

impl std::fmt::Display for RuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AlreadyRunning(target) => write!(
                formatter,
                "Pi runtime is already running for project {} session {}",
                target.project_id, target.session_id
            ),
            Self::NotRunning(target) => write!(
                formatter,
                "Pi runtime is not running for project {} session {}",
                target.project_id, target.session_id
            ),
            Self::Bridge(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for RuntimeError {}

impl From<BridgeError> for RuntimeError {
    fn from(error: BridgeError) -> Self {
        Self::Bridge(error.to_string())
    }
}

pub trait RuntimeBridge: Send + Sync + 'static {
    fn start<'a>(
        &'a self,
        cwd: &'a std::path::Path,
    ) -> Pin<Box<dyn Future<Output = Result<(), RuntimeError>> + Send + 'a>>;
    fn send<'a>(
        &'a self,
        request: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, RuntimeError>> + Send + 'a>>;
    fn abort<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, RuntimeError>> + Send + 'a>>;
    fn stop<'a>(&'a self) -> Pin<Box<dyn Future<Output = Result<(), RuntimeError>> + Send + 'a>>;
}

impl RuntimeBridge for AgentBridge {
    fn start<'a>(
        &'a self,
        cwd: &'a std::path::Path,
    ) -> Pin<Box<dyn Future<Output = Result<(), RuntimeError>> + Send + 'a>> {
        Box::pin(async move { self.start_agent(cwd).await.map_err(Into::into) })
    }

    fn send<'a>(
        &'a self,
        request: serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, RuntimeError>> + Send + 'a>> {
        Box::pin(async move { self.send_rpc(request).await.map_err(Into::into) })
    }

    fn abort<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, RuntimeError>> + Send + 'a>> {
        Box::pin(async move { self.abort_agent().await.map_err(Into::into) })
    }

    fn stop<'a>(&'a self) -> Pin<Box<dyn Future<Output = Result<(), RuntimeError>> + Send + 'a>> {
        Box::pin(async move { self.stop_agent().await.map_err(Into::into) })
    }
}

pub struct RuntimeEntry<B> {
    pub bridge: Arc<B>,
    pub cwd: PathBuf,
    pub generation: u64,
}

/// Short-lock registry. Every child operation runs after cloning an entry, never while
/// holding the registry mutex, so one blocked Pi process cannot serialize another.
impl<B> Clone for RuntimeEntry<B> {
    fn clone(&self) -> Self {
        Self {
            bridge: self.bridge.clone(),
            cwd: self.cwd.clone(),
            generation: self.generation,
        }
    }
}

pub struct RuntimeRegistry<B> {
    entries: Mutex<HashMap<RuntimeTarget, RuntimeEntry<B>>>,
    next_generation: AtomicU64,
}

impl<B: RuntimeBridge> RuntimeRegistry<B> {
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            next_generation: AtomicU64::new(1),
        }
    }

    pub async fn start(
        &self,
        target: RuntimeTarget,
        cwd: PathBuf,
        bridge: Arc<B>,
    ) -> Result<u64, RuntimeError> {
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
        {
            let mut entries = self.entries.lock().await;
            if entries.contains_key(&target) {
                return Err(RuntimeError::AlreadyRunning(target));
            }
            entries.insert(
                target.clone(),
                RuntimeEntry {
                    bridge: bridge.clone(),
                    cwd: cwd.clone(),
                    generation,
                },
            );
        }
        if let Err(error) = bridge.start(&cwd).await {
            self.remove_exact(&target, generation).await;
            return Err(error);
        }
        Ok(generation)
    }

    pub async fn entry(&self, target: &RuntimeTarget) -> Result<RuntimeEntry<B>, RuntimeError> {
        self.entries
            .lock()
            .await
            .get(target)
            .cloned()
            .ok_or_else(|| RuntimeError::NotRunning(target.clone()))
    }

    pub async fn send(
        &self,
        target: &RuntimeTarget,
        request: serde_json::Value,
    ) -> Result<serde_json::Value, RuntimeError> {
        self.entry(target).await?.bridge.send(request).await
    }

    pub async fn abort(&self, target: &RuntimeTarget) -> Result<serde_json::Value, RuntimeError> {
        self.entry(target).await?.bridge.abort().await
    }

    /// Replaces a temporary startup token with the stable Pi session ID without
    /// changing the process or its generation.
    pub async fn rekey(
        &self,
        from: &RuntimeTarget,
        session_id: String,
    ) -> Result<RuntimeTarget, RuntimeError> {
        let mut entries = self.entries.lock().await;
        let entry = entries
            .remove(from)
            .ok_or_else(|| RuntimeError::NotRunning(from.clone()))?;
        let target = RuntimeTarget {
            project_id: from.project_id.clone(),
            session_id,
        };
        if entries.contains_key(&target) {
            entries.insert(from.clone(), entry);
            return Err(RuntimeError::AlreadyRunning(target));
        }
        entries.insert(target.clone(), entry);
        Ok(target)
    }

    /// Returns the stable target currently assigned to a generation. A forwarder
    /// uses this after startup-token rekeying so pre-bind events never claim a
    /// stale identity and events for removed generations are dropped.
    pub async fn target_for_generation(&self, generation: u64) -> Option<RuntimeTarget> {
        self.entries
            .lock()
            .await
            .iter()
            .find_map(|(target, entry)| (entry.generation == generation).then(|| target.clone()))
    }

    /// Removes and stops every runtime belonging to a project. All entries are
    /// first detached under the mutex, then every child is stopped without the
    /// mutex; errors are accumulated so one failed child cannot leak the rest.
    pub async fn project_snapshot(&self, project_id: &str) -> ProjectRuntimeSnapshot {
        let mut targets = self
            .entries
            .lock()
            .await
            .keys()
            .filter(|target| target.project_id == project_id)
            .cloned()
            .collect::<Vec<_>>();
        targets.sort_by(|left, right| left.session_id.cmp(&right.session_id));
        ProjectRuntimeSnapshot {
            project_id: project_id.into(),
            targets,
        }
    }

    /// Drains a project only if its current runtime set remains exactly equal
    /// to the explicit confirmation snapshot.
    pub async fn drain_confirmed_project(
        &self,
        snapshot: &ProjectRuntimeSnapshot,
    ) -> Result<Vec<RuntimeError>, RuntimeError> {
        if self.project_snapshot(&snapshot.project_id).await != *snapshot {
            return Err(RuntimeError::Bridge(
                "Project runtime tasks changed; review removal again".into(),
            ));
        }
        let entries = self
            .entries
            .lock()
            .await
            .iter()
            .filter(|(target, _)| target.project_id == snapshot.project_id)
            .map(|(target, entry)| (target.clone(), entry.clone()))
            .collect::<Vec<_>>();
        let mut errors = vec![];
        for (target, entry) in entries {
            if let Err(error) = entry.bridge.stop().await {
                errors.push(error);
            } else {
                self.remove_exact(&target, entry.generation).await;
            }
        }
        Ok(errors)
    }

    pub async fn drain_project(&self, project_id: &str) -> Vec<RuntimeError> {
        self.drain_matching(|target| target.project_id == project_id)
            .await
    }

    /// Detaches and attempts to stop every live child during application exit.
    pub async fn shutdown_all(&self) -> Vec<RuntimeError> {
        self.drain_matching(|_| true).await
    }

    async fn drain_matching(
        &self,
        predicate: impl Fn(&RuntimeTarget) -> bool,
    ) -> Vec<RuntimeError> {
        let entries = {
            let mut entries = self.entries.lock().await;
            let targets = entries
                .keys()
                .filter(|target| predicate(target))
                .cloned()
                .collect::<Vec<_>>();
            targets
                .into_iter()
                .filter_map(|target| entries.remove(&target))
                .collect::<Vec<_>>()
        };
        let mut errors = vec![];
        for entry in entries {
            if let Err(error) = entry.bridge.stop().await {
                errors.push(error);
            }
        }
        errors
    }

    pub async fn remove_exact(
        &self,
        target: &RuntimeTarget,
        generation: u64,
    ) -> Option<RuntimeEntry<B>> {
        let mut entries = self.entries.lock().await;
        if entries
            .get(target)
            .is_some_and(|entry| entry.generation == generation)
        {
            entries.remove(target)
        } else {
            None
        }
    }

    #[cfg(test)]
    async fn count(&self) -> usize {
        self.entries.lock().await.len()
    }
}

impl<B: RuntimeBridge> Default for RuntimeRegistry<B> {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use std::{path::Path, sync::Arc, time::Duration};

    use serde_json::{json, Value};
    use tokio::sync::Notify;

    use super::{RuntimeBridge, RuntimeError, RuntimeRegistry, RuntimeTarget};

    struct FakeBridge {
        start_gate: Option<Arc<Notify>>,
        stop_error: bool,
        stops: Arc<std::sync::atomic::AtomicUsize>,
        aborts: Arc<std::sync::atomic::AtomicUsize>,
        requests: Arc<std::sync::Mutex<Vec<Value>>>,
    }

    impl FakeBridge {
        fn immediate() -> Self {
            Self {
                start_gate: None,
                stop_error: false,
                stops: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
                aborts: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
                requests: Arc::new(std::sync::Mutex::new(vec![])),
            }
        }
    }

    impl RuntimeBridge for FakeBridge {
        fn start<'a>(
            &'a self,
            _cwd: &'a Path,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<(), RuntimeError>> + Send + 'a>,
        > {
            Box::pin(async move {
                if let Some(gate) = &self.start_gate {
                    gate.notified().await;
                }
                Ok(())
            })
        }

        fn send<'a>(
            &'a self,
            request: Value,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<Value, RuntimeError>> + Send + 'a>,
        > {
            Box::pin(async move {
                self.requests.lock().unwrap().push(request.clone());
                Ok(request)
            })
        }

        fn abort<'a>(
            &'a self,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<Value, RuntimeError>> + Send + 'a>,
        > {
            Box::pin(async move {
                self.aborts
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                Ok(json!({ "aborted": true }))
            })
        }

        fn stop<'a>(
            &'a self,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<(), RuntimeError>> + Send + 'a>,
        > {
            Box::pin(async move {
                self.stops
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                if self.stop_error {
                    Err(RuntimeError::Bridge("fake stop failure".into()))
                } else {
                    Ok(())
                }
            })
        }
    }

    fn target(project_id: &str, session_id: &str) -> RuntimeTarget {
        RuntimeTarget {
            project_id: project_id.into(),
            session_id: session_id.into(),
        }
    }

    #[tokio::test]
    async fn independently_starts_sessions_and_rejects_duplicate_target() {
        let registry = RuntimeRegistry::new();
        let first = target("project-a", "session-1");
        let second = target("project-a", "session-2");
        registry
            .start(
                first.clone(),
                "/tmp/a".into(),
                Arc::new(FakeBridge::immediate()),
            )
            .await
            .unwrap();
        registry
            .start(
                second.clone(),
                "/tmp/a".into(),
                Arc::new(FakeBridge::immediate()),
            )
            .await
            .unwrap();

        assert_eq!(registry.count().await, 2);
        assert_eq!(
            registry
                .start(
                    first.clone(),
                    "/tmp/a".into(),
                    Arc::new(FakeBridge::immediate())
                )
                .await
                .unwrap_err(),
            RuntimeError::AlreadyRunning(first)
        );
    }

    #[tokio::test]
    async fn rekey_preserves_generation_and_replaces_the_startup_token() {
        let registry = RuntimeRegistry::new();
        let startup = target("project-a", "startup-token");
        let generation = registry
            .start(
                startup.clone(),
                "/tmp/a".into(),
                Arc::new(FakeBridge::immediate()),
            )
            .await
            .unwrap();
        let stable = registry.rekey(&startup, "session-1".into()).await.unwrap();

        assert_eq!(stable, target("project-a", "session-1"));
        assert_eq!(
            registry.target_for_generation(generation).await,
            Some(stable)
        );
        assert!(matches!(
            registry.entry(&startup).await,
            Err(RuntimeError::NotRunning(target)) if target == startup
        ));
    }

    #[tokio::test]
    async fn confirmed_project_drain_requires_the_reviewed_snapshot() {
        let registry = RuntimeRegistry::new();
        let reviewed = Arc::new(FakeBridge::immediate());
        let other = Arc::new(FakeBridge::immediate());
        registry
            .start(
                target("project-a", "reviewed"),
                "/tmp/a".into(),
                reviewed.clone(),
            )
            .await
            .unwrap();
        let snapshot = registry.project_snapshot("project-a").await;
        registry
            .start(
                target("project-a", "new-task"),
                "/tmp/a".into(),
                Arc::new(FakeBridge::immediate()),
            )
            .await
            .unwrap();
        registry
            .start(target("project-b", "other"), "/tmp/b".into(), other.clone())
            .await
            .unwrap();

        assert!(registry.drain_confirmed_project(&snapshot).await.is_err());
        assert_eq!(registry.count().await, 3);
        assert_eq!(reviewed.stops.load(std::sync::atomic::Ordering::Relaxed), 0);
        assert_eq!(other.stops.load(std::sync::atomic::Ordering::Relaxed), 0);
    }

    #[tokio::test]
    async fn confirmed_drain_keeps_a_failed_stop_registered_for_retry() {
        let registry = RuntimeRegistry::new();
        let failing = Arc::new(FakeBridge {
            start_gate: None,
            stop_error: true,
            stops: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            aborts: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            requests: Arc::new(std::sync::Mutex::new(vec![])),
        });
        registry
            .start(target("project-a", "failing"), "/tmp/a".into(), failing)
            .await
            .unwrap();
        let snapshot = registry.project_snapshot("project-a").await;

        assert_eq!(
            registry
                .drain_confirmed_project(&snapshot)
                .await
                .unwrap()
                .len(),
            1
        );
        assert_eq!(registry.count().await, 1);
    }

    #[tokio::test]
    async fn project_drain_is_scoped_and_shutdown_attempts_every_child() {
        let registry = RuntimeRegistry::new();
        let failing = Arc::new(FakeBridge {
            start_gate: None,
            stop_error: true,
            stops: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            aborts: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            requests: Arc::new(std::sync::Mutex::new(vec![])),
        });
        let surviving = Arc::new(FakeBridge::immediate());
        let final_child = Arc::new(FakeBridge::immediate());
        registry
            .start(target("project-a", "one"), "/tmp/a".into(), failing.clone())
            .await
            .unwrap();
        registry
            .start(
                target("project-a", "two"),
                "/tmp/a".into(),
                final_child.clone(),
            )
            .await
            .unwrap();
        registry
            .start(
                target("project-b", "three"),
                "/tmp/b".into(),
                surviving.clone(),
            )
            .await
            .unwrap();

        assert_eq!(registry.drain_project("project-a").await.len(), 1);
        assert_eq!(registry.count().await, 1);
        assert_eq!(failing.stops.load(std::sync::atomic::Ordering::Relaxed), 1);
        assert_eq!(
            final_child.stops.load(std::sync::atomic::Ordering::Relaxed),
            1
        );
        assert_eq!(
            surviving.stops.load(std::sync::atomic::Ordering::Relaxed),
            0
        );
        assert!(registry.shutdown_all().await.is_empty());
        assert_eq!(
            surviving.stops.load(std::sync::atomic::Ordering::Relaxed),
            1
        );
        assert_eq!(registry.count().await, 0);
    }

    #[tokio::test]
    async fn interleaved_fake_runtimes_route_requests_and_abort_only_the_target() {
        let registry = RuntimeRegistry::new();
        let first = Arc::new(FakeBridge::immediate());
        let second = Arc::new(FakeBridge::immediate());
        let first_target = target("project-a", "session-a");
        let second_target = target("project-b", "session-b");
        registry
            .start(first_target.clone(), "/tmp/a".into(), first.clone())
            .await
            .unwrap();
        registry
            .start(second_target.clone(), "/tmp/b".into(), second.clone())
            .await
            .unwrap();

        registry
            .send(&second_target, json!({ "type": "prompt", "text": "B" }))
            .await
            .unwrap();
        registry
            .send(&first_target, json!({ "type": "prompt", "text": "A" }))
            .await
            .unwrap();
        registry.abort(&second_target).await.unwrap();
        let settled = registry.remove_exact(&first_target, 1).await.unwrap();
        settled.bridge.stop().await.unwrap();

        assert_eq!(
            first.requests.lock().unwrap().as_slice(),
            &[json!({ "type": "prompt", "text": "A" })]
        );
        assert_eq!(
            second.requests.lock().unwrap().as_slice(),
            &[json!({ "type": "prompt", "text": "B" })]
        );
        assert_eq!(first.aborts.load(std::sync::atomic::Ordering::Relaxed), 0);
        assert_eq!(second.aborts.load(std::sync::atomic::Ordering::Relaxed), 1);
        assert_eq!(first.stops.load(std::sync::atomic::Ordering::Relaxed), 1);
        assert_eq!(second.stops.load(std::sync::atomic::Ordering::Relaxed), 0);
        assert_eq!(registry.count().await, 1);
    }

    #[tokio::test]
    async fn slow_runtime_start_does_not_block_another_target() {
        let registry = Arc::new(RuntimeRegistry::new());
        let gate = Arc::new(Notify::new());
        let slow_registry = registry.clone();
        let slow = tokio::spawn(async move {
            slow_registry
                .start(
                    target("project-a", "slow"),
                    "/tmp/a".into(),
                    Arc::new(FakeBridge {
                        start_gate: Some(gate),
                        stop_error: false,
                        stops: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
                        aborts: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
                        requests: Arc::new(std::sync::Mutex::new(vec![])),
                    }),
                )
                .await
        });
        tokio::time::sleep(Duration::from_millis(10)).await;

        tokio::time::timeout(
            Duration::from_millis(100),
            registry.start(
                target("project-b", "fast"),
                "/tmp/b".into(),
                Arc::new(FakeBridge::immediate()),
            ),
        )
        .await
        .expect("fast target must not wait for slow bridge")
        .unwrap();
        assert_eq!(registry.count().await, 2);
        slow.abort();
    }
}
