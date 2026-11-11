import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent as ReactClipboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type {
  PersistedSession,
  PiClient,
  DataRecord,
  Tag,
  SessionTagAssignment,
  SessionProcessEvent,
} from "./pi-client";
import { webPiClient } from "./pi-client";
import { insertClipboardPaths } from "./clipboard";
import {
  PI_NOTIFICATION_EVENT,
  parsePiNotification,
} from "../shared/extension-feedback";
import Conversation from "./conversation/Conversation";
import type { ChatStatus, HistoryEntry } from "./conversation/types";
import {
  canCreateSession,
  createWorkspaceState,
  isSessionInteractive,
  workspaceReducer,
} from "./workspace-state";
import type {
  ContextMenu,
  RenameTarget,
  WorkspaceSession,
} from "./workspace/types";
import WorkspaceNavigation from "./workspace/WorkspaceNavigation";

export type { ChatStatus } from "./conversation/types";
type WorkspaceInitialization = {
  id: string;
  activeSession?: WorkspaceSession;
  directory: string;
  sessions: WorkspaceSession[];
};
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
  const [pastingImages, setPastingImages] = useState(false);
  const [changingWorkspace, setChangingWorkspace] = useState(false);
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
  const sessionsRef = useRef<WorkspaceSession[]>([]);
  const workspaceEpochRef = useRef(0);

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
  const conversationTitle =
    activeSession?.title ??
    (status === "idle" || status === "starting"
      ? "Connecting to Pi"
      : "New chat");

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
      if (event.type === "CUSTOM" && event.name === PI_NOTIFICATION_EVENT) {
        const notice = parsePiNotification(event.value);
        updateSession(sessionId, setSessions, (session) => ({
          ...session,
          history: [...session.history, { kind: "notification", ...notice }],
        }));
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
    const workspaceEpoch = workspaceEpochRef.current;
    void (async () => {
      setStatus("starting");
      try {
        startup.current ??= initializeWorkspace(client);
        const workspace = await startup.current;
        if (!active || workspaceEpoch !== workspaceEpochRef.current) return;
        setDirectory(workspace.directory);
        setSessions(workspace.sessions);
        const [nextTags, nextAssignments] = await Promise.all([
          client.listTags(),
          client.listSessionTagAssignments(),
        ]);
        if (!active || workspaceEpoch !== workspaceEpochRef.current) return;
        setTags(nextTags);
        setAssignments(nextAssignments);
        activeSessionIdRef.current =
          workspace.activeSession?.id ?? INITIAL_SESSION_ID;
        setActiveSessionId(workspace.activeSession?.id ?? INITIAL_SESSION_ID);
        setStatus("ready");
      } catch (reason) {
        if (active && workspaceEpoch === workspaceEpochRef.current)
          fail(setError, setStatus, reason);
      }
    })();
    return () => {
      active = false;
    };
  }, [client]);

  async function assignTag(sessionId: string, tagId: number | null) {
    const workspaceEpoch = workspaceEpochRef.current;
    try {
      await client.assignSessionTag(sessionId, tagId);
      if (workspaceEpoch !== workspaceEpochRef.current) return;
      setAssignments((current) => [
        ...current.filter((assignment) => assignment.sessionId !== sessionId),
        ...(tagId === null ? [] : [{ sessionId, tagId }]),
      ]);
    } catch (reason) {
      if (workspaceEpoch === workspaceEpochRef.current)
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
    const workspaceEpoch = workspaceEpochRef.current;
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
        const nextTags = await client.listTags();
        if (workspaceEpoch !== workspaceEpochRef.current) return;
        setTags(nextTags);
      } else {
        await client.renameSession(renameTarget.session.id, name);
        if (workspaceEpoch !== workspaceEpochRef.current) return;
        updateSession(renameTarget.session.id, setSessions, (session) => ({
          ...session,
          title: name,
        }));
      }
    } catch (reason) {
      if (workspaceEpoch === workspaceEpochRef.current)
        fail(setError, setStatus, reason);
    }
  }

  async function removeTag(tag: Tag) {
    const workspaceEpoch = workspaceEpochRef.current;
    try {
      await client.deleteTag(tag.id);
      const [nextTags, nextAssignments] = await Promise.all([
        client.listTags(),
        client.listSessionTagAssignments(),
      ]);
      if (workspaceEpoch !== workspaceEpochRef.current) return;
      setTags(nextTags);
      setAssignments(nextAssignments);
      setContextMenu(undefined);
    } catch (reason) {
      if (workspaceEpoch === workspaceEpochRef.current)
        fail(setError, setStatus, reason);
    }
  }

  async function createTag() {
    const name = newTagName.trim();
    if (!name) return;
    const workspaceEpoch = workspaceEpochRef.current;
    try {
      const tag = await client.createTag(name);
      if (workspaceEpoch !== workspaceEpochRef.current) return;
      setTags((current) => [...current, tag]);
      setExpandedTags((current) => new Set(current).add(String(tag.id)));
      setNewTagName("");
      setCreatingTag(false);
    } catch (reason) {
      if (workspaceEpoch === workspaceEpochRef.current)
        fail(setError, setStatus, reason);
    }
  }

  async function chooseWorkspace() {
    if (changingWorkspace) return;
    let workspaceEpoch = workspaceEpochRef.current;
    setChangingWorkspace(true);
    setError(undefined);
    try {
      const selected = await client.selectWorkspace();
      if (!selected) return;
      workspaceEpochRef.current += 1;
      workspaceEpoch = workspaceEpochRef.current;
      setError(undefined);
      if (activeRuntime?.status === "streaming") {
        dispatchRuntime({
          type: "set-status",
          sessionId: activeSessionIdRef.current,
          status: "completed",
        });
      }
      activeSessionIdRef.current = INITIAL_SESSION_ID;
      setActiveSessionId(INITIAL_SESSION_ID);
      setDirectory(selected.path);
      setSessions([]);
      setTags([]);
      setAssignments([]);
      setDraft("");
      setCommands([]);
      setCommandIndex(0);
      setShowCommands(false);
      setCreatingTag(false);
      setNewTagName("");
      setNotifications([]);
      setNotificationsOpen(false);
      notifiedGenerations.current.clear();
      commandDiscovery.current = undefined;
      setContextMenu(undefined);
      setRenameTarget(undefined);
      setExpandedTags(new Set(["uncategorized"]));
      const [workspace, nextTags, nextAssignments] = await Promise.all([
        initializeWorkspace(client),
        client.listTags(),
        client.listSessionTagAssignments(),
      ]);
      if (workspaceEpoch !== workspaceEpochRef.current) return;
      setDirectory(workspace.directory);
      setSessions(workspace.sessions);
      setTags(nextTags);
      setAssignments(nextAssignments);
      const nextSessionId = workspace.activeSession?.id ?? INITIAL_SESSION_ID;
      activeSessionIdRef.current = nextSessionId;
      setActiveSessionId(nextSessionId);
      setDraft(runtimeState.sessions[nextSessionId]?.draft ?? "");
      setStatus("ready");
    } catch (reason) {
      if (workspaceEpoch === workspaceEpochRef.current)
        fail(setError, setStatus, reason);
    } finally {
      setChangingWorkspace(false);
    }
  }

  async function createSession() {
    if (changingWorkspace || !canCreateSession(status, activeRuntime)) return;
    const workspaceEpoch = workspaceEpochRef.current;
    try {
      const persisted = await client.createSession();
      if (workspaceEpoch !== workspaceEpochRef.current) return;
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
      if (workspaceEpoch === workspaceEpochRef.current)
        fail(setError, setStatus, reason);
    }
  }

  async function selectSession(session: WorkspaceSession) {
    const workspaceEpoch = workspaceEpochRef.current;
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
      if (workspaceEpoch !== workspaceEpochRef.current) return;
      updateSession(session.id, setSessions, (current) => ({
        ...current,
        historyLoaded: true,
        historyLoading: false,
        ...history,
        // Events can arrive before persisted history is loaded; preserve them.
        history: [...history.history, ...current.history],
      }));
    } catch (reason) {
      if (workspaceEpoch !== workspaceEpochRef.current) return;
      activeSessionIdRef.current = previousSessionId;
      setActiveSessionId(previousSessionId);
      fail(setError, setStatus, reason);
    }
  }

  async function loadOlderHistory() {
    const workspaceEpoch = workspaceEpochRef.current;
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
      if (workspaceEpoch !== workspaceEpochRef.current) return;
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
          history: [
            ...mapHistory(persistedMessages),
            ...current.history.filter((entry) => entry.kind === "notification"),
          ],
        };
      });
    } catch (reason) {
      if (workspaceEpoch === workspaceEpochRef.current) {
        fail(setError, setStatus, reason);
        updateSession(session.id, setSessions, (current) => ({
          ...current,
          historyLoading: false,
        }));
      }
    } finally {
      loadingOlderSessions.current.delete(session.id);
    }
  }

  async function pasteImages(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const images = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!images.length) return;
    event.preventDefault();
    if (
      pastingImages ||
      changingWorkspace ||
      !isSessionInteractive(activeRuntime)
    )
      return;
    const sessionId = activeSessionId;
    const workspaceEpoch = workspaceEpochRef.current;
    const textarea = event.currentTarget;
    const original = textarea.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    setPastingImages(true);
    setShowCommands(false);
    try {
      const paths = await Promise.all(
        images.map((image) => client.saveClipboardImage(image)),
      );
      if (workspaceEpoch !== workspaceEpochRef.current) return;
      const insertion = insertClipboardPaths(original, start, end, paths);
      dispatchRuntime({ type: "set-draft", sessionId, draft: insertion.text });
      if (activeSessionIdRef.current === sessionId) {
        setDraft(insertion.text);
        requestAnimationFrame(() => {
          if (activeSessionIdRef.current !== sessionId) return;
          textarea.focus();
          textarea.setSelectionRange(insertion.cursor, insertion.cursor);
        });
      }
    } catch (reason) {
      if (workspaceEpoch !== workspaceEpochRef.current) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      dispatchRuntime({
        type: "set-status",
        sessionId,
        status: "failed",
        error: message,
      });
      if (activeSessionIdRef.current === sessionId) setError(message);
    } finally {
      setPastingImages(false);
    }
  }

  async function sendPrompt() {
    const message = draft.trim();
    if (
      !message ||
      !activeSession ||
      changingWorkspace ||
      pastingImages ||
      !isSessionInteractive(activeRuntime)
    )
      return;
    setError(undefined);
    const workspaceEpoch = workspaceEpochRef.current;
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
      await client.runAgent(activeSession.id, message, (event) => {
        if (workspaceEpoch === workspaceEpochRef.current) handleEvent(event);
      });
    } catch (reason) {
      if (workspaceEpoch !== workspaceEpochRef.current) return;
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
    const workspaceEpoch = workspaceEpochRef.current;
    dispatchRuntime({
      type: "set-status",
      sessionId: activeSessionId,
      status: "aborted",
    });
    try {
      await client.abortSession(activeSessionId);
    } catch (reason) {
      if (workspaceEpoch === workspaceEpochRef.current)
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
    const workspaceEpoch = workspaceEpochRef.current;
    const sessionId = activeSession.id;
    commandDiscovery.current = client
      .listCommands(sessionId)
      .then((nextCommands) => {
        if (workspaceEpoch === workspaceEpochRef.current)
          setCommands(nextCommands);
      })
      .catch((reason) => {
        if (workspaceEpoch !== workspaceEpochRef.current) return;
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
        <WorkspaceNavigation
          state={{
            changingWorkspace,
            canCreateSession: canCreateSession(status, activeRuntime),
            directory,
            sessions,
            tags,
            assignments,
            runtimeSessions: runtimeState.sessions,
            activeSessionId,
            creatingTag,
            newTagName,
            expandedTags,
            dropTargetGroupId,
            renameTarget,
            renameValue,
          }}
          actions={{
            createSession: () => void createSession(),
            chooseWorkspace: () => void chooseWorkspace(),
            startTagCreation: () => setCreatingTag(true),
            createTag: () => void createTag(),
            cancelTagCreation: () => {
              setNewTagName("");
              setCreatingTag(false);
            },
            changeNewTagName: setNewTagName,
            toggleTag: (groupId) =>
              setExpandedTags((current) => {
                const next = new Set(current);
                if (next.has(groupId)) next.delete(groupId);
                else next.add(groupId);
                return next;
              }),
            setTagContextMenu: (tag, x, y) =>
              setContextMenu({ kind: "tag", tag, x, y }),
            selectSession: (session) => void selectSession(session),
            beginPointerDrag,
            beginRename,
            saveRename: () => void saveRename(),
            changeRenameValue: setRenameValue,
            cancelRename: () => setRenameTarget(undefined),
          }}
        />
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
      <section
        aria-busy={changingWorkspace}
        className="workspace"
        inert={changingWorkspace}
      >
        <header className="workspace-header">
          <div className="workspace-title">
            <p className="eyebrow">CONVERSATION</p>
            <h1 title={conversationTitle}>{conversationTitle}</h1>
          </div>
          <div
            aria-label="Conversation display"
            className="workspace-toolbar"
            role="toolbar"
          >
            <label className="tool-visibility-toggle">
              <input
                checked={!hideToolCalls}
                onChange={(event) => setHideToolCalls(!event.target.checked)}
                type="checkbox"
              />
              <span>Show tool calls</span>
            </label>
          </div>
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
            disabled={
              changingWorkspace ||
              pastingImages ||
              !isSessionInteractive(activeRuntime)
            }
            id="prompt"
            onChange={(event) => {
              const value = event.target.value;
              setRuntimeDraft(value);
              setCommandIndex(0);
              setShowCommands(value.startsWith("/"));
              if (value.startsWith("/")) void loadCommands();
            }}
            onPaste={(event) => void pasteImages(event)}
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
            {pastingImages && (
              <span role="status">Saving clipboard image…</span>
            )}
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
                disabled={
                  pastingImages ||
                  !isSessionInteractive(activeRuntime) ||
                  !draft.trim()
                }
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
