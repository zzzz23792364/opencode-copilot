# Changelog

## [0.2.0] - 2026-05-31

### Added

- **动态卡片 header**: 流式卡片根据状态切换 header（⏳/💭/✅），含耗时计数
- **心跳机制**: 无文字时每 5s 更新卡片为 `⏳ 思考中... (Xs)`
- **首段立即 PATCH**: 第一个文字块不等待节流，立即更新卡片
- **终止按钮**: 流式卡片右下角 `⏹ 终止` 按钮，点击 kill 进程 + 卡片标记 `❌ 已终止`
- **tool_use 通知**: opencode 工具调用时卡片显示 `🔧 执行中`
- **`/projects` 交互卡片**: 项目选择按钮（点击切换目录）
- **命令扩展**: `/abort`、`/unbind`、`/where`、`/status`、`/commands`

### Changed

- **minDeltaChars**: 200 → 50（流式更新更频繁）
- **editMessage**: 改为 fire-and-forget（不阻塞管道）
- **心跳超时**: 5min → 10min
- **默认模型**: deepseek-v4-pro (opencode-go provider)
- **移除 poller**: TUI→飞书转发已移除（防止消息循环混淆）

### Fixed

- **B001**: `-y` 标志无效导致 opencode 返回 `(no response)` — 已移除
- **B002**: `--plan` 标志在 opencode v1.15.13 不存在 — 相关命令已回退
- **B003**: Poller 误转发飞书消息 — 移除 poller
- **B004**: `editMessage` "🐱 回复中..." header 覆盖卡片 — 改用 SDK 直接 PATCH

### Docs

- 新增 `docs/bugs/` 4 篇踩坑记录
- 文档体系对齐 escape-pilot 结构（23 文件）

---

## [0.1.0] - 2026-05-31

### Added

- **Feishu ↔ opencode TUI 双向桥核心**
  - `opencode run --session --format json` 直接操作 SQLite DB，与 TUI 共享 session
  - Feishu WebSocket 事件订阅 (via `@larksuiteoapi/node-sdk`)
  - NDJSON 流解析 → AI 文本收集 → 飞书回复
  - E2E 验证通过：飞书发消息 → opencode 处理 → 飞书收到回复（~6s 延迟）

- **FeishuAdapter 复用** (from clowder-local)
  - `parseEvent()`: text/post/image/file/audio 全类型解析 + 群聊 @提及过滤 + 本地化富文本
  - `sendFormattedReply()`: 交互卡片回复（标题 + 正文 + 时间戳 footer）
  - `sendPlaceholder` / `editMessage` / `finalizeStreamCard`: placeholder → PATCH → finalize 流式卡片
  - `addReaction`: 👍 即时反馈 (F157 Receipt Ack)
  - `sendMedia`: 图片/文件/语音上传 + ffmpeg opus 转换 + SSRF 防护
  - `FeishuTokenManager`: tenant_access_token 自动刷新缓存
  - `feishu-card-formatter` + `feishu-receipt-lines`: 卡片格式化 + 猫猫个性签收语

- **Session 管理**
  - `feishu_sessions` SQLite 表: `feishu_key → session_id` 映射，重启不丢失
  - Session 发现: `opencode session list` → 自动绑定最新 session
  - 项目目录切换: `/projects` `/project <N>` → `opencode_cwd` 列存储
  - `/list`: 列出选中项目会话（带 opencode 标题）
  - `/list -all`: 列出所有项目会话（✓ 已绑定标记）

- **命令系统**
  - `/new` — 创建新会话
  - `/list` / `/list -all` — 列出会话
  - `/use <编号|ID|前缀|标题>` — 绑定会话
  - `/thread <id> <msg>` — 绑定 + 发消息
  - `/connect <id>` — 直接绑定
  - `/unbind` — 取消绑定
  - `/where` / `/status` — 查看当前绑定
  - `/projects` / `/project <N>` — 项目目录选择
  - `/commands` / `/help` — 显示命令列表

- **消息管线**
  - 统一的 `adapter.parseEvent()` 解析入口（非自己写的两个 parser）
  - `card.action.trigger` WS 事件注册
  - `message_id` 去重（SQLite + TTL）
  - 每个 chat FIFO 队列串行处理
  - 入站媒体下载 (`MediaService`: 下载 → 本地路径 → opencode)

- **TUI→飞书方向**
  - `feishu-poller`: 定时轮询 `opencode export` → 增量转发到飞书
  - `forwarded` 表跟踪已转发消息，避免重复

- **StreamingOutboundHook**
  - `receipt-line` 猫猫个性提示语（`pickReceiptLine`）
  - `senderHint` 群聊发送者前缀
  - placeholder → PATCH 更新 → finalize 完整生命周期

- **生命周期管理**
  - `scripts/manage.ts` PID file 管理
  - `npm start/stop/restart` + `npm run status`
  - CLI: `bin/opencode-copilot.ts` 可全局安装使用

- **npm 包配置**
  - `bin` field、`files` field、`engines: { bun: ">=1.1.0" }`
  - `.env` 文件自动加载 (Bun 原生支持)
  - `.env.example` 模板

- **文档体系**
  - `README.md`: 项目概览 + 快速开始 + 命令参考 + 架构图
  - `docs/SPEC.md`: 完整技术规格 → 移入 `docs/specs/tech-architecture.md`
  - `docs/CHANGELOG.md`: 版本变更（本文件）
  - `docs/SOP.md`: 开发流程标准操作
  - `docs/decisions/`: 技术决策记录 (D001, D002)
  - `docs/guides/dev-setup.md`: 开发环境搭建
  - `AGENTS.md`: 项目治理规则
  - `BACKLOG.md`: 功能路线图
  - `docs/README.md`: 文档索引
