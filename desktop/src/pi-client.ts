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

export type PersistedHistoryPage = {
  messages: RpcRecord[];
  before: number;
  hasMore: boolean;
};

export type CurrentWorkspace = {
  id: string;
  path: string;
  displayName: string;
};

export type Tag = { id: number; name: string };
export type SessionTagAssignment = { sessionId: string; tagId: number | null };

export interface PiClient {
  /** Activates a Pi child only for work on this target. An existing session path
   * makes the backend restore and verify Pi's active session before returning. */
  startAgent(target: RuntimeTarget, sessionPath?: string): Promise<void>;
  bindSession(target: RuntimeTarget, sessionId: string): Promise<RuntimeTarget>;
  currentWorkspace(): Promise<CurrentWorkspace | null>;
  chooseWorkspace(): Promise<CurrentWorkspace | null>;
  sendRpc(target: RuntimeTarget, request: RpcRecord): Promise<RpcRecord>;
  abortAgent(target: RuntimeTarget): Promise<RpcRecord>;
  listen(handler: (event: RuntimeEvent) => void): Promise<() => void>;
  listSessions(): Promise<PersistedSession[]>;
  listTags(): Promise<Tag[]>;
  createTag(name: string): Promise<Tag>;
  renameTag(id: number, name: string): Promise<Tag>;
  deleteTag(id: number): Promise<void>;
  listSessionTagAssignments(): Promise<SessionTagAssignment[]>;
  assignSessionTag(sessionId: string, tagId: number | null): Promise<void>;
  sessionHistory(
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
  currentWorkspace: () => invoke<CurrentWorkspace | null>("current_workspace"),
  chooseWorkspace: () => invoke<CurrentWorkspace | null>("choose_workspace"),
  sendRpc: (target, request) => invoke("send_rpc", { target, request }),
  abortAgent: (target) => invoke("abort_agent", { target }),
  listSessions: () => invoke("list_sessions"),
  listTags: () => invoke("list_tags"),
  createTag: (name) => invoke("create_tag", { name }),
  renameTag: (id, name) => invoke("rename_tag", { id, name }),
  deleteTag: (id) => invoke("delete_tag", { id }),
  listSessionTagAssignments: () => invoke("list_session_tag_assignments"),
  assignSessionTag: (sessionId, tagId) =>
    invoke("assign_session_tag", { sessionId, tagId }),
  sessionHistory: (sessionPath, before, limit) =>
    invoke("session_history", { sessionPath, before, limit }),
  listen: async (handler) =>
    listen<RuntimeEvent>("pi-rpc-event", ({ payload }) => handler(payload)),
};
