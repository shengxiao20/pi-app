import { describe, expect, it } from "vitest";

import {
  createWorkspaceState,
  isSessionInteractive,
  projectRuntimeSummary,
  sessionKey,
  workspaceReducer,
} from "./workspace-state";

describe("workspaceReducer", () => {
  it("keeps project/session state isolated while routing an envelope", () => {
    const first = sessionKey("project-a", "session-1");
    const second = sessionKey("project-b", "session-2");
    let state = createWorkspaceState();
    state = workspaceReducer(state, {
      type: "ensure-session",
      projectId: "project-a",
      session: { id: "session-1", title: "One", sessionPath: "/a/one" },
    });
    state = workspaceReducer(state, {
      type: "ensure-session",
      projectId: "project-b",
      session: { id: "session-2", title: "Two", sessionPath: "/b/two" },
    });
    state = workspaceReducer(state, {
      type: "runtime-event",
      active: first,
      event: {
        projectId: "project-b",
        sessionId: "session-2",
        generation: 3,
        event: { type: "message_update", text: "background" },
      },
    });

    expect(state.sessions[first].history).toEqual([]);
    expect(state.sessions[second]).toMatchObject({
      generation: 3,
      unread: true,
      history: [{ kind: "message", role: "assistant", text: "background" }],
    });
  });

  it("keeps drafts local and clears unread only when that session is selected", () => {
    const one = sessionKey("project", "one");
    const two = sessionKey("project", "two");
    let state = createWorkspaceState();
    for (const session of [
      { id: "one", title: "One", sessionPath: "/one" },
      { id: "two", title: "Two", sessionPath: "/two" },
    ]) {
      state = workspaceReducer(state, {
        type: "ensure-session",
        projectId: "project",
        session,
      });
    }
    state = workspaceReducer(state, {
      type: "set-draft",
      projectId: "project",
      sessionId: "one",
      draft: "keep me",
    });
    state = workspaceReducer(state, {
      type: "runtime-event",
      active: one,
      event: {
        projectId: "project",
        sessionId: "two",
        generation: 1,
        event: { type: "agent_settled" },
      },
    });
    state = workspaceReducer(state, {
      type: "select-session",
      projectId: "project",
      sessionId: "two",
    });

    expect(state.sessions[one].draft).toBe("keep me");
    expect(state.sessions[two].unread).toBe(false);
  });

  it("ignores an event from an older generation without affecting interactivity", () => {
    const key = sessionKey("project", "session");
    let state = createWorkspaceState();
    state = workspaceReducer(state, {
      type: "ensure-session",
      projectId: "project",
      session: { id: "session", title: "Session", sessionPath: "/session" },
    });
    state = workspaceReducer(state, {
      type: "runtime-event",
      active: key,
      event: {
        projectId: "project",
        sessionId: "session",
        generation: 2,
        event: { type: "bridge_error", message: "new failure" },
      },
    });
    state = workspaceReducer(state, {
      type: "runtime-event",
      active: key,
      event: {
        projectId: "project",
        sessionId: "session",
        generation: 1,
        event: { type: "agent_start" },
      },
    });

    expect(state.sessions[key]).toMatchObject({
      generation: 2,
      status: "failed",
      error: "new failure",
    });
    expect(isSessionInteractive(state.sessions[key])).toBe(true);
  });

  it("retains background tool lifecycle and derives terminal/project state", () => {
    const key = sessionKey("project", "session");
    let state = createWorkspaceState();
    state = workspaceReducer(state, {
      type: "ensure-session",
      projectId: "project",
      session: { id: "session", title: "Session", sessionPath: "/session" },
    });
    state = workspaceReducer(state, {
      type: "runtime-event",
      event: {
        projectId: "project",
        sessionId: "session",
        generation: 1,
        event: {
          type: "tool_execution_start",
          toolCallId: "tool-1",
          toolName: "bash",
        },
      },
    });
    state = workspaceReducer(state, {
      type: "runtime-event",
      event: {
        projectId: "project",
        sessionId: "session",
        generation: 1,
        event: {
          type: "tool_execution_end",
          toolCallId: "tool-1",
          output: "done",
        },
      },
    });
    state = workspaceReducer(state, {
      type: "runtime-event",
      event: {
        projectId: "project",
        sessionId: "session",
        generation: 1,
        event: { type: "agent_settled" },
      },
    });

    expect(state.sessions[key]).toMatchObject({
      status: "completed",
      tools: [{ id: "tool-1", name: "bash", output: "done", isRunning: false }],
    });
  });

  it("preserves abort intent and only flags unread for visible background work", () => {
    const key = sessionKey("project", "session");
    let state = createWorkspaceState();
    state = workspaceReducer(state, {
      type: "ensure-session",
      projectId: "project",
      session: { id: "session", title: "Session", sessionPath: "/session" },
    });
    state = workspaceReducer(state, {
      type: "set-status",
      projectId: "project",
      sessionId: "session",
      status: "aborted",
    });
    state = workspaceReducer(state, {
      type: "runtime-event",
      active: key,
      event: {
        projectId: "project",
        sessionId: "session",
        generation: 1,
        event: { type: "agent_settled" },
      },
    });
    expect(state.sessions[key].status).toBe("aborted");
    expect(state.sessions[key].unread).toBe(false);
  });

  it("derives project running and unread summary from its own sessions", () => {
    let state = createWorkspaceState();
    for (const [projectId, sessionId] of [
      ["project-a", "one"],
      ["project-b", "two"],
    ]) {
      state = workspaceReducer(state, {
        type: "ensure-session",
        projectId,
        session: {
          id: sessionId,
          title: sessionId,
          sessionPath: `/${sessionId}`,
        },
      });
    }
    state = workspaceReducer(state, {
      type: "runtime-event",
      event: {
        projectId: "project-b",
        sessionId: "two",
        generation: 1,
        event: { type: "message_update", text: "background" },
      },
    });

    expect(projectRuntimeSummary(state, "project-a")).toEqual({
      running: false,
      unread: false,
    });
    expect(projectRuntimeSummary(state, "project-b")).toEqual({
      running: true,
      unread: true,
    });
  });

  it("leaves an idle session interactive while another session streams", () => {
    const first = sessionKey("project", "first");
    const second = sessionKey("project", "second");
    let state = createWorkspaceState();
    for (const session of [
      { id: "first", title: "First", sessionPath: "/first" },
      { id: "second", title: "Second", sessionPath: "/second" },
    ]) {
      state = workspaceReducer(state, {
        type: "ensure-session",
        projectId: "project",
        session,
      });
    }
    state = workspaceReducer(state, {
      type: "set-status",
      projectId: "project",
      sessionId: "first",
      status: "streaming",
    });

    expect(isSessionInteractive(state.sessions[first])).toBe(false);
    expect(isSessionInteractive(state.sessions[second])).toBe(true);
  });
});
