import type {
  AssistantMessage,
  Message,
  RunAgentInput,
  ToolMessage,
  UserMessage,
} from "@ag-ui/core";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";

import {
  AgUiEventWriter,
  assertCanonicalHistory,
  parseRunInput,
  promptFromInput,
} from "./agui-adapter";

const input: RunAgentInput = {
  threadId: "session-1",
  runId: "run-1",
  state: {},
  messages: [{ id: "user-1", role: "user", content: "Fix the test" }],
  tools: [],
  context: [],
  forwardedProps: {},
};

const toolHistory: [UserMessage, AssistantMessage, ToolMessage] = [
  { id: "old-user", role: "user", content: "Read the file" },
  {
    id: "assistant-1",
    role: "assistant",
    content: "Reading",
    toolCalls: [
      {
        id: "tool-1",
        type: "function",
        function: { name: "read", arguments: '{"path":"README.md"}' },
      },
    ],
  },
  {
    id: "result-1",
    role: "tool",
    toolCallId: "tool-1",
    content: "contents",
  },
];

function commandInput(history: Message[]): RunAgentInput {
  return parseRunInput({
    ...input,
    messages: [
      ...history,
      { id: "command-1", role: "user", content: "/command args" },
    ],
  });
}

describe("AG-UI adapter", () => {
  it("validates run input and extracts the final text prompt", () => {
    expect(parseRunInput(input)).toEqual(input);
    expect(promptFromInput(input)).toBe("Fix the test");
  });

  it("rejects history that differs from the Pi session", () => {
    expect(() =>
      assertCanonicalHistory(
        {
          ...input,
          messages: [
            { id: "old", role: "user", content: "Old" },
            ...input.messages,
          ],
        },
        [],
      ),
    ).toThrow("does not match");
  });

  it.each([{}, { error: "Tool execution failed" }])(
    "accepts parsed tool history before a slash command with result metadata %j",
    (metadata) => {
      const canonical: Message[] = [
        ...toolHistory.slice(0, -1),
        { ...toolHistory[2], ...metadata },
      ];
      const parsed = commandInput(canonical);

      // Schema parsing changes tool-result key order, but not its contents.
      expect(JSON.stringify(parsed.messages.slice(0, -1))).not.toBe(
        JSON.stringify(canonical),
      );
      expect(() => assertCanonicalHistory(parsed, canonical)).not.toThrow();
      expect(promptFromInput(parsed)).toBe("/command args");
    },
  );

  it.each([
    [
      "result content",
      [...toolHistory.slice(0, -1), { ...toolHistory[2], content: "changed" }],
    ],
    [
      "result ID",
      [...toolHistory.slice(0, -1), { ...toolHistory[2], id: "changed" }],
    ],
    [
      "tool call ID",
      [
        ...toolHistory.slice(0, -1),
        { ...toolHistory[2], toolCallId: "changed" },
      ],
    ],
    [
      "result error",
      [
        ...toolHistory.slice(0, -1),
        { ...toolHistory[2], error: "Tool execution failed" },
      ],
    ],
    ["message order", [toolHistory[1], toolHistory[0], toolHistory[2]]],
    ["missing message", toolHistory.slice(0, -1)],
    [
      "tool arguments",
      [
        toolHistory[0],
        {
          id: "assistant-1",
          role: "assistant",
          content: "Reading",
          toolCalls: [
            {
              id: "tool-1",
              type: "function",
              function: { name: "read", arguments: '{"path":"other.md"}' },
            },
          ],
        },
        toolHistory[2],
      ],
    ],
  ] satisfies [string, Message[]][])(
    "rejects changed %s before a slash command",
    (_name, messages) => {
      expect(() =>
        assertCanonicalHistory(commandInput(messages), toolHistory),
      ).toThrow("does not match");
    },
  );

  it("keeps the assistant message ID on its tool call", () => {
    const target = responseTarget();
    const writer = new AgUiEventWriter(target.response, input);
    writer.start(input);
    writer.accept(
      event({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Working" },
      }),
    );
    writer.accept(
      event({
        type: "tool_execution_start",
        toolCallId: "tool-1",
        toolName: "read",
        args: { path: "README.md" },
      }),
    );
    writer.accept(
      event({
        type: "tool_execution_end",
        toolCallId: "tool-1",
        toolName: "read",
        result: { content: [{ type: "text", text: "contents" }] },
        isError: false,
      }),
    );
    writer.accept(event({ type: "agent_settled", aborted: false }));
    writer.finish();

    const events = target.events();
    const start = events.find((item) => item.type === "TEXT_MESSAGE_START");
    const tool = events.find((item) => item.type === "TOOL_CALL_START");
    expect(tool?.parentMessageId).toBe(start?.messageId);
    expect(events.map((item) => item.type)).toEqual([
      "RUN_STARTED",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
      "TOOL_CALL_RESULT",
      "RUN_FINISHED",
    ]);
    expect(events.at(-1)?.outcome).toEqual({ type: "success" });
    expect(target.ended()).toBe(true);
  });

  it.each(["info", "warning", "error"] as const)(
    "emits extension %s notifications without creating model messages",
    (level) => {
      const target = responseTarget();
      const writer = new AgUiEventWriter(target.response, input);
      writer.start(input);
      writer.acceptFeedback({
        type: "notification",
        message: "MCP status",
        level,
      });
      writer.finish();
      expect(target.events().map((event) => event.type)).toEqual([
        "RUN_STARTED",
        "CUSTOM",
        "RUN_FINISHED",
      ]);
      expect(target.events()[1]).toEqual({
        type: "CUSTOM",
        name: "pi.notification",
        value: { message: "MCP status", level },
      });
    },
  );

  it("reports caught extension failures instead of a successful run", () => {
    const target = responseTarget();
    const writer = new AgUiEventWriter(target.response, input);
    writer.start(input);
    writer.acceptFeedback({ type: "error", message: "Command failed" });
    expect(target.ended()).toBe(false);
    writer.finish();
    expect(target.events().map((event) => event.type)).toEqual([
      "RUN_STARTED",
      "RUN_ERROR",
    ]);
    expect(target.events().at(-1)?.message).toBe("Command failed");
    expect(target.ended()).toBe(true);
  });

  it("reports an aborted Pi run as cancelled", () => {
    const target = responseTarget();
    const writer = new AgUiEventWriter(target.response, input);
    writer.start(input);
    writer.accept(event({ type: "agent_settled", aborted: true }));
    writer.finish();
    expect(target.events().at(-1)?.outcome).toEqual({ type: "cancelled" });
  });
});

function event(value: unknown): AgentSessionEvent {
  return value as AgentSessionEvent;
}

function responseTarget(): {
  response: ServerResponse;
  events: () => Record<string, unknown>[];
  ended: () => boolean;
} {
  const chunks: string[] = [];
  let isEnded = false;
  const response = {
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    end() {
      isEnded = true;
      return response;
    },
  } as unknown as ServerResponse;
  return {
    response,
    events: () =>
      chunks.map((chunk) =>
        JSON.parse(chunk.slice("data: ".length).trim()),
      ) as Record<string, unknown>[],
    ended: () => isEnded,
  };
}
