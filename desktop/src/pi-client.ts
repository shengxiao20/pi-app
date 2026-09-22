import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type RpcRecord = Record<string, unknown>;

export interface PiClient {
  startAgent(): Promise<void>;
  launchSession(): Promise<string | undefined>;
  sendRpc(request: RpcRecord): Promise<RpcRecord>;
  abortAgent(): Promise<RpcRecord>;
  listen(handler: (event: RpcRecord) => void): Promise<() => void>;
  deleteSession(sessionPath: string): Promise<void>;
}

export const tauriPiClient: PiClient = {
  startAgent: () => invoke("start_agent"),
  launchSession: () => invoke("launch_session"),
  sendRpc: (request) => invoke("send_rpc", { request }),
  abortAgent: () => invoke("abort_agent"),
  deleteSession: (sessionPath) => invoke("delete_session", { sessionPath }),
  listen: async (handler) =>
    listen<RpcRecord>("pi-rpc-event", ({ payload }) => handler(payload)),
};
