# Pi Native App

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

### Sessions

`/app` does not take over the terminal's active conversation. Pi App opens its own session and lists persisted conversations for the current project under **Recents**; select one there to continue it in the desktop client. Recents provides an accessible pencil control for session naming through Pi's `set_session_name` RPC command. Pi App intentionally provides no session deletion action and never deletes Pi session files.

Automatic terminal-to-desktop continuation requires an explicit handoff feature. It is intentionally not part of `/app`, so a fresh terminal session that has not yet created a JSONL file can always open Pi App.

## Workspace selection

Pi App launched from `/app` or the terminal inherits that process's current working directory. Opening Pi App directly from Finder or the Dock first prompts for a project directory. If you cancel the picker, Pi App displays **Select a workspace to start Pi.** and does not start Pi. Use **Change workspace** in the sidebar to choose another directory; Pi App stops its current independent RPC process and starts a new one for the selected project, then loads that project's **Recents**.

Pi owns session persistence. Pi App calculates Pi's project session directory from the selected canonical workspace and passes it only as the documented startup option:

```text
pi --mode rpc --session-dir <Pi project session directory>
```

A project with no existing session directory starts with empty Recents; Pi creates the directory and its new session when the RPC process starts. Pi's RPC commands can switch a session, but cannot change an already-running RPC process's cwd. Consequently, changing workspace deliberately stops the old child and starts a new Pi RPC child in the selected directory.

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
