---
topics: [bug, poller, feishu]
doc_kind: fix-notes
created: 2026-05-31
---

# Bug: Poller 导致飞书消息二次转发

## 环境

- **平台**: Bun / Linux
- **版本**: opencode-copilot 45caba7 之前
- **复现率**: TUI+飞书同时操作时偶现

## 问题现象

1. 用户在飞书发送消息，bridge 处理并回复
2. `feishu-poller` 定时扫描 `opencode export`，发现 session 中新增的 user 消息
3. Poller 误认为该消息来自 TUI → 通过 `adapter.sendReply` 再次发送到飞书
4. 用户看到 bot "重复"了自己刚发的消息

## 根因分析

`feishu-poller.ts` 的设计初衷是将 TUI 输入转发到飞书。但它无法区分 session 中的 user 消息来源：

- 来自 TUI 的 user 消息（应转发）
- 来自飞书触发的 user 消息（不应转发，会形成循环）

两种消息在 `opencode export` 中记录相同（均为 `role: 'user'`），没有来源标记。

## 修复方案

**移除 `feishu-poller.ts`**（commit: 45caba7）。

理由：
1. TUI→飞书转发价值有限（终端已看到消息）
2. 核心功能（飞书→opencode→飞书）不依赖 poller
3. clowder-local 也没有此功能
4. 防止循环转发比保留弱功能更重要

## 验证

- [x] 移除后飞书消息不再重复
- [x] 核心双向通信不受影响
- [x] commit: 45caba7
