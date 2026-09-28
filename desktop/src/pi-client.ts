import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type RpcRecord = Record<string, unknown>;

export type RuntimeTarget = {
  projectId: string;
  sessionId: string;
};

export type RuntimeEvent = RuntimeTarget & {
  generation: number;
  event: RpcRecord;
};

export type ProjectRuntimeSnapshot = {
  projectId: string;
  targets: RuntimeTarget[];
};

export type PersistedHistoryPage = {
  messages: RpcRecord[];
  before: number;
  hasMore: boolean;
};

export type Project = {
  id: string;
  path: string;
  displayName: string;
  lastOpened: number;
};

export interface PiClient {
  /** Activates a Pi child only for work on this target. An existing session path
   * makes the backend restore and verify Pi's active session before returning. */
  startAgent(target: RuntimeTarget, sessionPath?: string): Promise<void>;
  bindSession(target: RuntimeTarget, sessionId: string): Promise<RuntimeTarget>;
  currentDirectory(): Promise<string | null>;
  chooseWorkspace(): Promise<string | null>;
  listProjects(): Promise<Project[]>;
  addProject(path: string): Promise<Project>;
  selectProject(projectId: string): Promise<Project>;
  renameProject(projectId: string, displayName: string): Promise<Project>;
  projectRuntimeSnapshot(projectId: string): Promise<ProjectRuntimeSnapshot>;
  removeProject(
    projectId: string,
    snapshot: ProjectRuntimeSnapshot,
  ): Promise<Project>;
  sendRpc(target: RuntimeTarget, request: RpcRecord): Promise<RpcRecord>;
  abortAgent(target: RuntimeTarget): Promise<RpcRecord>;
  listen(handler: (event: RuntimeEvent) => void): Promise<() => void>;
  listSessions(projectId: string): Promise<PersistedSession[]>;
  sessionHistory(
    projectId: string,
    sessionPath: string,
    before: number,
    limit: number,
  ): Promise<PersistedHistoryPage>;
}

export type PersistedSession = {
  id: string;
  path: string;
  title: string;
};

export const tauriPiClient: PiClient = {
  startAgent: (target, sessionPath) =>
    invoke("start_agent", { target, sessionPath }),
  bindSession: (target, sessionId) =>
    invoke<RuntimeTarget>("bind_session", { target, sessionId }),
  currentDirectory: () => invoke<string | null>("current_directory"),
  chooseWorkspace: () => invoke<string | null>("choose_workspace"),
  listProjects: () => invoke<Project[]>("list_projects"),
  addProject: (path) => invoke<Project>("add_project", { path }),
  selectProject: (projectId) =>
    invoke<Project>("select_project", { projectId }),
  renameProject: (projectId, displayName) =>
    invoke<Project>("rename_project", { projectId, displayName }),
  projectRuntimeSnapshot: (projectId) =>
    invoke<ProjectRuntimeSnapshot>("project_runtime_snapshot", { projectId }),
  removeProject: (projectId, snapshot) =>
    invoke<Project>("remove_project", { projectId, snapshot }),
  sendRpc: (target, request) => invoke("send_rpc", { target, request }),
  abortAgent: (target) => invoke("abort_agent", { target }),
  listSessions: (projectId) => invoke("list_sessions", { projectId }),
  sessionHistory: (projectId, sessionPath, before, limit) =>
    invoke("session_history", { projectId, sessionPath, before, limit }),
  listen: async (handler) =>
    listen<RuntimeEvent>("pi-rpc-event", ({ payload }) => handler(payload)),
};
