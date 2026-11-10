import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
  const workspace = {
    id: "workspace-a",
    path: "/workspace/a",
    displayName: "a",
  };
  const sessions = [
    { id: "a-session", path: "/sessions/a.jsonl", title: "Session A" },
  ];
  const client: PiClient = {
    createSession: vi.fn().mockResolvedValue({
      id: "new-session",
      path: "/sessions/new.jsonl",
      title: "new-session",
    }),
    currentWorkspace: vi.fn().mockImplementation(async () => workspace),
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
    saveClipboardImage: vi.fn().mockResolvedValue("/tmp/pi-clipboard-test.png"),
    abortSession: vi.fn().mockResolvedValue(undefined),
    renameSession: vi.fn().mockResolvedValue(undefined),
    listCommands: vi.fn().mockResolvedValue([]),
    listSessions: vi.fn().mockResolvedValue(sessions),
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
    expect(
      screen.queryByRole("button", { name: "Change workspace" }),
    ).toBeNull();
    expect(fake.client.sessionHistory).toHaveBeenCalledWith(
      "a-session",
      Number.MAX_SAFE_INTEGER,
      80,
    );
  });

  it("keeps the complete title available outside the display toolbar", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);

    const title = await screen.findByRole("heading", { name: "Session A" });
    expect(title.getAttribute("title")).toBe("Session A");
    const toolbar = screen.getByRole("toolbar", {
      name: "Conversation display",
    });
    expect(toolbar.contains(title)).toBe(false);
    expect(title.closest("header")).toBe(toolbar.closest("header"));
  });

  it("toggles tool calls without changing the label or hiding messages", async () => {
    const fake = createClient();
    fake.client.sessionHistory = vi.fn().mockResolvedValue({
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "Keep this reply visible" },
            {
              type: "toolCall",
              id: "tool-1",
              name: "read",
              arguments: { path: "/workspace/a/example.ts" },
            },
          ],
        },
      ],
      before: 0,
      hasMore: false,
    });
    render(<App client={fake.client} />);

    expect(await screen.findByText("/workspace/a/example.ts")).toBeTruthy();
    const toggle = screen.getByRole("checkbox", {
      name: "Show tool calls",
    }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(toggle.closest('[role="toolbar"]')).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.checked).toBe(false);
    expect(screen.queryByText("/workspace/a/example.ts")).toBeNull();
    expect(
      within(screen.getByRole("region", { name: "Conversation" })).getByText(
        "Keep this reply visible",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Show tool calls" })).toBe(
      toggle,
    );

    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);
    expect(screen.getByText("/workspace/a/example.ts")).toBeTruthy();
  });

  it("resizes the sidebar within its bounded width", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);
    await screen.findAllByText("Session A");

    const separator = screen.getByRole("separator", {
      name: "Resize sidebar",
    });
    expect(separator.getAttribute("aria-valuenow")).toBe("280");

    fireEvent.keyDown(separator, { key: "End" });
    expect(separator.getAttribute("aria-valuenow")).toBe("520");
    expect(separator.closest("main")?.getAttribute("style")).toContain(
      "--sidebar-width: 520px",
    );

    fireEvent.keyDown(separator, { key: "Home" });
    expect(separator.getAttribute("aria-valuenow")).toBe("220");
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

  it.each(["info", "warning", "error"] as const)(
    "renders extension %s output even when tool calls are hidden",
    async (level) => {
      const fake = createClient();
      fake.client.runAgent = vi
        .fn()
        .mockImplementation(async (sessionId, _prompt, handler) => {
          handler({
            sessionId,
            runId: "run-1",
            event: {
              type: "CUSTOM",
              name: "pi.notification",
              value: { message: "MCP server ready\nTools: 3", level },
            },
          });
        });
      render(<App client={fake.client} />);
      const textbox = await screen.findByRole("combobox", { name: "Message" });
      fireEvent.click(
        screen.getByRole("checkbox", { name: "Show tool calls" }),
      );
      fireEvent.change(textbox, { target: { value: "/mcp" } });
      fireEvent.keyDown(textbox, { key: "Enter" });
      const notice = await screen.findByText(/MCP server ready/);
      expect(notice.parentElement?.getAttribute("role")).toBe(
        level === "info" ? "status" : "alert",
      );
      expect(notice.textContent).toBe("MCP server ready\nTools: 3");
    },
  );

  it("displays extension command errors", async () => {
    const fake = createClient();
    fake.client.runAgent = vi
      .fn()
      .mockImplementation(async (sessionId, _prompt, handler) => {
        handler({
          sessionId,
          runId: "run-1",
          event: {
            type: "RUN_ERROR",
            message: "Supply an absolute Git project root.",
          },
        });
      });
    render(<App client={fake.client} />);
    const textbox = await screen.findByRole("combobox", { name: "Message" });
    fireEvent.change(textbox, { target: { value: "/codegraph-status" } });
    fireEvent.keyDown(textbox, { key: "Enter" });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Supply an absolute Git project root.",
    );
  });

  it("clears a command error only when a valid new message is submitted", async () => {
    const fake = createClient();
    let complete!: () => void;
    fake.client.runAgent = vi
      .fn()
      .mockImplementationOnce(async (sessionId, _prompt, handler) => {
        handler({
          sessionId,
          runId: "run-1",
          event: {
            type: "CUSTOM",
            name: "pi.notification",
            value: { message: "Previous command notification", level: "info" },
          },
        });
        handler({
          sessionId,
          runId: "run-1",
          event: {
            type: "RUN_ERROR",
            message: "Old command error",
          },
        });
      })
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            complete = resolve;
          }),
      );
    render(<App client={fake.client} />);
    const textbox = await screen.findByRole<HTMLTextAreaElement>("combobox", {
      name: "Message",
    });
    fireEvent.change(textbox, { target: { value: "/codegraph-status" } });
    fireEvent.keyDown(textbox, { key: "Enter" });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Old command error",
    );

    fireEvent.change(textbox, { target: { value: "New draft" } });
    expect(screen.getByRole("alert").textContent).toBe("Old command error");
    fireEvent.change(textbox, { target: { value: "   " } });
    fireEvent.keyDown(textbox, { key: "Enter" });
    expect(fake.client.runAgent).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toBe("Old command error");

    fireEvent.paste(textbox, {
      clipboardData: {
        files: [new File(["image"], "clipboard.png", { type: "image/png" })],
      },
    });
    await waitFor(() =>
      expect(textbox.value).toContain("/tmp/pi-clipboard-test.png"),
    );
    await waitFor(() => expect(textbox.disabled).toBe(false));
    expect(screen.getByRole("alert").textContent).toBe("Old command error");

    fireEvent.change(textbox, { target: { value: "Next message" } });
    fireEvent.keyDown(textbox, { key: "Enter" });
    expect(fake.client.runAgent).toHaveBeenCalledTimes(2);
    // The second request has not emitted RUN_STARTED or returned a result.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Previous command notification")).toBeTruthy();
    await act(async () => {
      complete();
    });
  });

  it("replaces a request error with the new request's error", async () => {
    const fake = createClient();
    fake.client.runAgent = vi
      .fn()
      .mockRejectedValueOnce(new Error("Old request error"))
      .mockRejectedValueOnce(new Error("New request error"));
    render(<App client={fake.client} />);
    const textbox = await screen.findByRole("combobox", { name: "Message" });
    fireEvent.change(textbox, { target: { value: "First message" } });
    fireEvent.keyDown(textbox, { key: "Enter" });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Old request error",
    );
    fireEvent.change(textbox, { target: { value: "Second message" } });
    fireEvent.keyDown(textbox, { key: "Enter" });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("New request error"),
    );
    expect(screen.queryByText("Old request error")).toBeNull();
  });

  it("saves a pasted image and replaces the selected composer text with its path", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);
    const textbox = await screen.findByRole<HTMLTextAreaElement>("combobox", {
      name: "Message",
    });
    fireEvent.change(textbox, { target: { value: "Explain old here" } });
    textbox.setSelectionRange(8, 11);
    const image = new File(["image bytes"], "clipboard.png", {
      type: "image/png",
    });
    fireEvent.paste(textbox, { clipboardData: { files: [image] } });
    await waitFor(() =>
      expect(textbox.value).toBe("Explain /tmp/pi-clipboard-test.png here"),
    );
    expect(fake.client.saveClipboardImage).toHaveBeenCalledWith(image);
    expect(fake.client.runAgent).not.toHaveBeenCalled();
    await waitFor(() => expect(textbox.selectionStart).toBe(34));
    expect(textbox.selectionEnd).toBe(34);
  });

  it("inserts multiple image paths in clipboard order", async () => {
    const fake = createClient();
    fake.client.saveClipboardImage = vi
      .fn()
      .mockResolvedValueOnce("/tmp/first.png")
      .mockResolvedValueOnce("/tmp/second.png");
    render(<App client={fake.client} />);
    const textbox = await screen.findByRole<HTMLTextAreaElement>("combobox", {
      name: "Message",
    });
    await waitFor(() => expect(textbox.disabled).toBe(false));
    fireEvent.paste(textbox, {
      clipboardData: {
        files: [
          new File(["first"], "first.png", { type: "image/png" }),
          new File(["second"], "second.png", { type: "image/png" }),
        ],
      },
    });
    await waitFor(() =>
      expect(textbox.value).toBe("/tmp/first.png /tmp/second.png"),
    );
    expect(fake.client.saveClipboardImage).toHaveBeenCalledTimes(2);
  });

  it("keeps a delayed paste in its source session when you switch sessions", async () => {
    const fake = createClient();
    fake.client.listSessions = vi.fn().mockResolvedValue([
      { id: "a-session", path: "/sessions/a.jsonl", title: "Session A" },
      { id: "b-session", path: "/sessions/b.jsonl", title: "Session B" },
    ]);
    let complete!: (path: string) => void;
    fake.client.saveClipboardImage = vi.fn().mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          complete = resolve;
        }),
    );
    render(<App client={fake.client} />);
    const textbox = await screen.findByRole<HTMLTextAreaElement>("combobox", {
      name: "Message",
    });
    fireEvent.change(textbox, { target: { value: "Explain" } });
    fireEvent.paste(textbox, {
      clipboardData: {
        files: [new File(["image"], "image.png", { type: "image/png" })],
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Session B Empty conversation/ }),
    );
    await screen.findByRole("heading", { name: "Session B" });
    complete("/tmp/source.png");
    await waitFor(() => expect(textbox.disabled).toBe(false));
    expect(textbox.value).toBe("");
    fireEvent.change(textbox, { target: { value: "Other session draft" } });
    fireEvent.click(
      screen.getByRole("button", { name: /Session A Empty conversation/ }),
    );
    await waitFor(() => expect(textbox.value).toBe("Explain /tmp/source.png"));
    fireEvent.click(
      screen.getByRole("button", { name: /Session B Empty conversation/ }),
    );
    await waitFor(() => expect(textbox.value).toBe("Other session draft"));
  });

  it("keeps ordinary text paste on the browser's native path", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);
    const textbox = await screen.findByRole("combobox", { name: "Message" });
    expect(
      fireEvent.paste(textbox, {
        clipboardData: { files: [], getData: () => "plain text" },
      }),
    ).toBe(true);
    expect(fake.client.saveClipboardImage).not.toHaveBeenCalled();
  });

  it("prevents sending while an image is being saved", async () => {
    const fake = createClient();
    let complete!: (path: string) => void;
    fake.client.saveClipboardImage = vi.fn().mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          complete = resolve;
        }),
    );
    render(<App client={fake.client} />);
    const textbox = await screen.findByRole<HTMLTextAreaElement>("combobox", {
      name: "Message",
    });
    fireEvent.change(textbox, { target: { value: "Explain" } });
    fireEvent.paste(textbox, {
      clipboardData: {
        files: [new File(["image"], "image.png", { type: "image/png" })],
      },
    });
    expect(textbox.disabled).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Send message" })
        .disabled,
    ).toBe(true);
    fireEvent.keyDown(textbox, { key: "Enter" });
    expect(fake.client.runAgent).not.toHaveBeenCalled();
    complete("/tmp/image.png");
    await waitFor(() => expect(textbox.value).toBe("Explain /tmp/image.png"));
    expect(textbox.disabled).toBe(false);
  });

  it("keeps the draft and displays an image upload failure", async () => {
    const fake = createClient();
    fake.client.saveClipboardImage = vi
      .fn()
      .mockRejectedValue(new Error("Cannot save clipboard image."));
    render(<App client={fake.client} />);
    const textbox = await screen.findByRole<HTMLTextAreaElement>("combobox", {
      name: "Message",
    });
    fireEvent.change(textbox, { target: { value: "Keep this draft" } });
    fireEvent.paste(textbox, {
      clipboardData: {
        files: [new File(["image"], "image.png", { type: "image/png" })],
      },
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Cannot save clipboard image.",
    );
    expect(textbox.value).toBe("Keep this draft");
    expect(textbox.disabled).toBe(false);
    expect(fake.client.runAgent).not.toHaveBeenCalled();
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
