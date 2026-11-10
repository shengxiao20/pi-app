# Changelog

## 0.2.0 (unreleased)

### BREAKING CHANGE: Pi RPC + Tauri desktop app → Pi SDK + AG-UI + web

Pi App replaces its native desktop architecture with a local web app.
This release does not continue the Tauri desktop runtime or Pi RPC subprocess transport.

- **Agent runtime:** The Pi TypeScript SDK runs directly in a Node.js service instead of a Pi RPC subprocess.
- **Client transport:** AG-UI streams run events to the browser. Separate HTTP APIs handle workspace and session operations.
- **User interface:** A browser replaces the Tauri desktop window. Tauri, Rust binaries, and platform installers are no longer included.

The npm package name remains `pi-native-app`, but the current package launches the web app.
See [Start here](README.md#start-here) for current requirements and launch instructions.

### Keep the previous desktop app

Install a specific older release if you want the Pi RPC + Tauri desktop app:

```sh
pi install npm:pi-native-app@0.1.15
```

Version `0.1.15` is the published desktop release.
Do not use the unversioned install command if you need the previous desktop architecture.

### Refactor: 14,611 fewer lines

The refactor PR reports **+6,490 / -21,101 lines**:

- Added: **6,490 lines**.
- Removed: **21,101 lines**.
- Net change: **−14,611 lines**.

The architecture replacement removes substantially more code than it adds.
The app no longer maintains the native desktop runtime and Pi RPC launcher.
These figures describe the PR diff, not total source code size or runtime performance.
