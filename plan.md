# Pi App 桌面客户端计划与任务台账

> **台账规则**：每次 AI 编程对话必须先按 [`AGENTS.md`](./AGENTS.md) 的流程检查 GitHub 仓库状态，再从本页任务台账领取一个任务。任务开始、转交、阻塞或完成时，必须同步更新本文件。

## 1. 协作状态

- **仓库**：https://github.com/shengxiao20/pi-app
- **参与者**：`Michael`、`Collaborator`（第二位参与者 GitHub 用户名待填写）
- **当前任务**：PIA-010（Michael，In Progress）。将已验收的桌面客户端 prototype 推送至 `feat/app-prototype-complete` 并创建 PR。

### 状态定义

| Status | 含义 |
|---|---|
| `Todo` | 已定义、尚未领取。 |
| `In Progress` | 已由唯一 assignee 领取，正在实施。 |
| `Blocked` | 无法推进；必须记录具体阻塞原因。 |
| `Done` | 验收标准通过，且已记录 PR/commit。 |

---

## 2. 任务台账

| ID | 任务 | Assignee | Status | 验收标准 | PR / Commit |
|---|---|---|---|---|---|
| PIA-000 | 初始化本地 Git 仓库、连接 `origin` 并推送当前协作文档。 | Michael | Done | 本地 `main`、`origin` 与初始协作文档已创建；Michael 已手动推送至 GitHub。 | `1b2b95e`, `d88317b` |
| PIA-001 | 验证 Pi extension 能否注册顶层 `pi app`，并确定受支持的启动入口。 | Michael | Done | 已建立最小 `pi-app` package；`pi -e .` 在 RPC `get_commands` 中公开 `/app`，且 `pi --help` 不公开顶层 `app`。最终入口为交互会话 `/app`。Evidence: `npm test`（3 passed）, `npm pack --dry-run --json`, `git diff --check`。 | [#2](https://github.com/shengxiao20/pi-app/pull/2) / `91e6f1d` |
| PIA-002 | 初始化 monorepo、Tauri 2 + React + TypeScript 工程和基础 CI。 | Michael | Done | npm workspace 下的 React/Vite 前端、Tauri 2 Rust crate 与 GitHub Actions CI 已建立。Evidence: `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:frontend && npm run rust:fmt && npm run rust:clippy && npm run rust:test && git diff --check` 全部通过（前端 1、extension 3、Rust 1 测试）。 | [#3](https://github.com/shengxiao20/pi-app/pull/3) / `2d32fbe` |
| PIA-003 | 实现并测试 TypeScript launcher 的平台二进制解析与 cwd 传递。 | Michael | Done | 支持 darwin arm64/x64、linux x64、win32 x64 的 optional package 映射；不支持平台和缺失 binary 明确报错；`/app` 以 Pi command context cwd、detached 和 ignore stdio 启动并 `unref`。Evidence: 4 launcher tests，完整质量门禁通过（root 7、frontend 1、Rust 1 测试）。 | [#3](https://github.com/shengxiao20/pi-app/pull/3) / `2d32fbe` |
| PIA-004 | 实现并测试 Rust JSONL RPC protocol 与 Pi 子进程 supervisor。 | Michael | Done | 严格按 LF JSONL 解帧（兼容 CRLF、保留不完整帧）、按 response `id` 关联请求并转发流式 event；无效 JSON 与异常退出明确报错，退出时释放 pending request。Evidence: Rust protocol/supervisor 7 个测试 + crate test 1 个；完整质量门禁通过。 | [#3](https://github.com/shengxiao20/pi-app/pull/3) / `2d32fbe` |
| PIA-005 | 实现并测试 Tauri RPC command/event bridge 与 fake-Pi 集成环境。 | Michael | Done | 固定启动 `pi --mode rpc`（WebView 不能控制 executable/cwd）；提供 `start_agent`、`send_rpc`、`abort_agent` command，未关联 JSONL record 通过 `pi-rpc-event` 转发。fake Pi 验证 prompt response、message_update 和 abort；Rust 10 tests 通过。 | [#3](https://github.com/shengxiao20/pi-app/pull/3) / `2d32fbe` |
| PIA-006 | 实现并测试 P0 聊天 UI 状态机与流式消息/工具调用渲染。 | Michael | Done | React UI 通过 Tauri client 调用 `start_agent`/`send_rpc`/`abort_agent` 并监听 `pi-rpc-event`；验证 `idle → starting → ready → streaming → idle`、abort、启动失败、流式文本和工具输出。Evidence: 3 Vitest tests，desktop production build、typecheck、lint 通过。 | [#3](https://github.com/shengxiao20/pi-app/pull/3) / `2d32fbe` |
| PIA-007 | 实现 npm root package、平台 optional-dependency 包及 `npm pack` 安装 smoke test。 | Michael | Done | root 发布包编译 launcher 为 JS、通过 optional/bundled `pi-app-darwin-arm64` 分发完整 Tauri `.app` 和 shim；clean `npm install` smoke 验证 extension registry、launcher binary resolution。真实 Pi RPC `/app` 返回 success 并启动 installed `.app`；打包 UI 截图验证 `ready`。其他平台构建矩阵留给 PIA-008。Evidence: root 8 tests（含 clean-install packaging）、frontend 4、Rust 10、Tauri macOS bundle 与完整质量门禁通过。 | [#3](https://github.com/shengxiao20/pi-app/pull/3) / `2d32fbe` |
| PIA-011 | 采用 Pi 官网视觉语言重构 desktop workspace，并将侧栏收敛为 New chat、Projects、Recents。 | Michael | Done | Sidebar 仅呈现 New chat、Projects、Recents；Recents 保留真实 Pi-backed workspace sessions，Projects 标注当前项目；`npm run format:check`、`npm test`、`npm run test:frontend`、`npm run typecheck`、`npm run lint` 与 `git diff --check` 通过。 | [#3](https://github.com/shengxiao20/pi-app/pull/3) / `dbe2bfe` |
| PIA-012 | 实现 desktop workspace 的 Projects CRUD、真实 Pi session 导入/CRUD 和 macOS app icon。 | Michael | Done | Projects 通过本地 Tauri metadata 可创建、重命名、删除；仅导入 JSONL header `cwd` 匹配当前项目的真实 Pi sessions；创建使用 Pi `new_session`、重命名使用 `set_session_name`，删除只允许删除已验证属于当前 cwd 的真实 JSONL。Tauri bundle 配置并分发有效 `icon.icns`。Evidence: frontend 6/6、root 8/8、Rust 12/12、format/lint/typecheck/clippy、native macOS bundle/repackage 和实际启动截图通过。 | [#3](https://github.com/shengxiao20/pi-app/pull/3) / `27c1cb3` |
| PIA-010 | 发布已验收的 desktop app prototype 至新 feature branch 并创建 PR。 | Michael | Done | `feat/app-prototype-complete` 已推送至 origin，PR 描述已更新为 PIA-002 至 PIA-007、PIA-009 至 PIA-012 的范围、测试证据及平台限制。 | [#3](https://github.com/shengxiao20/pi-app/pull/3) / `2d32fbe`, `dbe2bfe`, `27c1cb3` |

### 任务更新格式

领取任务时更新对应行：

```text
Assignee: Michael
Status: In Progress
```

完成任务时在该行或紧随该行的说明中补充：

```text
Status: Done
PR / Commit: #123 / abcdef1
Evidence: npm test; cargo test; <其他验收命令>
```

任务阻塞时补充：

```text
Status: Blocked
Blocker: <具体外部依赖、错误或待决策事项>
```

---

## 3. 目标与边界

构建一个以 Rust 为核心的 Pi 桌面客户端前端，让用户能通过 Pi npm package 安装，并从 Pi 启动桌面应用：

```bash
pi install npm:pi-app
# 在 Pi 交互会话中执行：
/app
```

桌面应用是 Pi CLI 的图形客户端，不重写 Pi Agent、provider、tool 或 session 系统。

> **PIA-001 结论（2026-09-21）**：Pi extension 无法注册顶层 CLI 裸子命令 `pi app`。`pi.registerCommand("app", …)` 的受支持入口是交互会话中的 `/app`；Pi `--help` 的顶层命令列表不含 `app`。不得通过覆盖全局 `pi` 可执行文件或 PATH 劫持来伪造该能力。

### MVP（P0）

- 从 Pi extension 启动桌面端。
- Rust 后端启动、停止和重启 `pi --mode rpc`。
- 继承执行入口时的当前工作目录。
- 单会话聊天，流式文本、thinking、工具调用及工具输出。
- Abort、模型选择、thinking level、新建会话。
- Pi 不存在、RPC 错误和子进程崩溃时给出清晰错误。
- macOS、Linux、Windows 的基础构建包。

### P1（后续）

- Session 列表、切换、fork、clone；图片输入；steering/follow-up 队列。
- RPC UI 请求：select、confirm、input、editor。
- token/费用/上下文窗口、主题、快捷键、窗口状态持久化、自动更新。

### 不在 MVP

- 自行管理模型 provider 或 API key。
- 自行执行 Pi 工具。
- 改写或直接管理 Pi session JSONL。
- 在 Rust 中重写/嵌入 Pi Agent core。
- 多工作区、多 Agent 并发、云同步。

---

## 4. 技术决策

### 桌面框架：Tauri 2 + Rust + React + TypeScript

| 方案 | 结论 | 理由 |
|---|---|---|
| **Tauri 2 + Rust** | **推荐** | Rust 桌面能力、跨平台构建与打包成熟，体积/资源开销通常低于 Electron，适合管理 Pi RPC 子进程。 |
| Electron | 不作为首选 | 偏重，不符合 Rust 为主的目标。 |
| WRY / tao 自建 | 暂不采用 | Tauri 已覆盖窗口、权限、构建、插件等基础能力；自行维护成本高。 |
| Slint / egui | 不适合 MVP | 复杂聊天、Markdown、代码块、虚拟列表等富 UI 的实现成本较高。 |

默认前端为 React。若项目在 PIA-002 前明确决定 Svelte，可在该任务中替换，不得在后续任务中无关迁移。

### Pi 集成：RPC mode

Pi 的 JSONL RPC mode：

```bash
pi --mode rpc
```

Tauri Rust 后端负责启动与监管该子进程；UI 只消费 Pi 返回的权威事件流。

```text
用户在 Pi 交互会话中执行 /app
        │
        ▼
npm 包内的 Pi Extension（TypeScript）
        │ 启动本机桌面程序
        ▼
Tauri 桌面客户端
        │ spawn / 管理
        ▼
pi --mode rpc
        │ JSONL over stdin/stdout
        ▼
Pi Agent / providers / tools / sessions
```

---

## 5. 架构与职责边界

```text
/app
└── extensions/app.ts
    └── launcher.startDesktopClient()
        └── pi-app-{platform}-{arch} binary
            └── RpcSupervisor.start()
                └── spawn("pi", ["--mode", "rpc", ...])
                    ├── stdin: RPC commands
                    └── stdout: RPC events
                        └── Tauri event bridge
                            └── React state store
                                └── Chat / tools / sessions UI
```

| 组件 | 责任 |
|---|---|
| `extensions/app.ts` | 注册 Pi command，并调用 launcher。 |
| `launcher/` | 识别平台、查找/校验二进制文件、启动桌面客户端。 |
| Rust RPC supervisor | 启动 Pi、JSONL 编解码、请求关联、子进程生命周期与异常处理。 |
| React UI | 呈现状态与派发用户操作；不实现 Agent 逻辑。 |

约束：

- 不在桌面端自行实现 provider、工具执行或 Pi session 文件格式。
- 不静默降级；二进制缺失、Pi 不存在、RPC 解析失败、子进程退出均必须显示明确错误。
- Pi CLI 是唯一 Agent 真相来源；UI 只显示和驱动其 RPC 协议。

### 核心伪代码

```text
on supported Pi app command:
  resolve OS + CPU architecture
  locate matching bundled desktop binary
  spawn binary detached with caller cwd
  return control to Pi terminal

on desktop startup:
  start `pi --mode rpc` in inherited project cwd
  read stdout as strict newline-delimited JSON records
  decode each RPC response/event
  emit typed events to frontend

on user prompt:
  write JSON prompt request to Pi stdin
  render pending UI state
  consume streamed deltas and tool events
  finalize only after Pi's authoritative completion event
```

---

## 6. 建议目录结构

```text
pi-app/
├── package.json                    # npm / Pi package manifest
├── extensions/
│   └── app.ts                      # 注册 Pi 入口
├── launcher/
│   └── index.ts                    # 定位并启动桌面二进制
├── desktop/
│   ├── package.json
│   ├── src/
│   │   ├── app/
│   │   ├── features/
│   │   │   ├── chat/
│   │   │   ├── sessions/
│   │   │   ├── composer/
│   │   │   ├── tools/
│   │   │   ├── settings/
│   │   │   └── rpc/
│   │   ├── components/
│   │   └── styles/
│   └── src-tauri/
│       ├── src/
│       │   ├── app.rs
│       │   ├── commands/
│       │   ├── rpc/
│       │   │   ├── process.rs
│       │   │   ├── protocol.rs
│       │   │   └── supervisor.rs
│       │   └── state/
│       ├── capabilities/
│       ├── tauri.conf.json
│       └── Cargo.toml
├── tests/
│   ├── extension/
│   ├── launcher/
│   └── e2e/
└── scripts/
    ├── package-binaries.mjs
    └── release.mjs
```

---

## 7. npm 分发设计

Pi package 使用 `pi` manifest 声明 extension：

```json
{
  "name": "pi-app",
  "version": "0.1.0",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"]
  }
}
```

跨平台 Tauri 二进制采用 optional dependency 平台包：

```text
pi-app                    # extension + launcher
pi-app-darwin-arm64       # Tauri binary
pi-app-darwin-x64         # Tauri binary
pi-app-linux-x64-gnu      # Tauri binary
pi-app-win32-x64-msvc     # Tauri binary
```

根包示意：

```json
{
  "optionalDependencies": {
    "pi-app-darwin-arm64": "0.1.0",
    "pi-app-darwin-x64": "0.1.0",
    "pi-app-linux-x64-gnu": "0.1.0",
    "pi-app-win32-x64-msvc": "0.1.0"
  }
}
```

launcher 基于 `process.platform` 和 `process.arch` 精确查找对应包；不支持的平台或缺失文件必须直接报错。

---

## 8. 验证与发布路线

### 测试顺序

1. **入口可行性**：最小 Pi package 和入口自动化测试。
2. **launcher**：OS/arch 映射、binary 缺失、cwd、单实例。
3. **Rust RPC**：LF JSONL 分帧、解码、request ID、流式事件、异常退出。
4. **Tauri bridge**：`start_agent`、`send_rpc`、`abort_agent` 与 fake Pi 集成。
5. **UI 状态机**：

   ```text
   idle → starting → ready → streaming → idle
   streaming → aborting → idle
   任意状态 → failed
   ```

6. **端到端**：`npm pack`、`pi install <tarball>`、fake Pi、真实 Pi smoke test、三平台启动。

### 发布流水线

```text
Pull Request
├── TypeScript lint / typecheck / unit tests
├── Rust fmt / clippy / unit tests
├── frontend unit tests
└── fake-Pi integration tests

Tag vX.Y.Z
├── build Tauri artifacts: macOS / Linux / Windows
├── generate platform npm packages
├── publish platform packages
├── publish root pi-app package
├── clean install through Pi
└── launch + RPC handshake smoke test
```

CI 构建矩阵：

```text
macos-14       → darwin-arm64
macos-intel    → darwin-x64
ubuntu-latest  → linux-x64-gnu
windows-latest → win32-x64-msvc
```

---

## 9. 调研结论

- Pi package 支持 `pi install npm:<package>`。
- package 可通过 `package.json` 的 `pi.extensions` 声明 TypeScript/JavaScript extension。
- Pi 0.86.1 的 extension API `pi.registerCommand("app", …)` 注册交互式 slash command `/app`，不能注册顶层 CLI 子命令 `pi app`；`tests/extension/entrypoint.test.mjs` 以 RPC `get_commands` 和 `pi --help` 自动验证该结论。
- Pi RPC mode 是为嵌入自定义 UI 而设计的 JSON stdin/stdout 协议，适合作为桌面客户端和 Pi Agent 的通信层。
- 当前工作区最初为空；CodeGraph 已初始化。
