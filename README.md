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

`/app` does not take over the terminal's active conversation. Pi App exposes **only one canonical current workspace** at a time: the directory inherited from `/app`, or a directory selected with **Change workspace** beside the Pi App title. Changing workspace replaces the visible session list; it never turns the sidebar into a catalog of other directories and does not implicitly start, stop, or abort an existing runtime.

Pi owns JSONL session persistence. Pi App reads only the current workspace's persisted conversations and starts a dedicated Pi RPC child only when a session first needs to send work. Sessions may continue in the background while you navigate; their target identity remains internal to route runtime events safely.

The sidebar groups sessions by one optional tag, plus the fixed **Uncategorized** group. Tags and assignments are app-private SQLite metadata keyed by canonical workspace path and Pi session ID. A tag name must be non-empty and unique. Removing a tag removes only its metadata assignment, immediately returning its sessions to Uncategorized: Pi App never deletes, migrates, or writes Pi JSONL session files or the legacy `projects.json` catalog.

When a non-current session completes, fails, or is aborted, Pi App creates an in-memory notification. The light-bulb control shows the unread count and opens entries that jump to their session. These notifications are not system notifications and are not persisted across an app restart.

Each session owns its draft, runtime status, error, streamed output, tools, and unread state. Background output receives an accessible unread marker without stealing focus; selecting that session clears the marker while preserving its terminal status.

### 会话消息为什么能在后台继续显示？（通俗版）

这里的 **session stream** 可以把它理解成：Pi 正在一小段一小段地“写字”时，应用把每一小段及时送到**正确的那一个对话**里。它不是把一个对话的回答同时复制到所有对话。

#### 1. 我们遇到了什么问题？

想象奶奶同时让两位助手做事：一位在厨房写菜谱，另一位在客厅写购物清单。奶奶走到客厅查看清单时，厨房的助手还在继续写菜谱。

以前，程序容易把“现在收到的新字”当成“屏幕上正在看的那一页”的新字。这样一来，厨房助手写的菜谱可能跑到客厅的购物清单上；或者为了避免弄错，奶奶只能等一个助手完全写完，才能去看另一个。这既不方便，也可能让内容串台。

#### 2. 之前是怎么样的？

之前桌面端更像只有一张总办公桌：多个会话共用一个 Pi 工作进程。切换会话时，应用会要求这个进程改去处理另一份会话记录；任务正在进行时，切换也会受到限制。

同时，前端主要按“当前正在看的会话”接收实时消息。实时消息本身不总会写明它来自哪份会话，所以一旦用户在消息到达前切换页面，应用没有可靠办法判断该把它放在哪里。

#### 3. 调研后选了什么方案？

我们比较了几种做法：

- **继续共用一个 Pi 进程，再不断切换会话**：同一项目里的两个会话不能真正同时工作，而且消息仍可能认错归属；不采用。
- **只根据当前屏幕决定消息去向**：人一切换页面就可能放错内容；不采用。
- **每个真正开始工作的会话配一位专属助手**：每位助手有自己的 Pi RPC 子进程，并在每条实时消息的信封上写清“项目 ID、会话 ID 和第几次启动”；采用。

这里的“信封”是关键：后台收到 Pi 的消息后，先补上收件人信息，再交给界面。界面只按信封上的项目和会话投递，**不猜测**用户此刻正在看哪个页面。`generation`（第几次启动）还会挡住旧助手迟到的消息，避免它污染后来重新开始的同一会话。

为了不白白占用资源，专属助手不是打开应用就全部启动：某个会话第一次需要发送任务时才启动；Pi 表示任务结束、发生桥接错误，或用户停止任务后，对应助手会被回收。会话历史仍由 Pi 保存，不会因为回收助手而删除。

#### 4. 现在实现效果如何？

- 可以在会话 A 正在生成回答时，切到会话 B 阅读、输入或发起另一项任务；切换不会停止或中断 A。
- A 在后台继续产生的文字、工具执行状态和最终结果，仍会记到 A；回到 A 就能看到完整的已接收内容。
- 后台会话有新内容时，侧边栏会出现未读提示，但不会强行把屏幕跳回 A；点开 A 后提示消失。
- 每个会话各自保存草稿、运行状态、错误和工具记录。A 忙碌时，不会把 B 的输入框锁住；停止操作也只针对指定会话。
- 如果一个旧运行实例晚到一条消息，应用会用启动代次识别并忽略它，避免旧内容混进新一轮对话。

简单说：现在像是每份正在处理的工作都有写着名字的专属信封和专属助手。你可以先去看别的工作；回来时，原来的工作会在原处等着你，而不会跑错本子。

Type `/` in the composer to discover the active Pi RPC workspace's extension commands, prompt templates, and Skills. Filter the accessible list, then use arrow keys and Enter or click a command to insert `/<name> `; submitting it uses Pi's existing `prompt` RPC execution. Built-in interactive TUI commands are intentionally excluded because Pi RPC does not expose them.

During an active Pi run, the conversation shows a working indicator until Pi emits `agent_settled`. Tool entries show their live state and Pi-supplied target context: the path for `read`, `edit`, and `write`, or the command for `bash`. Pi App does not infer or fabricate a target when Pi did not provide one.

Pi App reads persisted JSONL history from the newest 80-message page backward through Tauri's byte-cursor tail reader. When a session has earlier records, select **Load earlier messages** to retrieve the next page. Each loaded page is rendered directly; the frontend does not maintain a second virtualization layer. Use **Hide tool calls** in the conversation header when reviewing a session to show only user and Pi text; the toggle changes presentation only and does not alter persisted history.

Extension commands discovered through Pi RPC are handled according to their own lifecycle. A command that completes without starting an Agent run returns the composer to ready state after Pi accepts it; Pi `notify` extension UI events appear as Pi messages in the active conversation.

Automatic terminal-to-desktop continuation requires an explicit handoff feature. It is intentionally not part of `/app`, so a fresh terminal session that has not yet created a JSONL file can always open Pi App.

## Workspace selection

Pi App launched from `/app` or the terminal inherits that process's current working directory. Opening Pi App directly from Finder or the Dock first prompts for a workspace directory. If you cancel the picker, Pi App displays **Select a workspace to start Pi.** and does not start Pi. **Change workspace** replaces this sole visible workspace; it does not expose previously selected directories as navigation entries.

Pi owns session persistence. Pi App calculates Pi's workspace session directory from the selected canonical workspace and passes it only as the documented startup option:

```text
pi --mode rpc --session-dir <Pi project session directory>
```

A workspace with no existing session directory starts with no sessions; Pi creates the directory and its new session when the RPC process starts. Pi's RPC commands can switch a session, but Pi App does not use that global switch for sidebar navigation. Each active session is addressed by explicit internal workspace/session identity and runs in its workspace cwd.

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
