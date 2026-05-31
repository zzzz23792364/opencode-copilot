---
topics: [bug, opencode]
doc_kind: fix-notes
created: 2026-05-31
---

# Bug: `-y` 标志导致 opencode 返回空响应

## 环境

- **平台**: Bun / Linux
- **版本**: opencode v1.15.13, opencode-copilot d2f511a 之前
- **复现率**: 必现（每条消息）

## 问题现象

用户在飞书发送消息后，bridge 响应 `✅ 完成 (0s)` + `(no response)`，没有任何 AI 回复内容。流式心跳正常，但最终卡片为空。

## 根因分析

`opencode-run.ts` 中向 `opencode run` 传递了 `-y` 标志：

```typescript
const args = ['run', '-y', '--format', 'json']
```

但 `opencode run` 的 CLI 帮助中**没有 `-y` 选项**。该选项不存在于 `opencode` v1.15.13 的命令行参数中。opencode 将 `-y` 视为未知参数，直接打印帮助信息并 `exit(1)`，导致 stdout 没有任何 NDJSON 输出。

stderr 输出为完整的 opencode help 文本，但 bridge 没有读取/处理 stderr 中的错误信息。

## 修复方案

移除 `-y` 标志：

```typescript
const args = ['run', '--format', 'json']
```

openCode 在 `stdin: 'ignore'`（非 TTY 模式）时会自动跳过交互确认，不需要显式 `-y`。

## 验证

- [x] 修复后消息正常返回 AI 回复
- [x] 心跳、流式 PATCH 均正常工作
- [x] commit: d2f511a
