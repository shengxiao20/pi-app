# Pi Native App

Current release: **0.1.6**.

Native desktop client for the [Pi coding-agent harness](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).

Pi Native App is a Pi Package, not a separate agent runtime. The `/app` extension starts a native desktop client in the current project directory. The desktop client starts its own independent Pi RPC session for that project.

## Install

```sh
pi install npm:pi-native-app
```

## Use

Start Pi from the project you want to work in, then run `/app`:

```sh
cd /path/to/project
pi
```

```text
/app
```

The extension waits for the active agent to settle, then starts the native application with the current project directory. The terminal Pi process remains active; the desktop starts a separate Pi RPC session.

### Current workspace, sessions, and tags

`/app` does not take over the terminal's active conversation. Pi App exposes **only one canonical current workspace** at a time: the directory inherited from `/app`, or a directory selected with **Change workspace** beside the Pi App title. Changing workspace replaces the visible session list; it never turns the sidebar into a catalog of other directories and does not implicitly stop or abort active sessions.

Pi owns JSONL session persistence. Pi App reads only the current workspace's persisted conversations and starts a dedicated Pi RPC child only when a session first needs to send work. Sessions may continue in the background while you navigate; each process is identified by its session ID and instance ID so its events reach only that session.

The sidebar groups sessions by one optional tag, plus the fixed **Uncategorized** group. Tags and assignments are app-private SQLite metadata keyed by canonical workspace path and Pi session ID. A tag name must be non-empty and unique. Removing a tag removes only its metadata assignment, immediately returning its sessions to Uncategorized: Pi App never deletes, migrates, or writes Pi JSONL session files or the legacy `projects.json` catalog.

When a non-current session completes, fails, or is aborted, Pi App creates an in-memory notification. The light-bulb control shows the unread count and opens entries that jump to their session. These notifications are not system notifications and are not persisted across an app restart.

Each session owns its draft, runtime status, error, streamed output, tools, and unread state. Background output receives an accessible unread marker without stealing focus; selecting that session clears the marker while preserving its terminal status.

Type `/` in the composer to discover the active Pi RPC workspace's extension commands, prompt templates, and Skills. Filter the accessible list, then use arrow keys and Enter or click a command to insert `/<name> `; submitting it uses Pi's existing `prompt` RPC execution. Built-in interactive TUI commands are intentionally excluded because Pi RPC does not expose them.

During an active Pi run, the conversation shows a working indicator until Pi emits `agent_settled`. Tool entries show their live state and Pi-supplied target context: the path for `read`, `edit`, and `write`, or the command for `bash`. Pi App does not infer or fabricate a target when Pi did not provide one.

Pi App reads persisted JSONL history from the newest 80-message page backward through Tauri's byte-cursor tail reader. When a session has earlier records, select **Load earlier messages** to retrieve the next page. Each loaded page is rendered directly; the frontend does not maintain a second virtualization layer. Use **Hide tool calls** in the conversation header when reviewing a session to show only user and Pi text; the toggle changes presentation only and does not alter persisted history.

Extension commands discovered through Pi RPC are handled according to their own lifecycle. A command that completes without starting an Agent run returns the composer to ready state after Pi accepts it; Pi `notify` extension UI events appear as Pi messages in the active conversation.

Automatic terminal-to-desktop continuation requires an explicit handoff feature. It is intentionally not part of `/app`, so a fresh terminal session that has not yet created a JSONL file can always open Pi App.

## Workspace selection

Pi App launched from `/app` or the terminal inherits that process's current working directory. Opening Pi App directly from Finder or the Dock first prompts for a workspace directory. If you cancel the picker, Pi App displays **Select a workspace to start Pi.** and does not start Pi. **Change workspace** replaces this sole visible workspace; it does not expose previously selected directories as navigation entries.

Pi owns session persistence. Pi App calculates Pi's workspace session directory from the selected canonical workspace and passes it only as the documented startup option:

```text
pi --mode rpc --session-dir <Pi project session directory> [--session <Pi session JSONL path>]
```

A workspace with no existing session directory starts with no sessions; Pi creates the directory and its new session when the RPC process starts. Pi's RPC commands can switch a session, but Pi App does not use that global switch for sidebar navigation. Each active session has its own Pi RPC process, started in the workspace cwd and bound directly to that session.

Finder and Dock do not inherit your terminal's `PATH`. On macOS, Pi App starts that same documented command through the user's zsh login/interactive environment. This makes npm/NVM-installed `pi` and its Node interpreter available; zsh immediately `exec`s Pi, leaving the JSONL RPC stdin/stdout pipes directly connected to Pi. This requires a usable `pi` command in the user's zsh environment.

## Platform support

The initial release supports macOS on Apple Silicon (`darwin-arm64`) only. The package contains a prebuilt native application; users do not need Rust, Xcode, Tauri, or a local build step.

## Development and release

Release artifacts are built by maintainers before publishing:

```sh
npm run build:native
npm pack --dry-run
```

The npm tarball contains only the Pi extension, compiled launcher, license/readme, and the prebuilt native bundle for the supported platform.
