import type { SessionProcessEvent } from "./pi-client";

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
  runId?: string;
  unread: boolean;
};
export type WorkspaceState = { sessions: Record<string, WorkspaceSession> };
export type SessionSeed = Pick<
  WorkspaceSession,
  "id" | "title" | "sessionPath"
>;
export type WorkspaceAction =
  | { type: "ensure-session"; session: SessionSeed }
  | { type: "set-draft"; sessionId: string; draft: string }
  | {
      type: "set-status";
      sessionId: string;
      status: SessionStatus;
      error?: string;
    }
  | { type: "select-session"; sessionId: string }
  | { type: "clear-sessions" }
  | { type: "process-event"; active?: string; event: SessionProcessEvent };

export function isSessionInteractive(
  session: WorkspaceSession | undefined,
): boolean {
  return Boolean(
    session && session.status !== "starting" && session.status !== "streaming",
  );
}

export function createWorkspaceState(): WorkspaceState {
  return { sessions: {} };
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  if (action.type === "ensure-session") {
    if (state.sessions[action.session.id]) return state;
    return {
      ...state,
      sessions: {
        ...state.sessions,
        [action.session.id]: {
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
  if (action.type === "set-draft")
    return updateSession(state, action.sessionId, (session) => ({
      ...session,
      draft: action.draft,
    }));
  if (action.type === "set-status")
    return updateSession(state, action.sessionId, (session) => ({
      ...session,
      status: action.status,
      error: action.error,
    }));
  if (action.type === "select-session")
    return updateSession(state, action.sessionId, (session) => ({
      ...session,
      status: session.status === "completed" ? "idle" : session.status,
      unread: false,
    }));
  if (action.type === "clear-sessions") return createWorkspaceState();

  const { sessionId, runId, event } = action.event;
  const current = state.sessions[sessionId];
  if (!current) return state;
  if (
    current.runId &&
    current.runId !== runId &&
    event.type !== "RUN_STARTED"
  ) {
    return state;
  }
  const next: WorkspaceSession = {
    ...current,
    runId,
    unread: current.unread || action.active !== sessionId,
  };
  if (event.type === "RUN_STARTED") {
    next.status = "streaming";
    next.error = undefined;
  } else if (event.type === "RUN_ERROR") {
    next.status = "failed";
    next.error = event.message;
  } else if (event.type === "RUN_FINISHED") {
    next.status = event.outcome?.type === "cancelled" ? "aborted" : "completed";
  }
  return { ...state, sessions: { ...state.sessions, [sessionId]: next } };
}

function updateSession(
  state: WorkspaceState,
  sessionId: string,
  change: (session: WorkspaceSession) => WorkspaceSession,
): WorkspaceState {
  const session = state.sessions[sessionId];
  if (!session) return state;
  return {
    ...state,
    sessions: { ...state.sessions, [sessionId]: change(session) },
  };
}
