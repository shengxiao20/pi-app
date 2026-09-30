import { describe, expect, it } from "vitest";

import {
  createWorkspaceState,
  isSessionInteractive,
  workspaceReducer,
} from "./workspace-state";

function session(id: string) {
  return { id, title: id, sessionPath: `/${id}.jsonl` };
}

function event(sessionId: string, instanceId: number, type: string) {
  return { sessionId, instanceId, event: { type } };
}

describe("workspaceReducer", () => {
  it("keeps runtime state isolated by session", () => {
    let state = createWorkspaceState();
    state = workspaceReducer(state, {
      type: "ensure-session",
      session: session("a"),
    });
    state = workspaceReducer(state, {
      type: "ensure-session",
      session: session("b"),
    });
    state = workspaceReducer(state, {
      type: "process-event",
      active: "b",
      event: event("a", 1, "message_update"),
    });

    expect(state.sessions.a.status).toBe("streaming");
    expect(state.sessions.a.unread).toBe(true);
    expect(state.sessions.b.status).toBe("idle");
  });

  it("ignores stale events from an older process instance", () => {
    let state = createWorkspaceState();
    state = workspaceReducer(state, {
      type: "ensure-session",
      session: session("a"),
    });
    state = workspaceReducer(state, {
      type: "process-event",
      active: "a",
      event: event("a", 2, "agent_settled"),
    });
    state = workspaceReducer(state, {
      type: "process-event",
      active: "a",
      event: event("a", 1, "message_update"),
    });

    expect(state.sessions.a.status).toBe("completed");
    expect(state.sessions.a.instanceId).toBe(2);
  });

  it("selecting a completed session clears unread and returns it to idle", () => {
    let state = createWorkspaceState();
    state = workspaceReducer(state, {
      type: "ensure-session",
      session: session("a"),
    });
    state = workspaceReducer(state, {
      type: "process-event",
      active: "b",
      event: event("a", 1, "agent_settled"),
    });
    state = workspaceReducer(state, { type: "select-session", sessionId: "a" });

    expect(state.sessions.a).toMatchObject({ status: "idle", unread: false });
  });

  it("blocks prompts only for the session that is streaming", () => {
    let state = createWorkspaceState();
    state = workspaceReducer(state, {
      type: "ensure-session",
      session: session("a"),
    });
    state = workspaceReducer(state, {
      type: "ensure-session",
      session: session("b"),
    });
    state = workspaceReducer(state, {
      type: "set-status",
      sessionId: "a",
      status: "streaming",
    });

    expect(isSessionInteractive(state.sessions.a)).toBe(false);
    expect(isSessionInteractive(state.sessions.b)).toBe(true);
  });

  it("clears state when the visible workspace changes", () => {
    let state = createWorkspaceState();
    state = workspaceReducer(state, {
      type: "ensure-session",
      session: session("a"),
    });
    expect(workspaceReducer(state, { type: "clear-sessions" })).toEqual({
      sessions: {},
    });
  });
});
