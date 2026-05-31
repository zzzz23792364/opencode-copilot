---
topics: [bug, dedup, websocket, command, replay]
doc_kind: fix-notes
created: 2026-06-01
---

# Bug: 命令管道无去重保护导致 WS 重放命令自动回复

## 环境

- **平台**: Bun / Linux
- **版本**: opencode-copilot 8306020 之前
- **复现率**: WS 断线重连时必现

## 问题现象

飞书用户只发了一条普通消息 "什么进展了"（非命令），但 bridge 回复了两次：

1. 第一次：流式卡片 ✅ 完成 (34s) — 正确
2. 第二次：3 分钟后自动发出第二条格式化回复 (sendFormatted) — 不应出现

第二次回复的内容是 opencode 生成的文本（非固定命令响应），且日志中没有对应的 `Processing message` 或 `spawning opencode` 事件。

## 根因

### 事件流

```
WS 断线重连 → 重放历史事件
  ├─ "什么进展了" (messageHandler 路径) → dedup ✅ 拦截
  └─ 历史命令事件 (命令管道)          → ❌ 无 dedup, 重新执行
                                        → opencodeRun 3.5min
                                        → sendFormatted 自动发
```

### 代码缺陷

`index.ts` 的 `onMessage` 处理流程：

```typescript
const parsed = adapter.parseEvent(envelope)
// ↓ 命令处理管道 —— 无 dedup 保护！
const cmdResult = await commandHandler.handle(parsed.text, ...)
if (cmdResult) {
  outbound.sendFormatted(...)  // ← 重放的命令事件直接执行
  return
}
// ↓ 普通消息管道 —— 有 dedup
await messageHandler.handle(parsed)  // ← processEvent 内部 isDuplicate()
```

1. **命令管道无去重**：`commandHandler.handle()` 在 `dedup` 检查之前运行，WS 重放的命令事件（如 `/thread`、`/help`）会被直接重新执行。
2. **`/thread` 命令跑 opencode**：如果重放事件是 `/thread` 类命令，会启动新的 opencode 进程，生成文本回复，并以 `sendFormatted`（非流式）发出。
3. **重放延迟不可控**：3 分钟后用户已看到第一个回复，第二个回复显得"自动"出现，造成混淆。

## 修复

1. **将 dedup 检查移到 `onMessage` 顶部**（`index.ts:89-93`）：在 `parseEvent` 后、`commandHandler.handle()` 前添加 `dedup.isDuplicate()` + `dedup.mark()`。
2. **从 `message-handler.ts` 移除冗余 dedup**：去重已在 `onMessage` 层完成，`processEvent` 不再需要重复检查。
3. **清理死代码 `feishu-poller.ts`**：该文件已不 import，物理删除。

## 验证

- 重启 bridge 后发送 `/help`，确认正常回复
- 观察 WS 重连后是否出现重复命令执行（应被 dedup 拦截）
- bridge log 出现 `Duplicate event, skipping (command-safe dedup)` 表示拦截成功
