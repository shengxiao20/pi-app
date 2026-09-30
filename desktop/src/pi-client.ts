import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type RpcRecord = Record<string, unknown>;

export type SessionProcessEvent = {
  sessionId: string;
  instanceId: number;
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
  /** Starts an independent Pi RPC child already bound to this persisted session. */
  startSession(sessionId: string, sessionPath: string): Promise<void>;
  createSession(): Promise<PersistedSession>;
  currentWorkspace(): Promise<CurrentWorkspace | null>;
  chooseWorkspace(): Promise<CurrentWorkspace | null>;
  sendRpc(sessionId: string, request: RpcRecord): Promise<RpcRecord>;
  abortSession(sessionId: string): Promise<RpcRecord>;
  listen(handler: (event: SessionProcessEvent) => void): Promise<() => void>;
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
  startSession: (sessionId, sessionPath) =>
    invoke("start_session", { sessionId, sessionPath }),
  createSession: () => invoke("create_session"),
  currentWorkspace: () => invoke<CurrentWorkspace | null>("current_workspace"),
  chooseWorkspace: () => invoke<CurrentWorkspace | null>("choose_workspace"),
  sendRpc: (sessionId, request) => invoke("send_rpc", { sessionId, request }),
  abortSession: (sessionId) => invoke("abort_session", { sessionId }),
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
    listen<SessionProcessEvent>("pi-rpc-event", ({ payload }) =>
      handler(payload),
    ),
};
