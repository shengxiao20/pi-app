# Pi Native App（中文）

[English](README.md)
当前版本：**0.1.15**。
这是 [Pi coding-agent harness](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) 的原生桌面客户端。
Pi Native App 是一个 Pi Package，而不是独立的 Agent 运行时。
`/app` 扩展会在当前项目目录中启动原生桌面客户端。
桌面客户端会为该项目启动自己的独立 Pi RPC 会话。
## 安装
```sh
pi install npm:pi-native-app
```
## 使用
从要工作的项目启动 Pi，然后运行 `/app`：
```sh
cd /path/to/project
pi
```
扩展会等待活动 Agent 结束，然后使用当前项目目录启动原生应用。
终端 Pi 进程仍保持活动；桌面端会启动独立的 Pi RPC 会话。
## 当前工作区、会话和标签
`/app` 不会接管终端中的活动对话。
Pi App 在任意时刻只显示**一个规范的当前工作区**：从 `/app` 继承的目录，或通过 Pi App 标题旁的 **Change workspace** 选择的目录。
切换工作区会替换可见会话列表；它绝不会将侧边栏变成其他目录的目录册，也不会隐式停止或中止活动会话。
Pi 负责 JSONL 会话持久化。
Pi App 只读取当前工作区的已持久化对话，并且仅在会话首次需要发送工作时启动专用 Pi RPC 子进程。
导航期间会话可以在后台继续；每个进程都通过其 session ID 和 instance ID 识别，因此其事件只会到达该会话。
侧边栏按一个可选标签分组会话，另有固定的 **Uncategorized** 组。
标签和归属是以规范工作区路径和 Pi session ID 为键的应用私有 SQLite 元数据。
标签名称必须非空且唯一。
删除标签只会删除其元数据归属，并立即将会话返回 Uncategorized：Pi App 从不删除、迁移或写入 Pi JSONL 会话文件或旧版 `projects.json` 目录。
非当前会话完成、失败或中止时，Pi App 会创建内存中的通知。
灯泡控件显示未读数量，并打开可跳转到相应会话的条目。
这些通知不是系统通知，也不会在应用重启后保留。
每个会话都拥有自己的草稿、运行时状态、错误、流式输出、工具和未读状态。
后台输出会获得可访问的未读标记而不抢占焦点；选择该会话会清除标记，同时保留其终端状态。
在编辑框中输入 `/` 可发现活动 Pi RPC 工作区的扩展命令、提示模板和 Skills。
筛选可访问列表后，使用方向键和 Enter，或点击命令以插入 `/<name> `；提交时使用 Pi 现有的 `prompt` RPC 执行。
内置交互式 TUI 命令被有意排除，因为 Pi RPC 不暴露它们。
在活动 Pi 运行期间，对话会显示工作指示器，直到 Pi 发出 `agent_settled`。
工具条目显示其实时状态和 Pi 提供的目标上下文：`read`、`edit`、`write` 显示路径，`bash` 显示命令。
Pi 未提供目标时，Pi App 不会推断或编造目标。
Pi App 通过 Tauri 的字节游标尾部读取器，从最新的 80 条消息页向前读取已持久化的 JSONL 历史。
会话存在更早记录时，选择 **Load earlier messages** 以获取下一页。
每个已加载页面都会直接渲染；前端不维护第二层虚拟化。
审阅会话时，使用对话标题中的 **Hide tool calls** 仅显示用户和 Pi 文本；该切换只改变展示，不修改持久化历史。
通过 Pi RPC 发现的扩展命令会按其自身生命周期处理。
未启动 Agent 运行便完成的命令，在 Pi 接受后会将编辑框恢复为就绪状态；Pi `notify` 扩展 UI 事件会作为 Pi 消息出现在活动对话中。
自动从终端续接到桌面端需要显式的交接功能。
它有意不属于 `/app`，因此尚未创建 JSONL 文件的全新终端会话始终可以打开 Pi App。
## 工作区选择
从 `/app` 或终端启动的 Pi App 会继承该进程的当前工作目录。
直接从 Finder 或 Dock 打开 Pi App 时，会先提示选择工作区目录。
如果取消选择器，Pi App 会显示 **Select a workspace to start Pi.**，并且不会启动 Pi。
**Change workspace** 会替换这个唯一可见的工作区；它不会将此前选择的目录显示为导航条目。
Pi 负责会话持久化。
Pi App 会根据所选规范工作区计算 Pi 的工作区会话目录，并仅将其作为文档化的启动选项传递：
```text
pi --mode rpc --session-dir <Pi project session directory> [--session <Pi session JSONL path>]
```
没有现有会话目录的工作区会以无会话状态启动；RPC 进程启动时，Pi 会创建该目录和新会话。
Pi 的 RPC 命令可以切换会话，但 Pi App 不会将该全局切换用于侧边栏导航。
每个活动会话都有自己的 Pi RPC 进程，该进程在工作区 cwd 中启动并直接绑定到该会话。
Finder 和 Dock 不会继承终端的 `PATH`。
在 macOS 上，Pi App 通过用户的 zsh 登录/交互环境启动相同的文档化命令。
这使通过 npm/NVM 安装的 `pi` 及其 Node 解释器可用；zsh 会立即 `exec` Pi，使 JSONL RPC stdin/stdout 管道直接连接到 Pi。
这要求用户的 zsh 环境中存在可用的 `pi` 命令。
在 Windows 上，Pi App 通过继承的环境直接启动 `pi --mode rpc`。
运行 `/app` 前，请确保 `pi` 命令可在 `PATH` 中使用。
## 平台支持
发行版包含适用于 macOS Apple Silicon (`darwin-arm64`) 和 Windows x64 (`win32-x64-msvc`) 的预构建原生应用。
用户不需要 Rust、Xcode、Tauri 或本地构建步骤。
## 开发和发布
在本地更新每个版本字段，并通过常规 PR 合入该版本提升。
然后从 GitHub Actions 手动运行 **Publish Pi Native App release**。
它会读取合入后的 `main` 版本，在原生 runner 上构建 macOS ARM64 和 Windows x64 二进制，创建 GitHub Release 和匹配的 `v<version>` 标签，并按顺序向 npm 发布平台包和根包。
仓库需要一个具有发布 `pi-native-app` 及其平台包权限的 `NPM_TOKEN` GitHub Actions secret。
npm tarball 包含 Pi 扩展、已编译 launcher、许可证/README，以及 npm 为用户操作系统和架构选择的平台专属预构建原生 bundle。
