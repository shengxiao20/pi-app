import { StrictMode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type { PiClient, RpcRecord, RuntimeEvent } from "./pi-client";

function historyPage(messages: RpcRecord[], before = 0, hasMore = false) {
  return { messages, before, hasMore };
}

function createClient() {
  let handler: ((event: RuntimeEvent) => void) | undefined;
  let sessionNumber = 0;
  const client: PiClient = {
    startAgent: vi.fn().mockResolvedValue(undefined),
    bindSession: vi.fn().mockImplementation(async (target, sessionId) => ({
      ...target,
      sessionId,
    })),
    currentDirectory: vi.fn().mockResolvedValue("/workspace/pi-app"),
    chooseWorkspace: vi.fn().mockResolvedValue(null),
    listProjects: vi.fn().mockResolvedValue([
      {
        id: "project",
        path: "/workspace/pi-app",
        displayName: "pi-app",
        lastOpened: 1,
      },
      {
        id: "project",
        path: "/workspace/picked",
        displayName: "picked",
        lastOpened: 1,
      },
      {
        id: "project",
        path: "/workspace/empty",
        displayName: "empty",
        lastOpened: 1,
      },
      {
        id: "project",
        path: "/workspace/other",
        displayName: "other",
        lastOpened: 1,
      },
    ]),
    addProject: vi.fn(),
    selectProject: vi.fn(),
    renameProject: vi.fn(),
    projectRuntimeSnapshot: vi.fn().mockResolvedValue({
      projectId: "project",
      targets: [],
    }),
    removeProject: vi.fn(),
    sendRpc: vi.fn().mockImplementation(async (_target, request: RpcRecord) => {
      if (request.type === "new_session") sessionNumber += 1;
      if (request.type === "get_state") {
        return {
          type: "response",
          success: true,
          data: {
            sessionFile:
              sessionNumber === 0
                ? "/sessions/terminal.jsonl"
                : `/sessions/session-${sessionNumber}.jsonl`,
            sessionId:
              sessionNumber === 0 ? "terminal-id" : `session-${sessionNumber}`,
            sessionName: "Terminal conversation",
          },
        };
      }
      if (request.type === "get_messages") {
        return {
          type: "response",
          success: true,
          data: {
            messages: [
              { role: "user", content: "Continue this work" },
              {
                role: "assistant",
                content: [{ type: "text", text: "I have the context." }],
              },
            ],
          },
        };
      }
      return { type: "response", success: true, data: { cancelled: false } };
    }),
    abortAgent: vi.fn().mockResolvedValue({ type: "response", success: true }),
    listen: vi.fn().mockImplementation(async (nextHandler) => {
      handler = nextHandler;
      return () => undefined;
    }),
    listSessions: vi.fn().mockResolvedValue([
      {
        id: "terminal-id",
        path: "/sessions/terminal.jsonl",
        title: "Terminal conversation",
      },
    ]),
    sessionHistory: vi.fn().mockResolvedValue({
      messages: [
        { role: "user", content: "Continue this work" },
        {
          role: "assistant",
          content: [{ type: "text", text: "I have the context." }],
        },
      ],
      before: 0,
      hasMore: false,
    }),
  };
  return {
    client,
    emit: (event: RpcRecord) =>
      handler?.({
        projectId: "project",
        sessionId:
          event.type === "agent_settled" ? "terminal-id" : "terminal-id",
        generation: 1,
        event,
      }),
  };
}

describe("App", () => {
  afterEach(() => cleanup());

  it("renders the active persisted Pi RPC session history", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);

    await screen.findByText("CONVERSATION");
    expect(fake.client.sessionHistory).toHaveBeenCalledWith(
      "project",
      "/sessions/terminal.jsonl",
      Number.MAX_SAFE_INTEGER,
      80,
    );
    expect(screen.getAllByText("Continue this work")).toHaveLength(1);
    expect(screen.getAllByText("I have the context.")).toHaveLength(2);
    expect(
      await screen.findByRole("heading", { name: "Projects" }),
    ).toBeTruthy();
    expect(
      (
        await screen.findByRole("button", { name: "pi-app Current project" })
      ).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("orders the fixed New chat control above visible Projects and Recents", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);

    const navigation = await screen.findByRole("navigation", {
      name: "Workspace navigation",
    });
    expect(
      [...navigation.children].map((element) =>
        element.classList.contains("new-session")
          ? "new-chat"
          : element.getAttribute("aria-labelledby"),
      ),
    ).toEqual(["new-chat", "projects-heading", "recents-heading"]);
    expect(screen.getByRole("heading", { name: "Recents" })).toBeTruthy();
  });

  it("selects a project from the persistent sidebar without aborting its active session", async () => {
    const fake = createClient();
    fake.client.selectProject = vi.fn().mockResolvedValue({
      id: "other-project",
      path: "/workspace/other",
      displayName: "Other project",
      lastOpened: 2,
    });
    fake.client.listProjects = vi.fn().mockResolvedValue([
      {
        id: "project",
        path: "/workspace/pi-app",
        displayName: "pi-app",
        lastOpened: 1,
      },
      {
        id: "other-project",
        path: "/workspace/other",
        displayName: "Other project",
        lastOpened: 2,
      },
    ]);
    render(<App client={fake.client} />);

    await screen.findByRole("heading", { name: "Terminal conversation" });
    await screen.findByRole("button", { name: /Other project/ });
    (
      fake.client.currentDirectory as ReturnType<typeof vi.fn>
    ).mockResolvedValue("/workspace/other");
    fireEvent.click(screen.getByRole("button", { name: /Other project/ }));
    await waitFor(() =>
      expect(fake.client.selectProject).toHaveBeenCalledWith("other-project"),
    );
    expect(fake.client.abortAgent).not.toHaveBeenCalled();
    expect(fake.client.startAgent).not.toHaveBeenCalled();
  });

  it("shows an empty-state message when the selected project has no sessions", async () => {
    const fake = createClient();
    fake.client.listSessions = vi.fn().mockResolvedValue([]);
    render(<App client={fake.client} />);

    expect(
      await screen.findByText("No sessions in this project."),
    ).toBeTruthy();
  });

  it("shows an accessible unread marker for a background session in the sidebar", async () => {
    let handler: ((event: RuntimeEvent) => void) | undefined;
    const fake = createClient();
    fake.client.listSessions = vi.fn().mockResolvedValue([
      { id: "other-id", path: "/sessions/other.jsonl", title: "Other session" },
      {
        id: "terminal-id",
        path: "/sessions/terminal.jsonl",
        title: "Terminal conversation",
      },
    ]);
    fake.client.listen = vi.fn().mockImplementation(async (nextHandler) => {
      handler = nextHandler;
      return () => undefined;
    });
    render(<App client={fake.client} />);

    await screen.findByRole("heading", { name: "Terminal conversation" });
    handler?.({
      projectId: "project",
      sessionId: "other-id",
      generation: 2,
      event: { type: "agent_settled" },
    });
    expect(await screen.findByLabelText("Unread updates")).toBeTruthy();
  });

  it("renames and confirms removal of the selected project without claiming files are deleted", async () => {
    const fake = createClient();
    fake.client.renameProject = vi.fn().mockResolvedValue({
      id: "project",
      path: "/workspace/pi-app",
      displayName: "Renamed project",
      lastOpened: 2,
    });
    fake.client.projectRuntimeSnapshot = vi.fn().mockResolvedValue({
      projectId: "project",
      targets: [
        { projectId: "project", sessionId: "running-one" },
        { projectId: "project", sessionId: "running-two" },
      ],
    });
    fake.client.removeProject = vi.fn().mockResolvedValue({
      id: "project",
      path: "/workspace/pi-app",
      displayName: "Renamed project",
      lastOpened: 2,
    });
    render(<App client={fake.client} />);

    await screen.findByRole("button", { name: "Rename current project" });
    fireEvent.click(
      screen.getByRole("button", { name: "Rename current project" }),
    );
    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "Renamed project" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save project name" }));
    await waitFor(() =>
      expect(fake.client.renameProject).toHaveBeenCalledWith(
        "project",
        "Renamed project",
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove current project" }),
    );
    expect(
      await screen.findByRole("region", { name: "Remove project" }),
    ).toBeTruthy();
    expect(fake.client.projectRuntimeSnapshot).toHaveBeenCalledWith("project");
    expect(screen.getByText("running-one")).toBeTruthy();
    expect(screen.getByText("running-two")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove project" }));
    await waitFor(() =>
      expect(fake.client.removeProject).toHaveBeenCalledWith("project", {
        projectId: "project",
        targets: [
          { projectId: "project", sessionId: "running-one" },
          { projectId: "project", sessionId: "running-two" },
        ],
      }),
    );
  });

  it("does not remove a project when task-aware removal is cancelled", async () => {
    const fake = createClient();
    fake.client.projectRuntimeSnapshot = vi.fn().mockResolvedValue({
      projectId: "project",
      targets: [{ projectId: "project", sessionId: "running" }],
    });
    render(<App client={fake.client} />);

    await screen.findByRole("button", { name: "Remove current project" });
    fireEvent.click(
      screen.getByRole("button", { name: "Remove current project" }),
    );
    await screen.findByText("running");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(fake.client.removeProject).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Remove current project" }),
    ).toBeTruthy();
  });

  it("keeps working feedback and a tool target visible until Pi settles", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);
    await screen.findByText("CONVERSATION");

    fake.emit({
      type: "tool_execution_start",
      toolCallId: "read-package",
      toolName: "read",
      args: { path: "package.json" },
    });
    expect(
      await screen.findByRole("status", { name: "Pi is working" }),
    ).toBeTruthy();
    expect(screen.getByText("package.json")).toBeTruthy();
    expect(screen.getByText("running")).toBeTruthy();

    fake.emit({
      type: "tool_execution_end",
      toolCallId: "read-package",
      toolName: "read",
      args: { path: "package.json" },
      result: { content: [{ type: "text", text: "contents" }] },
      isError: false,
    });
    expect(await screen.findByText("completed")).toBeTruthy();
    fake.emit({ type: "agent_settled" });
    await waitFor(() =>
      expect(
        screen.queryByRole("status", { name: "Pi is working" }),
      ).toBeNull(),
    );
  });

  it("does not keep working feedback after Pi settles with an unfinished tool", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);
    await screen.findByText("CONVERSATION");

    fake.emit({
      type: "tool_execution_start",
      toolCallId: "interrupted-read",
      toolName: "read",
      args: { path: "package.json" },
    });
    expect(
      await screen.findByRole("status", { name: "Pi is working" }),
    ).toBeTruthy();

    fake.emit({ type: "agent_settled" });
    await waitFor(() =>
      expect(
        screen.queryByRole("status", { name: "Pi is working" }),
      ).toBeNull(),
    );
  });

  it("settles an extension command and renders its Pi notification without an agent run", async () => {
    const fake = createClient();
    fake.client.sendRpc = vi
      .fn()
      .mockImplementation(async (_target, request: RpcRecord) => {
        if (request.type === "get_state")
          return {
            type: "response",
            success: true,
            data: {
              sessionFile: "/sessions/terminal.jsonl",
              sessionId: "terminal-id",
              sessionName: "Terminal conversation",
            },
          };
        if (request.type === "get_commands")
          return {
            type: "response",
            success: true,
            data: {
              commands: [
                {
                  name: "pi-session-memory-whats-new",
                  source: "extension",
                },
              ],
            },
          };
        return { type: "response", success: true, data: { cancelled: false } };
      });
    render(<App client={fake.client} />);
    await screen.findByText("CONVERSATION");

    fireEvent.change(screen.getByRole("combobox", { name: "Message" }), {
      target: { value: "/pi-session-memory-whats-new" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send message" })).toBeTruthy(),
    );
    expect(screen.queryByRole("status", { name: "Pi is working" })).toBeNull();
    fake.emit({
      type: "extension_ui_request",
      method: "notify",
      message: "What's New in pi-session-memory v0.6.1",
    });
    const notification = (
      await screen.findAllByText("What's New in pi-session-memory v0.6.1")
    ).find((element) => element.closest(".message-assistant"));
    expect(notification).toBeTruthy();
    expect(document.querySelector(".extension-notification")).toBeNull();
  });

  it("does not create a Pi session merely because a project has no persisted sessions", async () => {
    const fake = createClient();
    fake.client.listSessions = vi.fn().mockResolvedValue([]);
    render(<App client={fake.client} />);

    expect(
      await screen.findByText("No sessions in this project."),
    ).toBeTruthy();
    expect(fake.client.startAgent).not.toHaveBeenCalled();
    expect(fake.client.sendRpc).not.toHaveBeenCalled();
  });

  it("renders Recents session text without a decorative square icon", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);

    await screen.findByText("CONVERSATION");
    expect(document.querySelector(".session-icon")).toBeNull();
  });

  it("renders persisted tool calls and their results in session history", async () => {
    const fake = createClient();
    fake.client.sendRpc = vi
      .fn()
      .mockImplementation(async (_target, request: RpcRecord) => {
        if (request.type === "get_state")
          return {
            type: "response",
            success: true,
            data: {
              sessionFile: "/sessions/terminal.jsonl",
              sessionId: "terminal-id",
            },
          };
        return { type: "response", success: true, data: { cancelled: false } };
      });
    fake.client.sessionHistory = vi.fn().mockResolvedValue(
      historyPage([
        {
          role: "user",
          content: "Inspect **the workspace**\n\n```ts\nconst pi = true;\n```",
        },
        {
          role: "assistant",
          content: [
            { type: "text", text: "I will inspect it." },
            {
              type: "toolCall",
              id: "read-1",
              name: "read",
              arguments: { path: "package.json" },
            },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "read-1",
          isError: false,
          content: [{ type: "text", text: "package.json contents" }],
        },
      ]),
    );
    render(<App client={fake.client} />);

    expect(await screen.findByText("read")).toBeTruthy();
    expect(
      screen.getByText("the workspace", { selector: "strong" }),
    ).toBeTruthy();
    expect(
      screen.getByText("const pi = true;", { selector: "code" }),
    ).toBeTruthy();
    expect(screen.getByText("read").closest("details")?.open).toBe(false);
    expect(screen.getByText("package.json")).toBeTruthy();
    expect(screen.getByText("package.json contents")).toBeTruthy();
  });

  it("hides tool calls without hiding user or Pi history text", async () => {
    const fake = createClient();
    fake.client.sessionHistory = vi.fn().mockResolvedValue(
      historyPage([
        { role: "user", content: "Review the project" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "I will review it." },
            {
              type: "toolCall",
              id: "read-1",
              name: "read",
              arguments: { path: "package.json" },
            },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "read-1",
          isError: false,
          content: [{ type: "text", text: "package.json contents" }],
        },
      ]),
    );
    render(<App client={fake.client} />);

    expect(await screen.findByText("package.json contents")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide tool calls" }));

    expect(
      screen
        .getByRole("button", { name: "Show tool calls" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByText("Review the project")).toBeTruthy();
    expect(screen.getAllByText("I will review it.")).toHaveLength(2);
    expect(screen.queryByText("package.json")).toBeNull();
    expect(screen.queryByText("package.json contents")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show tool calls" }));
    expect(await screen.findByText("package.json contents")).toBeTruthy();
  });

  it("shows the current working directory", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);

    expect(await screen.findByText("/workspace/pi-app")).toBeTruthy();
    expect(fake.client.currentDirectory).toHaveBeenCalledTimes(2);
  });

  it("asks a direct launch to select its workspace without starting Pi", async () => {
    const fake = createClient();
    fake.client.currentDirectory = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("/workspace/picked")
      .mockResolvedValueOnce("/workspace/picked");
    fake.client.chooseWorkspace = vi
      .fn()
      .mockResolvedValue("/workspace/picked");
    render(<App client={fake.client} />);

    expect(await screen.findByText("/workspace/picked")).toBeTruthy();
    expect(fake.client.chooseWorkspace).toHaveBeenCalledOnce();
    expect(fake.client.startAgent).not.toHaveBeenCalled();
  });

  it("instructs a direct launch to select a workspace when picker is cancelled", async () => {
    const fake = createClient();
    fake.client.currentDirectory = vi.fn().mockResolvedValue(null);
    fake.client.chooseWorkspace = vi.fn().mockResolvedValue(null);
    render(<App client={fake.client} />);

    expect(
      await screen.findByText("Select a workspace to view its sessions."),
    ).toBeTruthy();
    expect(screen.queryByText("[object Object]")).toBeNull();
    expect(fake.client.startAgent).not.toHaveBeenCalled();
  });

  it("switches to a workspace with no persisted sessions without creating Pi state", async () => {
    const fake = createClient();
    fake.client.chooseWorkspace = vi.fn().mockResolvedValue("/workspace/empty");
    fake.client.currentDirectory = vi
      .fn()
      .mockResolvedValueOnce("/workspace/pi-app")
      .mockResolvedValueOnce("/workspace/pi-app")
      .mockResolvedValueOnce("/workspace/empty")
      .mockResolvedValueOnce("/workspace/empty");
    fake.client.listSessions = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "terminal-id",
          path: "/sessions/terminal.jsonl",
          title: "Terminal conversation",
        },
      ])
      .mockResolvedValueOnce([]);
    fake.client.sendRpc = vi.fn().mockResolvedValue({
      type: "response",
      success: true,
      data: {
        sessionFile: "/empty-sessions/new.jsonl",
        sessionId: "empty-id",
      },
    });
    render(<App client={fake.client} />);

    await screen.findByText("/workspace/pi-app");
    fireEvent.click(screen.getByRole("button", { name: "Change workspace" }));

    expect(await screen.findByText("/workspace/empty")).toBeTruthy();
    expect(
      await screen.findByText("No sessions in this project."),
    ).toBeTruthy();
    expect(fake.client.startAgent).not.toHaveBeenCalled();
  });

  it("renders Tauri workspace errors using their message", async () => {
    const fake = createClient();
    fake.client.chooseWorkspace = vi.fn().mockRejectedValue({
      message: "Unable to switch to the selected workspace",
    });
    render(<App client={fake.client} />);

    await screen.findByText("/workspace/pi-app");
    fireEvent.click(screen.getByRole("button", { name: "Change workspace" }));

    expect(
      await screen.findByText("Unable to switch to the selected workspace"),
    ).toBeTruthy();
    expect(screen.queryByText("[object Object]")).toBeNull();
  });

  it("switches the independent RPC workspace and reloads its directory sessions", async () => {
    const fake = createClient();
    fake.client.chooseWorkspace = vi.fn().mockResolvedValue("/workspace/other");
    fake.client.currentDirectory = vi
      .fn()
      .mockResolvedValueOnce("/workspace/pi-app")
      .mockResolvedValueOnce("/workspace/pi-app")
      .mockResolvedValueOnce("/workspace/other")
      .mockResolvedValueOnce("/workspace/other");
    fake.client.listSessions = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "terminal-id",
          path: "/sessions/terminal.jsonl",
          title: "Terminal conversation",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "other-id",
          path: "/other-sessions/other.jsonl",
          title: "Other workspace conversation",
        },
      ]);
    fake.client.sendRpc = vi
      .fn()
      .mockImplementation(async (_target, request: RpcRecord) => {
        if (request.type === "get_state")
          return {
            type: "response",
            success: true,
            data: {
              sessionFile: "/other-sessions/other.jsonl",
              sessionId: "other-id",
            },
          };
        return { type: "response", success: true, data: { cancelled: false } };
      });
    render(<App client={fake.client} />);

    await screen.findByText("/workspace/pi-app");
    fireEvent.click(screen.getByRole("button", { name: "Change workspace" }));

    expect(await screen.findByText("/workspace/other")).toBeTruthy();
    expect(
      await screen.findByRole("heading", {
        name: "Other workspace conversation",
      }),
    ).toBeTruthy();
    expect(fake.client.chooseWorkspace).toHaveBeenCalledOnce();
    expect(fake.client.startAgent).not.toHaveBeenCalled();
  });

  it("reloads slash commands after replacing the RPC workspace", async () => {
    const fake = createClient();
    let commandRequests = 0;
    fake.client.chooseWorkspace = vi.fn().mockResolvedValue("/workspace/other");
    fake.client.currentDirectory = vi
      .fn()
      .mockResolvedValueOnce("/workspace/pi-app")
      .mockResolvedValueOnce("/workspace/pi-app")
      .mockResolvedValueOnce("/workspace/other")
      .mockResolvedValueOnce("/workspace/other");
    fake.client.sendRpc = vi
      .fn()
      .mockImplementation(async (_target, request: RpcRecord) => {
        if (request.type === "get_commands") {
          commandRequests += 1;
          return {
            type: "response",
            success: true,
            data: {
              commands: [
                {
                  name: commandRequests === 1 ? "skill:current" : "skill:other",
                  source: "skill",
                },
              ],
            },
          };
        }
        if (request.type === "get_state")
          return {
            type: "response",
            success: true,
            data: {
              sessionFile: "/sessions/terminal.jsonl",
              sessionId: "terminal-id",
              sessionName: "Terminal conversation",
            },
          };
        return { type: "response", success: true, data: { cancelled: false } };
      });
    render(<App client={fake.client} />);
    await screen.findByText("CONVERSATION");

    const composer = screen.getByLabelText("Message");
    fireEvent.change(composer, { target: { value: "/" } });
    expect(
      await screen.findByRole("option", { name: "/skill:current" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change workspace" }));
    await screen.findByText("/workspace/other");
    fireEvent.change(composer, { target: { value: "/" } });

    expect(
      await screen.findByRole("option", { name: "/skill:other" }),
    ).toBeTruthy();
    expect(screen.queryByRole("option", { name: "/skill:current" })).toBeNull();
    expect(commandRequests).toBe(2);
  });

  it("loads Pi persisted Recents rather than only sessions created in this desktop process", async () => {
    const fake = createClient();
    fake.client.listSessions = vi.fn().mockResolvedValue([
      {
        id: "older-id",
        path: "/sessions/older.jsonl",
        title: "Earlier terminal conversation",
      },
      {
        id: "terminal-id",
        path: "/sessions/terminal.jsonl",
        title: "Terminal conversation",
      },
    ]);
    render(<App client={fake.client} />);

    await screen.findByText("CONVERSATION");
    expect(fake.client.listSessions).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", {
        name: /Earlier terminal conversation Empty conversation/,
      }),
    ).toBeTruthy();
  });
  it("uses the persisted Pi session ID for an unnamed handed-off session", async () => {
    const fake = createClient();
    fake.client.listSessions = vi.fn().mockResolvedValue([
      {
        id: "terminal-id",
        path: "/sessions/terminal.jsonl",
        title: "terminal-id",
      },
    ]);
    fake.client.sendRpc = vi
      .fn()
      .mockImplementation(async (_target, request: RpcRecord) => {
        if (request.type === "get_state")
          return {
            type: "response",
            success: true,
            data: {
              sessionFile: "/sessions/terminal.jsonl",
              sessionId: "terminal-id",
            },
          };
        return { type: "response", success: true, data: { cancelled: false } };
      });
    fake.client.sessionHistory = vi.fn().mockResolvedValue(historyPage([]));
    render(<App client={fake.client} />);

    await screen.findByText("CONVERSATION");
    expect(screen.getByRole("heading", { name: "terminal-id" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /terminal-id Empty conversation/ }),
    ).toBeTruthy();
  });

  it("does not start an agent under React StrictMode navigation", async () => {
    const fake = createClient();
    render(
      <StrictMode>
        <App client={fake.client} />
      </StrictMode>,
    );

    await screen.findByText("CONVERSATION");
    expect(fake.client.startAgent).not.toHaveBeenCalled();
  });

  it("names a new conversation with its Pi session ID", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);

    await screen.findByText("CONVERSATION");
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));

    await waitFor(() =>
      expect(fake.client.sendRpc).toHaveBeenCalledWith(expect.any(Object), {
        id: "name-session-0",
        type: "set_session_name",
        name: "session-1",
      }),
    );
    expect(screen.getByRole("heading", { name: "session-1" })).toBeTruthy();
  });

  it("routes background session events without switching or aborting the active runtime", async () => {
    let handler: ((event: RuntimeEvent) => void) | undefined;
    const fake = createClient();
    fake.client.listSessions = vi.fn().mockResolvedValue([
      {
        id: "older-id",
        path: "/sessions/older.jsonl",
        title: "Earlier conversation",
      },
      {
        id: "terminal-id",
        path: "/sessions/terminal.jsonl",
        title: "Terminal conversation",
      },
    ]);
    fake.client.sessionHistory = vi.fn().mockResolvedValue(historyPage([]));
    fake.client.listen = vi.fn().mockImplementation(async (nextHandler) => {
      handler = nextHandler;
      return () => undefined;
    });
    render(<App client={fake.client} />);

    await screen.findByRole("heading", { name: "Terminal conversation" });
    handler?.({
      projectId: "project",
      sessionId: "older-id",
      generation: 2,
      event: {
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta: "Background reply",
        },
      },
    });
    expect(screen.queryByText("Background reply")).toBeNull();
    expect(fake.client.abortAgent).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Earlier conversation Empty conversation",
      }),
    );
    await screen.findAllByText("Background reply");
    expect(fake.client.abortAgent).not.toHaveBeenCalled();
    expect(fake.client.sendRpc).not.toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ type: "switch_session" }),
    );
  });

  it("keeps a started Pi session running after navigating to another session", async () => {
    let handler: ((event: RuntimeEvent) => void) | undefined;
    const fake = createClient();
    fake.client.listSessions = vi.fn().mockResolvedValue([
      {
        id: "older-id",
        path: "/sessions/older.jsonl",
        title: "Earlier conversation",
      },
      {
        id: "terminal-id",
        path: "/sessions/terminal.jsonl",
        title: "Terminal conversation",
      },
    ]);
    fake.client.sessionHistory = vi.fn().mockResolvedValue(historyPage([]));
    fake.client.listen = vi.fn().mockImplementation(async (nextHandler) => {
      handler = nextHandler;
      return () => undefined;
    });
    render(<App client={fake.client} />);

    await screen.findByRole("heading", { name: "Terminal conversation" });
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Work in the background" },
    });
    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter" });
    await waitFor(() =>
      expect(fake.client.startAgent).toHaveBeenCalledTimes(1),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Earlier conversation Empty conversation",
      }),
    );
    await screen.findByRole("heading", { name: "Earlier conversation" });

    handler?.({
      projectId: "project",
      sessionId: "terminal-id",
      generation: 1,
      event: {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Still running" },
      },
    });
    expect(fake.client.abortAgent).not.toHaveBeenCalled();
    expect(screen.queryByText("Still running")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /^Terminal conversation/ }),
    );
    await screen.findAllByText("Still running");
    expect(fake.client.abortAgent).not.toHaveBeenCalled();
  });

  it("keeps drafts local to each session and clears unread updates on selection", async () => {
    let handler: ((event: RuntimeEvent) => void) | undefined;
    const fake = createClient();
    fake.client.listSessions = vi.fn().mockResolvedValue([
      {
        id: "older-id",
        path: "/sessions/older.jsonl",
        title: "Earlier conversation",
      },
      {
        id: "terminal-id",
        path: "/sessions/terminal.jsonl",
        title: "Terminal conversation",
      },
    ]);
    fake.client.sessionHistory = vi.fn().mockResolvedValue(historyPage([]));
    fake.client.listen = vi.fn().mockImplementation(async (nextHandler) => {
      handler = nextHandler;
      return () => undefined;
    });
    render(<App client={fake.client} />);

    await screen.findByRole("heading", { name: "Terminal conversation" });
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "terminal draft" },
    });
    handler?.({
      projectId: "project",
      sessionId: "older-id",
      generation: 2,
      event: { type: "agent_settled" },
    });
    expect(await screen.findByLabelText("Unread updates")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /^Earlier conversation/ }),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("Unread updates")).toBeNull(),
    );
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "older draft" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /^Terminal conversation/ }),
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Message") as HTMLTextAreaElement).value,
      ).toBe("terminal draft"),
    );
  });

  it("does not issue a switch RPC when selecting a session", async () => {
    const fake = createClient();
    fake.client.listSessions = vi.fn().mockResolvedValue([
      {
        id: "older-id",
        path: "/sessions/older.jsonl",
        title: "Earlier conversation",
      },
      {
        id: "terminal-id",
        path: "/sessions/terminal.jsonl",
        title: "Terminal conversation",
      },
    ]);
    fake.client.sessionHistory = vi.fn().mockResolvedValue(historyPage([]));
    render(<App client={fake.client} />);

    await screen.findByRole("heading", { name: "Terminal conversation" });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Earlier conversation Empty conversation",
      }),
    );
    await waitFor(() =>
      expect(fake.client.sessionHistory).toHaveBeenCalledWith(
        "project",
        "/sessions/older.jsonl",
        Number.MAX_SAFE_INTEGER,
        80,
      ),
    );
    expect(fake.client.sendRpc).not.toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ type: "switch_session" }),
    );
  });

  it("renders every history entry returned by the current Tauri page", async () => {
    const fake = createClient();
    fake.client.sessionHistory = vi.fn().mockResolvedValue(
      historyPage(
        Array.from({ length: 200 }, (_, index) => ({
          role: "user",
          content: `paged history entry ${index}`,
        })),
      ),
    );
    render(<App client={fake.client} />);

    expect(await screen.findAllByText("paged history entry 0")).toHaveLength(1);
    expect(screen.getAllByText("paged history entry 199")).toHaveLength(2);
    expect(document.querySelector(".virtual-history-entry")).toBeNull();
  });

  it("loads the newest persisted-history page first and fetches older history only after upward scrolling", async () => {
    const fake = createClient();
    const messages = Array.from({ length: 160 }, (_, index) => ({
      role: "user",
      content: `paged history entry ${index}`,
    }));
    fake.client.sessionHistory = vi
      .fn()
      .mockImplementation(
        async (_projectId: string, _path: string, before: number) =>
          before === Number.MAX_SAFE_INTEGER
            ? historyPage(messages.slice(80), 800, true)
            : historyPage(messages.slice(0, 80), 0, false),
      );
    render(<App client={fake.client} />);

    await screen.findAllByText("paged history entry 159");
    expect(fake.client.sessionHistory).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("paged history entry 0")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Load earlier messages" }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Load earlier messages" }),
    );
    await waitFor(() =>
      expect(fake.client.sessionHistory).toHaveBeenCalledTimes(2),
    );
    await screen.findAllByText("paged history entry 0");
    expect(fake.client.sessionHistory).toHaveBeenLastCalledWith(
      "project",
      "/sessions/terminal.jsonl",
      800,
      80,
    );
    expect(
      screen.queryByRole("button", { name: "Load earlier messages" }),
    ).toBeNull();
  });

  it("loads earlier persisted history through its explicit control", async () => {
    const fake = createClient();
    const messages = Array.from({ length: 160 }, (_, index) => ({
      role: "user",
      content: `explicit history entry ${index}`,
    }));
    fake.client.sessionHistory = vi
      .fn()
      .mockImplementation(
        async (_projectId: string, _path: string, before: number) =>
          before === Number.MAX_SAFE_INTEGER
            ? historyPage(messages.slice(80), 800, true)
            : historyPage(messages.slice(0, 80), 0, false),
      );
    render(<App client={fake.client} />);

    await screen.findAllByText("explicit history entry 159");
    fireEvent.click(
      screen.getByRole("button", { name: "Load earlier messages" }),
    );
    await screen.findAllByText("explicit history entry 0");
    expect(fake.client.sessionHistory).toHaveBeenLastCalledWith(
      "project",
      "/sessions/terminal.jsonl",
      800,
      80,
    );
  });

  it("activates the selected session and shows loading while its history runs", async () => {
    const fake = createClient();
    fake.client.listSessions = vi.fn().mockResolvedValue([
      {
        id: "older-id",
        path: "/sessions/older.jsonl",
        title: "Earlier conversation",
      },
      {
        id: "terminal-id",
        path: "/sessions/terminal.jsonl",
        title: "Terminal conversation",
      },
    ]);
    let finishHistory: (() => void) | undefined;
    fake.client.sendRpc = vi
      .fn()
      .mockImplementation((_target, request: RpcRecord) => {
        if (request.type === "get_state")
          return Promise.resolve({
            type: "response",
            success: true,
            data: {
              sessionFile: "/sessions/terminal.jsonl",
              sessionId: "terminal-id",
            },
          });
        return Promise.resolve({ type: "response", success: true, data: {} });
      });
    fake.client.sessionHistory = vi
      .fn()
      .mockImplementation((_projectId: string, path: string) => {
        const page = historyPage([
          {
            role: "user",
            content:
              path === "/sessions/older.jsonl" ? "Older tail" : "Current tail",
          },
        ]);
        if (path === "/sessions/terminal.jsonl") return Promise.resolve(page);
        return new Promise((resolve) => {
          finishHistory = () => resolve(page);
        });
      });
    render(<App client={fake.client} />);

    await screen.findByRole("heading", { name: "Terminal conversation" });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Earlier conversation Empty conversation",
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Earlier conversation" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("status", { name: "Loading latest history" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "What can I help you build?" }),
    ).toBeNull();
    await waitFor(() =>
      expect(fake.client.sessionHistory).toHaveBeenCalledWith(
        "project",
        "/sessions/older.jsonl",
        Number.MAX_SAFE_INTEGER,
        80,
      ),
    );
    finishHistory?.();
    expect(await screen.findAllByText("Older tail")).toHaveLength(2);
  });

  it("does not reload a session history after it has been loaded once", async () => {
    const fake = createClient();
    fake.client.listSessions = vi.fn().mockResolvedValue([
      {
        id: "older-id",
        path: "/sessions/older.jsonl",
        title: "Earlier conversation",
      },
      {
        id: "terminal-id",
        path: "/sessions/terminal.jsonl",
        title: "Terminal conversation",
      },
    ]);
    render(<App client={fake.client} />);

    await screen.findByText("CONVERSATION");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Earlier conversation Empty conversation",
      }),
    );
    await waitFor(() =>
      expect(fake.client.sessionHistory).toHaveBeenCalledWith(
        "project",
        "/sessions/older.jsonl",
        Number.MAX_SAFE_INTEGER,
        80,
      ),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Terminal conversation I have the context.",
      }),
    );

    await screen.findByRole("heading", { name: "Terminal conversation" });
    expect(fake.client.sessionHistory).toHaveBeenCalledTimes(2);
    expect(fake.client.sendRpc).not.toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ type: "switch_session" }),
    );
  });

  it("renames a session through the in-app dialog", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);

    await screen.findByText("CONVERSATION");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Rename session Terminal conversation",
      }),
    );
    fireEvent.change(screen.getByLabelText("Session name"), {
      target: { value: "Renamed conversation" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(fake.client.sendRpc).toHaveBeenCalledWith(expect.any(Object), {
        id: "rename-session-0",
        type: "set_session_name",
        name: "Renamed conversation",
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Renamed conversation" }),
    ).toBeTruthy();
  });

  it("renders an accessible SVG pencil for session rename without deletion", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);

    await screen.findByText("CONVERSATION");
    const rename = screen.getByRole("button", {
      name: "Rename session Terminal conversation",
    });
    expect(rename.textContent).toBe("");
    expect(rename.querySelector("svg")).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: /Delete session/,
      }),
    ).toBeNull();
  });

  it("does not render ready status text", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);

    await screen.findByText("CONVERSATION");
    expect(screen.queryByText("Pi agent ready")).toBeNull();
    expect(
      screen.queryByText("Pi is ready to work in this project"),
    ).toBeNull();
    expect(screen.queryByText("ready", { selector: "span" })).toBeNull();
  });

  it("does not rename a session when Pi rejects the rename", async () => {
    const fake = createClient();
    fake.client.sendRpc = vi
      .fn()
      .mockImplementation(async (_target, request: RpcRecord) => {
        if (request.type === "get_state")
          return {
            type: "response",
            success: true,
            data: {
              sessionFile: "/sessions/terminal.jsonl",
              sessionId: "terminal-id",
            },
          };
        if (request.type === "get_messages")
          return { type: "response", success: true, data: { messages: [] } };
        if (request.type === "set_session_name")
          return { type: "response", success: false, error: "not allowed" };
        return { type: "response", success: true, data: { cancelled: false } };
      });
    render(<App client={fake.client} />);
    await screen.findByText("CONVERSATION");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Rename session Terminal conversation",
      }),
    );
    fireEvent.change(screen.getByLabelText("Session name"), {
      target: { value: "Rejected name" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("not allowed"),
    );
    expect(screen.queryByText("Rejected name")).toBeNull();
  });

  it("starts the runtime before discovering slash commands", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);
    await screen.findByText("CONVERSATION");

    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "/skill" },
    });
    await waitFor(() =>
      expect(fake.client.startAgent).toHaveBeenCalledWith(
        { projectId: "project", sessionId: "terminal-id" },
        "/sessions/terminal.jsonl",
      ),
    );
    await waitFor(() =>
      expect(fake.client.sendRpc).toHaveBeenCalledWith(
        { projectId: "project", sessionId: "terminal-id" },
        { id: "get-commands-0", type: "get_commands" },
      ),
    );
  });

  it("discovers Pi skills and inserts the selected slash command into the composer", async () => {
    const fake = createClient();
    fake.client.sendRpc = vi
      .fn()
      .mockImplementation(async (_target, request: RpcRecord) => {
        if (request.type === "get_commands")
          return {
            type: "response",
            success: true,
            data: {
              commands: [
                {
                  name: "skill:review",
                  description: "Review this change",
                  source: "skill",
                },
                {
                  name: "fix-tests",
                  description: "Fix failing tests",
                  source: "prompt",
                },
              ],
            },
          };
        if (request.type === "get_state")
          return {
            type: "response",
            success: true,
            data: {
              sessionFile: "/sessions/terminal.jsonl",
              sessionId: "terminal-id",
              sessionName: "Terminal conversation",
            },
          };
        if (request.type === "get_messages")
          return { type: "response", success: true, data: { messages: [] } };
        return { type: "response", success: true, data: { cancelled: false } };
      });
    render(<App client={fake.client} />);
    await screen.findByText("CONVERSATION");

    const composer = screen.getByLabelText("Message");
    fireEvent.change(composer, { target: { value: "/skill" } });
    expect(
      await screen.findByRole("option", {
        name: "/skill:review Review this change",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("Fix failing tests")).toBeNull();
    expect(fake.client.sendRpc).toHaveBeenCalledWith(expect.any(Object), {
      id: "get-commands-0",
      type: "get_commands",
    });

    fireEvent.keyDown(composer, { key: "Enter" });
    expect(composer).toHaveProperty("value", "/skill:review ");
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(fake.client.sendRpc).toHaveBeenLastCalledWith(expect.any(Object), {
        id: "prompt-0",
        type: "prompt",
        message: "/skill:review",
      }),
    );
  });

  it("submits an ordinary Enter from the composer but preserves Shift+Enter for a newline", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);
    await screen.findByText("CONVERSATION");
    const composer = screen.getByLabelText("Message");
    fireEvent.change(composer, { target: { value: "Explain this repo" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await waitFor(() =>
      expect(fake.client.sendRpc).toHaveBeenCalledWith(expect.any(Object), {
        id: "prompt-0",
        type: "prompt",
        message: "Explain this repo",
      }),
    );

    fake.emit({ type: "agent_settled" });
    await screen.findByRole("button", { name: "Send message" });
    fireEvent.change(composer, { target: { value: "A multiline prompt" } });
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
    expect(fake.client.sendRpc).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh runtime before sending again after Pi settles", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);
    await screen.findByText("CONVERSATION");
    const composer = screen.getByLabelText("Message");

    fireEvent.change(composer, { target: { value: "First prompt" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await waitFor(() =>
      expect(fake.client.startAgent).toHaveBeenCalledTimes(1),
    );
    fake.emit({ type: "agent_settled" });
    await screen.findByRole("button", { name: "Send message" });

    fireEvent.change(composer, { target: { value: "Second prompt" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await waitFor(() =>
      expect(fake.client.startAgent).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(fake.client.sendRpc).toHaveBeenLastCalledWith(
        { projectId: "project", sessionId: "terminal-id" },
        { id: "prompt-1", type: "prompt", message: "Second prompt" },
      ),
    );
  });

  it("uses one right-corner composer action to send, then stop a streaming prompt", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);
    await screen.findByText("CONVERSATION");
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Explain this repo" },
    });
    const send = screen.getByRole("button", { name: "Send message" });
    expect(send.querySelector("svg")).toBeTruthy();
    fireEvent.click(send);
    expect(
      await screen.findByRole("status", { name: "Pi is working" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
    const stop = screen.getByRole("button", { name: "Stop generating" });
    expect(stop.querySelector("svg")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "A second prompt" },
    });
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
    fake.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "I can help." },
    });
    expect((await screen.findAllByText("I can help.")).length).toBe(2);
    fireEvent.click(stop);
    await waitFor(() => expect(fake.client.abortAgent).toHaveBeenCalledOnce());
    expect(fake.client.sendRpc).toHaveBeenCalledTimes(1);
    expect(fake.client.sendRpc).toHaveBeenLastCalledWith(expect.any(Object), {
      id: "prompt-0",
      type: "prompt",
      message: "Explain this repo",
    });
    fake.emit({ type: "agent_settled" });
    await waitFor(() =>
      expect(
        screen.queryByRole("status", { name: "Pi is working" }),
      ).toBeNull(),
    );
  });
});
