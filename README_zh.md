# Pi App

[English](README.md)

Pi App 是 [Pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) 的本机 Web 客户端。
它保留现有 React 页面，并使用 AG-UI 1.0 连接浏览器和本机 Node.js 服务。
服务在进程内使用 Pi TypeScript SDK，不再启动 `pi --mode rpc`。

## 架构

```text
React 页面
  -> @ag-ui/client HttpAgent
    -> 127.0.0.1 上的 HTTP 和服务器发送事件
      -> AG-UI 适配器
        -> Pi AgentSession 和 SessionManager
```

AG-UI 传输运行输入、流式文本、工具调用、工具结果、取消和错误。
普通 HTTP API 处理工作区、历史分页、会话名称、命令和标签。
Pi 会话始终是对话历史和模型上下文的权威来源。

服务通过 `DefaultResourceLoader` 加载 Pi 资源。
服务显式启用 codemode、工具搜索和模型上下文协议（MCP）扩展。
浏览器可通过会话命令 API 获取扩展命令、提示词模板和 Skills。

## 要求

- Node.js 22 或更高版本
- 已配置的 Pi 模型和凭据

服务读取 `~/.pi` 下的标准 Pi 配置。
服务具有启动用户的本机文件权限。

## 开发

```sh
npm install
npm run dev
```

打开 <http://127.0.0.1:1420>。
初始工作区是运行命令时的目录。
你也可以通过 `PI_APP_WORKSPACE` 指定工作区。

提交变更前运行：

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run format:check
```

## 作为 Pi 包使用

安装此包，在项目目录中启动 Pi，然后运行 `/app`：

```sh
pi install npm:pi-native-app
cd /path/to/project
pi
```

```text
/app
```

命令会按需启动生产 Web 服务，选择当前 Pi 目录，并在浏览器中打开页面。
服务固定使用端口 `1420`，且只绑定 `127.0.0.1`。

## 会话和历史

Pi App 只列出当前规范工作区中的会话。
`SessionManager` 打开并继续 Pi 持久化的 JSONL 会话。
新的空会话在第一条用户消息之前只保留在内存中。这与 Pi SDK 的持久化规则一致。

每次 AG-UI 运行都发送完整且有序的消息历史。
运行开始前，服务会将该历史与 Pi 当前会话分支比较。
如果历史不一致，服务会明确拒绝请求，不会重复追加或静默使用另一份上下文。

历史 API 每页最多返回 200 条消息。
页面保留现有 Markdown、数学公式、Mermaid 和工具调用显示。
标签保存在 `~/.pi/agent/pi-app.json`，不会修改 Pi 会话文件。

## 运行结果

- 正常完成发送带成功结果的 `RUN_FINISHED`。
- 用户取消发送带取消结果的 `RUN_FINISHED`。
- 运行失败发送 `RUN_ERROR`。
- 浏览器断线不会被视为成功或取消。Pi 运行会在服务端继续。

任何运行处于活动状态时，服务会拒绝切换工作区。
服务也会拒绝同一会话的并发运行。

## 本机安全边界

服务只监听 IPv4 回环地址。
API 拒绝来自其他浏览器来源的请求。
会话 ID 只能通过 Pi 的当前工作区会话目录解析。
静态文件只能从 `desktop/dist` 读取。

此边界只适用于单个本机用户。Pi App 不是多用户或网络服务。

## 生产构建

```sh
npm run build
npm start
```

生产服务从同一回环来源提供 `desktop/dist` 和 API。
npm 包包含构建后的页面、Node.js 服务和 `/app` 扩展。
它不再包含 Tauri、Rust 二进制文件、平台包或 Pi RPC 启动器。
