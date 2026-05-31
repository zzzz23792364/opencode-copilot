# opencode-copilot — Feishu ↔ opencode TUI 双向桥

承接前序 session 的工作，构建一个独立的飞书桥接服务。

---

## 目标

飞书和 TUI 共享同一个 opencode session，实现：

```
TUI 输入   → session (SQLite) → AI 回复 → TUI 输出
飞书输入   → session (SQLite) → AI 回复 → TUI 输出 + 飞书回复
TUI 输入   → 同步转发到飞书（让手机端看到 TUI 的对话）
```

---

## 核心架构（已验证）

**不要用 `opencode serve` + `opencode attach` 模式**——session 管理分裂，TUI 和 bridge 看到的 session 不一致。

**正确的方案：直接操作 SQLite DB**

```
TUI:    opencode (直接)                    → 读写 ~/.local/share/opencode/opencode.db
Bridge: opencode run --session <id> --format json <prompt>  → 读写同一个 DB
```

已验证：`opencode run --session ses_xxx --format json "你好"` 发出的消息和 AI 回复会出现在 TUI 中。

---

## NDJSON 输出格式

`opencode run --format json` 输出 NDJSON（每行一个 JSON 对象）：

```
{"type":"step_start","timestamp":...,"sessionID":"ses_xxx","part":{"id":"prt_xxx","messageID":"msg_xxx","sessionID":"ses_xxx","type":"step-start"}}
{"type":"text","timestamp":...,"sessionID":"ses_xxx","part":{"id":"prt_xxx","messageID":"msg_xxx","sessionID":"ses_xxx","type":"text","text":"Hi","time":{"start":...,"end":...}}}
```

事件类型：
| type | 含义 |
|---|---|
| `step_start` | 新 step/消息开始 |
| `text` | AI 文本输出（`part.text`） |
| `tool_use` (推测) | 工具调用 |
| `error` (推测) | 错误 |

没有显式的 `result` / `SessionIdle` 事件——进程退出即表示完成。

---

## 参考项目

### opencode-im-bridge (v0.46.0)
- 位置：`~/.nvm/versions/node/v20.20.0/lib/node_modules/opencode-im-bridge/`
- 使用 Bun + TypeScript
- 当前已安装，飞书 WebSocket 可用（已验证 `Gateway received message`）
- 问题：目前通过 `POST /session/{id}/prompt_async` + SSE 跟 serve 通信 → 不可靠
- 可复用的模块：
  - `src/feishu/` — WebSocket 客户端、REST API 客户端（`sendMessage`, `addReaction`）、CardKit
  - `src/session/session-manager.ts` — session 映射管理（SQLite 表 `feishu_sessions`）
  - `src/handler/command-handler.ts` — 斜杠命令（`/new`, `/sessions`, `/connect` 等）
  - `src/streaming/streaming-card.ts` — 流式卡片（需要 `cardkit:card:write` 权限）
  - `src/handler/message-handler.ts` — 消息处理管线（需要改发送方式）
  - `src/handler/outbound-media.ts` — 自动发送文件
  - `src/utils/` — 配置加载、DB 初始化、日志

### clowder-local
- 位置：`/home/zengchao/.cat-cafe/clowder-local`
- 参考：`StreamingOutboundHook`（placeholder→PATCH→finalize 模式）
- 使用 `opencode run --session` + NDJSON 解析（已验证此模式可用）

---

## 飞书 App 信息

- App ID: `your_app_id`
- App Secret: `your_app_secret`
- Bot Open ID: `ou_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
- Bot 名称: catcaffe
- 接收者 Open ID: `ou_e0b85cf1af229d7fc9d148b35babb51c`（用于 feishu-notifier）
- 已开通权限: `im:message`, `im:chat` 等（已能收消息）
- 缺少权限: ❌ **`cardkit:card:write`**（流式卡片需要）
  - 开通地址：`https://open.feishu.cn/app/your_app_id/permission`
- Webhook 端口：3001（用于卡片回传交互）

---

## 飞书消息格式

收到的消息事件（WebSocket）：

```typescript
interface FeishuMessageEvent {
  event_id: string
  chat_id: string
  chat_type: "p2p" | "group"
  message_id: string
  message: {
    message_type: "text" | "post" | "image" | "file"
    content: string  // JSON string
  }
  sender: {
    sender_id: { open_id: string; union_id?: string; user_id?: string }
  }
  mentions?: Array<{ id: { open_id: string }; name: string }>
  root_id?: string
  parent_id?: string
}
```

发消息 API：
```
POST https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id
{
  "receive_id": "oc_xxx",
  "msg_type": "text",
  "content": "{\"text\":\"Hello\"}"
}
```

需要 `tenant_access_token`（App ID + App Secret 换取，有效期 2 小时）。

---

## 待构建的新项目

独立于 `opencode-im-bridge`，新建项目。

### 核心模块

```
src/
├── index.ts              # 入口：启动飞书 WS + 消息循环
├── feishu/
│   ├── ws-client.ts      # 飞书 WebSocket 事件订阅（复用 opencode-im-bridge 模式）
│   ├── api-client.ts     # REST API（sendMessage, upload, token 管理）
│   └── types.ts          # 飞书消息类型定义
├── bridge/
│   ├── opencode-run.ts   # spawn opencode run --session + NDJSON 解析
│   ├── session-manager.ts # session 发现/创建/映射（SQLite）
│   └── message-handler.ts # 消息管线：接收→转发→响应
├── feishu-poller.ts      # 定时轮询 session export 检查新消息（TUI→飞书方向）
└── utils/
    ├── config.ts         # 配置加载
    ├── logger.ts         # 日志
    └── db.ts             # SQLite 初始化
```

### Session 映射

SQLite 表 `feishu_sessions`：
```sql
CREATE TABLE feishu_sessions (
  feishu_key TEXT PRIMARY KEY,  -- "oc_xxx" / "oc_xxx:root_id"
  session_id TEXT NOT NULL,     -- "ses_xxx"
  agent TEXT NOT NULL,
  model TEXT,
  created_at INTEGER NOT NULL,
  last_active INTEGER NOT NULL
);
```

发现逻辑（从 opencode-im-bridge `session-manager.ts:104` 复制）：
1. 新消息 → 查映射表
2. 有映射 → 直接用
3. 无映射 → `opencode session list --format json -n 1` → 取最新的 session
4. 没有 session → `opencode run --format json "New session"` 创建新 session，从第一行 NDJSON 取 `sessionID`

### 消息流（飞书输入）

```
飞书消息 → WS → message-handler
  → 解析消息类型（text/post/image/file）
  → 查找/创建 session 映射
  → spawn opencode run --session <id> --format json <userText>
    → 解析 NDJSON stdout：
      - "text" 事件 → 累加 AI 回复文本
      - "tool_use" 事件 → 可选更新进度
      - 进程退出 → AI 回复完成
  → 通过飞书 API 发送回复文本（sendMessage）
  → 更新 session 最后活跃时间
```

### 消息流（TUI 输入→飞书转发）

```
定时轮询（每 2-3 秒）：
  → opencode export <session_id> --format json
  → 解析 messages 数组，取最后一条
  → 如果 role=user 且不是飞书发出的 → 转发到飞书
```

### 注意点

1. **`opencode run` 每次启动约 200-500ms 延迟**，可接受
2. **每个飞书 chat 一次只处理一个请求**（FIFO 队列）
3. **消重**：用 `message_id` 去重
4. **CardKit 权限**：如果要流式输出到飞书，需要开通 `cardkit:card:write`。在权限开通前，可先用 `text` 消息类型（`sendMessage`）发送最终回复
5. **文件/图片**：飞书消息带 file/image → 下载到本地 → 把路径传给 `opencode run`
6. **斜杠命令**：`/new`、`/sessions`、`/connect`、`/help`（参考 opencode-im-bridge `command-handler.ts`）

---

## 环境

- Node.js v20.20.0
- Bun 1.3.8
- opencode v1.15.13
- 飞书 SDK: `@larksuiteoapi/node-sdk`
- 平台: Linux (WSL2)
- 数据库: `~/.local/share/opencode/opencode.db` (SQLite, 共享)
