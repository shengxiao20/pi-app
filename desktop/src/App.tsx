import { useCallback, useEffect, useRef, useState } from "react";

import type { PiClient, RpcRecord } from "./pi-client";
import { tauriPiClient } from "./pi-client";

export type ChatStatus = "idle" | "starting" | "ready" | "streaming" | "failed";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

type ToolCall = {
  id: string;
  name: string;
  output: string;
  isError: boolean;
};

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
  const requestSequence = useRef(0);
  const sessionSequence = useRef(0);
  const activeSessionIdRef = useRef(INITIAL_SESSION_ID);
  const startup = useRef<Promise<void> | undefined>(undefined);

  const activeSession = sessions.find(
    (session) => session.id === activeSessionId,
  );

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const handleEvent = useCallback((event: RpcRecord) => {
    const type = event.type;
    if (type === "bridge_error") {
      setError(String(event.message));
      setStatus("failed");
      return;
    }
    if (type === "message_update") {
      const update = asRecord(event.assistantMessageEvent);
      const delta = update?.delta;
      if (update?.type === "text_delta" && typeof delta === "string") {
        updateSession(activeSessionIdRef.current, setSessions, (session) => ({
          ...session,
          messages: appendAssistantText(session.messages, delta),
        }));
      }
      return;
    }
    if (type === "tool_execution_start") {
      const toolCallId = event.toolCallId;
      const toolName = event.toolName;
      if (typeof toolCallId === "string" && typeof toolName === "string") {
        updateSession(activeSessionIdRef.current, setSessions, (session) => ({
          ...session,
          tools: [
            ...session.tools,
            { id: toolCallId, name: toolName, output: "", isError: false },
          ],
        }));
      }
      return;
    }
    if (type === "tool_execution_update" || type === "tool_execution_end") {
      updateTool(event, activeSessionIdRef.current, setSessions);
      return;
    }
    if (type === "agent_settled") setStatus("idle");
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;

    void (async () => {
      setStatus("starting");
      try {
        unlisten = await client.listen(handleEvent);
        if (!active) {
          unlisten();
          return;
        }
        startup.current ??= initializeAgent(client, setSessions);
        await startup.current;
        if (active) setStatus("ready");
      } catch (startError) {
        if (active) fail(startError);
      }
    })();

    return () => {
      active = false;
      unlisten?.();
    };
  }, [client, handleEvent]);

  function fail(reason: unknown) {
    setError(errorMessage(reason));
    setStatus("failed");
  }

  async function createSession() {
    if (status !== "ready" && status !== "idle") return;
    const id = `session-${sessionSequence.current++}`;
    try {
      await client.sendRpc({ id, type: "new_session" });
      const metadata = await getSessionMetadata(client, `${id}-state`);
      const session: WorkspaceSession = {
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
      setStatus("ready");
    } catch (createError) {
      fail(createError);
    }
  }

  async function selectSession(session: WorkspaceSession) {
    if (session.id === activeSessionId || status === "streaming") return;
    try {
      await client.sendRpc({
        id: `switch-${requestSequence.current++}`,
        type: "switch_session",
        sessionPath: session.sessionPath,
      });
      activeSessionIdRef.current = session.id;
      setActiveSessionId(session.id);
      setDraft("");
    } catch (switchError) {
      fail(switchError);
    }
  }

  async function sendPrompt() {
    const message = draft.trim();
    if (!message || !activeSession || (status !== "ready" && status !== "idle"))
      return;

    const id = `prompt-${requestSequence.current++}`;
    updateSession(activeSession.id, setSessions, (session) => ({
      ...session,
      messages: [...session.messages, { role: "user", text: message }],
    }));
    setDraft("");
    setStatus("streaming");
    try {
      await client.sendRpc({ id, type: "prompt", message });
    } catch (sendError) {
      fail(sendError);
    }
  }

  async function abort() {
    try {
      await client.abortAgent();
    } catch (abortError) {
      fail(abortError);
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
            className="navigation-section"
            aria-labelledby="projects-heading"
          >
            <h2 id="projects-heading">Projects</h2>
            <p className="project-note">This project</p>
          </section>
          <section
            className="navigation-section recents"
            aria-labelledby="recents-heading"
          >
            <h2 id="recents-heading">Recents</h2>
            <div className="session-list">
              {sessions.map((session) => (
                <button
                  aria-current={
                    session.id === activeSessionId ? "page" : undefined
                  }
                  className="session-item"
                  key={session.id}
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
            <p className="eyebrow">WORKSPACE</p>
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

async function initializeAgent(
  client: PiClient,
  setSessions: React.Dispatch<React.SetStateAction<WorkspaceSession[]>>,
) {
  await client.startAgent();
  const metadata = await getSessionMetadata(client, "session-initial-state");
  setSessions([
    {
      id: INITIAL_SESSION_ID,
      title: metadata.name || "New conversation",
      sessionPath: metadata.path,
      messages: [],
      tools: [],
    },
  ]);
}

async function getSessionMetadata(
  client: PiClient,
  id: string,
): Promise<{ path: string; name?: string }> {
  const response = await client.sendRpc({ id, type: "get_state" });
  const data = asRecord(response.data);
  if (response.success !== true || typeof data?.sessionFile !== "string")
    throw new Error("Pi did not return an active session file");
  return {
    path: data.sessionFile,
    name: typeof data.sessionName === "string" ? data.sessionName : undefined,
  };
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
  if (last?.role === "assistant")
    return [...messages.slice(0, -1), { ...last, text: last.text + delta }];
  return [...messages, { role: "assistant", text: delta }];
}

function updateTool(
  event: RpcRecord,
  sessionId: string,
  setSessions: React.Dispatch<React.SetStateAction<WorkspaceSession[]>>,
) {
  if (typeof event.toolCallId !== "string") return;
  const result = asRecord(event.partialResult) ?? asRecord(event.result);
  const output = toolOutput(result);
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
function toolOutput(result: RpcRecord | undefined): string {
  const content = result?.content;
  return Array.isArray(content)
    ? content
        .map((item) => asRecord(item)?.text)
        .filter((text): text is string => typeof text === "string")
        .join("\n")
    : "";
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
