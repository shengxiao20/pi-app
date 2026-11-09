import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import "katex/dist/katex.min.css";
import mermaid from "mermaid";

import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import type {
  PersistedSession,
  PiClient,
  DataRecord,
  Tag,
  SessionTagAssignment,
  SessionProcessEvent,
} from "./pi-client";
import { webPiClient } from "./pi-client";
import {
  createWorkspaceState,
  isSessionInteractive,
  workspaceReducer,
} from "./workspace-state";

export type ChatStatus =
  | "idle"
  | "starting"
  | "ready"
  | "streaming"
  | "completed"
  | "aborted"
  | "failed";

mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });

type ChatMessage = {
  kind: "message";
  role: "user" | "assistant";
  text: string;
};
type ToolCall = {
  kind: "tool";
  id: string;
  name: string;
  target?: string;
  argumentsJson: string;
  output: string;
  isError: boolean;
  isRunning: boolean;
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
  persistedMessages: DataRecord[];
  history: HistoryEntry[];
};
type WorkspaceInitialization = {
  id: string;
  activeSession?: WorkspaceSession;
  directory: string;
  sessions: WorkspaceSession[];
};
type RenameTarget =
  | { kind: "tag"; tag: Tag }
  | { kind: "session"; session: WorkspaceSession };
type ContextMenu = { kind: "tag"; tag: Tag; x: number; y: number };
type PiCommand = {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill";
};
type PointerDrag = {
  pointerId: number;
  sessionId: string;
  startX: number;
  startY: number;
  isDragging: boolean;
};

type SidebarResize = {
  pointerId: number;
  startWidth: number;
  startX: number;
};

const DEFAULT_SIDEBAR_WIDTH = 280;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 520;
const MIN_WORKSPACE_WIDTH = 360;
const INITIAL_SESSION_ID = "session-initial";
const HISTORY_PAGE_SIZE = 80;

export default function App({ client = webPiClient }: { client?: PiClient }) {
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState("");
  const [commands, setCommands] = useState<PiCommand[]>([]);
  const [commandIndex, setCommandIndex] = useState(0);
  const [showCommands, setShowCommands] = useState(false);
  const [hideToolCalls, setHideToolCalls] = useState(false);
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [assignments, setAssignments] = useState<SessionTagAssignment[]>([]);
  const [expandedTags, setExpandedTags] = useState<Set<string>>(
    () => new Set(["uncategorized"]),
  );
  const [contextMenu, setContextMenu] = useState<ContextMenu>();
  const [renameTarget, setRenameTarget] = useState<RenameTarget>();
  const [renameValue, setRenameValue] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [creatingTag, setCreatingTag] = useState(false);
  const [dropTargetGroupId, setDropTargetGroupId] = useState<string>();
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH, window.innerWidth),
  );
  const sidebarResize = useRef<SidebarResize | undefined>(undefined);
  const pointerDrag = useRef<PointerDrag | undefined>(undefined);
  const pointerDragCleanup = useRef<(() => void) | undefined>(undefined);
  const [notifications, setNotifications] = useState<
    {
      key: string;
      sessionId: string;
      title: string;
      status: string;
      read: boolean;
      createdAt: number;
    }[]
  >([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notifiedGenerations = useRef(new Map<string, string>());
  const [runtimeState, dispatchRuntime] = useReducer(
    workspaceReducer,
    undefined,
    createWorkspaceState,
  );
  const [directory, setDirectory] = useState("");
  const [activeSessionId, setActiveSessionId] = useState(INITIAL_SESSION_ID);
  const activeSessionIdRef = useRef(INITIAL_SESSION_ID);
  const workspaceIdRef = useRef<string | undefined>(undefined);
  const sessionsRef = useRef<WorkspaceSession[]>([]);

  const commandDiscovery = useRef<Promise<void> | undefined>(undefined);
  const loadingOlderSessions = useRef(new Set<string>());

  useEffect(() => {
    function handleViewportResize() {
      setSidebarWidth((width) => clampSidebarWidth(width, window.innerWidth));
    }

    window.addEventListener("resize", handleViewportResize);
    return () => window.removeEventListener("resize", handleViewportResize);
  }, []);

  const startup = useRef<Promise<WorkspaceInitialization> | undefined>(
    undefined,
  );
  const activeSession = sessions.find(({ id }) => id === activeSessionId);
  const activeRuntime = runtimeState.sessions[activeSessionId];
  const sessionStatus = activeRuntime?.status ?? status;
  const sessionError = activeRuntime?.error ?? error;

  function setRuntimeDraft(value: string) {
    setDraft(value);
    dispatchRuntime({
      type: "set-draft",
      sessionId: activeSessionId,
      draft: value,
    });
  }

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    if (!contextMenu && !notificationsOpen) return;
    const closeOverlays = () => {
      setContextMenu(undefined);
      setNotificationsOpen(false);
    };
    window.addEventListener("pointerdown", closeOverlays);
    return () => window.removeEventListener("pointerdown", closeOverlays);
  }, [contextMenu, notificationsOpen]);

  useEffect(() => {
    for (const session of sessions) {
      dispatchRuntime({
        type: "ensure-session",
        session: {
          id: session.id,
          title: session.title,
          sessionPath: session.sessionPath,
        },
      });
    }
  }, [sessions]);

  const handleEvent = useCallback(
    ({ sessionId, runId, event }: SessionProcessEvent) => {
      dispatchRuntime({
        type: "process-event",
        active: activeSessionIdRef.current,
        event: { sessionId, runId, event },
      });
      const terminalStatus = terminalStatusForEvent(
        event as unknown as DataRecord,
      );
      if (
        terminalStatus &&
        sessionId !== activeSessionIdRef.current &&
        notifiedGenerations.current.get(sessionId) !== runId
      ) {
        notifiedGenerations.current.set(sessionId, runId);
        setNotifications((current) => [
          ...current.filter((item) => !item.key.startsWith(`${sessionId}:`)),
          {
            key: `${sessionId}:${runId}`,
            sessionId,
            title:
              sessionsRef.current.find((session) => session.id === sessionId)
                ?.title ?? sessionId,
            status: terminalStatus,
            read: false,
            createdAt: Date.now(),
          },
        ]);
      }
      if (event.type === "RUN_ERROR") {
        if (sessionId === activeSessionIdRef.current) setError(event.message);
        return;
      }
      if (event.type === "TEXT_MESSAGE_CONTENT") {
        updateSession(sessionId, setSessions, (session) => ({
          ...session,
          history: appendAssistantText(session.history, event.delta),
        }));
        return;
      }
      if (event.type === "TOOL_CALL_START") {
        updateSession(sessionId, setSessions, (session) => ({
          ...session,
          history: [
            ...session.history,
            {
              kind: "tool",
              id: event.toolCallId,
              name: event.toolCallName,
              argumentsJson: "",
              output: "",
              isError: false,
              isRunning: true,
            },
          ],
        }));
        return;
      }
      if (event.type === "TOOL_CALL_ARGS") {
        appendToolArguments(
          event.toolCallId,
          event.delta,
          sessionId,
          setSessions,
        );
        return;
      }
      if (event.type === "TOOL_CALL_END") {
        finalizeToolArguments(event.toolCallId, sessionId, setSessions);
        return;
      }
      if (event.type === "TOOL_CALL_RESULT") {
        updateToolResult(event, sessionId, setSessions);
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      setStatus("starting");
      try {
        startup.current ??= initializeWorkspace(client);
        const workspace = await startup.current;
        if (active) {
          workspaceIdRef.current = workspace.id;
          setDirectory(workspace.directory);
          setSessions(workspace.sessions);
          const [nextTags, nextAssignments] = await Promise.all([
            client.listTags(),
            client.listSessionTagAssignments(),
          ]);
          setTags(nextTags);
          setAssignments(nextAssignments);
          activeSessionIdRef.current =
            workspace.activeSession?.id ?? INITIAL_SESSION_ID;
          setActiveSessionId(workspace.activeSession?.id ?? INITIAL_SESSION_ID);
          setStatus("ready");
        }
      } catch (reason) {
        if (active) fail(setError, setStatus, reason);
      }
    })();
    return () => {
      active = false;
    };
  }, [client]);

  async function assignTag(sessionId: string, tagId: number | null) {
    try {
      await client.assignSessionTag(sessionId, tagId);
      setAssignments((current) => [
        ...current.filter((assignment) => assignment.sessionId !== sessionId),
        ...(tagId === null ? [] : [{ sessionId, tagId }]),
      ]);
    } catch (reason) {
      fail(setError, setStatus, reason);
    }
  }

  function beginPointerDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    sessionId: string,
  ) {
    if (event.button > 0) return;
    pointerDragCleanup.current?.();
    const source = event.currentTarget;
    source.setPointerCapture(event.pointerId);
    pointerDrag.current = {
      pointerId: event.pointerId,
      sessionId,
      startX: event.clientX,
      startY: event.clientY,
      isDragging: false,
    };

    function cleanup() {
      source.removeEventListener("pointermove", handlePointerMove);
      source.removeEventListener("pointerup", handlePointerUp);
      source.removeEventListener("pointercancel", handlePointerCancel);
      source.removeEventListener("lostpointercapture", handlePointerCancel);
      if (pointerDragCleanup.current === cleanup)
        pointerDragCleanup.current = undefined;
    }

    function clear() {
      cleanup();
      pointerDrag.current = undefined;
      setDropTargetGroupId(undefined);
    }

    function groupAt(clientX: number, clientY: number): HTMLElement | null {
      return (
        document
          .elementFromPoint(clientX, clientY)
          ?.closest<HTMLElement>("[data-tag-group-id]") ?? null
      );
    }

    function handlePointerMove(moveEvent: PointerEvent) {
      const pointer = pointerDrag.current;
      if (!pointer || moveEvent.pointerId !== pointer.pointerId) return;
      if (
        !pointer.isDragging &&
        Math.hypot(
          moveEvent.clientX - pointer.startX,
          moveEvent.clientY - pointer.startY,
        ) >= 6
      )
        pointer.isDragging = true;
      if (pointer.isDragging)
        setDropTargetGroupId(
          groupAt(moveEvent.clientX, moveEvent.clientY)?.dataset.tagGroupId,
        );
    }

    function handlePointerUp(upEvent: PointerEvent) {
      const pointer = pointerDrag.current;
      if (!pointer || upEvent.pointerId !== pointer.pointerId) return;
      const group = pointer.isDragging
        ? groupAt(upEvent.clientX, upEvent.clientY)
        : null;
      clear();
      if (!group) return;
      const tagId = group.dataset.tagId;
      void assignTag(pointer.sessionId, tagId ? Number(tagId) : null);
    }

    function handlePointerCancel(cancelEvent: PointerEvent) {
      if (pointerDrag.current?.pointerId === cancelEvent.pointerId) clear();
    }

    pointerDragCleanup.current = cleanup;
    source.addEventListener("pointermove", handlePointerMove);
    source.addEventListener("pointerup", handlePointerUp);
    source.addEventListener("pointercancel", handlePointerCancel);
    source.addEventListener("lostpointercapture", handlePointerCancel);
  }

  function beginRename(target: RenameTarget) {
    setRenameTarget(target);
    setRenameValue(
      target.kind === "tag" ? target.tag.name : target.session.title,
    );
    setContextMenu(undefined);
  }

  async function saveRename() {
    if (!renameTarget) return;
    const name = renameValue.trim();
    const original =
      renameTarget.kind === "tag"
        ? renameTarget.tag.name
        : renameTarget.session.title;
    setRenameTarget(undefined);
    if (!name || name === original) return;
    try {
      if (renameTarget.kind === "tag") {
        await client.renameTag(renameTarget.tag.id, name);
        setTags(await client.listTags());
      } else {
        await client.renameSession(renameTarget.session.id, name);
        updateSession(renameTarget.session.id, setSessions, (session) => ({
          ...session,
          title: name,
        }));
      }
    } catch (reason) {
      fail(setError, setStatus, reason);
    }
  }

  async function removeTag(tag: Tag) {
    try {
      await client.deleteTag(tag.id);
      const [nextTags, nextAssignments] = await Promise.all([
        client.listTags(),
        client.listSessionTagAssignments(),
      ]);
      setTags(nextTags);
      setAssignments(nextAssignments);
      setContextMenu(undefined);
    } catch (reason) {
      fail(setError, setStatus, reason);
    }
  }

  async function createTag() {
    const name = newTagName.trim();
    if (!name) return;
    try {
      const tag = await client.createTag(name);
      setTags((current) => [...current, tag]);
      setExpandedTags((current) => new Set(current).add(String(tag.id)));
      setNewTagName("");
      setCreatingTag(false);
    } catch (reason) {
      fail(setError, setStatus, reason);
    }
  }

  async function createSession() {
    if (!isSessionInteractive(activeRuntime)) return;
    try {
      const persisted = await client.createSession();
      const session = loadedWorkspaceSession(persisted);
      setSessions((current) => [...current, session]);
      dispatchRuntime({
        type: "ensure-session",
        session: {
          id: session.id,
          title: session.title,
          sessionPath: session.sessionPath,
        },
      });
      activeSessionIdRef.current = session.id;
      setActiveSessionId(session.id);
      setDraft("");
    } catch (reason) {
      fail(setError, setStatus, reason);
    }
  }

  async function selectSession(session: WorkspaceSession) {
    setNotifications((current) =>
      current.filter((notification) => notification.sessionId !== session.id),
    );
    if (session.id === activeSessionId) return;
    const previousSessionId = activeSessionId;
    try {
      activeSessionIdRef.current = session.id;
      dispatchRuntime({ type: "select-session", sessionId: session.id });
      setDraft(runtimeState.sessions[session.id]?.draft ?? "");
      setActiveSessionId(session.id);
      if (session.historyLoaded) return;
      updateSession(session.id, setSessions, (current) => ({
        ...current,
        historyLoading: true,
      }));
      const history = await getHistory(client, session.id);
      updateSession(session.id, setSessions, (current) => ({
        ...current,
        historyLoaded: true,
        historyLoading: false,
        ...history,
        // Events can arrive before persisted history is loaded; preserve them.
        history: [...history.history, ...current.history],
      }));
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
        session.id,
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

  async function sendPrompt() {
    const message = draft.trim();
    if (!message || !activeSession || !isSessionInteractive(activeRuntime))
      return;
    updateSession(activeSession.id, setSessions, (session) => ({
      ...session,
      history: [
        ...session.history,
        { kind: "message", role: "user", text: message },
      ],
    }));
    setRuntimeDraft("");
    dispatchRuntime({
      type: "set-status",
      sessionId: activeSession.id,
      status: "streaming",
    });
    try {
      await client.runAgent(activeSession.id, message, handleEvent);
    } catch (reason) {
      const record = asRecord(reason);
      const message =
        reason instanceof Error
          ? reason.message
          : typeof record?.message === "string"
            ? record.message
            : String(reason);
      dispatchRuntime({
        type: "set-status",
        sessionId: activeSession.id,
        status: "failed",
        error: message,
      });
      setError(message);
    }
  }

  async function abort() {
    dispatchRuntime({
      type: "set-status",
      sessionId: activeSessionId,
      status: "aborted",
    });
    try {
      await client.abortSession(activeSessionId);
    } catch (reason) {
      fail(setError, setStatus, reason);
    }
  }

  function loadCommands(): Promise<void> {
    if (commandDiscovery.current) return commandDiscovery.current;
    if (!activeSession) {
      return Promise.reject(
        new Error("Select a session before loading commands"),
      );
    }
    commandDiscovery.current = client
      .listCommands(activeSession.id)
      .then(setCommands)
      .catch((reason) => {
        commandDiscovery.current = undefined;
        fail(setError, setStatus, reason);
      });
    return commandDiscovery.current;
  }

  const matchingCommands = showCommands ? matchCommands(commands, draft) : [];
  function selectCommand(command: PiCommand) {
    const value = `/${command.name} `;
    setRuntimeDraft(value);
    setCommandIndex(0);
    setShowCommands(false);
  }

  function beginSidebarResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    sidebarResize.current = {
      pointerId: event.pointerId,
      startWidth: sidebarWidth,
      startX: event.clientX,
    };
  }

  function continueSidebarResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const resize = sidebarResize.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    setSidebarWidth(
      clampSidebarWidth(
        resize.startWidth + event.clientX - resize.startX,
        window.innerWidth,
      ),
    );
  }

  function finishSidebarResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (sidebarResize.current?.pointerId !== event.pointerId) return;
    sidebarResize.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function resizeSidebarWithKeyboard(
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) {
    const maximum = sidebarMaximum(window.innerWidth);
    let nextWidth: number;
    switch (event.key) {
      case "ArrowLeft":
        nextWidth = sidebarWidth - 16;
        break;
      case "ArrowRight":
        nextWidth = sidebarWidth + 16;
        break;
      case "Home":
        nextWidth = MIN_SIDEBAR_WIDTH;
        break;
      case "End":
        nextWidth = maximum;
        break;
      default:
        return;
    }
    event.preventDefault();
    setSidebarWidth(clampSidebarWidth(nextWidth, window.innerWidth));
  }

  return (
    <main
      className="app-shell"
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <aside className="sidebar">
        <div className="brand" aria-label="Pi App">
          <span className="brand-mark" aria-hidden="true">
            π
          </span>
          <span>PI APP</span>
          <section className="notification-center" aria-label="Notifications">
            <button
              aria-expanded={notificationsOpen}
              aria-label={`Notifications: ${notifications.filter((item) => !item.read).length} unread`}
              className="notification-toggle"
              onClick={(event) => {
                event.stopPropagation();
                setNotificationsOpen((open) => !open);
              }}
              type="button"
            >
              <NotificationIcon />
              <span className="notification-count">
                {notifications.filter((item) => !item.read).length}
              </span>
            </button>
            {notificationsOpen && (
              <div
                onPointerDown={(event) => event.stopPropagation()}
                role="list"
              >
                {notifications.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => {
                      const session = sessions.find(
                        ({ id }) => id === item.sessionId,
                      );
                      if (session) void selectSession(session);
                      setNotificationsOpen(false);
                    }}
                    role="listitem"
                    type="button"
                  >
                    {item.title}: {item.status}
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
        <nav aria-label="Workspace navigation" className="workspace-navigation">
          <button
            className="new-session"
            disabled={!isSessionInteractive(activeRuntime)}
            onClick={() => void createSession()}
            type="button"
          >
            <span aria-hidden="true">+</span> New chat
          </button>
          <section
            className="workspace-heading"
            aria-labelledby="workspace-heading"
          >
            <h2 id="workspace-heading">Workspace</h2>
            <p className="current-directory" title={directory}>
              {directory || "No workspace selected"}
            </p>
          </section>
          <section
            className="navigation-section recents"
            aria-labelledby="recents-heading"
          >
            <div className="tag-list-heading">
              <h2 id="recents-heading">Tags</h2>
              <button
                aria-label="Create tag"
                aria-expanded={creatingTag}
                className="create-tag"
                onClick={() => setCreatingTag(true)}
                type="button"
              >
                <PlusIcon />
              </button>
            </div>
            <div className="session-list">
              {creatingTag && (
                <form
                  className="new-tag-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void createTag();
                  }}
                >
                  <label className="sr-only" htmlFor="new-tag-name">
                    New tag name
                  </label>
                  <input
                    autoFocus
                    id="new-tag-name"
                    onChange={(event) => setNewTagName(event.target.value)}
                    placeholder="New tag"
                    value={newTagName}
                  />
                  <button aria-label="Add tag" type="submit">
                    <PlusIcon />
                  </button>
                  <button
                    aria-label="Cancel new tag"
                    onClick={() => {
                      setNewTagName("");
                      setCreatingTag(false);
                    }}
                    type="button"
                  >
                    ×
                  </button>
                </form>
              )}
              {!sessions.length && (
                <p className="empty-projects">No sessions in this workspace.</p>
              )}
              {groupedSessions(tags, assignments, sessions).map((group) => (
                <section
                  className={`tag-group${
                    dropTargetGroupId === group.id ? " is-drop-target" : ""
                  }`}
                  data-tag-group-id={group.id}
                  data-tag-id={group.tag?.id}
                  key={group.id}
                >
                  <div
                    className="tag-row"
                    onContextMenu={(event) => {
                      if (!group.tag) return;
                      event.preventDefault();
                      setContextMenu({
                        kind: "tag",
                        tag: group.tag,
                        x: event.clientX,
                        y: event.clientY,
                      });
                    }}
                  >
                    {renameTarget?.kind === "tag" &&
                    renameTarget.tag.id === group.tag?.id ? (
                      <input
                        aria-label={`Rename tag ${group.name}`}
                        autoFocus
                        className="inline-rename"
                        onBlur={() => void saveRename()}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void saveRename();
                          if (event.key === "Escape")
                            setRenameTarget(undefined);
                        }}
                        value={renameValue}
                      />
                    ) : (
                      <button
                        aria-expanded={expandedTags.has(group.id)}
                        aria-label={`${expandedTags.has(group.id) ? "Collapse" : "Expand"} ${group.name}`}
                        className="tag-toggle"
                        onClick={() =>
                          setExpandedTags((current) => {
                            const next = new Set(current);
                            if (next.has(group.id)) next.delete(group.id);
                            else next.add(group.id);
                            return next;
                          })
                        }
                        type="button"
                      >
                        <span aria-hidden="true">
                          {expandedTags.has(group.id) ? "⌄" : "›"}
                        </span>
                        {group.name}
                      </button>
                    )}
                  </div>
                  {expandedTags.has(group.id) &&
                    group.sessions.map((session) => (
                      <div className="session-item" key={session.id}>
                        <button
                          aria-current={
                            session.id === activeSessionId ? "page" : undefined
                          }
                          className="session-select"
                          onPointerDown={(event) =>
                            beginPointerDrag(event, session.id)
                          }
                          onClick={() => void selectSession(session)}
                          type="button"
                        >
                          <StatusIcon
                            status={
                              runtimeState.sessions[session.id]?.status ??
                              "idle"
                            }
                          />
                          <span className="session-copy">
                            {renameTarget?.kind === "session" &&
                            renameTarget.session.id === session.id ? (
                              <input
                                aria-label={`Rename session ${session.title}`}
                                autoFocus
                                className="inline-rename"
                                onBlur={() => void saveRename()}
                                onChange={(event) =>
                                  setRenameValue(event.target.value)
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") void saveRename();
                                  if (event.key === "Escape")
                                    setRenameTarget(undefined);
                                }}
                                onClick={(event) => event.stopPropagation()}
                                value={renameValue}
                              />
                            ) : (
                              <strong>{session.title}</strong>
                            )}
                            {runtimeState.sessions[session.id]?.unread && (
                              <span
                                aria-label="Unread updates"
                                className="session-unread"
                              />
                            )}
                            <small>
                              {lastMessageText(session.history) ||
                                "Empty conversation"}
                            </small>
                          </span>
                        </button>
                        <div className="session-actions">
                          <button
                            aria-label={`Rename session ${session.title}`}
                            className="rename-session"
                            onClick={() =>
                              beginRename({ kind: "session", session })
                            }
                            type="button"
                          >
                            <svg
                              aria-hidden="true"
                              fill="none"
                              viewBox="0 0 24 24"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <path
                                d="m4 16.5-.5 4 4-.5L19 8.5 15.5 5 4 16.5Z"
                                stroke="currentColor"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="1.7"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                </section>
              ))}
            </div>
          </section>
        </nav>
      </aside>
      <button
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        aria-valuemax={sidebarMaximum(window.innerWidth)}
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuenow={sidebarWidth}
        className="sidebar-resize-handle"
        onKeyDown={resizeSidebarWithKeyboard}
        onLostPointerCapture={() => {
          sidebarResize.current = undefined;
        }}
        onPointerCancel={finishSidebarResize}
        onPointerDown={beginSidebarResize}
        onPointerMove={continueSidebarResize}
        onPointerUp={finishSidebarResize}
        role="separator"
        type="button"
      />
      <section className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">CONVERSATION</p>
            <h1>{activeSession?.title || "Connecting to Pi"}</h1>
          </div>
          <button
            aria-pressed={hideToolCalls}
            className="tool-visibility-toggle"
            onClick={() => setHideToolCalls((hidden) => !hidden)}
            type="button"
          >
            {hideToolCalls ? "Show tool calls" : "Hide tool calls"}
          </button>
        </header>
        {sessionError && <p role="alert">{sessionError}</p>}
        <Conversation
          hasMoreHistory={activeSession?.hasMoreHistory ?? false}
          history={activeSession?.history ?? []}
          historyLoading={activeSession?.historyLoading ?? false}
          hideToolCalls={hideToolCalls}
          key={activeSessionId}
          onLoadOlder={loadOlderHistory}
          status={sessionStatus}
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
            aria-autocomplete="list"
            aria-activedescendant={
              matchingCommands.length
                ? `slash-command-${commandIndex}`
                : undefined
            }
            aria-controls="slash-commands"
            aria-expanded={matchingCommands.length > 0}
            disabled={!isSessionInteractive(activeRuntime)}
            id="prompt"
            onChange={(event) => {
              const value = event.target.value;
              setRuntimeDraft(value);
              setCommandIndex(0);
              setShowCommands(value.startsWith("/"));
              if (value.startsWith("/")) void loadCommands();
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !matchingCommands.length
              ) {
                event.preventDefault();
                void sendPrompt();
                return;
              }
              if (!matchingCommands.length) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setCommandIndex(
                  (index) => (index + 1) % matchingCommands.length,
                );
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setCommandIndex(
                  (index) =>
                    (index + matchingCommands.length - 1) %
                    matchingCommands.length,
                );
              }
              if (event.key === "Enter") {
                event.preventDefault();
                selectCommand(
                  matchingCommands[commandIndex] ?? matchingCommands[0],
                );
              }
              if (event.key === "Escape") setShowCommands(false);
            }}
            placeholder="Message Pi about this workspace…"
            role="combobox"
            value={draft}
          />
          {matchingCommands.length > 0 && (
            <ul
              aria-label="Pi commands"
              className="slash-commands"
              id="slash-commands"
              role="listbox"
            >
              {matchingCommands.map((command, index) => (
                <li
                  aria-selected={index === commandIndex}
                  id={`slash-command-${index}`}
                  key={command.name}
                  role="option"
                >
                  <button onClick={() => selectCommand(command)} type="button">
                    <strong>/{command.name}</strong>
                    {command.description && <span>{command.description}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="composer-footer">
            {sessionStatus === "streaming" ? (
              <button
                aria-label="Stop generating"
                className="composer-action composer-stop"
                onClick={() => void abort()}
                type="button"
              >
                <svg aria-hidden="true" viewBox="0 0 16 16">
                  <rect height="8" rx="1" width="8" x="4" y="4" />
                </svg>
              </button>
            ) : (
              <button
                aria-label="Send message"
                className="composer-action composer-send"
                disabled={!isSessionInteractive(activeRuntime) || !draft.trim()}
                type="submit"
              >
                <svg aria-hidden="true" viewBox="0 0 16 16">
                  <path d="m3 8 10-5-3 10-2-4-5-1Z" />
                </svg>
              </button>
            )}
          </div>
        </form>
      </section>

      {contextMenu && (
        <div
          aria-label={`${contextMenu.kind} actions`}
          className="context-menu"
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => beginRename({ kind: "tag", tag: contextMenu.tag })}
            role="menuitem"
            type="button"
          >
            Rename
          </button>
          <button
            onClick={() => void removeTag(contextMenu.tag)}
            role="menuitem"
            type="button"
          >
            Remove tag
          </button>
        </div>
      )}
    </main>
  );
}

function matchCommands(commands: PiCommand[], draft: string): PiCommand[] {
  if (!draft.startsWith("/") || /\s/.test(draft)) return [];
  const query = draft.slice(1).toLowerCase();
  return commands.filter(({ name }) => name.toLowerCase().includes(query));
}

function Conversation({
  history,
  status,
  hasMoreHistory,
  historyLoading,
  hideToolCalls,
  onLoadOlder,
}: {
  history: HistoryEntry[];
  status: ChatStatus;
  hasMoreHistory: boolean;
  historyLoading: boolean;
  hideToolCalls: boolean;
  onLoadOlder: () => void;
}) {
  const conversation = useRef<HTMLElement>(null);
  const positionedAtLatest = useRef(false);

  useLayoutEffect(() => {
    if (historyLoading || !history.length || positionedAtLatest.current) return;
    conversation.current!.scrollTop = conversation.current!.scrollHeight;
    positionedAtLatest.current = true;
  }, [history.length, historyLoading]);

  return (
    <section
      aria-label="Conversation"
      className="conversation"
      ref={conversation}
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
      {hasMoreHistory && (
        <button
          className="load-older-history"
          disabled={historyLoading}
          onClick={onLoadOlder}
          type="button"
        >
          {historyLoading
            ? "Loading earlier messages…"
            : "Load earlier messages"}
        </button>
      )}
      <div className="history">
        {history.map(
          (entry, index) =>
            (!hideToolCalls || entry.kind === "message") && (
              <HistoryEntryView
                entry={entry}
                key={historyEntryKey(entry, index)}
              />
            ),
        )}
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

function HistoryEntryView({ entry }: { entry: HistoryEntry }) {
  return entry.kind === "message" ? (
    <article className={`message message-${entry.role}`}>
      <span className="message-avatar">
        {entry.role === "user" ? "You" : "π"}
      </span>
      <div>
        <strong>{entry.role === "user" ? "You" : "Pi"}</strong>
        <div className="markdown">
          <ReactMarkdown
            components={{
              code({ children, className, ...props }) {
                const language = /language-(\S+)/.exec(className ?? "")?.[1];
                if (language === "mermaid")
                  return <MermaidDiagram chart={String(children).trim()} />;
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              },
            }}
            rehypePlugins={[rehypeKatex]}
            remarkPlugins={[remarkGfm, remarkMath]}
          >
            {normalizeMarkdown(normalizeMath(entry.text))}
          </ReactMarkdown>
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
        {entry.target && <code>{entry.target}</code>}
        <em>
          {entry.isRunning ? "running" : entry.isError ? "failed" : "completed"}
        </em>
      </summary>
      <pre>{entry.output || "Running…"}</pre>
    </details>
  );
}

function MermaidDiagram({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const diagramId = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  useEffect(() => {
    let disposed = false;
    const container = containerRef.current;
    if (!container) return;

    container.replaceChildren();
    void mermaid
      .render(`mermaid-${diagramId}`, chart)
      .then(({ svg, bindFunctions }) => {
        if (disposed || !containerRef.current) return;
        containerRef.current.innerHTML = svg;
        bindFunctions?.(containerRef.current);
      })
      .catch((error: unknown) =>
        console.error("Could not render Mermaid diagram", error),
      );

    return () => {
      disposed = true;
    };
  }, [chart, diagramId]);

  return (
    <div
      aria-label="Mermaid diagram"
      className="mermaid-diagram"
      ref={containerRef}
    />
  );
}

function historyEntryKey(entry: HistoryEntry, index: number): string {
  return entry.kind === "message"
    ? `message-${index}`
    : `tool-${entry.id}-${index}`;
}

async function initializeWorkspace(
  client: PiClient,
): Promise<WorkspaceInitialization> {
  const workspace = await client.currentWorkspace();
  const sessions = (await client.listSessions()).map(workspaceSession);
  const activeSession =
    sessions.find((session) => session.id === "terminal-id") ?? sessions[0];
  if (!activeSession)
    return { id: workspace.id, directory: workspace.path, sessions };
  const loaded = {
    ...activeSession,
    historyLoaded: true,
    historyLoading: false,
    ...(await getHistory(client, activeSession.id)),
  };
  return {
    id: workspace.id,
    activeSession: loaded,
    directory: workspace.path,
    sessions: sessions.map((session) =>
      session.id === loaded.id ? loaded : session,
    ),
  };
}

function StatusIcon({ status }: { status: string }) {
  const label = `Session status: ${status}`;
  if (status === "streaming" || status === "starting")
    return (
      <svg
        aria-label={label}
        className="session-status is-running"
        viewBox="0 0 16 16"
      >
        <path d="M5 3.5 12 8l-7 4.5Z" />
      </svg>
    );
  if (status === "completed")
    return (
      <svg
        aria-label={label}
        className="session-status is-completed"
        viewBox="0 0 16 16"
      >
        <path d="m3.5 8 2.7 2.7 6.3-6.1" />
      </svg>
    );
  if (status === "failed")
    return (
      <svg
        aria-label={label}
        className="session-status is-failed"
        viewBox="0 0 16 16"
      >
        <path d="M4 4l8 8m0-8-8 8" />
      </svg>
    );
  if (status === "aborted")
    return (
      <svg
        aria-label={label}
        className="session-status is-aborted"
        viewBox="0 0 16 16"
      >
        <path d="M5 5h6v6H5z" />
      </svg>
    );
  return <span aria-label={label} className="session-status is-idle" />;
}

function sidebarMaximum(viewportWidth: number): number {
  return Math.max(
    MIN_SIDEBAR_WIDTH,
    Math.min(MAX_SIDEBAR_WIDTH, viewportWidth - MIN_WORKSPACE_WIDTH),
  );
}

function clampSidebarWidth(width: number, viewportWidth: number): number {
  return Math.min(
    sidebarMaximum(viewportWidth),
    Math.max(MIN_SIDEBAR_WIDTH, width),
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function NotificationIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M5 11.5h6M6 13h4M5 11.5c.8-.8 1-1.8 1-3.2 0-2 .8-3.3 2-3.3s2 1.3 2 3.3c0 1.4.2 2.4 1 3.2" />
    </svg>
  );
}

function terminalStatusForEvent(event: DataRecord): string | undefined {
  if (event.type === "RUN_ERROR") return "failed";
  if (event.type === "RUN_FINISHED") {
    const outcome = asRecord(event.outcome);
    return outcome?.type === "cancelled" ? "aborted" : "completed";
  }
  return undefined;
}

function groupedSessions(
  tags: Tag[],
  assignments: SessionTagAssignment[],
  sessions: WorkspaceSession[],
): { id: string; name: string; tag?: Tag; sessions: WorkspaceSession[] }[] {
  const tagBySession = new Map(
    assignments.map((item) => [item.sessionId, item.tagId]),
  );
  const groups = [
    ...tags.map((tag) => ({
      id: String(tag.id),
      name: tag.name,
      tag,
      sessions: [] as WorkspaceSession[],
    })),
    {
      id: "uncategorized",
      name: "Uncategorized",
      sessions: [] as WorkspaceSession[],
    },
  ];
  const byId = new Map(groups.map((group) => [group.id, group]));
  for (const session of sessions) {
    const group = byId.get(
      String(tagBySession.get(session.id) ?? "uncategorized"),
    );
    (group ?? groups.at(-1)!).sessions.push(session);
  }
  return groups;
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
async function getHistory(
  client: PiClient,
  sessionId: string,
): Promise<
  Pick<
    WorkspaceSession,
    "history" | "historyBefore" | "hasMoreHistory" | "persistedMessages"
  >
> {
  const page = await client.sessionHistory(
    sessionId,
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
              target: toolTarget(toolCall.name, toolCall.arguments),
              argumentsJson: JSON.stringify(toolCall.arguments),
              output: "",
              isError: false,
              isRunning: true,
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
        isRunning: false,
      };
  }
  return history;
}
function normalizeMath(text: string): string {
  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, "$$\n$1\n$$")
    .replace(/\\\(([\s\S]*?)\\\)/g, "$$$1$$");
}

function normalizeMarkdown(text: string): string {
  const delimiter = /\|(?:\s*:?-{3,}:?\s*\|)+/;
  const match = delimiter.exec(text);
  if (!match) return text;

  const tableStart = text.lastIndexOf("\n", match.index) + 1;
  const beforeTable = text.slice(0, tableStart);
  const flattenedTable = text.slice(tableStart).trim();
  if (flattenedTable.includes("\n")) return text;

  const columnCount = match[0].split("|").filter(Boolean).length;
  const cells = flattenedTable
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean);
  if (cells.length < columnCount * 2) return text;

  const rows = cells
    .filter((_, index) => index < columnCount || index >= columnCount * 2)
    .reduce<string[]>((result, cell, index) => {
      if (index % columnCount === 0) result.push("");
      result[result.length - 1] += `| ${cell} `;
      return result;
    }, [])
    .map((row) => `${row}|`);

  return `${beforeTable}${rows[0]}\n${match[0]}\n${rows.slice(1).join("\n")}`;
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
function appendToolArguments(
  toolCallId: string,
  delta: string,
  sessionId: string,
  setSessions: React.Dispatch<React.SetStateAction<WorkspaceSession[]>>,
) {
  updateSession(sessionId, setSessions, (session) => ({
    ...session,
    history: session.history.map((entry) =>
      entry.kind === "tool" && entry.id === toolCallId
        ? { ...entry, argumentsJson: entry.argumentsJson + delta }
        : entry,
    ),
  }));
}
function finalizeToolArguments(
  toolCallId: string,
  sessionId: string,
  setSessions: React.Dispatch<React.SetStateAction<WorkspaceSession[]>>,
) {
  updateSession(sessionId, setSessions, (session) => ({
    ...session,
    history: session.history.map((entry) =>
      entry.kind === "tool" && entry.id === toolCallId
        ? {
            ...entry,
            target: toolTarget(entry.name, JSON.parse(entry.argumentsJson)),
          }
        : entry,
    ),
  }));
}
function updateToolResult(
  event: { toolCallId: string; content: unknown; error?: string },
  sessionId: string,
  setSessions: React.Dispatch<React.SetStateAction<WorkspaceSession[]>>,
) {
  const output = messageText(event.content);
  updateSession(sessionId, setSessions, (session) => ({
    ...session,
    history: session.history.map((entry) =>
      entry.kind === "tool" && entry.id === event.toolCallId
        ? {
            ...entry,
            output,
            isError: typeof event.error === "string",
            isRunning: false,
          }
        : entry,
    ),
  }));
}
function toolTarget(name: unknown, args: unknown): string | undefined {
  const values = asRecord(args);
  if (!values || typeof name !== "string") return undefined;
  if (
    (name === "read" || name === "edit" || name === "write") &&
    typeof values.path === "string"
  )
    return values.path;
  if (name === "bash" && typeof values.command === "string")
    return values.command;
  return undefined;
}
function asRecord(value: unknown): DataRecord | undefined {
  return typeof value === "object" && value !== null
    ? (value as DataRecord)
    : undefined;
}
function fail(
  setError: React.Dispatch<React.SetStateAction<string | undefined>>,
  setStatus: React.Dispatch<React.SetStateAction<ChatStatus>>,
  reason: unknown,
) {
  const message = asRecord(reason)?.message;
  setError(
    reason instanceof Error
      ? reason.message
      : typeof message === "string"
        ? message
        : String(reason),
  );
  setStatus("failed");
}
