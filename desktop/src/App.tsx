import { useCallback, useEffect, useRef, useState } from "react";

import type { PiClient, RpcRecord } from "./pi-client";
import { tauriPiClient } from "./pi-client";

export type ChatStatus = "idle" | "starting" | "ready" | "streaming" | "failed";

type ChatMessage = { role: "user" | "assistant"; text: string };
type ToolCall = { id: string; name: string; output: string; isError: boolean };
type WorkspaceSession = {
  id: string;
  title: string;
  sessionPath: string;
  messages: ChatMessage[];
  tools: ToolCall[];
};

const INITIAL_SESSION_ID = "session-initial";

export default function App({ client = tauriPiClient }: { client?: PiClient }) {
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState("");
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState(INITIAL_SESSION_ID);
  const activeSessionIdRef = useRef(INITIAL_SESSION_ID);
  const requestSequence = useRef(0);
  const sessionSequence = useRef(0);
  const startup = useRef<Promise<WorkspaceSession> | undefined>(undefined);
  const activeSession = sessions.find(({ id }) => id === activeSessionId);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const handleEvent = useCallback((event: RpcRecord) => {
    if (event.type === "bridge_error")
      return fail(setError, setStatus, event.message);
    if (event.type === "message_update") {
      const update = asRecord(event.assistantMessageEvent);
      if (update?.type === "text_delta" && typeof update.delta === "string") {
        updateSession(activeSessionIdRef.current, setSessions, (session) => ({
          ...session,
          messages: appendAssistantText(
            session.messages,
            update.delta as string,
          ),
        }));
      }
      return;
    }
    if (
      event.type === "tool_execution_start" &&
      typeof event.toolCallId === "string" &&
      typeof event.toolName === "string"
    ) {
      updateSession(activeSessionIdRef.current, setSessions, (session) => ({
        ...session,
        tools: [
          ...session.tools,
          {
            id: event.toolCallId as string,
            name: event.toolName as string,
            output: "",
            isError: false,
          },
        ],
      }));
      return;
    }
    if (
      event.type === "tool_execution_update" ||
      event.type === "tool_execution_end"
    ) {
      updateTool(event, activeSessionIdRef.current, setSessions);
      return;
    }
    if (event.type === "agent_settled") setStatus("idle");
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;
    void (async () => {
      setStatus("starting");
      try {
        unlisten = await client.listen(handleEvent);
        if (!active) return unlisten();
        startup.current ??= initializeAgent(client);
        const session = await startup.current;
        if (active) {
          setSessions([session]);
          setActiveSessionId(session.id);
          setStatus("ready");
        }
      } catch (reason) {
        if (active) fail(setError, setStatus, reason);
      }
    })();
    return () => {
      active = false;
      unlisten?.();
    };
  }, [client, handleEvent]);

  async function createSession() {
    if (status !== "ready" && status !== "idle") return;
    const id = `session-${sessionSequence.current++}`;
    try {
      assertResponse(
        await client.sendRpc({ id, type: "new_session" }),
        "new session",
      );
      const metadata = await getSessionMetadata(client, `${id}-state`);
      const session = {
        id,
        title: `New conversation ${sessionSequence.current + 1}`,
        sessionPath: metadata.path,
        messages: [],
        tools: [],
      };
      setSessions((current) => [...current, session]);
      activeSessionIdRef.current = id;
      setActiveSessionId(id);
      setDraft("");
    } catch (reason) {
      fail(setError, setStatus, reason);
    }
  }

  async function selectSession(session: WorkspaceSession) {
    if (session.id === activeSessionId || status === "streaming") return;
    try {
      const restored = await switchAndLoad(
        client,
        session,
        `switch-${requestSequence.current++}`,
      );
      updateSession(session.id, setSessions, () => restored);
      activeSessionIdRef.current = session.id;
      setActiveSessionId(session.id);
      setDraft("");
    } catch (reason) {
      fail(setError, setStatus, reason);
    }
  }

  async function renameSession(session: WorkspaceSession) {
    const title = window.prompt("Session name", session.title)?.trim();
    if (!title || title === session.title) return;
    try {
      if (session.id !== activeSessionId) {
        const restored = await switchAndLoad(
          client,
          session,
          `switch-${requestSequence.current++}`,
        );
        updateSession(session.id, setSessions, () => restored);
        activeSessionIdRef.current = session.id;
        setActiveSessionId(session.id);
      }
      assertResponse(
        await client.sendRpc({
          id: `rename-session-${requestSequence.current++}`,
          type: "set_session_name",
          name: title,
        }),
        "rename session",
      );
      updateSession(session.id, setSessions, (current) => ({
        ...current,
        title,
      }));
    } catch (reason) {
      fail(setError, setStatus, reason);
    }
  }

  async function deleteSession(session: WorkspaceSession) {
    if (sessions.length === 1)
      return fail(
        setError,
        setStatus,
        new Error("Cannot delete the last workspace session"),
      );
    if (!window.confirm(`Delete session “${session.title}”?`)) return;
    try {
      const next = sessions.find(({ id }) => id !== session.id);
      if (session.id === activeSessionId && next) await selectSession(next);
      await client.deleteSession(session.sessionPath);
      setSessions((current) => current.filter(({ id }) => id !== session.id));
    } catch (reason) {
      fail(setError, setStatus, reason);
    }
  }

  async function sendPrompt() {
    const message = draft.trim();
    if (!message || !activeSession || (status !== "ready" && status !== "idle"))
      return;
    updateSession(activeSession.id, setSessions, (session) => ({
      ...session,
      messages: [...session.messages, { role: "user", text: message }],
    }));
    setDraft("");
    setStatus("streaming");
    try {
      assertResponse(
        await client.sendRpc({
          id: `prompt-${requestSequence.current++}`,
          type: "prompt",
          message,
        }),
        "send prompt",
      );
    } catch (reason) {
      fail(setError, setStatus, reason);
    }
  }

  async function abort() {
    try {
      assertResponse(await client.abortAgent(), "abort");
    } catch (reason) {
      fail(setError, setStatus, reason);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand" aria-label="Pi App">
          <span className="brand-mark" aria-hidden="true">
            π
          </span>
          <span>PI APP</span>
        </div>
        <nav aria-label="Workspace navigation" className="workspace-navigation">
          <button
            className="new-session"
            disabled={status !== "ready" && status !== "idle"}
            onClick={() => void createSession()}
            type="button"
          >
            <span aria-hidden="true">+</span> New chat
          </button>
          <section
            className="navigation-section recents"
            aria-labelledby="recents-heading"
          >
            <h2 id="recents-heading">Recents</h2>
            <div className="session-list">
              {sessions.map((session) => (
                <div className="session-item" key={session.id}>
                  <button
                    aria-current={
                      session.id === activeSessionId ? "page" : undefined
                    }
                    className="session-select"
                    onClick={() => void selectSession(session)}
                    type="button"
                  >
                    <span className="session-icon" aria-hidden="true">
                      □
                    </span>
                    <span className="session-copy">
                      <strong>{session.title}</strong>
                      <small>
                        {session.messages.at(-1)?.text || "Empty conversation"}
                      </small>
                    </span>
                  </button>
                  <div className="session-actions">
                    <button
                      aria-label={`Rename session ${session.title}`}
                      disabled={status === "streaming"}
                      onClick={() => void renameSession(session)}
                      type="button"
                    >
                      Rename
                    </button>
                    <button
                      aria-label={`Delete session ${session.title}`}
                      disabled={status === "streaming"}
                      onClick={() => void deleteSession(session)}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </nav>
        <div className="sidebar-footer">
          <span className="connection-dot" /> Pi agent {status}
        </div>
      </aside>
      <section className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">CONVERSATION</p>
            <h1>{activeSession?.title || "Connecting to Pi"}</h1>
          </div>
          <span aria-live="polite" className={`status status-${status}`}>
            {status}
          </span>
        </header>
        {error && <p role="alert">{error}</p>}
        <section aria-label="Conversation" className="conversation">
          {!activeSession?.messages.length &&
            !activeSession?.tools.length &&
            status !== "starting" && (
              <div className="empty-state">
                <span className="empty-orb">✦</span>
                <h2>What can I help you build?</h2>
                <p>
                  Ask Pi to explore this project, implement a feature, or review
                  a change.
                </p>
              </div>
            )}
          {activeSession?.messages.map((message, index) => (
            <article
              className={`message message-${message.role}`}
              key={`${message.role}-${index}`}
            >
              <span className="message-avatar">
                {message.role === "user" ? "You" : "π"}
              </span>
              <div>
                <strong>{message.role === "user" ? "You" : "Pi"}</strong>
                <p>{message.text}</p>
              </div>
            </article>
          ))}
          {activeSession?.tools.map((tool) => (
            <details className="tool" key={tool.id} open>
              <summary>
                <span>⌘</span>
                {tool.name}
                <em>{tool.isError ? "failed" : "running"}</em>
              </summary>
              <pre>{tool.output || "Running…"}</pre>
            </details>
          ))}
        </section>
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void sendPrompt();
          }}
        >
          <label className="sr-only" htmlFor="prompt">
            Message
          </label>
          <textarea
            disabled={status !== "ready" && status !== "idle"}
            id="prompt"
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Message Pi about this project…"
            value={draft}
          />
          <div className="composer-footer">
            <span>Pi is ready to work in this project</span>
            <div className="actions">
              <button
                disabled={status !== "streaming"}
                onClick={() => void abort()}
                type="button"
              >
                Stop
              </button>
              <button
                disabled={
                  (status !== "ready" && status !== "idle") || !draft.trim()
                }
                type="submit"
              >
                Send <span aria-hidden="true">↑</span>
              </button>
            </div>
          </div>
        </form>
      </section>
    </main>
  );
}

async function initializeAgent(client: PiClient): Promise<WorkspaceSession> {
  await client.startAgent();
  const handoffSession = await client.launchSession();
  if (handoffSession)
    assertResponse(
      await client.sendRpc({
        id: "handoff-switch",
        type: "switch_session",
        sessionPath: handoffSession,
      }),
      "restore handed-off session",
    );
  const metadata = await getSessionMetadata(client, "session-initial-state");
  const messages = await getMessages(
    client,
    handoffSession ? "handoff-messages" : "initial-messages",
  );
  return {
    id: INITIAL_SESSION_ID,
    title: metadata.name || "New conversation",
    sessionPath: metadata.path,
    messages,
    tools: [],
  };
}

async function switchAndLoad(
  client: PiClient,
  session: WorkspaceSession,
  id: string,
): Promise<WorkspaceSession> {
  assertResponse(
    await client.sendRpc({
      id,
      type: "switch_session",
      sessionPath: session.sessionPath,
    }),
    "switch session",
  );
  return { ...session, messages: await getMessages(client, `${id}-messages`) };
}

async function getSessionMetadata(
  client: PiClient,
  id: string,
): Promise<{ path: string; name?: string }> {
  const response = await client.sendRpc({ id, type: "get_state" });
  assertResponse(response, "get session state");
  const data = asRecord(response.data);
  if (typeof data?.sessionFile !== "string")
    throw new Error("Pi did not return an active session file");
  return {
    path: data.sessionFile,
    name: typeof data.sessionName === "string" ? data.sessionName : undefined,
  };
}

async function getMessages(
  client: PiClient,
  id: string,
): Promise<ChatMessage[]> {
  const response = await client.sendRpc({ id, type: "get_messages" });
  assertResponse(response, "load session history");
  const messages = asRecord(response.data)?.messages;
  if (!Array.isArray(messages))
    throw new Error("Pi did not return session messages");
  return messages.flatMap(mapMessage);
}

function mapMessage(message: unknown): ChatMessage[] {
  const record = asRecord(message);
  if (record?.role !== "user" && record?.role !== "assistant") return [];
  const text = messageText(record.content);
  return text ? [{ role: record.role, text }] : [];
}
function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  return Array.isArray(content)
    ? content
        .map((item) => asRecord(item)?.text)
        .filter((text): text is string => typeof text === "string")
        .join("\n")
    : "";
}
function assertResponse(response: RpcRecord, action: string) {
  const data = asRecord(response.data);
  if (response.success !== true)
    throw new Error(
      typeof response.error === "string"
        ? response.error
        : `Pi could not ${action}`,
    );
  if (data?.cancelled === true) throw new Error(`Pi ${action} was cancelled`);
}
function updateSession(
  id: string,
  setSessions: React.Dispatch<React.SetStateAction<WorkspaceSession[]>>,
  update: (session: WorkspaceSession) => WorkspaceSession,
) {
  setSessions((current) =>
    current.map((session) => (session.id === id ? update(session) : session)),
  );
}
function appendAssistantText(
  messages: ChatMessage[],
  delta: string,
): ChatMessage[] {
  const last = messages.at(-1);
  return last?.role === "assistant"
    ? [...messages.slice(0, -1), { ...last, text: last.text + delta }]
    : [...messages, { role: "assistant", text: delta }];
}
function updateTool(
  event: RpcRecord,
  sessionId: string,
  setSessions: React.Dispatch<React.SetStateAction<WorkspaceSession[]>>,
) {
  if (typeof event.toolCallId !== "string") return;
  const result = asRecord(event.partialResult) ?? asRecord(event.result);
  const content = result?.content;
  const output = Array.isArray(content)
    ? content
        .map((item) => asRecord(item)?.text)
        .filter((text): text is string => typeof text === "string")
        .join("\n")
    : "";
  updateSession(sessionId, setSessions, (session) => ({
    ...session,
    tools: session.tools.map((tool) =>
      tool.id === event.toolCallId
        ? { ...tool, output, isError: event.isError === true }
        : tool,
    ),
  }));
}
function asRecord(value: unknown): RpcRecord | undefined {
  return typeof value === "object" && value !== null
    ? (value as RpcRecord)
    : undefined;
}
function fail(
  setError: React.Dispatch<React.SetStateAction<string | undefined>>,
  setStatus: React.Dispatch<React.SetStateAction<ChatStatus>>,
  reason: unknown,
) {
  setError(reason instanceof Error ? reason.message : String(reason));
  setStatus("failed");
}
