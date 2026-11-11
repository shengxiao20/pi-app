import type { HistoryEntry } from "../conversation/types";
import type { DataRecord, Tag } from "../pi-client";

export type WorkspaceSession = {
  id: string;
  title: string;
  sessionPath: string;
  historyLoaded: boolean;
  historyLoading: boolean;
  historyBefore: number;
  hasMoreHistory: boolean;
  persistedMessages: DataRecord[];
  history: HistoryEntry[];
};

export type RenameTarget =
  | { kind: "tag"; tag: Tag }
  | { kind: "session"; session: WorkspaceSession };

export type ContextMenu = { kind: "tag"; tag: Tag; x: number; y: number };
