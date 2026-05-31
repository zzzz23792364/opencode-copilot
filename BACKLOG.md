---
topics: [backlog]
doc_kind: note
created: 2026-05-31
updated: 2026-06-01
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
| Features | **0** in_progress，**1** pending | 桥接核心 ✅ 命令系统 ✅ 流式卡片 ✅ 生命周期管理 ✅ 项目切换 ✅ 文档体系 ✅ 交互卡片 ✅ /sw ✅ Node.js迁移 ✅ |
| Bugs | **0** active | B001-B006 全部 ✅ |
| Docs | **0** pending | SPEC ✅ README ✅ SOP ✅ CHANGELOG ✅ decisions ✅ |

---

## Active Features

| ID | Name | Status | Owner | Link |
|----|------|--------|-------|------|
| — | _暂无活跃项_ | — | — | — |

---

## Recently Done (2026-06-01)

### v0.2.0 — Stability & UX

- **运行时迁移**: Bun → Node.js (tsx)，`bun:sqlite` → `better-sqlite3`
- **`/sw` 命令**: 两步卡片流（选项目 → 选 session）
- **命令管道去重**: B006 — WS 重放命令不再重复执行
- **`/new` 保留 CWD**: 不再重置 `/project` 选择的目录
- **流式卡片竞态修复**: `onStreamEnd` 等最后一个 chunk PATCH 完成再发 ✅
- **僵尸进程修复**: restart 轮询等老进程真正退出再启动
- **重启安全**: `shell: true` 是所有 spawn 的 opencode 必备项
- **BUG 修复**:
  - B001-B003: 基础标志/poller/心跳问题
  - B004: editMessage header 覆盖
  - B005: WS 重连 + 心跳阻塞 shutdown
  - B006: 命令管道无去重保护

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
- **消息去重**: SQLite-backed + `message_id` TTL=5min
- **FIFO 队列**: 每个 chat 一个请求串行处理
- **生命周期管理**: `npm start/stop/restart` + PID file
- **npm 包支持**: `bin/opencode-copilot.mjs` CLI 入口 + dotenv 自动加载
- **文档体系**: AGENTS.md / BACKLOG.md / SPEC.md / SOP.md / CHANGELOG.md / decisions/

---

## Next Steps

按优先级：
1. **F004 交互卡片** — /projects 交互卡片 + /use 卡片按钮
2. **F001 流式输出打磨** — minDeltaChars 从 200 降到 50
3. **F003 群聊支持** — @提及白名单

---

> 完整开发历史见 [docs/CHANGELOG.md](docs/CHANGELOG.md)。
