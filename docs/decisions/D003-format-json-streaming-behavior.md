---
topics: [decision, streaming, format-json]
doc_kind: decision
created: 2026-06-01
---

# D003: `--format json` 非流式输出是预期行为

## Context

桥接使用 `opencode run --session --format json <prompt>` 收集回复，通过
`StreamingOutboundHook` 实现飞书流式卡片。但实际观测到 `onText` 只被调用一次
（拿到完整文本），PATCH 也只发一次——没有逐 token 的流式更新。

排查日志：

```
[opencode-run] spawning opencode                [T+0s]
[message-handler] Got reply replyLen:501         [T+5.9s]  ← 一次性
[StreamingOutbound] PATCH ok len:501 delta:501   [T+6s]   ← 只 PATCH 一次
```

## 调研

### 直接测试

| 场景 | NDJSON 行数 | text 事件 |
|------|------------|-----------|
| 短回复 "say hello" | 2 (step_start + text) | 1 次，含完整 "Hello" |
| --thinking "1+1=" | 3 (step_start + reasoning + text) | 1 次，含完整 "2" |
| 500字 essay + tool_use | 5 (step_start + tool_use + step_finish + step_start + text) | 1 次，含完整文本 |
| 所有测试 | — | **每个 part 只有 1 个 text 事件** |

### opencode 事件架构

open code server 对流式文本创建**两种并行事件**：

```
LLM token 到达
  ├─ message.part.delta   ← BusEvent.publish 直发，逐 token
  └─ message.part.updated ← SyncEvent.run → Database.effect fork，part 完成时
```

- `message.part.delta`: 每个 token 触发一次，含 `{partID, field, delta}`（新文本增量）
- `message.part.updated`: part 完成时触发一次，含 `{part: {..., text: "<完整文本>"}}`

### TUI vs --format json

| | TUI (`opencode`) | `opencode run --format json` |
|---|---|---|
| 订阅 `message.part.delta` | ✅ **是**（逐 token → Ink setState） | ❌ 否 |
| 订阅 `message.part.updated` | ✅ part 完成时更新 | ✅ 转为 NDJSON line |
| 输出粒度 | 每 token 刷新屏幕 | 每 part 一行 JSONL |

**根因**：`--format json` CLI handler 只消费 `message.part.updated` 事件，不订阅
`message.part.delta`。因此输出的 text 事件总是包含完整文本，不是逐 token 增量。

参考：
- [opencode issue #26924](https://github.com/anomalyco/opencode/issues/26924) — delta 可能比 updated 先到，证明两者是独立发射的
- [opencode issue #26855](https://github.com/anomalyco/opencode/issues/26855) — 确认 `--format json` 的 NDJSON 输出以 `message.part.updated` 为源
- [opencode SDK Event types](https://github.com/anomalyco/opencode/blob/HEAD/packages/sdk/js/src/v2/gen/types.gen.ts) — `message.part.delta` 含 `delta: string` 字段

## 决策

**维持现状，不换 SSE**。

## 理由

要逐 token 流式输出到飞书，需要改用 opencode SDK 的 SSE 事件订阅
（`client.event.subscribe()` → 处理 `message.part.delta`），而非 `opencode run`
子进程模式。这涉及三项架构变动：

1. **跑 `opencode serve`**（或内嵌 server）替代每次 `spawn('opencode run')`
2. **用 SDK 订阅 SSE 流**，处理 `message.part.delta` / `message.part.updated` /
   `session.status` 等事件
3. **重写流式管线**，不再依赖 NDJSON 行解析

与 D001 的权衡一致：子进程模式虽然损失流式粒度，但架构简单、运维可靠。当前
placeholder 灰卡 + ⏳思考中 ticker 已提供足够的视觉反馈。

## Consequences

- **Positive**: 架构保持简单，无 server 进程需要管理
- **Positive**: 无需处理 SSE 重连、事件顺序、版本兼容等问题
- **Negative**: 飞书卡片只在回复完成后一次性 PATCH，用户看不到逐字输出
- **Negative**: 因 `--thinking` 思考时间较长，感知延迟更明显

## Future Possibilities

如果将来需要真正的逐 token 流式，路径是：

```
opencode serve（或内嵌 server）
  → client.event.subscribe()
  → for await (const event of events.stream)
      → message.part.delta: streaming.onChunk(delta)  // 逐 token
      → message.part.updated: 更新 tool 状态或完成 part
      → session.status(idle):  完成
```

可以复用现有的 `StreamingOutboundHook`（PATCH 节流、ticker、finalize
逻辑），只需替换事件来源。

## References

- [`D001-opencode-run-vs-serve.md`](./D001-opencode-run-vs-serve.md) — 原始 CLI vs serve 决策
- [`tech-architecture.md`](../specs/tech-architecture.md) — 技术架构
- `src/bridge/opencode-run.ts` — NDJSON 解析实现
- `src/bridge/StreamingOutboundHook.ts` — 流式卡片 PATCH 管线
