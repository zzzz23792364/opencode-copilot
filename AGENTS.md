<!-- CAT-CAFE-GOVERNANCE-START -->
> Pack version: 1.0.0

## Governance Rules

### Hard Constraints
- **opencode DB is read-only**: Never modify `~/.local/share/opencode/opencode.db` directly. All interactions go through `opencode` CLI.
- **Feishu secrets belong in .env**: Never commit App ID / App Secret to git. Use `.env` file (gitignored) or environment variables.
- **Bridge runs on Node.js**: Runtime dependency is Node.js >= 18. No Bun-only code paths.
- **Production uses `npm start`, never `npm run dev`**: `npm run dev` uses `tsx watch` which restarts the process on any `src/` file change. This triggers spurious bridge restarts, WS reconnection storms, and duplicate event processing. Production must always use `npm start` (= `manage.ts start`, detached mode with no auto-restart).

### Quality Discipline
- **Spec before code**: Non-trivial features require a spec document in `docs/features/` or `docs/decisions/`.
- **E2E test before merge**: Run the bridge locally and send a test message on Feishu before pushing.
- **Bug fix requires root cause**: Reproduce → check logs → confirm root cause → fix. No guess-and-patch.
- **Done = verified**: "Done" means tested on real Feishu bot with real opencode session.

### Knowledge Engineering
- **YAML frontmatter** on all docs: `topics`, `doc_kind`, `created` required.
- **Three-layer info architecture**: README.md (overview) → docs/ (specs/decisions/features) → BACKLOG.md (roadmap tracking).
- **Feature lifecycle**: idea → decision → spec → implement → changelog
- **Archive, don't delete**: Outdated docs move to `docs/archive/`, never removed.

### Collaboration
- **Self-review is forbidden**: Use `git diff` review before commit, but major changes should be pair-reviewed.
- **Commit messages are documentation**: Describe what changed and why. Follow conventional commits style.
- **BRIDGE LOGS** at `~/.opencode-copilot/bridge.log` are the first place to look for issues.
<!-- CAT-CAFE-GOVERNANCE-END -->

<!-- ANCHORED_SUMMARY_START -->
## Anchored Summary

### Goal
- 构建飞书 ↔ opencode TUI 双向桥接服务，通过 `opencode run --session --format json` 实现 session 共享。

### Constraints & Preferences
- Node.js >= 18 运行时（tsx），better-sqlite3 替代 bun:sqlite
- 复用 clowder-local 的 FeishuAdapter，避免自建飞书交互层
- 不用 `opencode serve` + SDK 模式，直接操作 SQLite
- `opencode run` 必须 `shell: true`（daemon IPC 要求，与 runtime 无关）
- opencode v1.15.13 不支持 `--plan`、`-y` 标志
- **生产必须用 `npm start`，绝不用 `npm run dev`**：`tsx watch` 监听 `src/` 文件变更触发 bridge 重启+WS 风暴
- 移除 poller、心跳 `setInterval`、catcaffe 残留

### Done
- F001 核心桥接 + 流式卡片 + session 管理
- F002 斜杠命令系统（/new, /list, /use, /thread, /connect, /unbind, /where, /projects, /commands, /sw, /cf）
- F003 Bug 修复 B001-B006
- F004 `/cf` 交互卡片：模型选择 + `cli_args` 自定义参数（`--dangerously-skip-permissions`, `--thinking`）
- B007 文档和修复：`tsx watch` 导致 bridge 反复重启的根因定位与硬约束写入 AGENTS.md
- `manage.ts` 完整重写（修复多次编辑导致的损坏），`findBridgeNodePids()` 正确定位 `node --require preflight.*src/index.ts`
- `manage.ts` `start()`/`restart()` 末尾增加 `verifySingleInstance()` 轮询确保唯一实例
- 多实例根因修复：`start()` 检查已有实例，`stop()` 全部 SIGKILL，`index.ts` lock 文件自检
- 生产部署：清理旧实例（21989 + 29705），`npm start` 单实例运行
- `/cf` 新增 `model` 选择（`opencode models` 查询 → provider 分组 → 模型列表卡片 → 存储至 `feishu_sessions.model` 列 → `opencode run` 传 `-m MODEL`）
- `cli_args` JSON 数组列（TEXT），`feishu_sessions.cli_args` 存储任意 CLI 参数，`opencode-run.ts` 展开至 args
- 数据库 migration：`cli_args TEXT` 列
- 文档：CHANGELOG、BACKLOG、README、AGENTS、SOP、tech-architecture、dev-setup、B007-tsx-watch-auto-restart

### In Progress
- (none)

### Blocked
- (none)

### Key Decisions
- **`--danger` → `--dangerously-skip-permissions`**：`opencode run --help` 确认正确参数名
- **`/cf` 卡片双按钮**："选择模型"（触发 `opencode models` + provider/模型选择流）和 `--dangerously-skip-permissions` toggle（写入 `cli_args` 数组）
- **`cli_args` 优先于 `flags.danger`**：新代码路径，`cli_args` 非空时忽略旧 `flags.danger`，避免重复传参
- **`model` 单独 `TEXT` 列**：独立于 `flags`/`cli_args`，`opencode run` 时 `-m MODEL`
- **`stop()` 用 `SIGKILL`**：孤儿进程可能卡死，SIGTERM 无法保证退出
- **`findBridgeNodePids()` 正则 `'node.*--require.*preflight.*src/index\\.ts'`**：仅匹配实际 bridge node 进程（含 preflight 的），排除 npm wrapper
- **`detached: true` 导致 node 进程独立于 npm wrapper**——PID 文件只跟踪 wrapper PID，stop 需扫描全部 node 实例
- **锁文件双重保障**：`manage.ts` 的 `findBridgeNodePids()` 防误启 + `index.ts` 的 `bridge.lock` 自检

### Next Steps
- F005 群聊支持（@提及过滤、白名单）
- 监控生产运行稳定性

### Relevant Files
- `src/bridge/session-manager.ts` — session 管理 + flags/cliArgs/model 解析
- `src/bridge/opencode-run.ts` — opencode 进程 spawn + model/cliArgs 注入
- `src/feishu/card-interaction.ts` — /cf 卡片 + toggle 处理 + model 选择流
- `src/commands/handlers.ts` — /cf 命令路由
- `src/index.ts` — 卡片路由 cf_config
- `scripts/manage.ts` — 生命周期管理（PID 文件 + findBridgeNodePids + verifySingleInstance）
<!-- ANCHORED_SUMMARY_END -->
