# AGENTS.md — Pi App 协作规范

本文件对本仓库中的所有人类与 AI coding agent 生效。

## 1. 团队与任务台账

本项目当前有两位参与者：

- `Michael`
- `Collaborator`（在首次协作前，将此占位符替换为第二位参与者的 GitHub 用户名）

[`plan.md`](./plan.md) 是唯一的任务台账。每一项可执行任务必须拥有：

- 唯一 ID；
- 明确的交付/验收标准；
- `Assignee`（`Michael`、`Collaborator` 或 `Unassigned`）；
- `Status`（`Todo`、`In Progress`、`Blocked`、`Done`）；
- 关联的 PR/commit（完成后填写）。

不得在未更新 `plan.md` 的情况下开始、转交或完成任务。一个任务同一时刻只能有一个 assignee；任务粒度过大时，先拆分为可独立验证的子任务。

## 2. 每次 AI 编程对话的强制开始流程

每次开始 AI 编程对话时，必须按顺序执行：

1. 阅读本文件及 `plan.md` 的任务台账。
2. 检查本地 Git 状态：
   ```bash
   git status --short --branch
   git remote -v
   ```
3. 同步并检查远程仓库 `https://github.com/shengxiao20/pi-app`：
   ```bash
   git fetch origin --prune
   git log --oneline HEAD..origin/main
   git log --oneline origin/main..HEAD
   ```
   并检查已合并/已关闭 PR（可用 `gh pr list --repo shengxiao20/pi-app`）。
4. 将远程已完成、但任务台账尚未标为 `Done` 的任务更新到 `plan.md`，填写关联 PR/commit；同步发生冲突时，明确报告并将相关任务标记为 `Blocked`，不得猜测远程状态。远程暂时不可访问时，仅在当前对话报告；不得将该临时网络状态写入 `plan.md`，也不得仅因其阻塞本地实施。
5. 从 `Todo` 中选择或被分派一个任务，先在 `plan.md` 中将其改为 `In Progress` 并填写 assignee，才可开始编码。

若本地目录尚不是该远程仓库的 checkout，先明确报告这一事实；在完成 clone 或初始化正确 remote 前，不得声称已完成远程同步检查。

## 3. 开发与完成流程

1. 使用 Test-Driven Development：先为用户需求写出/更新会失败的测试，再写最小实现使测试通过。
2. 开始前阅读关联代码和测试；使用 CodeGraph 探索代码。若尚未初始化，先运行 `codegraph init`。
3. 保持模块边界清晰、职责单一、命名一致。重复行为使用合适的抽象（例如 Python 中采用 decorator）；Python 静态方法使用 `_` 前缀。
4. 不得添加未经需求明确要求的 fallback、静默吞错或额外条件分支；让错误明确暴露。
5. 每次任务完成前运行对应格式化、类型检查、单元测试和必要的集成测试。
6. 任务验收通过后，更新 `plan.md`：`Status: Done`、验收证据、PR/commit 链接；若未完成，保留 `In Progress` 或标为 `Blocked` 并写明原因。

## 4. 代码质量要求

所有提交到 PR 的代码必须：

- 对公共 API、非显然的业务决策、并发/生命周期处理、协议字段和安全边界写准确且必要的注释；禁止用注释重复显而易见的代码。
- 精简、clean、可读，且仅包含当前任务所需的实现。
- 不包含冗余实现、未使用的导入、死代码、注释掉的旧代码、无用 wrapper 或重复逻辑。
- 不混入无关重构、格式化噪声或生成文件（除非该任务明确要求）。
- 有与需求对齐的测试；修复 bug 必须有能够复现该 bug 的回归测试。

## 5. Git、Commit 与 Pull Request 规范

- 一个 commit 只完成一个可理解、可回滚的变更；不要将不相关内容混在一起。
- 将大任务拆成少量且多次的小提交，并通过多个小 PR 合并；不要堆积一个巨大 PR。
- 每次提交前检查暂存区，确保没有误提交的文件或凭据。
- PR 标题必须以下列前缀之一开头：
  - `feat/`
  - `fix/`
  - `test/`
  - `doc/`
- 示例：`feat/rpc-supervisor-startup`、`fix/jsonl-frame-parser`、`test/launcher-platform-resolution`、`doc/task-board-workflow`。
- PR 描述必须包含：任务 ID、问题/目标、实现摘要、测试命令与结果、已知限制；完成后在 `plan.md` 写入 PR 编号和关键 commit。
- 合并前确保 CI 通过、任务验收标准达成，并且 `plan.md` 状态与实际情况一致。

## 6. 文档维护

- 架构、范围或技术决策发生变化时，同一 PR 必须更新 `plan.md`。
- `plan.md` 的“任务台账”是协作事实来源；不要仅在聊天记录、PR 描述或 issue 中维护任务状态。
- 修改本文件或 `plan.md` 的协作规则时，使用 `doc/` 前缀的独立、小型 PR。
