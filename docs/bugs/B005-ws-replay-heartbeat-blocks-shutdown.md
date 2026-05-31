---
topics: [bug, streaming, heartbeat, shutdown, websocket]
doc_kind: fix-notes
created: 2026-06-01
---

# Bug: WS 重连重放 + 心跳阻止 graceful shutdown

## 环境

- **平台**: Bun / Linux
- **版本**: opencode-copilot b2fdf41 之前
- **复现率**: 开发阶段频繁 `npm restart` 时必现

## 问题现象

1. 流式卡片完成后，bridge 无法正常退出，等待 30s 后被强杀
2. 同一条飞书消息被 bridge 处理多次（不同 `message_id`）
3. 日志出现 `Force exit after grace period inflightCount:1`

## 完整调用链

```
事件 1: 正常处理
─────────────────
16:24:53  "逐一修改把" 处理完成 → reply(451 chars)

事件 2: WS 重连重放
─────────────────
16:24:54  用户执行 npm restart → bridge 收到 SIGTERM
          新 bridge 启动，WS 重连
          → 飞书重放未确认事件（同一 message_id）
          → 去重 TTL=60s 已过期（事件距重启 >60s）
          → ❌ 去重失效 → 新建流式 session → 心跳 interval 启动

事件 3: 再次 restart
─────────────────
16:25:01  npm restart → SIGTERM
          → shutdown() 启动
          → 心跳 interval 仍在运行，每 5s 触发 PATCH
          → ❌ 每个 PATCH 计入 inflightCount
          → inflightCount 永远 >= 1
          → 30s grace period 到期 → Force exit
```

## 根因分析（3 层）

| 层 | 原因 | 影响 |
|---|------|------|
| 1 | `npm restart` 频繁（开发阶段） | 不可避免 |
| 2 | 去重 TTL=60s < 重启间隔 | WS 重连重放事件通过去重 |
| 3 | shutdown 时心跳 interval 不停止 | inflightCount 永远不归零 |

### 详细分析

**层 1 — 重启频繁**: 开发阶段每次代码修改都得 `npm restart`，每次重启触发 WS 断连重连。

**层 2 — 去重 TTL 过短**: Feishu WebSocket 长连接协议在断线重连后会**重放未确认的历史事件**。重放事件的 `message_id` 不变，但去重 TTL 只有 60s。当重启间隙 >60s 时，去重条目已被清理，重放事件被当作新消息处理。

**层 3 — 心跳阻止 shutdown**: 流式 session 的 `setInterval` 心跳在 shutdown 期间继续执行。每个 heartbeat PATCH 调用 `enterRequest()`/`leaveRequest()`，导致 `inflightCount` 永远不归零。30s grace period 后强杀。

## 修复方案

### Fix 1: 去重 TTL 60s → 5min

```typescript
// message-dedup.ts
export function createMessageDedup(db: Database, ttlMs = 300_000): MessageDedup {
```

commit: `1b4fe59`

### Fix 2: shutdown 立即停止心跳

```typescript
// StreamingOutboundHook.ts
stopAllHeartbeats(): void {
  for (const [, session] of this.sessions) {
    if (session.heartbeatTimer) clearInterval(session.heartbeatTimer)
  }
  this.sessions.clear()
}

// index.ts
function shutdown() {
  shuttingDown = true
  streamingHook.stopAllHeartbeats()  // 立即停止
}
```

commit: `b2fdf41`

## 修复后流程

```
npm restart → SIGTERM
  → shutdown()
    → streamingHook.stopAllHeartbeats()  // 所有 timer 立即清除
    → inflightCount 归零
    → 干净退出（1-2s 内）
  → 新 bridge 启动
    → WS 重连 → Feishu 重放事件
    → 去重 TTL=5min > 重启间隔 → ✅ 拦截
```

## 生产环境影响评估

| 场景 | 是否出现 |
|------|:---:|
| bridge 稳定运行中 | ❌ 不出现 |
| 偶尔重启（>5min 间隔） | ❌ 去重拦截 |
| 短间隔重启（<5min） | ✅ 去重覆盖 |
| shutdown 卡死 | ❌ 已修复 |

生产环境中 bridge 不会频繁重启，WS 重连重放是极低频事件。

## 验证

- [x] TTL 改为 5min → 重启重放事件被去重拦截
- [x] shutdown 立即停止心跳 → 1-2s 内干净退出
- [x] 不再出现 `Force exit after grace period`
- [x] commits: `b2fdf41`, `1b4fe59`
