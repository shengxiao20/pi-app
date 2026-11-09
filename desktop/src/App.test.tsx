import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type { PiClient, DataRecord } from "./pi-client";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: "<svg />" }),
  },
}));

function createClient() {
  let workspace = { id: "workspace-a", path: "/workspace/a", displayName: "a" };
  const sessions = {
    "workspace-a": [
      { id: "a-session", path: "/sessions/a.jsonl", title: "Session A" },
    ],
    "workspace-b": [
      { id: "b-session", path: "/sessions/b.jsonl", title: "Session B" },
    ],
  };
  const client: PiClient = {
    createSession: vi.fn().mockResolvedValue({
      id: "new-session",
      path: "/sessions/new.jsonl",
      title: "new-session",
    }),
    currentWorkspace: vi.fn().mockImplementation(async () => workspace),
    chooseWorkspace: vi.fn().mockImplementation(async () => {
      workspace = { id: "workspace-b", path: "/workspace/b", displayName: "b" };
      return workspace;
    }),
    runAgent: vi
      .fn()
      .mockImplementation(async (sessionId, _prompt, handler) => {
        handler({
          sessionId,
          runId: "run-1",
          event: { type: "RUN_STARTED", threadId: sessionId, runId: "run-1" },
        });
        handler({
          sessionId,
          runId: "run-1",
          event: {
            type: "TEXT_MESSAGE_START",
            messageId: "assistant-1",
            role: "assistant",
          },
        });
        handler({
          sessionId,
          runId: "run-1",
          event: {
            type: "TEXT_MESSAGE_CONTENT",
            messageId: "assistant-1",
            delta: "AG-UI reply",
          },
        });
        handler({
          sessionId,
          runId: "run-1",
          event: { type: "TEXT_MESSAGE_END", messageId: "assistant-1" },
        });
        handler({
          sessionId,
          runId: "run-1",
          event: {
            type: "RUN_FINISHED",
            threadId: sessionId,
            runId: "run-1",
            outcome: { type: "success" },
          },
        });
      }),
    abortSession: vi.fn().mockResolvedValue(undefined),
    renameSession: vi.fn().mockResolvedValue(undefined),
    listCommands: vi.fn().mockResolvedValue([]),
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
      messages: [] as DataRecord[],
      before: 0,
      hasMore: false,
    }),
  };
  return { client };
}

describe("App web workspace", () => {
  afterEach(cleanup);

  it("renders persisted Markdown without changing the page renderer", async () => {
    const fake = createClient();
    fake.client.sessionHistory = vi.fn().mockResolvedValue({
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "| 配置 | 含义 | |---|---| | AG-UI | Web protocol |",
            },
          ],
        },
      ],
      before: 0,
      hasMore: false,
    });
    render(<App client={fake.client} />);

    expect(await screen.findByRole("table")).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Web protocol" })).toBeTruthy();
  });

  it("loads the current workspace and session history by session ID", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);

    expect((await screen.findAllByText("Session A")).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Workspace" })).toBeTruthy();
    expect(fake.client.sessionHistory).toHaveBeenCalledWith(
      "a-session",
      Number.MAX_SAFE_INTEGER,
      80,
    );
  });

  it("replaces sessions after the server changes workspace", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);
    await screen.findAllByText("Session A");

    fireEvent.click(screen.getByRole("button", { name: "Change workspace" }));

    await waitFor(() =>
      expect(screen.getAllByText("Session B").length).toBeGreaterThan(0),
    );
    expect(screen.queryAllByText("Session A")).toHaveLength(0);
  });

  it("creates a tag with the existing inline control", async () => {
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

  it("renames a session through the Pi SDK service", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Rename session Session A" }),
    );
    const input = screen.getByRole("textbox", {
      name: "Rename session Session A",
    });
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(fake.client.renameSession).toHaveBeenCalledWith(
        "a-session",
        "Renamed",
      ),
    );
  });

  it("renders AG-UI text events from a run", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);
    const textbox = await screen.findByRole("combobox", { name: "Message" });
    fireEvent.change(textbox, { target: { value: "Hello" } });
    fireEvent.keyDown(textbox, { key: "Enter" });

    await waitFor(() => expect(fake.client.runAgent).toHaveBeenCalled());
    expect((await screen.findAllByText("AG-UI reply")).length).toBeGreaterThan(
      0,
    );
  });
});
