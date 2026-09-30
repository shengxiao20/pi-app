use std::{
    collections::HashMap,
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};

use serde::Serialize;
use serde_json::Value;
use tokio::sync::Mutex;

use crate::rpc::bridge::{AgentBridge, BridgeError};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionProcessEvent {
    pub workspace_id: String,
    pub session_id: String,
    pub instance_id: u64,
    pub event: Value,
}

#[derive(Clone)]
pub struct SessionProcess {
    pub bridge: Arc<AgentBridge>,
    pub instance_id: u64,
}

pub struct SessionProcessManager {
    processes: Mutex<HashMap<String, SessionProcess>>,
    next_instance_id: AtomicU64,
}

impl SessionProcessManager {
    pub fn new() -> Self {
        Self {
            processes: Mutex::new(HashMap::new()),
            next_instance_id: AtomicU64::default(),
        }
    }

    pub async fn start(
        &self,
        session_id: String,
        session_path: Option<&Path>,
        session_dir: &Path,
        cwd: &Path,
    ) -> Result<SessionProcess, BridgeError> {
        let instance_id = self.next_instance_id.fetch_add(1, Ordering::Relaxed);
        let process = SessionProcess {
            bridge: Arc::new(AgentBridge::pi(session_dir, session_path)),
            instance_id,
        };
        {
            let mut processes = self.processes.lock().await;
            if processes.contains_key(&session_id) {
                return Err(BridgeError::AlreadyStarted);
            }
            processes.insert(session_id.clone(), process.clone());
        }
        if let Err(error) = process.bridge.start_agent(cwd).await {
            self.remove_if_current(&session_id, instance_id).await;
            return Err(error);
        }
        Ok(process)
    }

    pub async fn register(
        &self,
        session_id: String,
        bridge: Arc<AgentBridge>,
    ) -> Result<SessionProcess, BridgeError> {
        let process = SessionProcess {
            bridge,
            instance_id: self.next_instance_id.fetch_add(1, Ordering::Relaxed),
        };
        let mut processes = self.processes.lock().await;
        if processes.contains_key(&session_id) {
            return Err(BridgeError::AlreadyStarted);
        }
        processes.insert(session_id, process.clone());
        Ok(process)
    }

    pub async fn process(&self, session_id: &str) -> Result<SessionProcess, BridgeError> {
        self.processes
            .lock()
            .await
            .get(session_id)
            .cloned()
            .ok_or(BridgeError::NotStarted)
    }

    pub async fn remove_if_current(
        &self,
        session_id: &str,
        instance_id: u64,
    ) -> Option<SessionProcess> {
        let mut processes = self.processes.lock().await;
        if processes
            .get(session_id)
            .is_some_and(|process| process.instance_id == instance_id)
        {
            processes.remove(session_id)
        } else {
            None
        }
    }

    pub async fn shutdown_all(&self) -> Vec<BridgeError> {
        let processes = {
            let mut processes = self.processes.lock().await;
            std::mem::take(&mut *processes)
        };
        let mut errors = vec![];
        for (_, process) in processes {
            if let Err(error) = process.bridge.stop_agent().await {
                errors.push(error);
            }
        }
        errors
    }
}

impl Default for SessionProcessManager {
    fn default() -> Self {
        Self::new()
    }
}
