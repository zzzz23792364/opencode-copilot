---
topics: [bug, opencode]
doc_kind: fix-notes
created: 2026-05-31
---

# Bug: `--plan` 标志在 opencode v1.15.13 中不存在

## 环境

- **平台**: Bun / Linux
- **版本**: opencode v1.15.13, opencode-copilot 4600332 之前
- **复现率**: 必现

## 问题现象

用户执行 `/plan` 命令后发送消息，opencode 返回 `(no response)`，流式卡片显示 0s 完成。

## 根因分析

`opencode-run.ts` 中根据 `mode === 'plan'` 判断向 opencode 传递了 `--plan` 标志：

```typescript
if ((mode || 'build') === 'plan') args.push('--plan')
```

但 `opencode run` 的 CLI 帮助中**没有 `--plan` 选项**。与 `-y` 问题类似，opencode v1.15.13 不支持 mode 切换。plan/build 模式切换需要通过 agent 配置而非 CLI 参数。

## 修复方案

1. 移除 `--plan` 标志传递逻辑
2. 保留 `feishu_sessions.mode` 列供后续版本使用
3. 标记 `/plan` `/build` 命令为"待 opencode 支持"

后续完整回退（commit: 4600332）：移除 `/plan` `/build` 命令、模式列和相关逻辑，避免引入不可用功能。

## 验证

- [x] opencode v1.15.13 help 确认无 `--plan` 选项
- [x] 回退后 `/plan` `/build` 命令不可用（不报错）
- [x] commit: 4600332
