import { HttpAgent } from "@ag-ui/client";
import type { Event, Message } from "@ag-ui/core";
import { EventSchema } from "@ag-ui/core/schemas";

export type DataRecord = Record<string, unknown>;

export type SessionProcessEvent = {
  sessionId: string;
  runId: string;
  event: Event;
};

export type PersistedHistoryPage = {
  messages: DataRecord[];
  before: number;
  hasMore: boolean;
};

export type CurrentWorkspace = {
  id: string;
  path: string;
  displayName: string;
};

export type Tag = { id: number; name: string };
export type SessionTagAssignment = { sessionId: string; tagId: number | null };

export type PiCommand = {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill";
};

export interface PiClient {
  createSession(): Promise<PersistedSession>;
  currentWorkspace(): Promise<CurrentWorkspace>;
  saveClipboardImage(image: Blob): Promise<string>;
  runAgent(
    sessionId: string,
    prompt: string,
    handler: (event: SessionProcessEvent) => void,
  ): Promise<void>;
  abortSession(sessionId: string): Promise<void>;
  renameSession(sessionId: string, name: string): Promise<void>;
  listCommands(sessionId: string): Promise<PiCommand[]>;
  listSessions(): Promise<PersistedSession[]>;
  listTags(): Promise<Tag[]>;
  createTag(name: string): Promise<Tag>;
  renameTag(id: number, name: string): Promise<Tag>;
  deleteTag(id: number): Promise<void>;
  listSessionTagAssignments(): Promise<SessionTagAssignment[]>;
  assignSessionTag(sessionId: string, tagId: number | null): Promise<void>;
  sessionHistory(
    sessionId: string,
    before: number,
    limit: number,
  ): Promise<PersistedHistoryPage>;
}

export type PersistedSession = {
  id: string;
  path: string;
  title: string;
};

export const webPiClient: PiClient = {
  createSession: () => request("/api/sessions", { method: "POST" }),
  currentWorkspace: () => request("/api/workspace"),
  saveClipboardImage: async (image) => {
    const result = await request<{ path: string }>("/api/clipboard-images", {
      method: "POST",
      headers: { "Content-Type": image.type },
      body: image,
    });
    if (typeof result.path !== "string" || !result.path.startsWith("/")) {
      throw new Error(
        "Clipboard image upload did not return an absolute path.",
      );
    }
    return result.path;
  },
  runAgent: async (sessionId, prompt, handler) => {
    const messages = await request<Message[]>(
      `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
    );
    const agent = new HttpAgent({
      url: "/api/agent",
      threadId: sessionId,
      initialMessages: messages,
    });
    agent.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
    });
    await agent.runAgent(undefined, {
      onEvent: ({ event, input }) => {
        handler({
          sessionId,
          runId: input.runId,
          event: EventSchema.parse(event),
        });
      },
    });
  },
  abortSession: (sessionId) =>
    request(`/api/sessions/${encodeURIComponent(sessionId)}/abort`, {
      method: "POST",
    }),
  renameSession: (sessionId, name) =>
    request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  listCommands: (sessionId) =>
    request(`/api/sessions/${encodeURIComponent(sessionId)}/commands`),
  listSessions: () => request("/api/sessions"),
  listTags: () => request("/api/tags"),
  createTag: (name) =>
    request("/api/tags", { method: "POST", body: JSON.stringify({ name }) }),
  renameTag: (id, name) =>
    request(`/api/tags/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  deleteTag: (id) => request(`/api/tags/${id}`, { method: "DELETE" }),
  listSessionTagAssignments: () => request("/api/session-tags"),
  assignSessionTag: (sessionId, tagId) =>
    request(`/api/session-tags/${encodeURIComponent(sessionId)}`, {
      method: "PUT",
      body: JSON.stringify({ tagId }),
    }),
  sessionHistory: (sessionId, before, limit) =>
    request(
      `/api/sessions/${encodeURIComponent(sessionId)}/history?before=${before}&limit=${limit}`,
    ),
};

async function request<T = void>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json()) as { message?: string };
    throw new Error(
      body.message ?? `Request failed with status ${response.status}.`,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
