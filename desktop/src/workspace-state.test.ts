import { EventType } from "@ag-ui/core";
import { describe, expect, it } from "vitest";

import {
  createWorkspaceState,
  isSessionInteractive,
  workspaceReducer,
} from "./workspace-state";
import type { SessionProcessEvent } from "./pi-client";

function session(id: string) {
  return { id, title: id, sessionPath: `/${id}.jsonl` };
}

function started(sessionId: string, runId = "run-1"): SessionProcessEvent {
  return {
    sessionId,
    runId,
    event: { type: EventType.RUN_STARTED, threadId: sessionId, runId },
  };
}

function finished(sessionId: string, runId = "run-1"): SessionProcessEvent {
  return {
    sessionId,
    runId,
    event: {
      type: EventType.RUN_FINISHED,
      threadId: sessionId,
      runId,
      outcome: { type: "success" },
    },
  };
}

describe("workspaceReducer", () => {
  it("keeps AG-UI run state isolated by session", () => {
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
      event: started("a"),
    });

    expect(state.sessions.a.status).toBe("streaming");
    expect(state.sessions.a.unread).toBe(true);
    expect(state.sessions.b.status).toBe("idle");
  });

  it("ignores events for sessions outside the visible workspace", () => {
    const state = workspaceReducer(createWorkspaceState(), {
      type: "process-event",
      event: started("old-workspace-session"),
    });
    expect(state).toEqual(createWorkspaceState());
  });

  it("ignores terminal events from an older run", () => {
    let state = createWorkspaceState();
    state = workspaceReducer(state, {
      type: "ensure-session",
      session: session("a"),
    });
    state = workspaceReducer(state, {
      type: "process-event",
      active: "a",
      event: started("a", "run-2"),
    });
    state = workspaceReducer(state, {
      type: "process-event",
      active: "a",
      event: finished("a", "run-1"),
    });

    expect(state.sessions.a.status).toBe("streaming");
    expect(state.sessions.a.runId).toBe("run-2");
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
      event: finished("a"),
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
    expect(isSessionInteractive(undefined)).toBe(false);
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
