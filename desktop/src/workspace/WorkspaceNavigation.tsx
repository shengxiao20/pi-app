import type { PointerEvent as ReactPointerEvent } from "react";

import type { SessionTagAssignment, Tag } from "../pi-client";
import type { WorkspaceState } from "../workspace-state";
import type { RenameTarget, WorkspaceSession } from "./types";

export type WorkspaceNavigationState = {
  changingWorkspace: boolean;
  canCreateSession: boolean;
  directory: string;
  sessions: WorkspaceSession[];
  tags: Tag[];
  assignments: SessionTagAssignment[];
  runtimeSessions: WorkspaceState["sessions"];
  activeSessionId: string;
  creatingTag: boolean;
  newTagName: string;
  expandedTags: Set<string>;
  dropTargetGroupId?: string;
  renameTarget?: RenameTarget;
  renameValue: string;
};

export type WorkspaceNavigationActions = {
  createSession: () => void;
  chooseWorkspace: () => void;
  startTagCreation: () => void;
  createTag: () => void;
  cancelTagCreation: () => void;
  changeNewTagName: (value: string) => void;
  toggleTag: (groupId: string) => void;
  setTagContextMenu: (tag: Tag, x: number, y: number) => void;
  selectSession: (session: WorkspaceSession) => void;
  beginPointerDrag: (
    event: ReactPointerEvent<HTMLButtonElement>,
    sessionId: string,
  ) => void;
  beginRename: (target: RenameTarget) => void;
  saveRename: () => void;
  changeRenameValue: (value: string) => void;
  cancelRename: () => void;
};

type WorkspaceNavigationProps = {
  state: WorkspaceNavigationState;
  actions: WorkspaceNavigationActions;
};

export default function WorkspaceNavigation({
  state,
  actions,
}: WorkspaceNavigationProps) {
  return (
    <nav
      aria-busy={state.changingWorkspace}
      aria-label="Workspace navigation"
      className="workspace-navigation"
      inert={state.changingWorkspace}
    >
      <button
        className="new-session"
        disabled={state.changingWorkspace || !state.canCreateSession}
        onClick={actions.createSession}
        type="button"
      >
        <span aria-hidden="true">+</span> New chat
      </button>
      <section
        className="workspace-heading"
        aria-labelledby="workspace-heading"
      >
        <h2 id="workspace-heading">Workspace</h2>
        <div className="workspace-path-row">
          <p className="current-directory" title={state.directory}>
            {state.directory || "No workspace selected"}
          </p>
          <button
            aria-label="Choose workspace directory"
            className="choose-workspace"
            disabled={state.changingWorkspace}
            onClick={actions.chooseWorkspace}
            title={
              state.changingWorkspace
                ? "Choosing workspace…"
                : "Choose workspace directory"
            }
            type="button"
          >
            <FolderIcon />
          </button>
        </div>
      </section>
      <section
        className="navigation-section recents"
        aria-labelledby="recents-heading"
      >
        <div className="tag-list-heading">
          <h2 id="recents-heading">Tags</h2>
          <button
            aria-label="Create tag"
            aria-expanded={state.creatingTag}
            className="create-tag"
            onClick={actions.startTagCreation}
            type="button"
          >
            <PlusIcon />
          </button>
        </div>
        <div className="session-list">
          {state.creatingTag && (
            <form
              className="new-tag-form"
              onSubmit={(event) => {
                event.preventDefault();
                actions.createTag();
              }}
            >
              <label className="sr-only" htmlFor="new-tag-name">
                New tag name
              </label>
              <input
                autoFocus
                id="new-tag-name"
                onChange={(event) =>
                  actions.changeNewTagName(event.target.value)
                }
                placeholder="New tag"
                value={state.newTagName}
              />
              <button aria-label="Add tag" type="submit">
                <PlusIcon />
              </button>
              <button
                aria-label="Cancel new tag"
                onClick={actions.cancelTagCreation}
                type="button"
              >
                ×
              </button>
            </form>
          )}
          {!state.sessions.length && (
            <p className="empty-projects">No sessions in this workspace.</p>
          )}
          {groupedSessions(state.tags, state.assignments, state.sessions).map(
            (group) => (
              <section
                className={`tag-group${
                  state.dropTargetGroupId === group.id ? " is-drop-target" : ""
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
                    actions.setTagContextMenu(
                      group.tag,
                      event.clientX,
                      event.clientY,
                    );
                  }}
                >
                  {state.renameTarget?.kind === "tag" &&
                  state.renameTarget.tag.id === group.tag?.id ? (
                    <input
                      aria-label={`Rename tag ${group.name}`}
                      autoFocus
                      className="inline-rename"
                      onBlur={actions.saveRename}
                      onChange={(event) =>
                        actions.changeRenameValue(event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") actions.saveRename();
                        if (event.key === "Escape") actions.cancelRename();
                      }}
                      value={state.renameValue}
                    />
                  ) : (
                    <button
                      aria-expanded={state.expandedTags.has(group.id)}
                      aria-label={`${state.expandedTags.has(group.id) ? "Collapse" : "Expand"} ${group.name}`}
                      className="tag-toggle"
                      onClick={() => actions.toggleTag(group.id)}
                      type="button"
                    >
                      <span aria-hidden="true">
                        {state.expandedTags.has(group.id) ? "⌄" : "›"}
                      </span>
                      {group.name}
                    </button>
                  )}
                </div>
                {state.expandedTags.has(group.id) &&
                  group.sessions.map((session) => (
                    <div className="session-item" key={session.id}>
                      <button
                        aria-current={
                          session.id === state.activeSessionId
                            ? "page"
                            : undefined
                        }
                        className="session-select"
                        onPointerDown={(event) =>
                          actions.beginPointerDrag(event, session.id)
                        }
                        onClick={() => actions.selectSession(session)}
                        type="button"
                      >
                        <StatusIcon
                          status={
                            state.runtimeSessions[session.id]?.status ?? "idle"
                          }
                        />
                        <span className="session-copy">
                          {state.renameTarget?.kind === "session" &&
                          state.renameTarget.session.id === session.id ? (
                            <input
                              aria-label={`Rename session ${session.title}`}
                              autoFocus
                              className="inline-rename"
                              onBlur={actions.saveRename}
                              onChange={(event) =>
                                actions.changeRenameValue(event.target.value)
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") actions.saveRename();
                                if (event.key === "Escape")
                                  actions.cancelRename();
                              }}
                              onClick={(event) => event.stopPropagation()}
                              value={state.renameValue}
                            />
                          ) : (
                            <strong>{session.title}</strong>
                          )}
                          {state.runtimeSessions[session.id]?.unread && (
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
                            actions.beginRename({ kind: "session", session })
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
            ),
          )}
        </div>
      </section>
    </nav>
  );
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

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M2.5 5.25A1.75 1.75 0 0 1 4.25 3.5h4l1.75 2h5.75A1.75 1.75 0 0 1 17.5 7.25v7.5a1.75 1.75 0 0 1-1.75 1.75h-11A2.25 2.25 0 0 1 2.5 14.25z" />
      <path d="M2.75 8h14" />
    </svg>
  );
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

function lastMessageText(
  history: WorkspaceSession["history"],
): string | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry.kind === "message") return entry.text;
  }
  return undefined;
}
