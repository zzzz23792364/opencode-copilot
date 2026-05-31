---
topics: [spec, architecture]
doc_kind: spec
created: 2026-05-31
---

# opencode-copilot — Technical Architecture

## Objective

构建独立的飞书 ↔ opencode TUI 双向桥接服务，飞书和 TUI 共享同一个 opencode session。

```
TUI 输入   → session (SQLite) → AI 回复 → TUI 输出 + 飞书转发
飞书输入   → session (SQLite) → AI 回复 → TUI 输出 + 飞书回复
```

核心方案：`opencode run --session <id> --format json <prompt>` + NDJSON 流解析。

## Tech Stack

| 层 | 选型 | 备注 |
|---|------|------|
| 运行时 | Node.js >= 18 (tsx) + npm (包管理) | 纯 Node，零 Bun 依赖 |

| SQLite | `better-sqlite3` | 原生 C 扩展，稳定高性能 |
| 配置 | `opencode-copilot.jsonc` | 参考 opencode-im-bridge 风格 |
| 日志 | 控制台（结构化时间戳+模块名） | 无需 winston/pino |

## Commands

```bash
npm run dev            # tsx watch src/index.ts
npm start              # tsx src/index.ts
npm run test:e2e       # tsx scripts/e2e-test.ts
npm run test:ws        # tsx scripts/test-ws.ts
npx tsc --noEmit        # Type check
```

## Project Structure

```
src/
├── index.ts                     # 入口：init → WS → poller
├── feishu/
│   ├── FeishuAdapter.ts         # ← [reuse] clowder-local（SDK Client 模式）
│   ├── FeishuTokenManager.ts    # ← [reuse] clowder-local（原生 fetch）
│   ├── feishu-card-formatter.ts # ← [reuse] clowder-local
│   ├── feishu-receipt-lines.ts  # ← [reuse] clowder-local
│   ├── ws-client.ts             # WS 事件订阅（lark.WSClient）
│   └── types.ts                 # 飞书消息类型
├── bridge/
│   ├── StreamingOutboundHook.ts # ← [reuse] clowder-local（简化）
│   ├── opencode-run.ts          # spawn opencode run + NDJSON 解析
│   ├── session-manager.ts       # feishu_sessions CRUD
│   ├── message-handler.ts       # 输入管线：parse → session → opencode
│   └── outbound.ts              # 输出管线：文本/卡片/流式
├── commands/
│   ├── registry.ts              # 命令注册表
│   └── handlers/                # /new, /sessions, /connect, /help
├── feishu-poller.ts             # TUI→Feishu 方向轮询
└── utils/
    ├── config.ts                # JSONC 配置加载
    ├── logger.ts                # 结构化日志
    └── db.ts                    # SQLite 初始化 + 迁移

scripts/
├── test-ws.ts                   # WS 连通性验证
└── e2e-test.ts                  # 端到端验证
```

### 复用策略

| 源文件 (clowder-local) | 目标文件 | 改编方式 |
|---|---|---|
| `connectors/adapters/FeishuAdapter.ts` | `src/feishu/FeishuAdapter.ts` | 去掉 `@cat-cafe/shared` 类型导入，内联本地类型；保留 SDK Client |
| `connectors/adapters/FeishuTokenManager.ts` | `src/feishu/FeishuTokenManager.ts` | 直接复制 |
| `connectors/adapters/feishu-card-formatter.ts` | `src/feishu/feishu-card-formatter.ts` | 内联 RichBlock / LarkCard 等类型 |
| `connectors/feishu-receipt-lines.ts` | `src/feishu/feishu-receipt-lines.ts` | 直接复制 |
| `StreamingOutboundHook.ts` | `src/bridge/StreamingOutboundHook.ts` | 去掉 catRegistry / multi-cat 逻辑；去掉 IConnectorThreadBindingStore 依赖 |

### 自写模块

`ws-client.ts`, `opencode-run.ts`, `session-manager.ts`, `message-handler.ts`, `outbound.ts`, `feishu-poller.ts`, `commands/`, `utils/` — bridge 的核心逻辑，不复杂。

## Architecture

```
┌──────────────────────┐
│  Feishu Open Platform │
└──┬───────────────┬────┘
  WS│               │ REST (send/patch/edit/react)
    ▼               ▲
┌─────────┐    ┌─────────────────┐
│ws-client│    │ FeishuAdapter    │
│(SDK WS) │    │ (SDK Client)    │
└────┬────┘    │ FeishuTokenMgr │
     │         └────────┬────────┘
     │                  │
┌────▼──────────────────▼────┐
│      message-handler       │
│  parse → session map →     │
│  spawn opencode run        │
└────────┬───────────────────┘
         │ NDJSON
┌────────▼────────────┐
│  opencode-run.ts    │
│  + NDJSON parser    │
└────────┬────────────┘
         │ text events
┌────────▼────────────┐
│  outbound.ts        │
│  → StreamingOutlet- │
│    boundHook        │
│  → FeishuAdapter    │
│    send/patch/fin   │
└─────────────────────┘
```

## Data Model

```sql
-- Session 映射
CREATE TABLE feishu_sessions (
  feishu_key  TEXT PRIMARY KEY,  -- chat_id / chat_id:root_id
  session_id  TEXT NOT NULL,     -- ses_xxx
  agent       TEXT NOT NULL DEFAULT 'default',
  model       TEXT,
  created_at  INTEGER NOT NULL,
  last_active INTEGER NOT NULL
);

-- Message 去重（防重放）
CREATE TABLE dedup (
  message_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- TUI→飞书已转发标记
CREATE TABLE forwarded (
  message_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  forwarded_at INTEGER NOT NULL
);
```

## Streaming Strategy

```typescript
// 每收到一条飞书消息：
addReaction("THUMBS_UP")                        // 即时反馈：👍
sendPlaceholder("🐱 思考中...")                   // 灰色卡片占位

// opencode run 过程中：
onStreamChunk → editMessage(累计文本 + " ▌")     // 每 2s/200 字符更新

// 完成后：
finalizeStreamCard("✅ 已回复")                   // 绿色完成卡片
```

## Code Style

```typescript
// 工厂函数为主（参考 opencode-im-bridge）
export function createSessionManager(db: Database): SessionManager { ... }

// 接口优先
export interface SessionManager {
  getOrCreate(feishuKey: string): Promise<string>
  getSession(feishuKey: string): SessionMapping | null
}

// 异步全用 async/await
async function handle(event: FeishuMessageEvent): Promise<void> { ... }
```

## Testing Strategy

| 层级 | 内容 | 方式 |
|------|------|------|
| 手动 E2E | 飞书→opencode→飞书完整链路 | `npx tsx scripts/e2e-test.ts` |
| 手动验证 | WS 事件接收 | `npx tsx scripts/test-ws.ts` |
| 手动验证 | Session 发现/创建 | TUI 中检查 session 对话是否出现 |

初期不写自动化测试，以手动验证和实时日志为主。

## Boundaries

**Always do**:
- `message_id` 去重
- 每个 chat 同时只处理一个请求（FIFO 队列）
- 进程异常/退出时记录日志
- App Secret 不提交到 git

**Ask first**:
- 数据库 schema 变更
- 新增外部依赖
- 飞书事件订阅变更

**Never do**:
- 直接修改 opencode SQLite DB
- 覆盖/删除已有 session 映射

## Success Criteria

- [x] 飞书 WS 能收到消息
- [x] `opencode run --session --format json` 能正常执行
- [x] NDJSON 能正确解析出 AI 回复文本
- [x] 飞书 API 能发送回复消息
- [ ] TUI 和飞书共享同一 session（消息双向可见）
- [ ] 流式卡片（placeholder → PATCH → finalize）
- [ ] 文本/图片/文件消息收发
- [ ] 斜杠命令（/new, /sessions, /connect, /help）
- [ ] TUI→飞书方向自动转发
- [ ] Session 映射持久化，重启不丢失
- [ ] 消息去重，防止重复处理
