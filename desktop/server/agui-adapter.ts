import type { Message, RunAgentInput } from "@ag-ui/core";
import { EventSchema, RunAgentInputSchema } from "@ag-ui/core/schemas";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

export function parseRunInput(value: unknown): RunAgentInput {
  return RunAgentInputSchema.parse(value);
}

export function promptFromInput(input: RunAgentInput): string {
  const message = input.messages.at(-1);
  if (!message || message.role !== "user") {
    throw new Error("The run must end with one new user message.");
  }
  return messageText(message);
}

export function assertCanonicalHistory(
  input: RunAgentInput,
  canonical: Message[],
): void {
  const supplied = input.messages.slice(0, -1);
  if (JSON.stringify(supplied) !== JSON.stringify(canonical)) {
    throw new Error(
      "The AG-UI message history does not match the authoritative Pi session.",
    );
  }
}

export class AgUiEventWriter {
  readonly #response: ServerResponse;
  readonly #threadId: string;
  readonly #runId: string;
  #messageId: string | undefined;
  #openToolCalls = new Set<string>();
  #closed = false;
  #aborted = false;

  constructor(response: ServerResponse, input: RunAgentInput) {
    this.#response = response;
    this.#threadId = input.threadId;
    this.#runId = input.runId;
  }

  start(input: RunAgentInput): void {
    this.#write({
      type: "RUN_STARTED",
      threadId: this.#threadId,
      runId: this.#runId,
      input,
    });
  }

  accept(event: AgentSessionEvent): void {
    if (event.type === "message_update") {
      const update = event.assistantMessageEvent;
      if (update.type === "text_delta") {
        this.#openTextMessage();
        this.#write({
          type: "TEXT_MESSAGE_CONTENT",
          messageId: this.#messageId,
          delta: update.delta,
        });
      }
      return;
    }
    if (event.type === "tool_execution_start") {
      const parentMessageId = this.#messageId;
      this.#closeTextMessage();
      this.#write({
        type: "TOOL_CALL_START",
        toolCallId: event.toolCallId,
        toolCallName: event.toolName,
        parentMessageId,
      });
      this.#write({
        type: "TOOL_CALL_ARGS",
        toolCallId: event.toolCallId,
        delta: JSON.stringify(event.args),
      });
      this.#write({ type: "TOOL_CALL_END", toolCallId: event.toolCallId });
      this.#openToolCalls.add(event.toolCallId);
      return;
    }
    if (event.type === "tool_execution_end") {
      this.#write({
        type: "TOOL_CALL_RESULT",
        messageId: randomUUID(),
        toolCallId: event.toolCallId,
        content: resultText(event.result),
        ...(event.isError ? { error: "Tool execution failed" } : {}),
      });
      this.#openToolCalls.delete(event.toolCallId);
      return;
    }
    if (event.type === "agent_settled") this.#aborted = event.aborted;
  }

  finish(): void {
    this.#closeTextMessage();
    if (this.#openToolCalls.size > 0) {
      throw new Error(
        "Pi settled before all tool executions produced results.",
      );
    }
    this.#write({
      type: "RUN_FINISHED",
      threadId: this.#threadId,
      runId: this.#runId,
      outcome: { type: this.#aborted ? "cancelled" : "success" },
    });
    this.#end();
  }

  fail(reason: unknown): void {
    if (this.#closed) return;
    this.#closeTextMessage();
    this.#write({
      type: "RUN_ERROR",
      message: reason instanceof Error ? reason.message : String(reason),
    });
    this.#end();
  }

  #openTextMessage(): void {
    if (this.#messageId) return;
    this.#messageId = randomUUID();
    this.#write({
      type: "TEXT_MESSAGE_START",
      messageId: this.#messageId,
      role: "assistant",
    });
  }

  #closeTextMessage(): void {
    if (!this.#messageId) return;
    this.#write({ type: "TEXT_MESSAGE_END", messageId: this.#messageId });
    this.#messageId = undefined;
  }

  #write(value: unknown): void {
    const event = EventSchema.parse(value);
    this.#response.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  #end(): void {
    this.#closed = true;
    this.#response.end();
  }
}

function messageText(message: Message): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    throw new Error("Pi currently accepts text prompts only.");
  }
  const text = content
    .filter((part): part is { type: "text"; text: string } =>
      Boolean(part && part.type === "text" && typeof part.text === "string"),
    )
    .map((part) => part.text)
    .join("\n");
  if (!text) throw new Error("Pi currently accepts text prompts only.");
  return text;
}

function resultText(result: unknown): string {
  if (!result || typeof result !== "object") return String(result ?? "");
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return JSON.stringify(result);
  return content
    .map((part) =>
      part && typeof part === "object" && "text" in part
        ? String((part as { text: unknown }).text)
        : "",
    )
    .filter(Boolean)
    .join("\n");
}
