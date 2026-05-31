<!-- CAT-CAFE-GOVERNANCE-START -->
> Pack version: 1.0.0

## Governance Rules

### Hard Constraints
- **opencode DB is read-only**: Never modify `~/.local/share/opencode/opencode.db` directly. All interactions go through `opencode` CLI.
- **Feishu secrets belong in .env**: Never commit App ID / App Secret to git. Use `.env` file (gitignored) or environment variables.
- **Bridge runs on Node.js**: Runtime dependency is Node.js >= 18. No Bun-only code paths.

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

### Done
- F001 核心桥接 + 流式卡片 + session 管理
- F002 斜杠命令系统（/new, /list, /use, /thread, /connect, /unbind, /where, /projects, /commands, /sw, /cf）
- F003 Bug 修复 B001-B006
- F004 `-y` → `--danger` flag，交互式 `/cf` 卡片配置

### In Progress
- (none)

### Blocked
- (none)

### Key Decisions
- `--danger` 替代 `-y`：opencode v1.15.13 不支持 `-y`，改用 `--danger`
- `/cf` 交互卡片：卡片按钮 toggle 配置，即时更新 DB 并刷新卡片
- flags 以 JSON 字符串存储在 `feishu_sessions.flags` 列

### Next Steps
- F005 群聊支持（@提及过滤、白名单）
- F006 监控生产运行稳定性

### Relevant Files
- `src/bridge/session-manager.ts` — session 管理 + flags 解析
- `src/bridge/opencode-run.ts` — opencode 进程 spawn + flags 注入
- `src/feishu/card-interaction.ts` — /cf 卡片 + toggle flag 处理
- `src/commands/handlers.ts` — /cf 命令路由
- `src/index.ts` — 卡片路由 cf_config
<!-- ANCHORED_SUMMARY_END -->
