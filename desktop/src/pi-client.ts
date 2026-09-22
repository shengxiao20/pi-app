import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type RpcRecord = Record<string, unknown>;

export type WorkspaceProject = {
  id: string;
  name: string;
  path: string;
};

export type ImportedSession = {
  path: string;
  name?: string;
};

export interface WorkspaceSnapshot {
  projects: WorkspaceProject[];
  sessions: ImportedSession[];
}

export interface PiClient {
  startAgent(): Promise<void>;
  sendRpc(request: RpcRecord): Promise<RpcRecord>;
  abortAgent(): Promise<RpcRecord>;
  listen(handler: (event: RpcRecord) => void): Promise<() => void>;
  loadWorkspace(): Promise<WorkspaceSnapshot>;
  createProject(name: string): Promise<WorkspaceProject>;
  renameProject(id: string, name: string): Promise<WorkspaceProject>;
  deleteProject(id: string): Promise<void>;
  deleteSession(sessionPath: string): Promise<void>;
}

export const tauriPiClient: PiClient = {
  startAgent: () => invoke("start_agent"),
  sendRpc: (request) => invoke("send_rpc", { request }),
  abortAgent: () => invoke("abort_agent"),
  loadWorkspace: () => invoke("load_workspace"),
  createProject: (name) => invoke("create_project", { name }),
  renameProject: (id, name) => invoke("rename_project", { id, name }),
  deleteProject: (id) => invoke("delete_project", { id }),
  deleteSession: (sessionPath) => invoke("delete_session", { sessionPath }),
  listen: async (handler) => {
    return listen<RpcRecord>("pi-rpc-event", ({ payload }) => handler(payload));
  },
};
