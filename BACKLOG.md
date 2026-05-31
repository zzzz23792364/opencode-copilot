---
topics: [backlog]
doc_kind: note
created: 2026-05-31
updated: 2026-05-31
---

# Feature Roadmap

> 活跃项看板。Done 项归档到 `docs/archive/backlog-history.md`。
>
> **规则**:
> 1. Active 表格只保留活跃（in_progress / todo）和 pending 项。Done 项必须移除。
> 2. 近期 Done 汇总仅用于快速摘要，不保留在表格中。

---

## 快速摘要

| 维度 | 活跃 / Pending | 近期 Done |
|------|---------------|-----------|
| Features | **1** in_progress，**0** pending | 桥接核心 ✅ 命令系统 ✅ 流式卡片 ✅ 生命周期管理 ✅ 项目切换 ✅ 文档体系 ✅ |
| Bugs | **0** active | — |
| Docs | **0** pending | SPEC ✅ README ✅ SOP ✅ CHANGELOG ✅ decisions ✅ |

---

## Active Features

| ID | Name | Status | Owner | Link |
|----|------|--------|-------|------|
| **F001** | **流式输出打磨** | **todo** | TBD | [/use 和 /list 交互升级为卡片按钮、placeholder 卡片优化 |
| **F002** | **Webhook 模式** | **pending** | TBD | 支持 `FEISHU_CONNECTION_MODE=webhook`，URL 验证 |
| **F003** | **群聊支持** | **pending** | TBD | @提及检测、群聊白名单、多用户 session 隔离 |
| **F004** | **飞书交互卡片** | **todo** | TBD | /list /use 做成交互卡片，按钮点选取代文本命令 |

---

## Recently Done (2026-05-31)

### v0.1.0 — Initial Release

- **Feishu ↔ opencode TUI 双向桥核心**
  - `opencode run --session --format json` 直接操作 SQLite DB
  - Feishu WebSocket 事件订阅 (via @larksuiteoapi/node-sdk)
  - NDJSON 流解析 → AI 文本收集 → 飞书回复
- **FeishuAdapter 复用** (from clowder-local)
  - `parseEvent()`: text/post/image/file/audio 全类型解析 + 群聊 @提及过滤
  - `sendFormattedReply()`: 交互卡片（标题 + 正文 + 时间戳）
  - `sendPlaceholder` / `editMessage` / `finalizeStreamCard`: 流式卡片
  - `addReaction`: 👍 即时反馈 (F157 Receipt Ack)
  - `sendMedia`: 图片/文件/语音上传下载 + opus 转换
- **Session 管理**
  - `feishu_sessions` SQLite 表: `feishu_key → session_id` 映射
  - Session 发现: `opencode session list` → 自动绑定
  - 项目目录切换: `/projects` `/project <N>` → `opencode_cwd` 列
- **命令系统**
  - `/new`, `/list`, `/list -all`, `/use <编号|ID|前缀|标题>`
  - `/thread <id> <msg>`, `/connect <id>`, `/unbind`
  - `/where` / `/status`, `/commands` / `/help`
  - `/projects`, `/project <N>`
- **TUI→飞书 poller**: `opencode export` 轮询 + 增量转发
- **消息去重**: SQLite-backed + `message_id` TTL
- **FIFO 队列**: 每个 chat 一个请求串行处理
- **生命周期管理**: `npm start/stop/restart` + PID file
- **npm 包支持**: `bin/opencode-copilot.ts` CLI 入口 + `.env` 自动加载
- **文档体系**: AGENTS.md / BACKLOG.md / SPEC.md / SOP.md / CHANGELOG.md / decisions/

---

## Next Steps

按优先级：
1. **F003 群聊支持** — 当前只支持 p2p 私聊，群聊 @bot 后会触发但缺乏白名单
2. **F001 流式卡片打磨** — /list /use 用卡片按钮交互；placeholder 文案优化
3. **F004 交互卡片** — 将 /list /use /project 升级为交互卡片（需搭建卡片动作路由）
4. **F002 Webhook 模式** — 可选，当前 WS 已经工作良好

---

> 完整开发历史见 [docs/CHANGELOG.md](docs/CHANGELOG.md)。
