import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type { PiClient, RpcRecord, RuntimeEvent } from "./pi-client";

function createClient() {
  let workspace = {
    id: "workspace-a",
    path: "/workspace/a",
    displayName: "a",
  };
  let handler: ((event: RuntimeEvent) => void) | undefined;
  const sessions = {
    "workspace-a": [
      { id: "a-session", path: "/sessions/a.jsonl", title: "Session A" },
    ],
    "workspace-b": [
      { id: "b-session", path: "/sessions/b.jsonl", title: "Session B" },
    ],
  };
  const client: PiClient = {
    startAgent: vi.fn().mockResolvedValue(undefined),
    bindSession: vi.fn().mockImplementation(async (target, sessionId) => ({
      ...target,
      sessionId,
    })),
    currentWorkspace: vi.fn().mockImplementation(async () => workspace),
    chooseWorkspace: vi.fn().mockImplementation(async () => {
      workspace = {
        id: "workspace-b",
        path: "/workspace/b",
        displayName: "b",
      };
      return workspace;
    }),
    sendRpc: vi.fn().mockResolvedValue({ type: "response", success: true }),
    abortAgent: vi.fn().mockResolvedValue({ type: "response", success: true }),
    listen: vi.fn().mockImplementation(async (nextHandler) => {
      handler = nextHandler;
      return () => undefined;
    }),
    listSessions: vi
      .fn()
      .mockImplementation(
        async () => sessions[workspace.id as keyof typeof sessions],
      ),
    listTags: vi.fn().mockResolvedValue([]),
    createTag: vi.fn(),
    renameTag: vi.fn(),
    deleteTag: vi.fn(),
    listSessionTagAssignments: vi.fn().mockResolvedValue([]),
    assignSessionTag: vi.fn(),
    sessionHistory: vi.fn().mockResolvedValue({
      messages: [] as RpcRecord[],
      before: 0,
      hasMore: false,
    }),
  };
  return { client, emit: (event: RuntimeEvent) => handler?.(event) };
}

describe("App workspace boundary", () => {
  afterEach(cleanup);

  it("shows a single current workspace rather than a Projects catalog", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);

    expect((await screen.findAllByText("Session A")).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Workspace" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Change workspace" }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Projects" })).toBeNull();
    expect(screen.queryByText("Skills will appear here.")).toBeNull();
    expect(fake.client.listSessions).toHaveBeenCalledWith();
    expect(fake.client.sessionHistory).toHaveBeenCalledWith(
      "/sessions/a.jsonl",
      Number.MAX_SAFE_INTEGER,
      80,
    );
  });

  it("replaces visible sessions when Change workspace selects a new directory", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);
    await screen.findAllByText("Session A");

    fireEvent.click(screen.getByRole("button", { name: "Change workspace" }));

    await waitFor(() =>
      expect(screen.getAllByText("Session B").length).toBeGreaterThan(0),
    );
    expect(screen.queryAllByText("Session A")).toHaveLength(0);
    expect(fake.client.abortAgent).not.toHaveBeenCalled();
    expect(fake.client.startAgent).not.toHaveBeenCalled();
  });

  it("creates a tag from the visible inline control", async () => {
    const fake = createClient();
    fake.client.createTag = vi.fn().mockResolvedValue({ id: 7, name: "Work" });
    render(<App client={fake.client} />);

    fireEvent.click(await screen.findByRole("button", { name: "Create tag" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New tag name" }), {
      target: { value: "Work" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));

    await waitFor(() =>
      expect(fake.client.createTag).toHaveBeenCalledWith("Work"),
    );
  });

  it("moves a session to a tag by dropping its session row onto the tag group", async () => {
    const fake = createClient();
    fake.client.listTags = vi.fn().mockResolvedValue([{ id: 7, name: "Work" }]);
    render(<App client={fake.client} />);

    await screen.findAllByText("Session A");
    const dataTransfer = {
      effectAllowed: "",
      getData: vi.fn().mockReturnValue("a-session"),
      setData: vi.fn(),
    };
    fireEvent.dragStart(
      screen.getAllByRole("button", { name: /Session A/ })[0],
      { dataTransfer },
    );
    fireEvent.drop(screen.getByText("Work").parentElement!, { dataTransfer });

    await waitFor(() =>
      expect(fake.client.assignSessionTag).toHaveBeenCalledWith("a-session", 7),
    );
    expect(fake.client.startAgent).not.toHaveBeenCalled();
  });

  it("opens a context menu and renames a session inline", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);
    const session = (
      await screen.findAllByRole("button", { name: /Session A/ })
    )[0];

    fireEvent.contextMenu(session, { clientX: 20, clientY: 20 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox", {
      name: "Rename session Session A",
    });
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(fake.client.sendRpc).toHaveBeenCalledWith(
        { projectId: "workspace-a", sessionId: "a-session" },
        expect.objectContaining({ type: "set_session_name", name: "Renamed" }),
      ),
    );
  });

  it("deduplicates background terminal notifications and clears them on workspace replacement", async () => {
    const fake = createClient();
    fake.client.listSessions = vi.fn().mockImplementation(async () => {
      if ((await fake.client.currentWorkspace())?.id === "workspace-a") {
        return [
          { id: "a-session", path: "/sessions/a.jsonl", title: "Session A" },
          { id: "b-session", path: "/sessions/b.jsonl", title: "Session B" },
        ];
      }
      return [
        { id: "b-session", path: "/sessions/b.jsonl", title: "Session B" },
      ];
    });
    render(<App client={fake.client} />);
    await screen.findAllByText("Session A");
    await waitFor(() => expect(fake.client.listen).toHaveBeenCalled());

    await act(async () => {
      fake.emit({
        projectId: "workspace-a",
        sessionId: "b-session",
        generation: 2,
        event: { type: "agent_settled" },
      });
      fake.emit({
        projectId: "workspace-a",
        sessionId: "b-session",
        generation: 1,
        event: { type: "agent_settled" },
      });
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Notifications: 1 unread" }),
      ).toBeTruthy(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Notifications: 1 unread" }),
    );
    expect(screen.getByText("Session B: completed")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Change workspace" }));
    await waitFor(() =>
      expect(screen.getAllByText("Session B")).toHaveLength(1),
    );
    expect(
      screen.getByRole("button", { name: "Notifications: 0 unread" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Session B: completed" }),
    ).toBeNull();
  });
});
