# Pi Native App

Native desktop client for the [Pi coding-agent harness](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).

Pi Native App is a Pi Package, not a separate agent runtime. The `/app` extension hands the active Pi session and project working directory to a native desktop client, which starts Pi's RPC mode for the same project.

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

The extension waits for the active agent to settle, starts the native application with the current project directory and session file, then closes the terminal Pi process.

## Platform support

The initial release supports macOS on Apple Silicon (`darwin-arm64`) only. The package contains a prebuilt native application; users do not need Rust, Xcode, Tauri, or a local build step.

## Development and release

Release artifacts are built by maintainers before publishing:

```sh
npm run build:native
npm pack --dry-run
```

The npm tarball contains only the Pi extension, compiled launcher, license/readme, and the prebuilt native bundle for the supported platform.
