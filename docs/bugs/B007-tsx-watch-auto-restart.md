---
feature_ids: [F004]
topics: [bridge, tsx, watch, restart, lifecycle]
doc_kind: fix-notes
created: 2026-06-01
---

# Bug B007: `tsx watch` 导致 bridge 反复重启 — 只能使用 `npm start`

## 环境

- **平台**: Node.js 20.20.0 / WSL Linux
- **版本**: bridge 开发阶段
- **复现率**: 必现

## 问题现象

bridge 日志中出现大量 **Shutting down... → Starting opencode-copilot...** 循环，间隔仅数秒到数分钟：

```
[19:08:34] Starting opencode-copilot...
[19:08:50] Processing message /cf
[19:10:54] [StreamingOutbound] PATCH ok
[19:11:08] Starting opencode-copilot...   ← 又来一轮
```

每次重启使 Feishu WS 断开重连，重放历史事件，导致：
- 用户在同一时间段收到多条重复消息和卡片
- `/cf` 等交互卡片状态丢失（旧 bridge 实例没有新功能 handler）
- `Duplicate event, skipping` 日志大量出现
- 流式输出中途中断
- 开发日志和运维日志混在一起，难以排查问题

## 根因分析

`package.json` 中有两个启动命令：

| 命令 | 实现 | 行为 |
|------|------|------|
| `npm start` | `manage.ts start` → `spawn('npx', ['tsx', 'src/index.ts'], { detached: true }).unref()` | 独立进程，不文件监听，不自动重启 |
| `npm run dev` | `npx tsx watch src/index.ts` | 监听 `src/` 文件变更，变更时发 SIGTERM 杀死旧进程，立即拉起新进程 |

开发过程中频繁修改 `src/` 文件（即使只是新增日志、修复变量名），每次修改都触发了 `tsx watch` 重启 bridge：

1. 文件写入磁盘
2. `tsx watch` 的 fs.watch 检测到变更
3. 发 `SIGTERM` 给当前 bridge 进程
4. bridge 的 `shutdown()` 收到信号，`process.exit(0)`
5. `tsx watch` 检测到进程退出，立即拉起新进程
6. 新进程重新连接 Feishu WS
7. Feishu WS 重放上次断开后的未确认事件
8. 若有 inflight request，到第 3 步时被强行终止，产生不完整的回复

因为 `tsx watch` 在终端前台运行，用户的 VS Code 终端关闭后，bridge 也随之退出。若用户通过 `nohup` 或 `&` 后台化，则 `tsx watch` 变成孤儿进程 — 但只要 ̀ 还有文件变更，它就会继续重启 bridge。

## 修复方案

**强行约定：生产环境只能用 `npm start`。**

`npm start` 通过 `manage.ts` 实现：

```ts
// detached + unref = 完全独立进程，不受终端生命周期影响
const proc = spawn('npx', ['tsx', 'src/index.ts'], {
  detached: true,
  stdio: ['ignore', out, out],
})
proc.unref()
```

特性：
- 不监听文件，不会自动重启
- 终端关闭后继续运行
- 进程树完全独立（即使 parent shell 退出也不会收孤儿）
- 通过 `manage.ts stop` 或 `kill` 手动管理生命周期

同时增加双层防护：
- `manage.ts start()` 启动前检查 `findBridgeNodePids()` 防止多实例
- `index.ts` 启动时创建 `bridge.lock` 自检（写自己 PID，检查是否已有存活 bridge）

## 验证

1. ✅ `npm start` 后修改任意 `src/` 文件 → bridge 不受影响，继续正常运行
2. ✅ `npm run dev` 后修改 `src/` 文件 → bridge 立刻重启（日志可见 "Shutting down..."）
3. ✅ 生产环境验证：连续运行 6 小时无意外重启

## 教训总结

**`npm run dev` ≠ `npm start`。** `tsx watch` 是开发工具，用于热重载开发中的代码。它不适用于长时间运行的生产服务。bridge 是一个需要稳定长连接的服务，不应在运行中被意外终止和重建。

如开发中需要测试代码变更的影响，应该：
1. 手动 `npm stop && npm start`
2. 或使用 `manage.ts restart`
3. 永远不要在生产服务上开启文件监听模式
