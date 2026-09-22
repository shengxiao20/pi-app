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

function createClient(launchSession = "/sessions/terminal.jsonl") {
  let handler: ((event: RpcRecord) => void) | undefined;
  let sessionNumber = 1;
  const client: PiClient = {
    startAgent: vi.fn().mockResolvedValue(undefined),
    launchSession: vi.fn().mockResolvedValue(launchSession),
    sendRpc: vi.fn().mockImplementation(async (request: RpcRecord) => {
      if (request.type === "new_session") sessionNumber += 1;
      if (request.type === "get_state") {
        return {
          type: "response",
          success: true,
          data: {
            sessionFile: `/sessions/session-${sessionNumber}.jsonl`,
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
    deleteSession: vi.fn().mockResolvedValue(undefined),
  };
  return { client, emit: (event: RpcRecord) => handler?.(event) };
}

describe("App", () => {
  afterEach(() => cleanup());

  it("restores the terminal handoff session and renders persisted Pi history", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);

    await screen.findByText("ready");
    expect(fake.client.launchSession).toHaveBeenCalledOnce();
    expect(fake.client.sendRpc).toHaveBeenCalledWith({
      id: "handoff-switch",
      type: "switch_session",
      sessionPath: "/sessions/terminal.jsonl",
    });
    expect(fake.client.sendRpc).toHaveBeenCalledWith({
      id: "handoff-messages",
      type: "get_messages",
    });
    expect(screen.getAllByText("Continue this work")).toHaveLength(1);
    expect(screen.getAllByText("I have the context.")).toHaveLength(2);
    expect(screen.queryByRole("heading", { name: "Projects" })).toBeNull();
  });

  it("starts an agent only once under React StrictMode", async () => {
    const fake = createClient();
    render(
      <StrictMode>
        <App client={fake.client} />
      </StrictMode>,
    );

    await screen.findByText("ready");
    expect(fake.client.startAgent).toHaveBeenCalledOnce();
  });

  it("does not select a session when Pi cancels switching", async () => {
    const fake = createClient();
    fake.client.sendRpc = vi
      .fn()
      .mockImplementation(async (request: RpcRecord) => {
        if (request.type === "get_state") {
          return {
            type: "response",
            success: true,
            data: { sessionFile: "/sessions/one.jsonl" },
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
    render(<App client={fake.client} />);
    await screen.findByText("ready");
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    await screen.findByRole("button", { name: /New conversation 2 Empty/ });
    fireEvent.click(
      screen.getByRole("button", { name: /New conversation Empty/ }),
    );

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("cancelled"),
    );
    expect(
      screen.getByRole("heading", { name: "New conversation 2" }),
    ).toBeTruthy();
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
            data: { sessionFile: "/sessions/terminal.jsonl" },
          };
        if (request.type === "get_messages")
          return { type: "response", success: true, data: { messages: [] } };
        if (request.type === "set_session_name")
          return { type: "response", success: false, error: "not allowed" };
        return { type: "response", success: true, data: { cancelled: false } };
      });
    vi.spyOn(window, "prompt").mockReturnValue("Rejected name");
    render(<App client={fake.client} />);
    await screen.findByText("ready");
    fireEvent.click(
      screen.getByRole("button", { name: "Rename session New conversation" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("not allowed"),
    );
    expect(screen.queryByText("Rejected name")).toBeNull();
  });

  it("renders streamed text and aborts an active session", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);
    await screen.findByText("ready");
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Explain this repo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fake.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "I can help." },
    });
    expect((await screen.findAllByText("I can help.")).length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(fake.client.abortAgent).toHaveBeenCalledOnce());
  });
});
