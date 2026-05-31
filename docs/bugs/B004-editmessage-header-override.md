---
topics: [bug, streaming, feishu]
doc_kind: fix-notes
created: 2026-05-31
---

# Bug: editMessage 包装 "🐱 回复中..." header 覆盖流式卡片

## 环境

- **平台**: Bun / Linux
- **版本**: opencode-copilot 7143abb 之前
- **复现率**: 必现

## 问题现象

流式卡片最终状态始终显示 `🐱 回复中...`，而不是 AI 的完整回复文字。用户反馈"回复完成之后，之前的思考过程和流式时长信息也丢失了"。

## 根因分析

`FeishuAdapter.editMessage()` 方法（来自 clowder-local）每次 PATCH 都会构造独立卡片：

```typescript
const card = {
  header: { title: '🐱 回复中...', template: 'blue' },
  elements: [{ tag: 'markdown', content: text }],
}
```

在 clowder-local 的架构中，流式卡片只是"正在生成"的指示器，真正的回复通过 `sendFormattedReply` 另发一条消息。但在我们的 bridge 中，流式卡片**就是**最终回复，不应该有 "🐱 回复中..." header。

## 修复方案

**不通过 `adapter.editMessage`，直接用 SDK client PATCH**

在 `StreamingOutboundHook` 中创建 `patchCard` 方法：

```typescript
private async patchCard(session, text, header?) {
  const card = { elements: [{ tag: 'markdown', content: text }] }
  if (header) {
    card.header = { title: ..., template: ... }
  }
  await adapter.client.im.message.patch({ ... })
}
```

改为动态 header：
- 心跳: `⏳ 思考中... (Xs)` grey
- 流式: `💭 回复中...` blue  
- 完成: `✅ 完成 (Xs)` green（含总耗时）

## 验证

- [x] 流式卡片不再残留 "🐱 回复中..."
- [x] 动态 header 正确显示状态变化
- [x] 最终卡片保留耗时信息
- [x] commit: 7143abb, 06d9fa1
