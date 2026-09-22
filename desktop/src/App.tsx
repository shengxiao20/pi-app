import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";

import type { PersistedSession, PiClient, RpcRecord } from "./pi-client";
import { tauriPiClient } from "./pi-client";

export type ChatStatus = "idle" | "starting" | "ready" | "streaming" | "failed";

type ChatMessage = {
  kind: "message";
  role: "user" | "assistant";
  text: string;
};
type ToolCall = {
  kind: "tool";
  id: string;
  name: string;
  output: string;
  isError: boolean;
};
type HistoryEntry = ChatMessage | ToolCall;
type WorkspaceSession = {
  id: string;
  title: string;
  sessionPath: string;
  historyLoaded: boolean;
  historyLoading: boolean;
  historyBefore: number;
  hasMoreHistory: boolean;
  persistedMessages: RpcRecord[];
  history: HistoryEntry[];
};
type WorkspaceInitialization = {
  activeSession: WorkspaceSession;
  directory: string;
  sessions: WorkspaceSession[];
};
type SessionDialog =
  | { kind: "rename"; session: WorkspaceSession }
  | { kind: "delete"; session: WorkspaceSession };

const INITIAL_SESSION_ID = "session-initial";
const ESTIMATED_HISTORY_ENTRY_HEIGHT = 120;
const HISTORY_OVERSCAN_PX = 960;
const HISTORY_PAGE_SIZE = 80;
const HISTORY_LOAD_MORE_THRESHOLD_PX = 240;

function isInteractive(status: ChatStatus): boolean {
  return status === "ready" || status === "idle";
}

export default function App({ client = tauriPiClient }: { client?: PiClient }) {
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState("");
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [dialog, setDialog] = useState<SessionDialog>();
  const [directory, setDirectory] = useState("");
  const [activeSessionId, setActiveSessionId] = useState(INITIAL_SESSION_ID);
  const activeSessionIdRef = useRef(INITIAL_SESSION_ID);
  const requestSequence = useRef(0);
  const sessionSequence = useRef(0);
  const loadingOlderSessions = useRef(new Set<string>());
  const startup = useRef<Promise<WorkspaceInitialization> | undefined>(
    undefined,
  );
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
          history: appendAssistantText(session.history, update.delta as string),
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
        history: [
          ...session.history,
          {
            kind: "tool",
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
        const workspace = await startup.current;
        if (active) {
          setDirectory(workspace.directory);
          setSessions(workspace.sessions);
          activeSessionIdRef.current = workspace.activeSession.id;
          setActiveSessionId(workspace.activeSession.id);
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
    if (!isInteractive(status)) return;
    const id = `session-${sessionSequence.current++}`;
    try {
      assertResponse(
        await client.sendRpc({ id, type: "new_session" }),
        "new session",
      );
      const metadata = await getSessionMetadata(client, `${id}-state`);
      assertResponse(
        await client.sendRpc({
          id: `name-${id}`,
          type: "set_session_name",
          name: metadata.id,
        }),
        "name session",
      );
      const session = loadedWorkspaceSession({
        id: metadata.id,
        title: metadata.id,
        path: metadata.path,
      });
      setSessions((current) => [...current, session]);
      activeSessionIdRef.current = metadata.id;
      setActiveSessionId(metadata.id);
      setDraft("");
    } catch (reason) {
      fail(setError, setStatus, reason);
    }
  }

  async function selectSession(session: WorkspaceSession) {
    if (session.id === activeSessionId || status === "streaming") return;
    const previousSessionId = activeSessionId;
    try {
      activeSessionIdRef.current = session.id;
      updateSession(session.id, setSessions, (current) => ({
        ...current,
        historyLoading: !current.historyLoaded,
      }));
      setActiveSessionId(session.id);
      setDraft("");
      const restored = await switchAndLoad(
        client,
        session,
        `switch-${requestSequence.current++}`,
      );
      updateSession(session.id, setSessions, () => restored);
    } catch (reason) {
      activeSessionIdRef.current = previousSessionId;
      setActiveSessionId(previousSessionId);
      fail(setError, setStatus, reason);
    }
  }

  async function loadOlderHistory() {
    const session = sessions.find(
      ({ id }) => id === activeSessionIdRef.current,
    );
    if (
      !session ||
      !session.hasMoreHistory ||
      loadingOlderSessions.current.has(session.id)
    )
      return;
    loadingOlderSessions.current.add(session.id);
    updateSession(session.id, setSessions, (current) => ({
      ...current,
      historyLoading: true,
    }));
    try {
      const page = await client.sessionHistory(
        session.sessionPath,
        session.historyBefore,
        HISTORY_PAGE_SIZE,
      );
      updateSession(session.id, setSessions, (current) => {
        const persistedMessages = [
          ...page.messages,
          ...current.persistedMessages,
        ];
        return {
          ...current,
          historyLoading: false,
          historyBefore: page.before,
          hasMoreHistory: page.hasMore,
          persistedMessages,
          history: mapHistory(persistedMessages),
        };
      });
    } catch (reason) {
      fail(setError, setStatus, reason);
      updateSession(session.id, setSessions, (current) => ({
        ...current,
        historyLoading: false,
      }));
    } finally {
      loadingOlderSessions.current.delete(session.id);
    }
  }

  async function saveRename(session: WorkspaceSession, value: string) {
    const title = value.trim();
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
      setDialog(undefined);
    } catch (reason) {
      fail(setError, setStatus, reason);
    }
  }

  async function confirmDelete(session: WorkspaceSession) {
    try {
      const next = sessions.find(({ id }) => id !== session.id);
      if (session.id === activeSessionId && next) await selectSession(next);
      await client.deleteSession(session.sessionPath);
      setSessions((current) => current.filter(({ id }) => id !== session.id));
      setDialog(undefined);
    } catch (reason) {
      fail(setError, setStatus, reason);
    }
  }

  async function sendPrompt() {
    const message = draft.trim();
    if (!message || !activeSession || !isInteractive(status)) return;
    updateSession(activeSession.id, setSessions, (session) => ({
      ...session,
      history: [
        ...session.history,
        { kind: "message", role: "user", text: message },
      ],
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
          <p className="current-directory" title={directory}>
            {directory}
          </p>
          <button
            className="new-session"
            disabled={!isInteractive(status)}
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
                    <span className="session-copy">
                      <strong>{session.title}</strong>
                      <small>
                        {lastMessageText(session.history) ||
                          "Empty conversation"}
                      </small>
                    </span>
                  </button>
                  <div className="session-actions">
                    <button
                      aria-label={`Rename session ${session.title}`}
                      disabled={status === "streaming"}
                      onClick={() => setDialog({ kind: "rename", session })}
                      type="button"
                    >
                      Rename
                    </button>
                    <button
                      aria-label={`Delete session ${session.title}`}
                      disabled={status === "streaming"}
                      onClick={() => {
                        if (sessions.length === 1)
                          return fail(
                            setError,
                            setStatus,
                            new Error(
                              "Cannot delete the last workspace session",
                            ),
                          );
                        setDialog({ kind: "delete", session });
                      }}
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
      </aside>
      <section className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">CONVERSATION</p>
            <h1>{activeSession?.title || "Connecting to Pi"}</h1>
          </div>
        </header>
        {error && <p role="alert">{error}</p>}
        <Conversation
          hasMoreHistory={activeSession?.hasMoreHistory ?? false}
          history={activeSession?.history ?? []}
          historyLoading={activeSession?.historyLoading ?? false}
          key={activeSessionId}
          onLoadOlder={loadOlderHistory}
          status={status}
        />
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
            disabled={!isInteractive(status)}
            id="prompt"
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Message Pi about this project…"
            value={draft}
          />
          <div className="composer-footer">
            <div className="actions">
              <button
                disabled={status !== "streaming"}
                onClick={() => void abort()}
                type="button"
              >
                Stop
              </button>
              <button
                disabled={!isInteractive(status) || !draft.trim()}
                type="submit"
              >
                Send <span aria-hidden="true">↑</span>
              </button>
            </div>
          </div>
        </form>
      </section>
      {dialog?.kind === "rename" && (
        <form
          aria-label="Rename session"
          className="session-dialog"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void saveRename(dialog.session, String(form.get("session-name")));
          }}
        >
          <label>
            Session name
            <input defaultValue={dialog.session.title} name="session-name" />
          </label>
          <div className="actions">
            <button onClick={() => setDialog(undefined)} type="button">
              Cancel
            </button>
            <button type="submit">Save</button>
          </div>
        </form>
      )}
      {dialog?.kind === "delete" && (
        <section aria-label="Delete session" className="session-dialog">
          <p>Delete “{dialog.session.title}”?</p>
          <div className="actions">
            <button onClick={() => setDialog(undefined)} type="button">
              Cancel
            </button>
            <button
              onClick={() => void confirmDelete(dialog.session)}
              type="button"
            >
              Delete
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

function Conversation({
  history,
  status,
  hasMoreHistory,
  historyLoading,
  onLoadOlder,
}: {
  history: HistoryEntry[];
  status: ChatStatus;
  hasMoreHistory: boolean;
  historyLoading: boolean;
  onLoadOlder: () => void;
}) {
  const container = useRef<HTMLElement>(null);
  const heights = useRef(new Map<number, number>());
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const followsLatest = useRef(true);
  const expectedLatestScrollTop = useRef<number | undefined>(undefined);
  const [, updateMeasuredHeights] = useState(0);
  const offsets = [0];
  for (let index = 0; index < history.length; index += 1)
    offsets.push(
      offsets[index] +
        (heights.current.get(index) ?? ESTIMATED_HISTORY_ENTRY_HEIGHT),
    );
  const totalHeight = offsets.at(-1) ?? 0;
  const start = firstVisibleIndex(offsets, scrollTop - HISTORY_OVERSCAN_PX);
  const end = firstVisibleIndex(
    offsets,
    scrollTop + viewportHeight + HISTORY_OVERSCAN_PX,
  );
  const visibleHistory = history.slice(
    start,
    Math.min(end + 1, history.length),
  );

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setViewportHeight(element.clientHeight),
    );
    observer.observe(element);
    setViewportHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    followsLatest.current = true;
    expectedLatestScrollTop.current = undefined;
  }, []);

  useLayoutEffect(() => {
    const element = container.current;
    if (!element || !followsLatest.current) return;
    const latestOffset = Math.max(totalHeight - element.clientHeight, 0);
    expectedLatestScrollTop.current = latestOffset;
    element.scrollTop = latestOffset;
    setScrollTop(latestOffset);
  }, [totalHeight, viewportHeight]);

  return (
    <section
      aria-label="Conversation"
      className="conversation"
      onScroll={(event) => {
        const element = event.currentTarget;
        if (element.scrollTop === expectedLatestScrollTop.current) {
          setScrollTop(element.scrollTop);
          return;
        }
        expectedLatestScrollTop.current = undefined;
        if (
          element.scrollTop <= HISTORY_LOAD_MORE_THRESHOLD_PX &&
          hasMoreHistory &&
          !historyLoading
        ) {
          followsLatest.current = false;
          onLoadOlder();
        } else
          followsLatest.current =
            element.scrollTop >=
            element.scrollHeight - element.clientHeight - 1;
        setScrollTop(element.scrollTop);
      }}
      ref={container}
    >
      {!history.length && !historyLoading && status !== "starting" && (
        <div className="empty-state">
          <span className="empty-orb">✦</span>
          <h2>What can I help you build?</h2>
          <p>
            Ask Pi to explore this project, implement a feature, or review a
            change.
          </p>
        </div>
      )}
      <div className="virtual-history" style={{ height: totalHeight }}>
        <div style={{ transform: `translateY(${offsets[start]}px)` }}>
          {visibleHistory.map((entry, index) => {
            const historyIndex = start + index;
            return (
              <MeasuredHistoryEntry
                entry={entry}
                index={historyIndex}
                key={historyEntryKey(entry, historyIndex)}
                onMeasured={(height) => {
                  if (heights.current.get(historyIndex) === height) return;
                  heights.current.set(historyIndex, height);
                  updateMeasuredHeights((current) => current + 1);
                }}
              />
            );
          })}
        </div>
      </div>
      {historyLoading && (
        <div
          aria-label="Loading latest history"
          className="thinking-indicator"
          role="status"
        >
          <span aria-hidden="true" /> Loading latest history…
        </div>
      )}
      {status === "streaming" && (
        <div
          aria-label="Pi is working"
          className="thinking-indicator"
          role="status"
        >
          <span aria-hidden="true" /> Pi is working…
        </div>
      )}
    </section>
  );
}

function MeasuredHistoryEntry({
  entry,
  index,
  onMeasured,
}: {
  entry: HistoryEntry;
  index: number;
  onMeasured: (height: number) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const current = element.current;
    if (!current) return;
    const observer = new ResizeObserver(([measurement]) =>
      onMeasured(
        measurement.borderBoxSize[0]?.blockSize ?? current.offsetHeight,
      ),
    );
    observer.observe(current);
    return () => observer.disconnect();
  }, [onMeasured]);
  return (
    <div
      className="virtual-history-entry"
      data-history-index={index}
      ref={element}
    >
      <HistoryEntryView entry={entry} />
    </div>
  );
}

function HistoryEntryView({ entry }: { entry: HistoryEntry }) {
  return entry.kind === "message" ? (
    <article className={`message message-${entry.role}`}>
      <span className="message-avatar">
        {entry.role === "user" ? "You" : "π"}
      </span>
      <div>
        <strong>{entry.role === "user" ? "You" : "Pi"}</strong>
        <div className="markdown">
          <ReactMarkdown>{entry.text}</ReactMarkdown>
        </div>
      </div>
    </article>
  ) : (
    <details
      className={`tool ${entry.isError ? "tool-error" : "tool-success"}`}
    >
      <summary>
        <span aria-hidden="true">⌘</span>
        <span>{entry.name}</span>
        <em>{entry.isError ? "failed" : "completed"}</em>
      </summary>
      <pre>{entry.output || "Running…"}</pre>
    </details>
  );
}

function firstVisibleIndex(offsets: number[], position: number): number {
  let lower = 0;
  let upper = offsets.length - 1;
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    if (offsets[middle] <= position) lower = middle;
    else upper = middle - 1;
  }
  return lower;
}

function historyEntryKey(entry: HistoryEntry, index: number): string {
  return entry.kind === "message"
    ? `message-${index}`
    : `tool-${entry.id}-${index}`;
}

async function initializeAgent(
  client: PiClient,
): Promise<WorkspaceInitialization> {
  await client.startAgent();
  const directory = await client.currentDirectory();
  const metadata = await getSessionMetadata(client, "session-initial-state");
  const sessions = (await client.listSessions()).map(workspaceSession);
  const matchingSession = sessions.find(
    ({ sessionPath }) => sessionPath === metadata.path,
  );
  if (!matchingSession) {
    const activeSession = loadedWorkspaceSession({
      id: metadata.id,
      title: metadata.name || metadata.id,
      path: metadata.path,
    });
    return {
      activeSession,
      directory,
      sessions: [...sessions, activeSession],
    };
  }
  const activeSession = {
    ...matchingSession,
    title: metadata.name || matchingSession.title,
    historyLoaded: true,
    historyLoading: false,
    ...(await getHistory(client, metadata.path)),
  };
  return {
    activeSession,
    directory,
    sessions: sessions.map((session) =>
      session.id === activeSession.id ? activeSession : session,
    ),
  };
}

function workspaceSession(session: PersistedSession): WorkspaceSession {
  return emptyWorkspaceSession(session);
}

function loadedWorkspaceSession(session: PersistedSession): WorkspaceSession {
  return {
    ...emptyWorkspaceSession(session),
    historyLoaded: true,
  };
}

function emptyWorkspaceSession(session: PersistedSession): WorkspaceSession {
  return {
    id: session.id,
    title: session.title,
    sessionPath: session.path,
    historyLoaded: false,
    historyLoading: false,
    historyBefore: 0,
    hasMoreHistory: false,
    persistedMessages: [],
    history: [],
  };
}
async function switchAndLoad(
  client: PiClient,
  session: WorkspaceSession,
  id: string,
): Promise<WorkspaceSession> {
  const switched = client.sendRpc({
    id,
    type: "switch_session",
    sessionPath: session.sessionPath,
  });
  if (session.historyLoaded) {
    assertResponse(await switched, "switch session");
    return session;
  }
  const [response, history] = await Promise.all([
    switched,
    getHistory(client, session.sessionPath),
  ]);
  assertResponse(response, "switch session");
  return {
    ...session,
    historyLoaded: true,
    historyLoading: false,
    ...history,
  };
}

async function getSessionMetadata(
  client: PiClient,
  id: string,
): Promise<{ id: string; path: string; name?: string }> {
  const response = await client.sendRpc({ id, type: "get_state" });
  assertResponse(response, "get session state");
  const data = asRecord(response.data);
  if (typeof data?.sessionFile !== "string")
    throw new Error("Pi did not return an active session file");
  if (typeof data?.sessionId !== "string")
    throw new Error("Pi did not return an active session id");
  return {
    id: data.sessionId,
    path: data.sessionFile,
    name: typeof data.sessionName === "string" ? data.sessionName : undefined,
  };
}

async function getHistory(
  client: PiClient,
  sessionPath: string,
): Promise<
  Pick<
    WorkspaceSession,
    "history" | "historyBefore" | "hasMoreHistory" | "persistedMessages"
  >
> {
  const page = await client.sessionHistory(
    sessionPath,
    Number.MAX_SAFE_INTEGER,
    HISTORY_PAGE_SIZE,
  );
  const history = mapHistory(page.messages);
  return {
    history,
    historyBefore: page.before,
    hasMoreHistory: page.hasMore,
    persistedMessages: page.messages,
  };
}

function mapHistory(messages: unknown[]): HistoryEntry[] {
  const history: HistoryEntry[] = [];
  for (const message of messages) {
    const record = asRecord(message);
    if (!record) continue;
    if (record.role === "user" || record.role === "assistant") {
      const text = messageText(record.content);
      if (text) history.push({ kind: "message", role: record.role, text });
      if (record.role === "assistant" && Array.isArray(record.content))
        for (const block of record.content) {
          const toolCall = asRecord(block);
          if (
            toolCall?.type === "toolCall" &&
            typeof toolCall.id === "string" &&
            typeof toolCall.name === "string"
          )
            history.push({
              kind: "tool",
              id: toolCall.id,
              name: toolCall.name,
              output: "",
              isError: false,
            });
        }
      continue;
    }
    if (record.role !== "toolResult" || typeof record.toolCallId !== "string")
      continue;
    const output = messageText(record.content);
    const index = history.findIndex(
      (entry) => entry.kind === "tool" && entry.id === record.toolCallId,
    );
    if (index !== -1 && history[index].kind === "tool")
      history[index] = {
        ...history[index],
        output,
        isError: record.isError === true,
      };
  }
  return history;
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
function lastMessageText(history: HistoryEntry[]): string | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry.kind === "message") return entry.text;
  }
  return undefined;
}
function appendAssistantText(
  history: HistoryEntry[],
  delta: string,
): HistoryEntry[] {
  const last = history.at(-1);
  return last?.kind === "message" && last.role === "assistant"
    ? [...history.slice(0, -1), { ...last, text: last.text + delta }]
    : [...history, { kind: "message", role: "assistant", text: delta }];
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
    history: session.history.map((entry) =>
      entry.kind === "tool" && entry.id === event.toolCallId
        ? { ...entry, output, isError: event.isError === true }
        : entry,
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
