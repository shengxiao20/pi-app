import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type RpcRecord = Record<string, unknown>;

export interface PiClient {
  startAgent(): Promise<void>;
  sendRpc(request: RpcRecord): Promise<RpcRecord>;
  abortAgent(): Promise<RpcRecord>;
  listen(handler: (event: RpcRecord) => void): Promise<() => void>;
}

export const tauriPiClient: PiClient = {
  startAgent: () => invoke("start_agent"),
  sendRpc: (request) => invoke("send_rpc", { request }),
  abortAgent: () => invoke("abort_agent"),
  listen: async (handler) => {
    return listen<RpcRecord>("pi-rpc-event", ({ payload }) => handler(payload));
  },
};
