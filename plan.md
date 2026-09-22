# Pi App 桌面客户端计划与任务台账

> **台账规则**：每次 AI 编程对话必须先按 [`AGENTS.md`](./AGENTS.md) 的流程检查 GitHub 仓库状态，再从本页任务台账领取一个任务。任务开始、转交、阻塞或完成时，必须同步更新本文件。

## 1. 协作状态

- **仓库**：https://github.com/shengxiao20/pi-app
- **参与者**：`Michael`、`Collaborator`（第二位参与者 GitHub 用户名待填写）
- **当前任务**：无。PIA-058 已完成：PR #6 的唯一提交已重写并由 GitHub 归属至 `shengxiao20`。

### 状态定义

| Status        | 含义                               |
| ------------- | ---------------------------------- |
| `Todo`        | 已定义、尚未领取。                 |
| `In Progress` | 已由唯一 assignee 领取，正在实施。 |
| `Blocked`     | 无法推进；必须记录具体阻塞原因。   |
| `Done`        | 验收标准通过，且已记录 PR/commit。 |

---

## 2. 任务台账

| ID      | 任务                                                                                                                                                                                       | Assignee | Status | 验收标准                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | PR / Commit                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| PIA-000 | 初始化本地 Git 仓库、连接 `origin` 并推送当前协作文档。                                                                                                                                    | Michael  | Done   | 本地 `main`、`origin` 与初始协作文档已创建；Michael 已手动推送至 GitHub。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `1b2b95e`, `d88317b`                                                              |
| PIA-001 | 验证 Pi extension 能否注册顶层 `pi app`，并确定受支持的启动入口。                                                                                                                          | Michael  | Done   | 已建立最小 `pi-app` package；`pi -e .` 在 RPC `get_commands` 中公开 `/app`，且 `pi --help` 不公开顶层 `app`。最终入口为交互会话 `/app`。Evidence: `npm test`（3 passed）, `npm pack --dry-run --json`, `git diff --check`。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | [#2](https://github.com/shengxiao20/pi-app/pull/2) / `91e6f1d`                    |
| PIA-002 | 初始化 monorepo、Tauri 2 + React + TypeScript 工程。                                                                                                                                       | Michael  | Done   | npm workspace 下的 React/Vite 前端与 Tauri 2 Rust crate 已建立；根据 Michael 的明确要求，GitHub Actions CI/CD 已移除，质量门禁仅作为本地命令执行。Evidence: `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:frontend && npm run rust:fmt && npm run rust:clippy && npm run rust:test && git diff --check` 全部通过（前端 1、extension 3、Rust 1 测试）。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | [#3](https://github.com/shengxiao20/pi-app/pull/3) / `2d32fbe`, 待提交 CI/CD 移除 |
| PIA-003 | 实现并测试 TypeScript launcher 的平台二进制解析与 cwd 传递。                                                                                                                               | Michael  | Done   | 支持 darwin arm64/x64、linux x64、win32 x64 的 optional package 映射；不支持平台和缺失 binary 明确报错；`/app` 以 Pi command context cwd、detached 和 ignore stdio 启动并 `unref`。Evidence: 4 launcher tests，完整质量门禁通过（root 7、frontend 1、Rust 1 测试）。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | [#3](https://github.com/shengxiao20/pi-app/pull/3) / `2d32fbe`                    |
| PIA-004 | 实现并测试 Rust JSONL RPC protocol 与 Pi 子进程 supervisor。                                                                                                                               | Michael  | Done   | 严格按 LF JSONL 解帧（兼容 CRLF、保留不完整帧）、按 response `id` 关联请求并转发流式 event；无效 JSON 与异常退出明确报错，退出时释放 pending request。Evidence: Rust protocol/supervisor 7 个测试 + crate test 1 个；完整质量门禁通过。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | [#3](https://github.com/shengxiao20/pi-app/pull/3) / `2d32fbe`                    |
| PIA-005 | 实现并测试 Tauri RPC command/event bridge 与 fake-Pi 集成环境。                                                                                                                            | Michael  | Done   | 固定启动 `pi --mode rpc`（WebView 不能控制 executable/cwd）；提供 `start_agent`、`send_rpc`、`abort_agent` command，未关联 JSONL record 通过 `pi-rpc-event` 转发。fake Pi 验证 prompt response、message_update 和 abort；Rust 10 tests 通过。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | [#3](https://github.com/shengxiao20/pi-app/pull/3) / `2d32fbe`                    |
| PIA-006 | 实现并测试 P0 聊天 UI 状态机与流式消息/工具调用渲染。                                                                                                                                      | Michael  | Done   | React UI 通过 Tauri client 调用 `start_agent`/`send_rpc`/`abort_agent` 并监听 `pi-rpc-event`；验证 `idle → starting → ready → streaming → idle`、abort、启动失败、流式文本和工具输出。Evidence: 3 Vitest tests，desktop production build、typecheck、lint 通过。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | [#3](https://github.com/shengxiao20/pi-app/pull/3) / `2d32fbe`                    |
| PIA-007 | 实现 npm root package、平台 optional-dependency 包及 `npm pack` 安装 smoke test。                                                                                                          | Michael  | Done   | root 发布包编译 launcher 为 JS、通过 optional/bundled `pi-app-darwin-arm64` 分发完整 Tauri `.app` 和 shim；clean `npm install` smoke 验证 extension registry、launcher binary resolution。真实 Pi RPC `/app` 返回 success 并启动 installed `.app`；打包 UI 截图验证 `ready`。其他平台构建矩阵留给 PIA-008。Evidence: root 8 tests（含 clean-install packaging）、frontend 4、Rust 10、Tauri macOS bundle 与完整质量门禁通过。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | [#3](https://github.com/shengxiao20/pi-app/pull/3) / `2d32fbe`                    |
| PIA-011 | 采用 Pi 官网视觉语言重构 desktop workspace，并将侧栏收敛为 New chat、Projects、Recents。                                                                                                   | Michael  | Done   | Sidebar 仅呈现 New chat、Projects、Recents；Recents 保留真实 Pi-backed workspace sessions，Projects 标注当前项目；`npm run format:check`、`npm test`、`npm run test:frontend`、`npm run typecheck`、`npm run lint` 与 `git diff --check` 通过。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | [#3](https://github.com/shengxiao20/pi-app/pull/3) / `dbe2bfe`                    |
| PIA-012 | 实现 desktop workspace 的 Projects CRUD、真实 Pi session 导入/CRUD 和 macOS app icon。                                                                                                     | Michael  | Done   | Projects 通过本地 Tauri metadata 可创建、重命名、删除；仅导入 JSONL header `cwd` 匹配当前项目的真实 Pi sessions；创建使用 Pi `new_session`、重命名使用 `set_session_name`，删除只允许删除已验证属于当前 cwd 的真实 JSONL。Tauri bundle 配置并分发有效 `icon.icns`。Evidence: frontend 6/6、root 8/8、Rust 12/12、format/lint/typecheck/clippy、native macOS bundle/repackage 和实际启动截图通过。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | [#3](https://github.com/shengxiao20/pi-app/pull/3) / `27c1cb3`                    |
| PIA-014 | 修复 desktop 与 Pi terminal session lifecycle 不一致：以 Pi 项目 session directory 为权威，列出真实同 cwd sessions，删除后使 terminal resume 不再可选，并支持 handoff/custom session-dir。 | Michael  | Done   | Desktop Recents 从 `list_sessions` 的 Pi persisted session store 加载；root 取 handoff JSONL 的 parent，默认模式复刻 Pi cwd 编码 directory；desktop RPC 同样传递 `--session-dir`，因此 New chat 与 terminal resume 写入/读取同一目录。删除仍要求 canonical path 位于该目录且 JSONL header `cwd` 匹配。Rust custom-directory test 覆盖 list/delete、隔离 foreign cwd/default directory；frontend 6/6 覆盖 persisted Recents。真实 Pi custom-dir subprocess 验证 `switch_session → get_state → get_messages` 恢复 handed-off JSONL。全量 format/lint/typecheck、Node 8/8、Rust 11/11、darwin-arm64 native build 通过。                                                                                                                                                                                                                                                                                                                 | 待提交                                                                            |
| PIA-013 | 将 desktop 重构为 Pi persisted session 的替代 renderer：`/app` 显式交接当前 terminal session，desktop 恢复历史并以真实 Pi RPC 继续；移除不代表 Pi 能力的本地 Projects CRUD。               | Michael  | Done   | `/app` 等待 idle 后传递 `sessionManager.getSessionFile()`，desktop 以 `switch_session → get_state → get_messages` 恢复历史并关闭 terminal renderer；Projects metadata API/UI 已移除；失败/cancelled RPC 不更新 UI。通过 format/lint/typecheck、frontend 5/5、Node 8/8、Rust 11/11 与 darwin-arm64 native build。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `041c3c8`                                                                         |
| PIA-015 | 将 New chat 的默认持久化名称设为 Pi sessionId，并修复小窗口中的 workspace 空白纵向滚动。                                                                                                   | Michael  | Done   | New chat 后 Pi `set_session_name` 接收该 sessionId，侧栏及标题显示该 ID；窗口低于 630px 时 app shell 不再因最小高度产生文档级空白滚动；前端回归测试 7/7、`npm run lint --workspace @pi-app/desktop`、`npm run typecheck --workspace @pi-app/desktop`、`npm run format:check --workspace @pi-app/desktop` 与 `git diff --check` 均通过。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 待提交                                                                            |
| PIA-016 | 将 desktop 应用图标从圆形占位图替换为 Pi（`π`）符号，并同步 macOS `icns` 与 PNG 打包资源。                                                                                                 | Michael  | Done   | `icons/icon.svg` 以 Pi 官网暖白／珊瑚粉 `#e98c78`／浅蓝 `#5a9abf`／金黄 `#ecc261` 定义 Pi 标识；已生成有效 1024px PNG 和 ICNS，Tauri bundle 配置继续引用两项资源，打包 `.app` 的 Resources/icon.icns 与源资源字节一致。`node --test tests/assets/application-icon.test.mjs`、format check 与 diff check 通过；Tauri 成功生成 macOS `.app`，DMG 的 create-dmg 脚本在本机无参数执行而失败。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 待提交                                                                            |
| PIA-017 | 诊断并修复 `/app` 启动未生效或已修改内容未进入实际启动产物的问题。                                                                                                                         | Michael  | Done   | 根因是 `build:native` 默认 Tauri `targets=all`：DMG 的 `bundle_dmg.sh` 失败令 `&& node scripts/package-native.mjs` 跳过，已生成 `.app` 未复制到平台包。改为 `--bundles app` 后 native build 和重打包完成；target/package executable SHA-1 均为 `9e3924467a1eaf1813f6957617ed12852667f12e`。`npm test` 9/9（含 clean-install packaging smoke）、typecheck、frontend 7/7、Rust 11/11、format、lint、diff check 均通过；真实平台 shim 携带 `--pi-session-file` 启动 desktop process 并存活 3 秒。                                                                                                                                                                                                                                                                                                                                                                                                                                       | 待提交                                                                            |
| PIA-018 | 修复历史未命名 Pi session 的标题回退，并防止侧栏 session 操作挤压标题。                                                                                                                    | Michael  | Done   | `WorkspaceStore` 对无 `session_info.name` 的 JSONL 用 header `id` 作为标题；active session 仅以 Pi RPC 的显式名称覆盖它；Rename/Delete 已移至标题下方。回归：frontend 8/8、Rust 12/12；全量 Node 9/9、packaging 1/1、typecheck、format、lint、Rust fmt/clippy 和 diff check 均通过。native `.app` 已重打包，target/package/node_modules executable SHA-1 均为 `de14678146e502a62adb9f2d3701b8ac7be51051`。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 待提交                                                                            |
| PIA-019 | 修复 desktop 页面在 Tauri WebView 中未填满窗口导致的文档级空白滚动，并增大默认窗口尺寸。                                                                                                   | Michael  | Done   | `html`、`body`、`#root` 与 app shell 填满可用 WebView 高度，页面不再在 workspace 后显示空白 body 区域；默认窗口已调整为 1440×900。新增配置/样式回归测试；Node 9/9、packaging 1/1、frontend 8/8、typecheck、format、lint、Rust fmt/clippy/test 12/12 和 diff check 均通过。native `.app` 已重打包，target/package/node_modules executable SHA-1 均为 `9686362e6c40dac2fd5ee15fc2ea3b28c355af04`。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 待提交                                                                            |
| PIA-020 | 修复高 DPI/缩放下窄屏媒体查询覆盖 app shell 全高、仍显示文档级空白的问题。                                                                                                                 | Michael  | Done   | 运行时截图确认 `max-width:700px` 规则覆盖 `.app-shell` 为 `height:auto`/`overflow:visible`；已移除该覆盖，同时保留单列窄屏布局。新增媒体查询回归断言先失败后通过；Node 9/9、packaging 1/1、frontend 8/8、typecheck、format、lint、Rust fmt/clippy/test 12/12、diff check 均通过。native `.app` 已重打包，target/package/node_modules executable SHA-1 均为 `f11714359dd07e03656ad2c335700fd3160ae7fe`。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 待提交                                                                            |
| PIA-021 | 在本地 Pi App bundle 被删除后重新构建并恢复 `/app` 所需的 darwin-arm64 平台包。                                                                                                            | Michael  | Done   | 已从源码重建 macOS `.app` 并恢复 target、`packages/pi-app-darwin-arm64`、`node_modules/pi-app-darwin-arm64`；四处 executable SHA-1 均为 `f11714359dd07e03656ad2c335700fd3160ae7fe`。launcher dry-run 解析 node_modules shim 并传递 `--pi-session-file`；packaging smoke、Node 9/9、typecheck、format、lint、Rust fmt/clippy/test 12/12 和 diff check 均通过。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 待提交                                                                            |
| PIA-022 | 修复 release Tauri WebView 中百分比高度未可靠约束 app shell、窗口下半部仍为空白的问题。                                                                                                    | Michael  | Done   | 新截图确认当前进程实际来自 `node_modules`，其 SHA 与 target/package 一致，且显示内容来自同一 handoff JSONL；改用 `.app-shell { position: fixed; inset: 0; }` 直接约束 WebView，而不依赖百分比高度链。回归测试先失败后通过；Node 9/9、packaging 1/1、frontend 8/8、typecheck、format、lint、Rust fmt/clippy/test 12/12、diff check 均通过。native `.app` 已重打包，target/package/node_modules executable SHA-1 均为 `7ca8229f1bdb9efe49ed3156f8b4115bc97c985d`。                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 待提交                                                                            |
| PIA-023 | 修复未渲染 error 时 CSS Grid 自动放置导致 Conversation 未占可滚动 `1fr` 行的问题。                                                                                                         | Michael  | Done   | 未渲染 error 时 conversation 曾自动进入第二个 `auto` 行、composer 进入 `1fr` 行；已将 conversation/composer 显式定位至第 3/4 行，并为 workspace 增加 `min-height:0`，使 Conversation 内部滚动且 composer 固定底部。回归测试先失败后通过；Node 9/9、packaging 1/1、frontend 8/8、typecheck、format、lint、Rust fmt/clippy/test 12/12、diff check 均通过。native `.app` 已重打包，target/package/node_modules executable SHA-1 均为 `ad7854a625f6bf5251c1e483a35c0d5efbb5975e`。                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 待提交                                                                            |
| PIA-024 | 移除无用的 ready 状态文本，并让 session Rename/Delete 使用可靠的应用内对话框。                                                                                                             | Michael  | Done   | 移除 header、侧栏和 composer 的 ready 文本；替换 release WebView 中不可靠的 `window.prompt`/`window.confirm` 为应用内 Rename 输入及 Delete 确认对话框，Rename 发送 `set_session_name`、Delete 调用持久化删除。新增成功路径和 UI 精简回归；Node 9/9、packaging 1/1、frontend 11/11、typecheck、format、lint、Rust fmt/clippy/test 12/12、diff check 均通过。native `.app` 已重打包，target/package/node_modules executable SHA-1 均为 `1615811262837023abf88669bf46f358f99c1417`。                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 待提交                                                                            |
| PIA-025 | 缓存已加载的 session 历史，减少在 Recents 间往返切换时的重复 Pi RPC 和全量消息映射。                                                                                                       | Michael  | Done   | 增加 `historyLoaded` 会话状态。首次访问仍执行 `switch_session` 和 `get_messages`；再次访问已加载会话只执行 `switch_session` 并复用缓存历史，避免重复映射完整 Pi message 数组。新增前端回归；Node 9/9、packaging 1/1、frontend 12/12、typecheck、format、lint、Rust fmt/clippy/test 12/12、diff check 通过。native `.app` 已重打包，target/package/node_modules executable SHA-1 均为 `30cbfcb576406415007248c8dd615767c408f32a`。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 待提交                                                                            |
| PIA-026 | 修复当前项目 Recents 侧栏在窗口内裁剪 session，并显示当前工作目录。                                                                                                                        | Michael  | Done   | Recents 仍只列出当前 cwd 的 Pi persisted sessions；侧栏将可用剩余高度分配给 Recents，超出时在列表内部滚动而不是被固定 app shell 裁剪；UI 明确展示 desktop 启动时的 canonical 当前目录。新增前端目录显示回归及样式滚动约束回归。验证：frontend 13/13、Node 9/9、packaging 1/1、typecheck、lint、format check、Rust fmt/clippy/test 12/12、diff check 均通过；native `.app` 已重打包，target/package/node_modules executable SHA-1 均为 `09b22827e09d7a8172c2e724f6b279341a6b99c6`。                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 待提交                                                                            |
| PIA-027 | 完整显示选中 Pi session 的历史 tool call 与 tool result。                                                                                                                                  | Michael  | Done   | 右侧 Conversation 保留 `get_messages` 中按顺序返回的 user/assistant text、assistant tool call 与关联 tool result；历史 tool result 不再被静默过滤，实时 tool 更新复用同一历史条目。新增历史 tool call/result 前端回归。验证：frontend 14/14、Node 9/9、packaging 1/1、typecheck、lint、format check、Rust fmt/clippy/test 12/12、diff check 均通过；native `.app` 已重打包，target/package/node_modules executable SHA-1 均为 `f076773c9f4dd7d749f35181ce676087a20f4780`。                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 待提交                                                                            |
| PIA-028 | 以 Pi TUI 语义适配桌面历史消息的 Markdown 和工具执行呈现。                                                                                                                                 | Michael  | Done   | user/assistant 文本以 `react-markdown` 渲染（含 fenced code 与 strong）；工具执行显示紧凑、状态化摘要，结果按需展开，不再生成空白全宽线框。已阅读 Pi TUI 实现以确认 Markdown 与 pending/success/error tool 语义。新增前端回归。验证：frontend 14/14、Node 9/9、packaging 1/1、layout 1/1、typecheck、lint、format check、Rust fmt/clippy/test 12/12、diff check 均通过；native `.app` 已重打包，target/package/node_modules executable SHA-1 均为 `25d80a25ddeb6ad3c2968999e96fddf1b44375ca`。                                                                                                                                                                                                                                                                                                                                                                                                                                       | 待提交                                                                            |
| PIA-029 | 从当前项目 session JSONL 加载完整时间线，而非 Pi compacted RPC context。                                                                                                                   | Michael  | Done   | 选择 session 后仍发送 `switch_session`，但右侧从已验证属于当前项目的 JSONL 读取最早至最新的全部持久化 message records；不再使用 Pi `get_messages` 的 compacted `session.messages` 作为历史展示源。新增 Rust 时序回归（含 compaction record）和前端 sessionHistory 缓存回归。验证：frontend 14/14、Rust 13/13、Node 9/9、packaging 1/1、layout 1/1、typecheck、lint、format check、Rust fmt/clippy、diff check 均通过；native `.app` 已重打包，target/package/node_modules executable SHA-1 均为 `d4ec1f9bdec6833b14061e0867eb8a126eaa61b5`。                                                                                                                                                                                                                                                                                                                                                                                         | 待提交                                                                            |
| PIA-030 | 修复桌面 Markdown 行内代码与 fenced code block 字号过小的问题。                                                                                                                            | Michael  | Done   | 行内 code 维持等宽与背景但继承正文可读字号；fenced code block 使用显式 `14px/1.6` 等宽排版。新增样式回归。修复 Rust 并行测试临时目录命名碰撞，确保回归稳定。验证：frontend 14/14、Rust 13/13、Node 9/9、packaging 1/1、layout 1/1、typecheck、lint、format check、Rust fmt/clippy、diff check 均通过；native `.app` 已重打包，target/package/node_modules executable SHA-1 均为 `d66f9de49acf7efc1957c31374417106f7c306ce`。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 待提交                                                                            |
| PIA-031 | 在 Pi 处理已发送 prompt、尚未收到首个文字事件时显示加载反馈。                                                                                                                              | Michael  | Done   | Send 后立刻显示带旋转圆环、`role=status` 和 “Pi is working” 可访问名称的加载指示；Pi settled 或请求失败后移除，Stop 在处理期间仍可用。新增前端回归。验证：frontend 14/14、Rust 13/13、Node 9/9、packaging 1/1、layout 1/1、typecheck、lint、format check、Rust fmt/clippy、diff check 均通过；native `.app` 已重打包，target/package/node_modules executable SHA-1 均为 `f1dbf6f7fdd9f78da9dd3c79019cf71459d7777f`。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 待提交                                                                            |
| PIA-032 | 修复消息作者小号标签 CSS 误缩小 Markdown `**strong**` 文本的问题。                                                                                                                         | Michael  | Done   | 作者标签样式从宽泛 `.message strong` 收窄为 `.message > div > strong`；Markdown `<strong>` 继承正文大小，仅表达加粗。新增样式回归，禁止恢复宽泛 selector。验证：frontend 14/14、Rust 13/13、Node 9/9、packaging 1/1、layout 1/1、typecheck、lint、format check、Rust fmt/clippy、diff check 均通过；native `.app` 已重打包，target/package/node_modules executable SHA-1 均为 `dfb8a7deb8c141c1a69b33b3ed440932c084dac5`。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 待提交                                                                            |
| PIA-033 | 虚拟化长 session 的 Conversation 历史，消除切换时一次挂载全部 Markdown 与工具节点造成的主线程卡顿。                                                                                        | Michael  | Done   | `Conversation` 使用 `ResizeObserver` 测量的可变高度 windowing：完整 persisted timeline 保留为 `HistoryEntry[]`，仅视口及 960px overscan 挂载 Markdown/tool entry；120px 估算及 spacer 保持历史完整可滚动访问。每次选择仍发送 `switch_session`，`historyLoaded` 仍避免重复持久化读取。前端回归验证 200 条 history 不会全量挂载。验证：frontend 15/15、Rust 13/13、Node 9/9、packaging 1/1、layout 1/1、typecheck、lint、format check、Rust fmt/clippy、diff check 均通过；native `.app` 已重打包，target/package/node_modules executable SHA-1 均为 `48c0a87ffe016fd8221526541522d666e889ba96`。                                                                                                                                                                                                                                                                                                                                      | 待提交                                                                            |
| PIA-034 | 打开或切换已有 session 时默认定位最新消息，而不是最早历史。                                                                                                                                | Michael  | Done   | Conversation 在首次布局及虚拟项 `ResizeObserver` 高度校正期间保持 follows-latest 底部锚点，打开时显示最新 history；scroll handler 仅在用户离开底部时解除锚定，手动查看早期消息不会被拉回。前端回归覆盖 200 条 history 初始定位最后一项。验证：frontend 16/16、Rust 13/13、Node 9/9、packaging 1/1、layout 1/1、typecheck、lint、format check、Rust fmt/clippy、diff check 均通过；native `.app` 已重打包，target/package/node_modules executable SHA-1 均为 `d5fa3f8cf72f8028057fda34e3c7764fe11a1467`。                                                                                                                                                                                                                                                                                                                                                                                                                             | 待提交                                                                            |
| PIA-035 | 按尾页按需加载 persisted history，消除首次切换时完整 JSONL history 的大 IPC payload。                                                                                                      | Michael  | Done   | `session_history` 以 cursor page 返回 `messages/start/has_more`；首次打开或首次切换仅获取最新 80 条 persisted message，保持每次 `switch_session`；上滚至已加载 history 顶端 240px 内时再加载上一页，直至完整 history 可访问。前端保留 raw persisted messages 并重映射累积页，使跨页 tool call/result 仍可关联。回归覆盖首请求 `(MAX_SAFE_INTEGER, 80)`、尾页渲染、上滚请求 `(80, 80)` 及 Rust cursor 边界。验证：frontend 17/17、Rust 14/14、Node 9/9、packaging 1/1、layout 1/1、typecheck、lint、format check、Rust fmt/clippy、diff check 均通过；native `.app` 已重打包，target/package/node_modules executable SHA-1 均为 `d8ad301b4b577656242284a969429e31c5b7409d`。                                                                                                                                                                                                                                                          | 待提交                                                                            |
| PIA-036 | 消除尾页分页仍全量扫描 JSONL 的切换阻塞，并在切换期间立即反馈目标 session。                                                                                                                | Michael  | Done   | `session_history` cursor 改为 JSONL byte offset；native 端以 64KB blocks 从文件末尾反向读取，仅解析组成 page 所需完整 records，项目校验仅读首个 header line。选择未缓存 session 时立即激活目标项并显示 `Loading latest history…`，`switch_session` 与 tail read 并行；拒绝切换则恢复此前 active session。回归覆盖 byte cursor 前翻、tail page、即时目标标题/loading 与 RPC/history 并行。验证：frontend 18/18、Rust 14/14、Node 9/9、packaging 1/1、layout 1/1、typecheck、lint、format check、Rust fmt/clippy、diff check 均通过；native `.app` 已重打包，target/package/node_modules executable SHA-1 均为 `1bb9aec5df42f5f81e43ad70ad75ab1535a521fd`。                                                                                                                                                                                                                                                                            | 待提交                                                                            |
| PIA-037 | 稳定异步 session 切换后的 Conversation 底部锚定，避免部分 session 初始停在非最新位置。                                                                                                     | Michael  | Done   | 每个 Conversation mount 显式重置 follows-latest initial anchor；layout/ResizeObserver 校正时记录 programmatic expected `scrollTop`，对应 scroll event 不会被当作用户上滚而解除锚定；其它 scroll 才解除并允许阅读早期记录。前端回归覆盖 A→B→A 两个 200 条 history session 均显示第 199 条且保持非零 bottom `scrollTop`。验证：frontend 19/19、Rust 14/14、Node 9/9、packaging 1/1、layout 1/1、typecheck、lint、format check、Rust fmt/clippy、diff check 均通过；native `.app` 已重打包，target/package/node_modules executable SHA-1 均为 `0b21d42be58d48d13499e616f7fa77ea44727f1d`。                                                                                                                                                                                                                                                                                                                                              | 待提交                                                                            |
| PIA-038 | 修复 `/app` macOS native bundle 的无效代码签名，确保发布包可被系统验证并启动。                                                                                                             | Michael  | Done   | 复现 Tauri source、packages 与 node_modules `.app` 均因 `code has no resources but signature indicates they must be present` 未通过 strict verification；`package-native.mjs` 在 macOS copy 后执行 `codesign --force --deep --sign -` 重新 seal bundle。packaging smoke 回归验证 packages 及 clean-install `.app` 的 `codesign --verify --deep --strict`。验证：frontend 19/19、Rust 14/14、Node 9/9、packaging 1/1、layout 1/1、typecheck、lint、format check、Rust fmt/clippy、diff check 均通过；packages/node_modules strict codesign 均通过，并以 launcher 实际路径启动 native process。native bundle 的 sealed executable SHA-1 为 `08d5a3358519e942a1bc4138d0a65510848c27d1`。                                                                                                                                                                                                                                                | 待提交                                                                            |
| PIA-039 | 移除 Recents session 列表中无语义的方块图标，并让 session 标题/摘要左对齐。                                                                                                                | Michael  | Done   | 移除 `.session-icon` / `□` 与其 CSS；去掉选择按钮原有 icon gap，`.session-copy` 弹性填充使标题/摘要从按钮左侧内容边界对齐，保留标题、摘要和 Rename/Delete 操作。前端回归禁止 `.session-icon` 返回。验证：frontend 20/20、Rust 14/14、Node 9/9、packaging 1/1、layout 1/1、typecheck、lint、format check、Rust fmt/clippy、diff check 均通过；native `.app` 已重打包，packages/node_modules strict codesign 均通过，sealed executable SHA-1 均为 `c1a239e001d12199204d3c5c4e9359e2c513f162`。                                                                                                                                                                                                                                                                                                                                                                                                                                         | 待提交                                                                            |
| PIA-040 | 全面审计桌面端、native、launcher、打包和样式，删除已验证的死代码并精简重复实现。                                                                                                           | Michael  | Done   | 审计确认并删除无 JSX 引用的 Projects 与 sidebar footer CSS（包括 mobile media query 残留）；`isInteractive()` 统一 5 处 ready/idle 判断；`emptyWorkspaceSession()` / `loadedWorkspaceSession()` 统一重复的 session history 初始化。layout 回归禁止已删除 selector 返回。验证：frontend 20/20、Rust 14/14、Node 9/9、packaging 1/1、layout 1/1、root/desktop typecheck、lint、Prettier、rustfmt、clippy、`git diff --check` 均通过；native `.app` 已重打包，packages 与 `/app` 实际 node_modules bundle 均通过 `codesign --verify --deep --strict`，sealed executable SHA-1 均为 `08fc9e2afcf2c808eeb68bb12950ed07911544c3`。                                                                                                                                                                                                                                                                                                         | 待提交                                                                            |
| PIA-041 | 修复首次切换到未缓存 session 时，历史尾页尚未返回而错误显示空会话页的一闪。                                                                                                                | Michael  | Done   | `Conversation` 空态增加 `!historyLoading` 条件：首次 tail history 加载期间仅显示 `Loading latest history…`，历史加载完成且仍为空时才显示 `What can I help you build?`。前端异步回归将目标 history Promise 延迟，断言 loading 可见且空态不存在；变更前失败、变更后通过。验证：frontend 20/20、Rust 14/14、Node 9/9、packaging 1/1、layout 1/1、root/desktop typecheck、lint、Prettier、rustfmt、clippy、`git diff --check` 均通过；native `.app` 已重打包，packages 与 `/app` 实际 node_modules bundle 均通过 `codesign --verify --deep --strict`，sealed executable SHA-1 均为 `59638a0c732e2d9a9c409f7a6f7e634dc881d03e`。                                                                                                                                                                                                                                                                                                          | 待提交                                                                            |
| PIA-042 | 修复 release `/app` bundle 未嵌入 Vite 前端入口，导致 Tauri 显示 `asset not found: index.html`。                                                                                           | Michael  | Done   | `build.rs` 递归声明 `../dist` 目录与每个 Vite 输出文件为 Cargo 输入，确保 `beforeBuildCommand` 更新 Vite hash assets 后必重跑 `tauri_build::build()` 并嵌入 `index.html`。打包回归验证 build contract，并验证 packages/clean-install executable 均包含当前 Vite JS entry。验证：frontend 20/20、Rust 14/14、Node 10/10、packaging 2/2、layout 1/1、root/desktop typecheck、lint、Prettier、rustfmt、clippy、`git diff --check` 均通过；native `.app` 已重打包，packages 与 `/app` 实际 node_modules executable 均嵌入 `/assets/index-Bk0uj_xE.js` 并通过 `codesign --verify --deep --strict`，sealed executable SHA-1 均为 `0a28ebc3ba473c5c77786b5fe2f63b2b476c83e3`。                                                                                                                                                                                                                                                              | 待提交                                                                            |
| PIA-043 | 将项目收敛为可发布的 `pi-native-app` npm Pi Package，明确发布文件并清理开发文件。                                                                                                          | Michael  | Done   | 根 npm package 改为 `pi-native-app`，macOS Apple Silicon bundled dependency 改为 `pi-native-app-darwin-arm64`，launcher shim 改为 `bin/pi-native-app`；恢复 platform `package.json` 并加入 README、license、repository/issue/homepage/keywords metadata。root `files` allowlist 只发布 README、LICENSE、extension、compiled launcher 与 bundled native runtime；不含 desktop/Rust/tests/scripts/local tarball。packaging smoke 精确断言 tarball 12 个运行时文件并在 finally 清除生成 `.tgz`；clean install 继续验证 `/app` extension、launcher、嵌入 Vite entry 和 strict signature。验证：Frontend 20/20、Node 10/10、Rust 14/14、packaging 2/2、layout 1/1、root/desktop typecheck、lint、Prettier、rustfmt、clippy、`git diff --check` 均通过；packages 与 `/app` node_modules bundle 均通过 `codesign --verify --deep --strict`，sealed executable SHA-1 均为 `0a28ebc3ba473c5c77786b5fe2f63b2b476c83e3`。未执行 `npm publish`。 | 待提交                                                                            |
| PIA-044 | 清理当前 Pi 环境中旧的本地 `pi-app` extension 注册，保留 npm 安装的 `pi-native-app`。                                                                                                      | Michael  | Done   | 执行 `pi remove '../../My Project/pi-app'`，仅从 `~/.pi/agent/settings.json` 移除本地路径 package；确认 `npm:pi-native-app` 仍存在于 `pi list` 和 `~/.pi/agent/npm/node_modules/pi-native-app`（v0.1.0）。仓库 `/Users/I604724/My Project/pi-app` 未删除。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Local environment change; no commit                                               |
| PIA-045 | 整理推送前 `.gitignore`，排除本地生成物且保留 npm 发布所需 native bundle。                                                                                                                 | Michael  | Done   | 现有规则已覆盖 CodeGraph、node_modules、Vite/Rust outputs、环境/IDE 与 `.DS_Store`；新增 `*.tgz` 忽略本地 `npm pack` tarball。验证 `pi-native-app-0.1.0.tgz` 被忽略，而 `packages/pi-native-app-darwin-arm64` 不被忽略；`git diff --check` 通过。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 待提交                                                                            |
| PIA-046 | 将当前 Pi 环境的 `pi-native-app` extension 从 npm 安装切换为当前仓库绝对路径安装，并验证实际加载路径与 `/app` 注册。                                                                         | Michael  | Done | `pi remove npm:pi-native-app` 与 `pi install '/Users/I604724/My Project/pi-app'` 成功；`pi list` 显示 `../../My Project/pi-app`。RPC `get_commands` 将 `/app` 解析至 `/Users/I604724/My Project/pi-app/extensions/app.ts`；本地 darwin-arm64 shim 与 app executable 可执行；`launchDesktopClient` 解析至本仓库 `node_modules/pi-native-app-darwin-arm64/bin/pi-native-app`。 | Local environment change; no commit |
| PIA-047 | 首次 `/app` 调用在 terminal session 尚未持久化为 JSONL 时启动桌面端的新 RPC session；已有 JSONL 时仍接管原 session。 | Michael | Blocked | 实现：`sessionFile` 改为可选；无 JSONL 时 launcher 传空 argv，已有 JSONL 时仍传 `--pi-session-file <path>`；extension 不再拒绝首次 handoff。TDD：新增无 session argv 与 extension 许可回归，先失败、实现后通过。验证：targeted Node 9/9、root/desktop typecheck、Rust test 14/14、clippy、rustfmt、Prettier、`git diff --check` 通过。`npm test` 11/12：packaging smoke 因本工作树预先删除 `packages/pi-native-app-darwin-arm64/package.json` 和 `.app` bundle 文件而失败；未覆盖他人本地删除，待恢复后重跑。 | 待提交 |
| PIA-048 | 将当前 Pi 环境的 `pi-native-app` extension 从 npm 注册切换为当前仓库绝对路径，并验证加载本地 `/app`。 | Michael | Done | 已移除 `npm:pi-native-app` 并安装 `/Users/I604724/My Project/pi-app`；`pi list` 显示 `../../My Project/pi-app`，RPC `get_commands` 的 `/app` 解析至本地 `extensions/app.ts`。 | Local environment change; no commit |
| PIA-049 | 修复首次 `/app` 无 persisted JSONL 时桌面端初始化失败：Pi RPC 返回 sessionFile 前尚未写出 JSONL。 | Michael | Done | TDD：新增 fresh RPC session 回归（无 launch session、`listSessions` 为空且 history 文件不存在），先失败后通过。实现：未列入 persisted sessions 的 active RPC session 以空 history 初始化，不读取未写出的 JSONL；已持久化 session 保持 history 加载路径。验证：frontend 21/21、typecheck、Prettier、`git diff --check`、Rust 14/14、clippy、rustfmt 通过；重建并签名 local native app，workspace shim 启动新 binary 无 stderr，RPC 仍解析本地 `/app`，fresh launcher argv 为 `[]`。 | 待提交 |
| PIA-050 | 修复首次 `/app` 在 Pi 尚未创建 session directory 时的启动失败，并复用 Pi 首个 assistant message 的 JSONL 持久化时序。 | Michael | Done | Pi 源码确认：`SessionManager._persist()` 在历史包含首条 assistant message 后才以 `openSync(sessionFile, "wx")` 写入累积 session/user/assistant entries，不能在 prompt 时手工造 JSONL。TDD：`WorkspaceStore::list_sessions()` 对不存在目录先失败（ENOENT），改为仅将 `NotFound` 映射为空列表。验证：frontend 21/21、Rust 15/15、typecheck、Prettier、clippy、rustfmt、`git diff --check` 通过；重建、ad-hoc 签名 local native app（SHA-1 `0bd6b884c60dd9ad14ae296de8971cbd70bf17a5`），本地 `/app` registry 与 fresh argv `[]` 均确认，native app 启动无 stderr。 | 待提交 |
| PIA-051 | 修复较小显示器/窗口高度下 composer 被裁出视口的响应式布局问题。 | Michael | Done | 根因：fixed app-shell 的唯一隐式 grid row 会被 sidebar/workspace 内容最小高度撑出视口，`overflow: hidden` 随即裁掉 composer。实现：shell 显式 `minmax(0, 1fr)` row，sidebar 可缩小；高度 ≤760px 收紧间距/vertical padding/text area；宽度 ≤700px 改为 sidebar ≤38vh 与可缩 workspace 两行，移除 `min-height:74vh`。新增 stylesheet 回归。验证：frontend 22/22、typecheck、Prettier、Rust 15/15、clippy、rustfmt、`git diff --check` 通过；重建并签名 workspace-linked native app（SHA-1 `d70eeedc63a17a75b0bdbc6dfe267baffebee608`）。 | 待提交 |
| PIA-052 | 修复 terminal 尚无对话/JSONL 时 `/app` 无法唤醒 desktop。 | Michael | Done | 根因：Pi fresh `getSessionFile()` 返回未来 JSONL 路径（非 undefined）；旧逻辑仍将不存在的路径传给 desktop（Tauri canonicalize 后退出）且 shutdown terminal。实现：以 `existsSync(sessionFile)` 定义 persisted handoff；仅文件存在时传 `--pi-session-file` 并 shutdown terminal，否则传 undefined/空 argv 并保留 terminal。TDD：extension source regression。真实 fresh RPC 验证：`/app` 返回 success 后 `desktopStarted=true`、`piAlive=true`。验证：Node targeted 9/9、frontend 22/22、typecheck、Prettier、Rust 15/15、clippy、rustfmt、`git diff --check` 通过；重建签名 local native app。 | 待提交 |
| PIA-053 | 按需求试验 `/app` 无论是否能找到 session path 都无条件启动 desktop。 | Michael | Done | 诊断变更：extension 不再读取 `getSessionFile()`、不传 `--pi-session-file`、不调用 terminal shutdown；所有 `/app` 均启动独立 desktop RPC session。TDD：更新 extension source regression（先失败后通过）。真实 Pi RPC 验证：fresh 与有 JSONL 临时 session 均 `desktopStarted=true`、`piAlive=true`、response success。验证：Node targeted 9/9、frontend 22/22、Rust 15/15、typecheck、Prettier、clippy、rustfmt、`git diff --check` 通过；重建、签名 workspace-linked native app。限制：desktop 不接管 terminal 的已有对话，后续需在基础唤醒确认后重新设计 handoff。 | 待提交 |
| PIA-054 | 删除 `/app` 已废弃的 desktop session handoff 实现，同时保持独立 desktop 的 fresh RPC session 支持。 | Michael | Done | 删除 launcher 的 `sessionFile` option/argv、Tauri `--pi-session-file` parser、`AppState.launch_session`/`launch_session` command、PiClient `launchSession()` 与 initial `switch_session`。保留 frontend fresh-RPC in-memory active session 与 Rust sessions-directory `NotFound → []`。TDD：launcher 断言 spawn argv 为 `[]`；frontend fake 不再提供 handoff API。验证：Prettier、frontend 22/22、Node 8/8、typecheck、Rust 15/15、clippy、rustfmt、`git diff --check` 均通过；全仓运行代码无旧 handoff token。native `.app` 已重建且 ad-hoc 签名，package/node_modules executable SHA-1 均为 `ef3e422f4ad133eec5130a0830dd715952faee08`。README 更新为独立 desktop session 语义。 | 待提交 |
| PIA-055 | 将 npm release metadata 升至 0.1.1，并更新独立 desktop session / 显式 handoff 的用户文档。 | Michael | Done | Root `package.json`、desktop workspace、npm lockfile、Tauri config/Cargo crate 均升至 0.1.1；native rebuild 生成 macOS `CFBundleShortVersionString`/`CFBundleVersion` 0.1.1。README 明确 `/app` 不接管 terminal session、terminal 保持运行，已有会话在 Recents 手动选择，自动交接需要未来显式 handoff。验证：Prettier、frontend 22/22、Node targeted 8/8、typecheck、Rust 15/15、clippy、rustfmt、native build、codesign、diff check 通过。后续 PIA-056 已按授权恢复并同步 platform manifest。 | 待提交 |
| PIA-056 | 恢复 darwin-arm64 platform package manifest，使 npm 0.1.1 bundled dependency 的 clean-install/update 路径完整可用。 | Michael | Done | 按 Michael 授权恢复 `packages/pi-native-app-darwin-arm64/package.json`，保留原有 macOS arm64 限定和发布 files，仅同步 version 至 0.1.1。`npm install --package-lock-only` 后本地依赖树报告 `pi-native-app-darwin-arm64@0.1.1`。验证：packaging smoke 2/2（含 `npm pack → 临时目录 npm install → launcher/bundle/signature/extension`）、Prettier、typecheck、Node targeted 8/8 与 `git diff --check` 通过。 | 待提交 |
| PIA-057 | 关闭旧 PR #5，并以新分支创建一个相对 `main` 包含全部当前更新的替代 PR。 | Michael | Done | 已关闭旧 PR [#5](https://github.com/shengxiao20/pi-app/pull/5)，并从完整当前 HEAD 新建/推送 `feat/complete-pi-app-v0.1.1`。替代 PR [#6](https://github.com/shengxiao20/pi-app/pull/6) 以 `main` 为 base，覆盖完整 `origin/main...HEAD`（53 files，17,931 additions，51 deletions）；初始 head commit `2e353eb`，随后台账完成记录提交至同一 PR。验证：`git diff --check` 通过；GitHub 当前未报告 branch checks。 | PR #6 |
| PIA-058 | 将 PR #6 相对 `main` 的全部提交重写为归属 `shengxiao20` 的单一内容等价提交。 | Michael | Done | 使用 GitHub account-specific noreply identity `Haoxuan Hu <69582780+shengxiao20@users.noreply.github.com>` 将相对 `main` 的错误 attribution commits 压缩为内容等价的单提交。force-push 后，GitHub API 确认 PR [#6](https://github.com/shengxiao20/pi-app/pull/6) 的唯一 commit author/committer 都解析为 `shengxiao20`；diff 保持为 53 files、17,932 additions、51 deletions。 | PR #6 |

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

| 方案               | 结论       | 理由                                                                                          |
| ------------------ | ---------- | --------------------------------------------------------------------------------------------- |
| **Tauri 2 + Rust** | **推荐**   | Rust 桌面能力、跨平台构建与打包成熟，体积/资源开销通常低于 Electron，适合管理 Pi RPC 子进程。 |
| Electron           | 不作为首选 | 偏重，不符合 Rust 为主的目标。                                                                |
| WRY / tao 自建     | 暂不采用   | Tauri 已覆盖窗口、权限、构建、插件等基础能力；自行维护成本高。                                |
| Slint / egui       | 不适合 MVP | 复杂聊天、Markdown、代码块、虚拟列表等富 UI 的实现成本较高。                                  |

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

| 组件                | 责任                                                        |
| ------------------- | ----------------------------------------------------------- |
| `extensions/app.ts` | 注册 Pi command，并调用 launcher。                          |
| `launcher/`         | 识别平台、查找/校验二进制文件、启动桌面客户端。             |
| Rust RPC supervisor | 启动 Pi、JSONL 编解码、请求关联、子进程生命周期与异常处理。 |
| React UI            | 呈现状态与派发用户操作；不实现 Agent 逻辑。                 |

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
