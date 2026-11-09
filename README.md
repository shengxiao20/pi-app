# Pi App

[中文](README_zh.md)

Pi App is a local web client for the [Pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).
It keeps the existing React interface and uses AG-UI 1.0 between the browser and a local Node.js service.
The service uses the Pi TypeScript SDK in-process. It does not start `pi --mode rpc`.

## Architecture

```text
React page
  -> @ag-ui/client HttpAgent
    -> HTTP and server-sent events on 127.0.0.1
      -> AG-UI adapter
        -> Pi AgentSession and SessionManager
```

AG-UI carries run input, streamed text, tool calls, tool results, cancellation, and run errors.
Regular HTTP APIs carry workspace selection, persisted history, session names, commands, and tags.
Pi remains the authority for conversation history and model context.

The service loads Pi resources with `DefaultResourceLoader`.
It explicitly enables codemode, tool search, and Model Context Protocol (MCP) extensions.
The browser can discover extension commands, prompt templates, and Skills through the session commands API.

## Requirements

- Node.js 22 or later
- Configured Pi models and credentials

The service reads the normal Pi configuration under `~/.pi`.
It has the same local file access as the user who starts it.

## Development

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:1420>.
The initial workspace is the directory where you run the command.
You can override it with `PI_APP_WORKSPACE`.

Use these checks before you submit a change:

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run format:check
```

## Pi package use

Install the package, start Pi in a project, and run `/app`:

```sh
pi install npm:pi-native-app
cd /path/to/project
pi
```

```text
/app
```

The command starts the production web service when needed.
It selects the current Pi directory as the workspace and opens the local URL in your browser.
The service stays on port `1420` and binds only to `127.0.0.1`.
To change the workspace, start Pi in the target directory and run `/app` again.

## Sessions and history

Pi App lists only sessions for the current canonical workspace.
`SessionManager` opens and continues persisted Pi JSONL sessions.
A new empty session stays in memory until its first user message, which matches Pi SDK persistence rules.

Each AG-UI run sends the complete ordered message history.
Before a run starts, the service compares that history with the active Pi session branch.
The service rejects a mismatch instead of appending duplicate or inconsistent context.

The history API returns pages of up to 200 messages.
The page keeps the existing Markdown, math, Mermaid, and tool-call presentation.
Tags are app metadata in `~/.pi/agent/pi-app.json`; they do not modify Pi session files.

## Run outcomes

- A normal run emits `RUN_FINISHED` with a success outcome.
- A user abort emits `RUN_FINISHED` with a cancelled outcome.
- A run failure emits `RUN_ERROR`.
- A browser disconnect does not become success or cancellation. The Pi run continues on the server.

The service rejects a workspace change while any run is active.
It also rejects concurrent runs for the same session.

## Local security boundary

The service listens only on the IPv4 loopback address.
The API rejects browser requests from other origins.
Session IDs resolve only through Pi's current-workspace session directory.
Static files resolve only inside `desktop/dist`.

This boundary is for one local user. Pi App is not a multi-user or network service.

## Build output

```sh
npm run build
npm start
```

The production service serves `desktop/dist` and the API from the same loopback origin.
The npm package includes the built page, Node.js service, and `/app` extension.
It does not include Tauri, Rust binaries, platform packages, or a Pi RPC launcher.
