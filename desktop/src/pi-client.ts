import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type RpcRecord = Record<string, unknown>;

export type PersistedHistoryPage = {
  messages: RpcRecord[];
  before: number;
  hasMore: boolean;
};

export interface PiClient {
  startAgent(): Promise<void>;
  launchSession(): Promise<string | undefined>;
  currentDirectory(): Promise<string>;
  sendRpc(request: RpcRecord): Promise<RpcRecord>;
  abortAgent(): Promise<RpcRecord>;
  listen(handler: (event: RpcRecord) => void): Promise<() => void>;
  listSessions(): Promise<PersistedSession[]>;
  sessionHistory(
    sessionPath: string,
    before: number,
    limit: number,
  ): Promise<PersistedHistoryPage>;
  deleteSession(sessionPath: string): Promise<void>;
}

export type PersistedSession = {
  id: string;
  path: string;
  title: string;
};

export const tauriPiClient: PiClient = {
  startAgent: () => invoke("start_agent"),
  launchSession: () => invoke("launch_session"),
  currentDirectory: () => invoke("current_directory"),
  sendRpc: (request) => invoke("send_rpc", { request }),
  abortAgent: () => invoke("abort_agent"),
  listSessions: () => invoke("list_sessions"),
  sessionHistory: (sessionPath, before, limit) =>
    invoke("session_history", { sessionPath, before, limit }),
  deleteSession: (sessionPath) => invoke("delete_session", { sessionPath }),
  listen: async (handler) =>
    listen<RpcRecord>("pi-rpc-event", ({ payload }) => handler(payload)),
};
