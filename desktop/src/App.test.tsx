import { StrictMode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import App from "./App";
import type { PiClient, RpcRecord } from "./pi-client";

function historyPage(messages: RpcRecord[], before = 0, hasMore = false) {
  return { messages, before, hasMore };
}

function createClient(launchSession = "/sessions/terminal.jsonl") {
  let handler: ((event: RpcRecord) => void) | undefined;
  let sessionNumber = 0;
  const client: PiClient = {
    startAgent: vi.fn().mockResolvedValue(undefined),
    launchSession: vi.fn().mockResolvedValue(launchSession),
    currentDirectory: vi.fn().mockResolvedValue("/workspace/pi-app"),
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
    deleteSession: vi.fn().mockResolvedValue(undefined),
  };
  return { client, emit: (event: RpcRecord) => handler?.(event) };
}

describe("App", () => {
  beforeAll(() => {
    class ResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}

      disconnect() {}
      observe(target: Element) {
        this.callback(
          [
            {
              borderBoxSize: [{ blockSize: 120, inlineSize: 0 }],
              contentRect: target.getBoundingClientRect(),
              target,
            } as unknown as ResizeObserverEntry,
          ],
          this,
        );
      }
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserver);
  });

  afterEach(() => cleanup());

  it("restores the terminal handoff session and renders persisted Pi history", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);

    await screen.findByText("CONVERSATION");
    expect(fake.client.launchSession).toHaveBeenCalledOnce();
    expect(fake.client.sendRpc).toHaveBeenCalledWith({
      id: "handoff-switch",
      type: "switch_session",
      sessionPath: "/sessions/terminal.jsonl",
    });
    expect(fake.client.sessionHistory).toHaveBeenCalledWith(
      "/sessions/terminal.jsonl",
      Number.MAX_SAFE_INTEGER,
      80,
    );
    expect(screen.getAllByText("Continue this work")).toHaveLength(1);
    expect(screen.getAllByText("I have the context.")).toHaveLength(2);
    expect(screen.queryByRole("heading", { name: "Projects" })).toBeNull();
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
            { type: "toolCall", id: "read-1", name: "read" },
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
    expect(screen.getByText("package.json contents")).toBeTruthy();
  });

  it("shows the current working directory", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);

    expect(await screen.findByText("/workspace/pi-app")).toBeTruthy();
    expect(fake.client.currentDirectory).toHaveBeenCalledOnce();
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
        if (request.type === "switch_session") {
          return request.id === "handoff-switch"
            ? { type: "response", success: true, data: { cancelled: false } }
            : { type: "response", success: true, data: { cancelled: true } };
        }
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

  it("virtualizes a long persisted history instead of mounting every entry", async () => {
    const fake = createClient();
    fake.client.sessionHistory = vi.fn().mockResolvedValue(
      historyPage(
        Array.from({ length: 200 }, (_, index) => ({
          role: "user",
          content: `long history entry ${index}`,
        })),
      ),
    );
    render(<App client={fake.client} />);

    await screen.findAllByText("long history entry 199");
    const mountedEntries = document.querySelectorAll(
      ".virtual-history-entry",
    ).length;
    expect(mountedEntries).toBeGreaterThan(0);
    expect(mountedEntries).toBeLessThan(200);
  });

  it("opens a persisted session at its newest history entry", async () => {
    const fake = createClient();
    fake.client.sessionHistory = vi.fn().mockResolvedValue(
      historyPage(
        Array.from({ length: 200 }, (_, index) => ({
          role: "user",
          content: `bottom anchored entry ${index}`,
        })),
      ),
    );
    render(<App client={fake.client} />);

    expect(
      await screen.findAllByText("bottom anchored entry 199"),
    ).toHaveLength(2);
    expect(
      screen.getByRole("region", { name: "Conversation" }).scrollTop,
    ).toBeGreaterThan(0);
  });

  it("anchors each long session at its latest history after switching away and back", async () => {
    const fake = createClient();
    fake.client.listSessions = vi.fn().mockResolvedValue([
      { id: "older-id", path: "/sessions/older.jsonl", title: "Earlier" },
      {
        id: "terminal-id",
        path: "/sessions/terminal.jsonl",
        title: "Terminal conversation",
      },
    ]);
    fake.client.sessionHistory = vi.fn().mockImplementation((path: string) =>
      Promise.resolve(
        historyPage(
          Array.from({ length: 200 }, (_, index) => ({
            role: "user",
            content: `${path === "/sessions/older.jsonl" ? "older" : "terminal"} ${index}`,
          })),
        ),
      ),
    );
    render(<App client={fake.client} />);

    await screen.findAllByText("terminal 199");
    fireEvent.click(
      screen.getByRole("button", { name: "Earlier Empty conversation" }),
    );
    await screen.findAllByText("older 199");
    expect(
      screen.getByRole("region", { name: "Conversation" }).scrollTop,
    ).toBeGreaterThan(0);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Terminal conversation terminal 199",
      }),
    );
    await screen.findAllByText("terminal 199");
    expect(
      screen.getByRole("region", { name: "Conversation" }).scrollTop,
    ).toBeGreaterThan(0);
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

    const conversation = screen.getByRole("region", {
      name: "Conversation",
    });
    Object.defineProperty(conversation, "scrollTop", {
      configurable: true,
      value: 0,
      writable: true,
    });
    fireEvent.scroll(conversation);
    await waitFor(() =>
      expect(fake.client.sessionHistory).toHaveBeenCalledTimes(2),
    );
    await screen.findAllByText("paged history entry 0");
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
      if (request.type === "switch_session" && request.id !== "handoff-switch")
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

  it("deletes a session through the in-app dialog", async () => {
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
        name: "Delete session Earlier conversation",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(fake.client.deleteSession).toHaveBeenCalledWith(
        "/sessions/older.jsonl",
      ),
    );
    expect(screen.queryByText("Earlier conversation")).toBeNull();
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

  it("renders streamed text and aborts an active session", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);
    await screen.findByText("CONVERSATION");
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Explain this repo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(
      await screen.findByRole("status", { name: "Pi is working" }),
    ).toBeTruthy();
    fake.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "I can help." },
    });
    expect((await screen.findAllByText("I can help.")).length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(fake.client.abortAgent).toHaveBeenCalledOnce());
    fake.emit({ type: "agent_settled" });
    await waitFor(() =>
      expect(
        screen.queryByRole("status", { name: "Pi is working" }),
      ).toBeNull(),
    );
  });
});
