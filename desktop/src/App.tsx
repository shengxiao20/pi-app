import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";

import type {
  PersistedSession,
  PiClient,
  Project,
  RpcRecord,
  RuntimeEvent,
  ProjectRuntimeSnapshot,
} from "./pi-client";
import { tauriPiClient } from "./pi-client";
import {
  createWorkspaceState,
  isSessionInteractive,
  projectRuntimeSummary,
  sessionKey,
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
  persistedMessages: RpcRecord[];
  history: HistoryEntry[];
};
type WorkspaceInitialization = {
  activeSession?: WorkspaceSession;
  directory: string;
  projectId: string;
  sessions: WorkspaceSession[];
};
type SessionDialog =
  | { kind: "rename"; session: WorkspaceSession }
  | { kind: "rename-project"; project: Project }
  | {
      kind: "remove-project";
      project: Project;
      snapshot: ProjectRuntimeSnapshot;
    };
type PiCommand = {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill";
};

const INITIAL_SESSION_ID = "session-initial";
const HISTORY_PAGE_SIZE = 80;

function activeTarget(
  projectId: string | undefined,
  sessionId: string,
): import("./pi-client").RuntimeTarget {
  if (!projectId)
    throw new Error("Select a project before sending Pi commands");
  return { projectId, sessionId };
}

export default function App({ client = tauriPiClient }: { client?: PiClient }) {
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState("");
  const [commands, setCommands] = useState<PiCommand[]>([]);
  const [commandIndex, setCommandIndex] = useState(0);
  const [showCommands, setShowCommands] = useState(false);
  const [hideToolCalls, setHideToolCalls] = useState(false);
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [runtimeState, dispatchRuntime] = useReducer(
    workspaceReducer,
    undefined,
    createWorkspaceState,
  );
  const [dialog, setDialog] = useState<SessionDialog>();
  const [directory, setDirectory] = useState("");
  const [projectId, setProjectId] = useState<string>();
  const currentProject = projects.find((project) => project.id === projectId);
  const projectIdRef = useRef<string | undefined>(undefined);
  const [activeSessionId, setActiveSessionId] = useState(INITIAL_SESSION_ID);
  const activeSessionIdRef = useRef(INITIAL_SESSION_ID);
  const requestSequence = useRef(0);
  const agentRunObserved = useRef(false);
  const discoveredCommands = useRef<PiCommand[]>([]);
  const commandDiscovery = useRef<Promise<void> | undefined>(undefined);
  const commandGeneration = useRef(0);
  const sessionSequence = useRef(0);
  const loadingOlderSessions = useRef(new Set<string>());
  const startedRuntimes = useRef(new Set<string>());
  const startup = useRef<Promise<WorkspaceInitialization> | undefined>(
    undefined,
  );
  const activeSession = sessions.find(({ id }) => id === activeSessionId);
  const activeRuntime = projectId
    ? runtimeState.sessions[sessionKey(projectId, activeSessionId)]
    : undefined;
  const sessionStatus = activeRuntime?.status ?? status;
  const sessionError = activeRuntime?.error ?? error;

  function setRuntimeDraft(value: string) {
    setDraft(value);
    if (projectId) {
      dispatchRuntime({
        type: "set-draft",
        projectId,
        sessionId: activeSessionId,
        draft: value,
      });
    }
  }

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    for (const session of sessions) {
      dispatchRuntime({
        type: "ensure-session",
        projectId,
        session: {
          id: session.id,
          title: session.title,
          sessionPath: session.sessionPath,
        },
      });
    }
  }, [projectId, sessions]);

  const handleEvent = useCallback(
    ({
      projectId: eventProjectId,
      sessionId,
      event,
      ...identity
    }: RuntimeEvent) => {
      const selected = sessionKey(
        projectIdRef.current ?? "",
        activeSessionIdRef.current,
      );
      dispatchRuntime({
        type: "runtime-event",
        active: selected,
        event: { projectId: eventProjectId, sessionId, event, ...identity },
      });
      // The normalized store retains every target. The presentation list is
      // updated only for its own project while persisted history is loading.
      if (eventProjectId !== projectIdRef.current) return;
      if (event.type === "bridge_error") {
        if (sessionId === activeSessionIdRef.current)
          setError(
            typeof event.message === "string"
              ? event.message
              : "Pi bridge failed",
          );
        return;
      }
      if (event.type === "agent_start") agentRunObserved.current = true;
      if (
        (event.type === "agent_settled" || event.type === "bridge_error") &&
        eventProjectId === projectIdRef.current
      ) {
        startedRuntimes.current.delete(sessionKey(eventProjectId, sessionId));
      }
      const notification = event.message;
      if (
        event.type === "extension_ui_request" &&
        event.method === "notify" &&
        typeof notification === "string"
      ) {
        updateSession(sessionId, setSessions, (session) => ({
          ...session,
          history: [
            ...session.history,
            { kind: "message", role: "assistant", text: notification },
          ],
        }));
        return;
      }
      if (event.type === "message_update") {
        const update = asRecord(event.assistantMessageEvent);
        if (update?.type === "text_delta" && typeof update.delta === "string")
          updateSession(sessionId, setSessions, (session) => ({
            ...session,
            history: appendAssistantText(
              session.history,
              update.delta as string,
            ),
          }));
        return;
      }
      if (
        event.type === "tool_execution_start" &&
        typeof event.toolCallId === "string" &&
        typeof event.toolName === "string"
      ) {
        updateSession(sessionId, setSessions, (session) => ({
          ...session,
          history: [
            ...session.history,
            {
              kind: "tool",
              id: event.toolCallId as string,
              name: event.toolName as string,
              target: toolTarget(event.toolName, event.args),
              output: "",
              isError: false,
              isRunning: true,
            },
          ],
        }));
        return;
      }
      if (
        event.type === "tool_execution_update" ||
        event.type === "tool_execution_end"
      )
        updateTool(event, sessionId, setSessions);
    },
    [],
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;
    void (async () => {
      setStatus("starting");
      try {
        unlisten = await client.listen(handleEvent);
        if (!active) return unlisten();
        startup.current ??= initializeWorkspace(client);
        const workspace = await startup.current;
        if (active) {
          setDirectory(workspace.directory);
          setProjects(uniqueProjects(await client.listProjects()));
          projectIdRef.current = workspace.projectId;
          setProjectId(workspace.projectId);
          setSessions(workspace.sessions);
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
      unlisten?.();
    };
  }, [client, handleEvent]);

  async function selectProject(nextProject: Project) {
    if (nextProject.id === projectId) return;
    try {
      await client.selectProject(nextProject.id);
      setStatus("starting");
      setError(undefined);
      setDraft("");
      resetCommandDiscovery();
      const workspace = await initializeWorkspace(client);
      setDirectory(workspace.directory);
      projectIdRef.current = workspace.projectId;
      setProjectId(workspace.projectId);
      setSessions(workspace.sessions);
      activeSessionIdRef.current =
        workspace.activeSession?.id ?? INITIAL_SESSION_ID;
      setActiveSessionId(workspace.activeSession?.id ?? INITIAL_SESSION_ID);
      setProjects(uniqueProjects(await client.listProjects()));
      setStatus("ready");
    } catch (reason) {
      fail(setError, setStatus, reason);
    }
  }

  async function saveProjectRename(project: Project, value: string) {
    const displayName = value.trim();
    if (!displayName || displayName === project.displayName) return;
    try {
      await client.renameProject(project.id, displayName);
      setProjects((current) =>
        current.map((item) =>
          item.id === project.id ? { ...item, displayName } : item,
        ),
      );
      setDialog(undefined);
    } catch (reason) {
      fail(setError, setStatus, reason);
    }
  }

  async function showRemoveProject(project: Project) {
    try {
      const snapshot = await client.projectRuntimeSnapshot(project.id);
      setDialog({ kind: "remove-project", project, snapshot });
    } catch (reason) {
      fail(setError, setStatus, reason);
    }
  }

  async function removeCurrentProject(
    project: Project,
    snapshot: ProjectRuntimeSnapshot,
  ) {
    try {
      await client.removeProject(project.id, snapshot);
      setProjects((current) =>
        current.filter((item) => item.id !== project.id),
      );
      setDialog(undefined);
      setProjectId(undefined);
      setSessions([]);
      setDirectory("");
    } catch (reason) {
      fail(setError, setStatus, reason);
    }
  }

  async function changeWorkspace() {
    if (status === "streaming" || status === "starting") return;
    try {
      const selected = await client.chooseWorkspace();
      if (!selected) return;
      setStatus("starting");
      setError(undefined);
      setDraft("");
      resetCommandDiscovery();
      const workspace = await initializeWorkspace(client);
      setDirectory(workspace.directory);
      projectIdRef.current = workspace.projectId;
      setProjectId(workspace.projectId);
      setSessions(workspace.sessions);
      activeSessionIdRef.current =
        workspace.activeSession?.id ?? INITIAL_SESSION_ID;
      setActiveSessionId(workspace.activeSession?.id ?? INITIAL_SESSION_ID);
      setProjects(uniqueProjects(await client.listProjects()));
      setStatus("ready");
    } catch (reason) {
      fail(setError, setStatus, reason);
    }
  }

  async function createSession() {
    if (!isSessionInteractive(activeRuntime)) return;
    const id = `session-${sessionSequence.current++}`;
    try {
      assertResponse(
        await client.sendRpc(activeTarget(projectId, activeSessionId), {
          id,
          type: "new_session",
        }),
        "new session",
      );
      const priorTarget = activeTarget(projectId, activeSessionId);
      const metadata = await getSessionMetadata(
        client,
        priorTarget,
        `${id}-state`,
      );
      const stableTarget = await client.bindSession(priorTarget, metadata.id);
      startedRuntimes.current.delete(
        sessionKey(priorTarget.projectId, priorTarget.sessionId),
      );
      startedRuntimes.current.add(
        sessionKey(stableTarget.projectId, stableTarget.sessionId),
      );
      assertResponse(
        await client.sendRpc(stableTarget, {
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
    if (session.id === activeSessionId) return;
    const previousSessionId = activeSessionId;
    try {
      if (!projectId)
        throw new Error("Select a project before selecting sessions");
      activeSessionIdRef.current = session.id;
      dispatchRuntime({
        type: "select-session",
        projectId,
        sessionId: session.id,
      });
      setDraft(
        runtimeState.sessions[sessionKey(projectId, session.id)]?.draft ?? "",
      );
      setActiveSessionId(session.id);
      if (session.historyLoaded) return;
      updateSession(session.id, setSessions, (current) => ({
        ...current,
        historyLoading: true,
      }));
      const history = await getHistory(client, projectId, session.sessionPath);
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
      if (!projectId)
        throw new Error("Select a project before loading history");
      const page = await client.sessionHistory(
        projectId,
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
      if (!projectId)
        throw new Error("Select a project before renaming a session");
      assertResponse(
        await client.sendRpc(activeTarget(projectId, session.id), {
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
    const extensionCommand = message.startsWith("/")
      ? (await loadCommands(),
        isExtensionCommand(message, discoveredCommands.current))
      : false;
    setRuntimeDraft("");
    agentRunObserved.current = false;
    if (projectId) {
      dispatchRuntime({
        type: "set-status",
        projectId,
        sessionId: activeSession.id,
        status: "streaming",
      });
    }
    try {
      const target = activeTarget(projectId, activeSession.id);
      await ensureRuntimeStarted(target, activeSession.sessionPath);
      assertResponse(
        await client.sendRpc(target, {
          id: `prompt-${requestSequence.current++}`,
          type: "prompt",
          message,
        }),
        "send prompt",
      );
      if (extensionCommand && !agentRunObserved.current && projectId) {
        dispatchRuntime({
          type: "set-status",
          projectId,
          sessionId: activeSession.id,
          status: "idle",
        });
      }
    } catch (reason) {
      const record = asRecord(reason);
      const message =
        reason instanceof Error
          ? reason.message
          : typeof record?.message === "string"
            ? record.message
            : String(reason);
      if (projectId) {
        dispatchRuntime({
          type: "set-status",
          projectId,
          sessionId: activeSession.id,
          status: "failed",
          error: message,
        });
      }
      setError(message);
    }
  }

  async function abort() {
    if (projectId) {
      dispatchRuntime({
        type: "set-status",
        projectId,
        sessionId: activeSessionId,
        status: "aborted",
      });
    }
    try {
      assertResponse(
        await client.abortAgent(activeTarget(projectId, activeSessionId)),
        "abort",
      );
    } catch (reason) {
      fail(setError, setStatus, reason);
    }
  }

  function resetCommandDiscovery() {
    commandGeneration.current += 1;
    discoveredCommands.current = [];
    commandDiscovery.current = undefined;
    setCommands([]);
    setCommandIndex(0);
    setShowCommands(false);
  }

  async function ensureRuntimeStarted(
    target: import("./pi-client").RuntimeTarget,
    sessionPath: string,
  ) {
    const targetKey = sessionKey(target.projectId, target.sessionId);
    if (startedRuntimes.current.has(targetKey)) return;
    await client.startAgent(target, sessionPath);
    startedRuntimes.current.add(targetKey);
  }

  function loadCommands(): Promise<void> {
    if (commandDiscovery.current) return commandDiscovery.current;
    const generation = commandGeneration.current;
    if (!projectId || !activeSession)
      return Promise.reject(
        new Error("Select a project and session before loading commands"),
      );
    const target = activeTarget(projectId, activeSessionId);
    commandDiscovery.current = ensureRuntimeStarted(
      target,
      activeSession.sessionPath,
    )
      .then(() => getCommands(client, target, "get-commands-0"))
      .then((availableCommands) => {
        if (generation !== commandGeneration.current) return;
        discoveredCommands.current = availableCommands;
        setCommands(availableCommands);
      })
      .catch((reason) => {
        if (generation !== commandGeneration.current) return;
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
            disabled={!isSessionInteractive(activeRuntime)}
            onClick={() => void createSession()}
            type="button"
          >
            <span aria-hidden="true">+</span> New chat
          </button>
          <section
            className="project-navigation"
            aria-labelledby="projects-heading"
          >
            <div className="project-heading">
              <h2 id="projects-heading">Projects</h2>
              <p className="current-directory" title={directory}>
                {directory || "No workspace selected"}
              </p>
              <button
                className="change-workspace"
                disabled={status === "starting"}
                onClick={() => void changeWorkspace()}
                type="button"
              >
                Change workspace
              </button>
            </div>
            <div className="project-list">
              {projects.map((project) => (
                <button
                  aria-current={project.id === projectId ? "page" : undefined}
                  aria-label={`${project.displayName}${project.id === projectId ? " Current project" : ""}`}
                  className="project-select"
                  key={project.id}
                  onClick={() => void selectProject(project)}
                  type="button"
                >
                  <strong>{project.displayName}</strong>
                  {(() => {
                    const summary = projectRuntimeSummary(
                      runtimeState,
                      project.id,
                    );
                    return (
                      (summary.running || summary.unread) && (
                        <span
                          aria-label={`Project status: ${summary.running ? "running" : "unread"}`}
                        >
                          {summary.running ? " Running" : " Unread"}
                        </span>
                      )
                    );
                  })()}
                </button>
              ))}
              {!projects.length && (
                <p className="empty-projects">Add a project to begin.</p>
              )}
            </div>
            {currentProject && (
              <div className="project-actions">
                <button
                  aria-label="Rename current project"
                  onClick={() =>
                    setDialog({
                      kind: "rename-project",
                      project: currentProject,
                    })
                  }
                  type="button"
                >
                  Rename
                </button>
                <button
                  aria-label="Remove current project"
                  onClick={() => void showRemoveProject(currentProject)}
                  type="button"
                >
                  Remove
                </button>
              </div>
            )}
          </section>
          <section
            className="navigation-section recents"
            aria-labelledby="recents-heading"
          >
            <h2 id="recents-heading">Recents</h2>
            <div className="session-list">
              {!sessions.length && (
                <p className="empty-projects">No sessions in this project.</p>
              )}
              {sessions.map((session) => (
                <div className="session-item" key={session.id}>
                  <button
                    aria-current={
                      session.id === activeSessionId ? "page" : undefined
                    }
                    aria-describedby={`session-status-${session.id}`}
                    className="session-select"
                    onClick={() => void selectSession(session)}
                    type="button"
                  >
                    <span className="session-copy">
                      <strong>{session.title}</strong>
                      {runtimeState.sessions[
                        sessionKey(projectId ?? "", session.id)
                      ]?.unread && (
                        <span
                          aria-label="Unread updates"
                          className="session-unread"
                        />
                      )}
                      <small>
                        {lastMessageText(session.history) ||
                          "Empty conversation"}
                      </small>
                      <small aria-hidden="true" className="session-status" />
                    </span>
                  </button>
                  <span
                    className="visually-hidden"
                    id={`session-status-${session.id}`}
                  >
                    Session status:{" "}
                    {runtimeState.sessions[
                      sessionKey(projectId ?? "", session.id)
                    ]?.status ?? "idle"}
                  </span>
                  <div className="session-actions">
                    <button
                      aria-label={`Rename session ${session.title}`}
                      className="rename-session"
                      disabled={sessionStatus === "streaming"}
                      onClick={() => setDialog({ kind: "rename", session })}
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
                          strokeWidth="1.8"
                        />
                        <path
                          d="m14.5 6 3.5 3.5"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeWidth="1.8"
                        />
                      </svg>
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
            placeholder="Message Pi about this project…"
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
      {dialog?.kind === "rename-project" && (
        <form
          aria-label="Rename project"
          className="session-dialog"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void saveProjectRename(
              dialog.project,
              String(form.get("project-name")),
            );
          }}
        >
          <label>
            Project name
            <input
              defaultValue={dialog.project.displayName}
              name="project-name"
            />
          </label>
          <button type="submit">Save project name</button>
          <button onClick={() => setDialog(undefined)} type="button">
            Cancel
          </button>
        </form>
      )}
      {dialog?.kind === "remove-project" && (
        <section aria-label="Remove project" className="session-dialog">
          <p>
            This removes only the project record; files and Pi session history
            stay on disk.
          </p>
          {dialog.snapshot.targets.length > 0 && (
            <>
              <p>These running Pi tasks will be terminated:</p>
              <ul>
                {dialog.snapshot.targets.map((target) => (
                  <li key={target.sessionId}>{target.sessionId}</li>
                ))}
              </ul>
            </>
          )}
          <button
            onClick={() =>
              void removeCurrentProject(dialog.project, dialog.snapshot)
            }
            type="button"
          >
            Remove project
          </button>
          <button onClick={() => setDialog(undefined)} type="button">
            Cancel
          </button>
        </section>
      )}
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
    </main>
  );
}

async function getCommands(
  client: PiClient,
  target: import("./pi-client").RuntimeTarget,
  id: string,
): Promise<PiCommand[]> {
  const response = await client.sendRpc(target, { id, type: "get_commands" });
  assertResponse(response, "get commands");
  const data = asRecord(response.data);
  const commands = data?.commands;
  if (!Array.isArray(commands)) throw new Error("Pi returned invalid commands");
  return commands.map((command) => {
    const value = asRecord(command);
    if (
      !value ||
      typeof value.name !== "string" ||
      (value.source !== "extension" &&
        value.source !== "prompt" &&
        value.source !== "skill")
    )
      throw new Error("Pi returned invalid command");
    return {
      name: value.name,
      description:
        typeof value.description === "string" ? value.description : undefined,
      source: value.source,
    };
  });
}

function matchCommands(commands: PiCommand[], draft: string): PiCommand[] {
  if (!draft.startsWith("/") || /\s/.test(draft)) return [];
  const query = draft.slice(1).toLowerCase();
  return commands.filter(({ name }) => name.toLowerCase().includes(query));
}

function isExtensionCommand(message: string, commands: PiCommand[]): boolean {
  const name = /^\/([^\s]+)/.exec(message)?.[1];
  return commands.some(
    (command) => command.source === "extension" && command.name === name,
  );
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
        {entry.target && <code>{entry.target}</code>}
        <em>
          {entry.isRunning ? "running" : entry.isError ? "failed" : "completed"}
        </em>
      </summary>
      <pre>{entry.output || "Running…"}</pre>
    </details>
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
  if (!(await client.currentDirectory()) && !(await client.chooseWorkspace())) {
    throw new Error("Select a workspace to view its sessions.");
  }
  const directory = await client.currentDirectory();
  if (!directory) throw new Error("Select a workspace before viewing sessions");
  const project = (await client.listProjects()).find(
    (candidate) => candidate.path === directory,
  );
  if (!project)
    throw new Error("Selected workspace is missing its project identity");
  const sessions = (await client.listSessions(project.id)).map(
    workspaceSession,
  );
  const activeSession =
    sessions.find((session) => session.id === "terminal-id") ?? sessions[0];
  if (!activeSession) return { directory, projectId: project.id, sessions };
  const loaded = {
    ...activeSession,
    historyLoaded: true,
    historyLoading: false,
    ...(await getHistory(client, project.id, activeSession.sessionPath)),
  };
  return {
    activeSession: loaded,
    directory,
    projectId: project.id,
    sessions: sessions.map((session) =>
      session.id === loaded.id ? loaded : session,
    ),
  };
}

function uniqueProjects(projects: Project[]): Project[] {
  const seen = new Set<string>();
  return projects.filter((project) => {
    if (seen.has(project.id)) return false;
    seen.add(project.id);
    return true;
  });
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
async function getSessionMetadata(
  client: PiClient,
  target: import("./pi-client").RuntimeTarget,
  id: string,
): Promise<{ id: string; path: string; name?: string }> {
  const response = await client.sendRpc(target, { id, type: "get_state" });
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
  projectId: string,
  sessionPath: string,
): Promise<
  Pick<
    WorkspaceSession,
    "history" | "historyBefore" | "hasMoreHistory" | "persistedMessages"
  >
> {
  const page = await client.sessionHistory(
    projectId,
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
              target: toolTarget(toolCall.name, toolCall.arguments),
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
        ? {
            ...entry,
            target: toolTarget(event.toolName, event.args) ?? entry.target,
            output,
            isError: event.isError === true,
            isRunning: event.type !== "tool_execution_end",
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
