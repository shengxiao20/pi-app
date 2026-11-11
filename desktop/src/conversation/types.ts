import type { PiNotification } from "../../shared/extension-feedback";

export type ChatStatus =
  | "idle"
  | "starting"
  | "ready"
  | "streaming"
  | "completed"
  | "aborted"
  | "failed";

type ChatMessage = {
  kind: "message";
  role: "user" | "assistant";
  text: string;
};

type ToolCall = {
  kind: "tool";
  id: string;
  name: string;
  target?: string;
  argumentsJson: string;
  output: string;
  isError: boolean;
  isRunning: boolean;
};

export type HistoryEntry =
  | ChatMessage
  | ToolCall
  | ({ kind: "notification" } & PiNotification);
