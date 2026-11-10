import type { Message as AgUiMessage } from "@ag-ui/core";
import type {
  AgentSession,
  DefaultResourceLoader as DefaultResourceLoaderType,
  SessionEntry,
  SessionInfo,
  SessionManager as SessionManagerType,
} from "@earendil-works/pi-coding-agent";
import { realpath } from "node:fs/promises";
import { basename } from "node:path";
import {
  ExtensionFeedback,
  type ExtensionFeedbackEvent,
} from "./extension-feedback.ts";
import { isPathInside } from "./path-safety.ts";

const PI_SDK_SPECIFIER =
  process.env.PI_APP_PI_SDK_URL ?? "@earendil-works/pi-coding-agent";
const {
  createAgentSession,
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  SettingsManager,
} = (await import(
  PI_SDK_SPECIFIER
)) as typeof import("@earendil-works/pi-coding-agent");

export type PersistedSession = {
  id: string;
  path: string;
  title: string;
};

export type HistoryPage = {
  messages: unknown[];
  before: number;
  hasMore: boolean;
};

export type PiCommand = {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill";
};

type ManagedSession = {
  session: AgentSession;
  path: string;
  commands: PiCommand[];
  feedback: ExtensionFeedback;
};

export class SessionRegistry {
  #cwd: string;
  readonly #sessions = new Map<string, ManagedSession>();
  readonly #opening = new Map<string, Promise<ManagedSession>>();

  constructor(cwd: string) {
    this.#cwd = cwd;
  }

  get cwd(): string {
    return this.#cwd;
  }

  async replaceWorkspace(path: string): Promise<void> {
    const cwd = await realpath(path);
    await Promise.all(this.#opening.values());
    for (const managed of this.#sessions.values()) managed.session.dispose();
    this.#sessions.clear();
    this.#cwd = cwd;
  }

  async list(): Promise<PersistedSession[]> {
    const sessions = await SessionManager.list(this.#cwd);
    return sessions.map(toPersistedSession);
  }

  async create(): Promise<PersistedSession> {
    const manager = SessionManager.create(this.#cwd);
    const managed = await this.#createAgent(manager);
    const path = managed.session.sessionFile;
    if (!path) throw new Error("Pi did not create a persistent session file.");
    this.#sessions.set(managed.session.sessionId, { ...managed, path });
    managed.session.setSessionName(managed.session.sessionId);
    return {
      id: managed.session.sessionId,
      path,
      title: managed.session.sessionId,
    };
  }

  async open(sessionId: string): Promise<AgentSession> {
    const active = this.#sessions.get(sessionId);
    if (active) return active.session;
    const opening = this.#opening.get(sessionId);
    if (opening) return (await opening).session;
    const path = SessionManager.findById(this.#cwd, sessionId);
    if (!path) throw new Error(`Unknown session: ${sessionId}`);
    const manager = SessionManager.open(path, undefined, this.#cwd);
    const pending = this.#createAgent(manager).then((managed) => {
      const value = { ...managed, path };
      this.#sessions.set(sessionId, value);
      return value;
    });
    this.#opening.set(sessionId, pending);
    try {
      return (await pending).session;
    } finally {
      this.#opening.delete(sessionId);
    }
  }

  async commands(sessionId: string): Promise<PiCommand[]> {
    await this.open(sessionId);
    return this.#sessions.get(sessionId)!.commands;
  }

  subscribeFeedback(
    sessionId: string,
    listener: (event: ExtensionFeedbackEvent) => void,
  ): () => void {
    const managed = this.#sessions.get(sessionId);
    if (!managed) throw new Error(`Session is not open: ${sessionId}`);
    return managed.feedback.subscribe(listener);
  }

  async rename(sessionId: string, name: string): Promise<void> {
    const normalized = name.trim();
    if (!normalized) throw new Error("Session name cannot be blank.");
    const session = await this.open(sessionId);
    session.setSessionName(normalized);
  }

  async abort(sessionId: string): Promise<void> {
    const session = await this.open(sessionId);
    await session.abort();
  }

  assertKnown(sessionId: string): void {
    this.#manager(sessionId);
  }

  history(sessionId: string, before: number, limit: number): HistoryPage {
    if (!Number.isSafeInteger(before) || before < 0) {
      throw new Error("History before must be a non-negative safe integer.");
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new Error("History limit must be an integer from 1 through 200.");
    }
    const manager = this.#manager(sessionId);
    const messages = branchMessages(manager.getBranch());
    const end = Math.min(before, messages.length);
    const start = Math.max(0, end - limit);
    return {
      messages: messages.slice(start, end),
      before: start,
      hasMore: start > 0,
    };
  }

  canonicalMessages(sessionId: string): AgUiMessage[] {
    const manager = this.#manager(sessionId);
    return toAgUiMessages(manager.getBranch());
  }

  #manager(sessionId: string): SessionManagerType {
    const active = this.#sessions.get(sessionId);
    if (active) return active.session.sessionManager;
    const path = SessionManager.findById(this.#cwd, sessionId);
    if (!path) throw new Error(`Unknown session: ${sessionId}`);
    return SessionManager.open(path, undefined, this.#cwd);
  }

  async #createAgent(
    manager: SessionManagerType,
  ): Promise<Omit<ManagedSession, "path">> {
    const resourceLoader = new DefaultResourceLoader({
      cwd: this.#cwd,
      agentDir: getAgentDir(),
      extensionFactories: [
        createCodemodeExtension({ mode: "on" }),
        createToolSearchExtension(),
        createMcpExtension(),
      ],
    });
    await resourceLoader.reload();
    const settingsManager = SettingsManager.create(this.#cwd);
    settingsManager.applyOverrides({
      defaultTools: ["+codemode", "+tool_search"],
    });
    const { session } = await createAgentSession({
      cwd: this.#cwd,
      resourceLoader,
      settingsManager,
      sessionManager: manager,
    });
    const feedback = new ExtensionFeedback();
    await session.bindExtensions({
      mode: "rpc",
      uiContext: feedback.uiContext,
      onError: feedback.onError,
    });
    return { session, commands: resourceCommands(resourceLoader), feedback };
  }
}

function resourceCommands(
  resourceLoader: DefaultResourceLoaderType,
): PiCommand[] {
  const extensionCommands = resourceLoader
    .getExtensions()
    .extensions.flatMap((extension) =>
      [...extension.commands.values()].map((command) => ({
        name: command.name,
        description: command.description,
        source: "extension" as const,
      })),
    );
  const promptCommands = resourceLoader.getPrompts().prompts.map((prompt) => ({
    name: prompt.name,
    description: prompt.description,
    source: "prompt" as const,
  }));
  const skillCommands = resourceLoader.getSkills().skills.map((skill) => ({
    name: `skill:${skill.name}`,
    description: skill.description,
    source: "skill" as const,
  }));
  return [...extensionCommands, ...promptCommands, ...skillCommands].sort(
    (a, b) => a.name.localeCompare(b.name),
  );
}

function toPersistedSession(info: SessionInfo): PersistedSession {
  return {
    id: info.id,
    path: info.path,
    title: info.name || info.firstMessage || info.id,
  };
}

function branchMessages(entries: SessionEntry[]): unknown[] {
  return entries.flatMap((entry) =>
    entry.type === "message" ? [entry.message] : [],
  );
}

function toAgUiMessages(entries: SessionEntry[]): AgUiMessage[] {
  const messages: AgUiMessage[] = [];
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role === "user") {
      messages.push({
        id: entry.id,
        role: "user",
        content: contentText(message.content),
      });
      continue;
    }
    if (message.role === "assistant") {
      const toolCalls = message.content
        .filter((part) => part.type === "toolCall")
        .map((part) => ({
          id: part.id,
          type: "function" as const,
          function: {
            name: part.name,
            arguments: JSON.stringify(part.arguments),
          },
        }));
      messages.push({
        id: entry.id,
        role: "assistant",
        content: message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
        ...(toolCalls.length ? { toolCalls } : {}),
      });
      continue;
    }
    if (message.role === "toolResult") {
      messages.push({
        id: entry.id,
        role: "tool",
        toolCallId: message.toolCallId,
        content: contentText(message.content),
        ...(message.isError ? { error: "Tool execution failed" } : {}),
      });
    }
  }
  return messages;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part && typeof part === "object" && "text" in part
        ? String((part as { text: unknown }).text)
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

export function workspaceView(path: string): {
  id: string;
  path: string;
  displayName: string;
} {
  return { id: path, path, displayName: basename(path) };
}

export function isInsideWorkspace(
  workspace: string,
  candidate: string,
): boolean {
  return isPathInside(workspace, candidate);
}
