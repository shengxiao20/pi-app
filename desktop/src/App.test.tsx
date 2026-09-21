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

function createClient() {
  let handler: ((event: RpcRecord) => void) | undefined;
  let sessionNumber = 1;
  const client: PiClient = {
    startAgent: vi.fn().mockResolvedValue(undefined),
    sendRpc: vi.fn().mockImplementation(async (request: RpcRecord) => {
      if (request.type === "new_session") sessionNumber += 1;
      if (request.type === "get_state") {
        return {
          type: "response",
          success: true,
          data: { sessionFile: `/tmp/session-${sessionNumber}.jsonl` },
        };
      }
      return { type: "response", success: true };
    }),
    abortAgent: vi.fn().mockResolvedValue({ type: "response", success: true }),
    listen: vi.fn().mockImplementation(async (nextHandler) => {
      handler = nextHandler;
      return () => undefined;
    }),
  };
  return { client, emit: (event: RpcRecord) => handler?.(event) };
}

describe("App", () => {
  afterEach(() => cleanup());

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

  it("creates and selects Pi-backed workspace sessions from the sidebar", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);
    await screen.findByText("ready");

    expect(screen.getByRole("navigation", { name: "Sessions" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New session" }));

    await waitFor(() =>
      expect(fake.client.sendRpc).toHaveBeenCalledWith({
        id: "session-0",
        type: "new_session",
      }),
    );
    expect(
      screen.getByRole("button", { name: /New conversation 2/ }),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Keep this in session two" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getAllByText("Keep this in session two")).toHaveLength(2);
    fake.emit({ type: "agent_settled" });
    await screen.findByText("idle");

    fireEvent.click(
      screen.getByRole("button", { name: /New conversation Empty/ }),
    );
    await waitFor(() =>
      expect(screen.getAllByText("Keep this in session two")).toHaveLength(1),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /New conversation 2 Keep/ }),
    );
    await waitFor(() =>
      expect(screen.getAllByText("Keep this in session two")).toHaveLength(2),
    );
  });

  it("starts an agent, renders streamed text, and returns to idle when Pi settles", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);

    await screen.findByText("ready");
    expect(fake.client.startAgent).toHaveBeenCalledOnce();

    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Explain this repo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(fake.client.sendRpc).toHaveBeenCalledWith({
      id: "prompt-0",
      type: "prompt",
      message: "Explain this repo",
    });
    expect(screen.getByText("streaming")).toBeTruthy();
    expect(screen.getAllByText("Explain this repo")).toHaveLength(2);

    fake.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "I can help." },
    });
    expect((await screen.findAllByText("I can help.")).length).toBe(2);

    fake.emit({ type: "agent_settled" });
    await waitFor(() => expect(screen.getByText("idle")).toBeTruthy());
  });

  it("renders tool output and aborts an active stream", async () => {
    const fake = createClient();
    render(<App client={fake.client} />);
    await screen.findByText("ready");

    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "List files" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fake.emit({
      type: "tool_execution_start",
      toolCallId: "tool-1",
      toolName: "bash",
    });
    fake.emit({
      type: "tool_execution_update",
      toolCallId: "tool-1",
      partialResult: { content: [{ type: "text", text: "src\n" }] },
    });

    expect(await screen.findByText("bash")).toBeTruthy();
    expect(screen.getByText("src")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(fake.client.abortAgent).toHaveBeenCalledOnce());
  });

  it("displays startup and bridge failures", async () => {
    const fake = createClient();
    fake.client.startAgent = vi
      .fn()
      .mockRejectedValue(new Error("Pi executable is missing"));
    render(<App client={fake.client} />);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Pi executable is missing",
    );
    expect(screen.getByText("failed")).toBeTruthy();
  });
});
