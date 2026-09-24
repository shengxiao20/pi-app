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
import type { PiClient, RpcRecord } from "./pi-client";

function historyPage(messages: RpcRecord[], before = 0, hasMore = false) {
  return { messages, before, hasMore };
}

function createClient() {
  let handler: ((event: RpcRecord) => void) | undefined;
  let sessionNumber = 0;
  const client: PiClient = {
    startAgent: vi.fn().mockResolvedValue(undefined),
    currentDirectory: vi.fn().mockResolvedValue("/workspace/pi-app"),
    chooseWorkspace: vi.fn().mockResolvedValue(null),
    sendRpc: vi.fn().mockImplementation(async (request: RpcRecord) => {
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
  return { client, emit: (event: RpcRecord) => handler?.(event) };
}

describe("App", () => {
  afterEach(() => cleanup());

  it("renders the active persisted Pi RPC session history", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);

    await screen.findByText("CONVERSATION");
    expect(fake.client.sessionHistory).toHaveBeenCalledWith(
      "/sessions/terminal.jsonl",
      Number.MAX_SAFE_INTEGER,
      80,
    );
    expect(screen.getAllByText("Continue this work")).toHaveLength(1);
    expect(screen.getAllByText("I have the context.")).toHaveLength(2);
    expect(screen.queryByRole("heading", { name: "Projects" })).toBeNull();
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
      .mockImplementation(async (request: RpcRecord) => {
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

  it("initializes a fresh RPC session before Pi persists its JSONL file", async () => {
    const fake = createClient();
    fake.client.listSessions = vi.fn().mockResolvedValue([]);
    fake.client.sendRpc = vi
      .fn()
      .mockImplementation(async (request: RpcRecord) => {
        if (request.type === "get_state")
          return {
            type: "response",
            success: true,
            data: {
              sessionFile: "/sessions/fresh.jsonl",
              sessionId: "fresh-id",
            },
          };
        return { type: "response", success: true, data: { cancelled: false } };
      });
    fake.client.sessionHistory = vi
      .fn()
      .mockRejectedValue(new Error("the fresh JSONL file does not exist yet"));
    render(<App client={fake.client} />);

    expect(
      await screen.findByRole("heading", { name: "fresh-id" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /fresh-id Empty conversation/ }),
    ).toBeTruthy();
    expect(fake.client.sessionHistory).not.toHaveBeenCalled();
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
      .mockImplementation(async (request: RpcRecord) => {
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

  it("asks a direct launch to select its workspace before starting Pi", async () => {
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
    expect(fake.client.startAgent).toHaveBeenCalledOnce();
  });

  it("instructs a direct launch to select a workspace when picker is cancelled", async () => {
    const fake = createClient();
    fake.client.currentDirectory = vi.fn().mockResolvedValue(null);
    fake.client.chooseWorkspace = vi.fn().mockResolvedValue(null);
    render(<App client={fake.client} />);

    expect(
      await screen.findByText("Select a workspace to start Pi."),
    ).toBeTruthy();
    expect(screen.queryByText("[object Object]")).toBeNull();
    expect(fake.client.startAgent).not.toHaveBeenCalled();
  });

  it("switches to a workspace with no persisted sessions", async () => {
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
      await screen.findByRole("heading", { name: "empty-id" }),
    ).toBeTruthy();
    expect(fake.client.startAgent).toHaveBeenCalledTimes(2);
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
      .mockImplementation(async (request: RpcRecord) => {
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
    expect(fake.client.startAgent).toHaveBeenCalledTimes(2);
  });

  it("reloads slash commands after replacing the RPC workspace", async () => {
    const fake = createClient();
    let agentStarts = 0;
    let commandRequests = 0;
    fake.client.startAgent = vi.fn().mockImplementation(async () => {
      agentStarts += 1;
    });
    fake.client.chooseWorkspace = vi.fn().mockResolvedValue("/workspace/other");
    fake.client.currentDirectory = vi
      .fn()
      .mockResolvedValueOnce("/workspace/pi-app")
      .mockResolvedValueOnce("/workspace/pi-app")
      .mockResolvedValueOnce("/workspace/other")
      .mockResolvedValueOnce("/workspace/other");
    fake.client.sendRpc = vi
      .fn()
      .mockImplementation(async (request: RpcRecord) => {
        if (request.type === "get_commands") {
          commandRequests += 1;
          return {
            type: "response",
            success: true,
            data: {
              commands: [
                {
                  name: agentStarts === 1 ? "skill:current" : "skill:other",
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
      .mockImplementation(async (request: RpcRecord) => {
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

  it("starts an agent only once under React StrictMode", async () => {
    const fake = createClient();
    render(
      <StrictMode>
        <App client={fake.client} />
      </StrictMode>,
    );

    await screen.findByText("CONVERSATION");
    expect(fake.client.startAgent).toHaveBeenCalledOnce();
  });

  it("names a new conversation with its Pi session ID", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);

    await screen.findByText("CONVERSATION");
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));

    await waitFor(() =>
      expect(fake.client.sendRpc).toHaveBeenCalledWith({
        id: "name-session-0",
        type: "set_session_name",
        name: "session-1",
      }),
    );
    expect(screen.getByRole("heading", { name: "session-1" })).toBeTruthy();
  });

  it("does not select a session when Pi cancels switching", async () => {
    const fake = createClient();
    fake.client.listSessions = vi
      .fn()
      .mockResolvedValue([
        { id: "one", path: "/sessions/one.jsonl", title: "New conversation" },
      ]);
    fake.client.sendRpc = vi
      .fn()
      .mockImplementation(async (request: RpcRecord) => {
        if (request.type === "get_state") {
          const isNewSession = request.id === "session-0-state";
          return {
            type: "response",
            success: true,
            data: {
              sessionFile: isNewSession
                ? "/sessions/two.jsonl"
                : "/sessions/one.jsonl",
              sessionId: isNewSession ? "two" : "one",
            },
          };
        }
        if (request.type === "get_messages") {
          return { type: "response", success: true, data: { messages: [] } };
        }
        if (request.type === "new_session")
          return {
            type: "response",
            success: true,
            data: { cancelled: false },
          };
        if (request.type === "switch_session")
          return { type: "response", success: true, data: { cancelled: true } };
        return { type: "response", success: true, data: { cancelled: false } };
      });
    fake.client.sessionHistory = vi.fn().mockResolvedValue(historyPage([]));
    render(<App client={fake.client} />);
    await screen.findByText("CONVERSATION");
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    await screen.findAllByRole("button", { name: /New conversation Empty/ });
    fireEvent.click(
      screen.getAllByRole("button", { name: /New conversation Empty/ })[0],
    );

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("cancelled"),
    );
    expect(screen.getByRole("heading", { name: "two" })).toBeTruthy();
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
      .mockImplementation(async (_path, before: number) =>
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
      .mockImplementation(async (_path, before: number) =>
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
      "/sessions/terminal.jsonl",
      800,
      80,
    );
  });

  it("activates the selected session and shows loading while switch and tail history run in parallel", async () => {
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
    let finishSwitch: (() => void) | undefined;
    fake.client.sendRpc = vi.fn().mockImplementation((request: RpcRecord) => {
      if (request.type === "get_state")
        return Promise.resolve({
          type: "response",
          success: true,
          data: {
            sessionFile: "/sessions/terminal.jsonl",
            sessionId: "terminal-id",
          },
        });
      if (request.type === "switch_session")
        return new Promise((resolve) => {
          finishSwitch = () =>
            resolve({ type: "response", success: true, data: {} });
        });
      return Promise.resolve({ type: "response", success: true, data: {} });
    });
    fake.client.sessionHistory = vi.fn().mockImplementation((path: string) => {
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
        "/sessions/older.jsonl",
        Number.MAX_SAFE_INTEGER,
        80,
      ),
    );
    finishHistory?.();
    finishSwitch?.();
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

    await waitFor(() =>
      expect(fake.client.sendRpc).toHaveBeenCalledWith({
        id: "switch-1",
        type: "switch_session",
        sessionPath: "/sessions/terminal.jsonl",
      }),
    );
    expect(fake.client.sessionHistory).toHaveBeenCalledTimes(2);
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
      expect(fake.client.sendRpc).toHaveBeenCalledWith({
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
      .mockImplementation(async (request: RpcRecord) => {
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

  it("discovers Pi skills and inserts the selected slash command into the composer", async () => {
    const fake = createClient();
    fake.client.sendRpc = vi
      .fn()
      .mockImplementation(async (request: RpcRecord) => {
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
    expect(fake.client.sendRpc).toHaveBeenCalledWith({
      id: "get-commands-0",
      type: "get_commands",
    });

    fireEvent.keyDown(composer, { key: "Enter" });
    expect(composer).toHaveProperty("value", "/skill:review ");
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(fake.client.sendRpc).toHaveBeenLastCalledWith({
        id: "prompt-0",
        type: "prompt",
        message: "/skill:review",
      }),
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
    expect(fake.client.sendRpc).toHaveBeenCalledTimes(2);
    expect(fake.client.sendRpc).toHaveBeenLastCalledWith({
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
