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

### Projects and sessions

`/app` does not take over the terminal's active conversation. Pi App persists a local **Projects** catalog and presents a Codex-inspired two-level sidebar: select a project, then select only that project's persisted conversations. Selecting a session changes the displayed conversation; it does not send `switch_session`, stop, or abort another running session. Pi App starts a dedicated Pi RPC child only when a session first needs to send work, so sessions can continue in the background while you navigate.

Use **Change workspace** to add a project through the native picker. Projects can be renamed or removed from the sidebar. Removal deletes only Pi App's project-catalog entry: it never deletes the directory or Pi JSONL session history. Removing a project with live children drains only that project's RPC runtimes. Sessions provide an accessible pencil control for session naming through Pi's `set_session_name` RPC command; Pi App intentionally provides no session deletion action and never deletes Pi session files.

Each session owns its draft, runtime status, error, streamed output, tools, and unread state. Background output receives an accessible unread marker without stealing focus; selecting that session clears the marker while preserving its terminal status.

Type `/` in the composer to discover the active Pi RPC workspace's extension commands, prompt templates, and Skills. Filter the accessible list, then use arrow keys and Enter or click a command to insert `/<name> `; submitting it uses Pi's existing `prompt` RPC execution. Built-in interactive TUI commands are intentionally excluded because Pi RPC does not expose them.

During an active Pi run, the conversation shows a working indicator until Pi emits `agent_settled`. Tool entries show their live state and Pi-supplied target context: the path for `read`, `edit`, and `write`, or the command for `bash`. Pi App does not infer or fabricate a target when Pi did not provide one.

Pi App reads persisted JSONL history from the newest 80-message page backward through Tauri's byte-cursor tail reader. When a session has earlier records, select **Load earlier messages** to retrieve the next page. Each loaded page is rendered directly; the frontend does not maintain a second virtualization layer. Use **Hide tool calls** in the conversation header when reviewing a session to show only user and Pi text; the toggle changes presentation only and does not alter persisted history.

Extension commands discovered through Pi RPC are handled according to their own lifecycle. A command that completes without starting an Agent run returns the composer to ready state after Pi accepts it; Pi `notify` extension UI events appear as Pi messages in the active conversation.

Automatic terminal-to-desktop continuation requires an explicit handoff feature. It is intentionally not part of `/app`, so a fresh terminal session that has not yet created a JSONL file can always open Pi App.

## Workspace selection

Pi App launched from `/app` or the terminal inherits that process's current working directory. Opening Pi App directly from Finder or the Dock first prompts for a project directory. If you cancel the picker, Pi App displays **Select a workspace to start Pi.** and does not start Pi. Use **Change workspace** in the sidebar to add another directory, then select a project to load its sessions. Changing selection does not terminate other project/session children; removal and application exit perform the scoped/global runtime drain described above.

Pi owns session persistence. Pi App calculates Pi's project session directory from the selected canonical workspace and passes it only as the documented startup option:

```text
pi --mode rpc --session-dir <Pi project session directory>
```

A project with no existing session directory starts with empty Recents; Pi creates the directory and its new session when the RPC process starts. Pi's RPC commands can switch a session, but Pi App does not use that global switch for sidebar navigation. Each active session is addressed by explicit project/session identity and runs in its own project cwd.

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
