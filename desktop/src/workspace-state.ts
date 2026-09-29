import type { RpcRecord, RuntimeEvent } from "./pi-client";

export type SessionStatus =
  | "idle"
  | "starting"
  | "ready"
  | "streaming"
  | "completed"
  | "aborted"
  | "failed";
export type ChatMessage = {
  kind: "message";
  role: "user" | "assistant";
  text: string;
};
export type WorkspaceTool = {
  id: string;
  name: string;
  output: string;
  isError: boolean;
  isRunning: boolean;
};
export type WorkspaceSession = {
  id: string;
  title: string;
  sessionPath: string;
  history: ChatMessage[];
  tools: WorkspaceTool[];
  draft: string;
  status: SessionStatus;
  error?: string;
  generation?: number;
  unread: boolean;
};
export type WorkspaceState = { sessions: Record<string, WorkspaceSession> };
export function isSessionInteractive(
  session: WorkspaceSession | undefined,
): boolean {
  return session?.status !== "starting" && session?.status !== "streaming";
}

export function projectRuntimeSummary(
  state: WorkspaceState,
  projectId: string,
): { running: boolean; unread: boolean } {
  const sessions = Object.entries(state.sessions)
    .filter(([key]) => key.startsWith(`${projectId}:`))
    .map(([, session]) => session);
  return {
    running: sessions.some(
      (session) =>
        session.status === "starting" || session.status === "streaming",
    ),
    unread: sessions.some((session) => session.unread),
  };
}
export type SessionSeed = Pick<
  WorkspaceSession,
  "id" | "title" | "sessionPath"
>;

export type WorkspaceAction =
  | { type: "ensure-session"; projectId: string; session: SessionSeed }
  | { type: "set-draft"; projectId: string; sessionId: string; draft: string }
  | {
      type: "set-status";
      projectId: string;
      sessionId: string;
      status: SessionStatus;
      error?: string;
    }
  | { type: "select-session"; projectId: string; sessionId: string }
  | {
      type: "remove-workspace";
      projectId: string;
    }
  | { type: "runtime-event"; active?: string; event: RuntimeEvent };

export function sessionKey(projectId: string, sessionId: string): string {
  return `${projectId}:${sessionId}`;
}

export function createWorkspaceState(): WorkspaceState {
  return { sessions: {} };
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  if (action.type === "ensure-session") {
    const key = sessionKey(action.projectId, action.session.id);
    if (state.sessions[key]) return state;
    return {
      ...state,
      sessions: {
        ...state.sessions,
        [key]: {
          ...action.session,
          history: [],
          tools: [],
          draft: "",
          status: "idle",
          unread: false,
        },
      },
    };
  }

  if (action.type === "set-draft") {
    return updateSession(
      state,
      sessionKey(action.projectId, action.sessionId),
      (session) => ({
        ...session,
        draft: action.draft,
      }),
    );
  }
  if (action.type === "set-status") {
    return updateSession(
      state,
      sessionKey(action.projectId, action.sessionId),
      (session) => ({
        ...session,
        status: action.status,
        error: action.error,
      }),
    );
  }
  if (action.type === "select-session") {
    return updateSession(
      state,
      sessionKey(action.projectId, action.sessionId),
      (session) => ({
        ...session,
        status: session.status === "completed" ? "idle" : session.status,
        unread: false,
      }),
    );
  }
  if (action.type === "remove-workspace") {
    return {
      sessions: Object.fromEntries(
        Object.entries(state.sessions).filter(
          ([key]) => !key.startsWith(`${action.projectId}:`),
        ),
      ),
    };
  }

  const key = sessionKey(action.event.projectId, action.event.sessionId);
  const current = state.sessions[key] ?? {
    id: action.event.sessionId,
    title: action.event.sessionId,
    sessionPath: "",
    history: [],
    tools: [],
    draft: "",
    status: "idle" as SessionStatus,
    unread: false,
  };
  if (
    current.generation !== undefined &&
    action.event.generation < current.generation
  ) {
    return state;
  }
  const event = action.event.event;
  const generation = Math.max(
    current.generation ?? action.event.generation,
    action.event.generation,
  );
  const selected = action.active === key;
  const next: WorkspaceSession = {
    ...current,
    generation,
    unread: current.unread || !selected,
  };

  if (event.type === "bridge_error") {
    next.status = "failed";
    next.error = stringField(event, "message") ?? "Pi bridge failed";
  } else if (event.type === "agent_settled") {
    next.status = current.status === "aborted" ? "aborted" : "completed";
  } else if (event.type === "agent_aborted") {
    next.status = "aborted";
  } else if (isStreamingEvent(event)) {
    next.status = "streaming";
  }

  if (
    event.type === "extension_ui_request" &&
    event.method === "notify" &&
    typeof event.message === "string"
  ) {
    next.history = [
      ...current.history,
      { kind: "message", role: "assistant", text: event.message },
    ];
  } else if (event.type === "tool_execution_start") {
    const id = stringField(event, "toolCallId");
    const name = stringField(event, "toolName");
    if (id && name)
      next.tools = [
        ...current.tools,
        { id, name, output: "", isError: false, isRunning: true },
      ];
  } else if (
    event.type === "tool_execution_update" ||
    event.type === "tool_execution_end"
  ) {
    const id = stringField(event, "toolCallId");
    if (id) {
      next.tools = current.tools.map((tool) =>
        tool.id !== id
          ? tool
          : {
              ...tool,
              output:
                stringField(event, "output") ??
                stringField(event, "text") ??
                tool.output,
              isError:
                event.type === "tool_execution_end" && event.isError === true,
              isRunning: event.type !== "tool_execution_end",
            },
      );
    }
  }

  const text = messageText(event);
  if (text) {
    next.history = [
      ...current.history,
      { kind: "message", role: "assistant", text },
    ];
  }
  return { ...state, sessions: { ...state.sessions, [key]: next } };
}

function updateSession(
  state: WorkspaceState,
  key: string,
  change: (session: WorkspaceSession) => WorkspaceSession,
): WorkspaceState {
  const session = state.sessions[key];
  if (!session) return state;
  return { ...state, sessions: { ...state.sessions, [key]: change(session) } };
}

function isStreamingEvent(event: RpcRecord): boolean {
  return [
    "agent_start",
    "turn_start",
    "message_start",
    "message_update",
    "tool_execution_start",
    "tool_execution_update",
    "compaction_start",
    "auto_retry_start",
  ].includes(String(event.type));
}

function messageText(event: RpcRecord): string | undefined {
  if (event.type === "message_update") {
    const update = event.assistantMessageEvent;
    if (isRecord(update) && update.type === "text_delta")
      return stringField(update, "delta");
  }
  return stringField(event, "text");
}

function stringField(record: RpcRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is RpcRecord {
  return typeof value === "object" && value !== null;
}
