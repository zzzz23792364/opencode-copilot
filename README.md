# @woxiaoniu/opencode-copilot: 飞书 ↔ opencode TUI 双向桥

在飞书聊天框里直接使用 opencode 终端 AI 助手，与 TUI 共享同一会话、同一历史。

```
你在飞书发消息 → opencode 处理 → 回复同时出现在 TUI 和飞书
你在 TUI 发消息 → 历史即时同步（双向可见）
```

不需要运行 `opencode serve`，不依赖插件 SDK，直接通过 `opencode run --format json` 与 TUI 共享 SQLite 数据库。

## Quick Start

```bash
# 推荐：全局安装
npm install -g @woxiaoniu/opencode-copilot

# 或者：git clone 部署
git clone https://github.com/zzzz23792364/opencode-copilot.git
cd opencode-copilot
npm install

# 2. 配置飞书应用凭据
cp .env.example .env
# 填入 FEISHU_APP_ID 和 FEISHU_APP_SECRET

# 3. 启动（生产模式，后台运行）
npm start

# 4. 在飞书给 bot 发消息即可
```

## Features

### 斜杠命令

| 命令 | 说明 |
|------|------|
| `/new` | 创建新会话 |
| `/sw` | 交互卡片选择项目 + 会话 |
| `/cf` | 交互式配置（模型 / CLI 参数） |
| `/list` | 查看活跃会话 |
| `/help` | 显示帮助 |

### 交互式配置（`/cf`）

`/cf` 命令发送一张配置卡片，支持：

- **模型选择** — `opencode models` 查询可用模型，按 provider 分组，卡片流式选择
- **`--dangerously-skip-permissions`** — 切换按钮，跳过权限确认
- **`--thinking`** — 切换按钮，启用推理过程显示

配置会持久化到该飞书会话，后续 `opencode run` 自动带上对应参数。

### 推理过程（reasoning）

当模型处于 `--thinking` 模式时，推理过程通过 `reasoning` NDJSON 事件捕获，以 `---` 分隔线附加在回复末尾，不影响主回复流。

## 为什么是 @woxiaoniu/opencode-copilot，而非其他方案？

| 维度 | @woxiaoniu/opencode-copilot | NeverMore93/opencode-feishu | @neomei/opencode-feishu |
|------|----------------------------|----------------------------|------------------------|
| **运行模式** | 独立桥接服务 | opencode 插件（进程内） | 独立 CLI + 插件 |
| **依赖 serve** | ❌ 不需要 | ✅ 需要 | ✅ 需要 |
| **会话共享 TUI** | ✅ 同一 SQLite DB | ❌ 不共享 | ❌ 不共享 |
| **连接方式** | `opencode run` 子进程 | `@opencode-ai/plugin` 钩子 | `@opencode-ai/sdk` SSE |
| **流式粒度** | 每次回复整块发送 | 轮询检测完成 | SSE 逐 token |
| **启动开销** | ~400ms/次 | 0（进程内） | ~0（SSE 长连） |

**核心差异化优势**：
- **不依赖 `opencode serve`** — 只要 CLI 装好就能跑，不受 serve 模式稳定性影响
- **与 TUI 共享 session** — 飞书发的消息在 TUI `ls` 可见，TUI 的回复飞书也能查
- **架构极简** — 单进程 + SQLite，0 额外依赖

## Architecture

```
┌──────────────────────┐
│  Feishu Open Platform │
└──┬───────────────┬────┘
  WS│               │ REST API
    ▼               ▲
┌─────────┐    ┌─────────────────┐
│ws-client│    │ FeishuAdapter    │  ← 复用 clowder-local
│         │    │ FeishuTokenMgr  │
└────┬────┘    └────────┬────────┘
     │                  │
┌────▼──────────────────▼────┐
│      message-handler       │
│  parse → session map →     │
│  opencode run → outbound   │
└────────┬───────────────────┘
         │
┌────────▼────────────┐
│  opencode run       │
│  --session <id>     │
│  --format json      │
└────────┬────────────┘
         │ NDJSON stream
┌────────▼────────────┐
│  TUI                │ ← 同一个 opencode session
│  (共享 SQLite DB)   │
└─────────────────────┘
```

**核心原理**：通过 `opencode run --session <id> --format json` 写入 opencode 的 SQLite 数据库，TUI 读取同一个 DB，实现双向共享。不需要 `opencode serve` 后台进程。

## Session Mapping

首次消息时自动发现或创建 session，映射关系存储在 `~/.opencode-copilot/sessions.db`（包名变更后兼容旧路径）：

```
feishu_key (chat_id) → session_id (ses_xxx)
```

重启不丢失，用 `/list` 管理绑定。

## Environment Variables

| 变量 | 必须 | 说明 |
|------|:---:|------|
| `FEISHU_APP_ID` | ✅ | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | ✅ | 飞书应用 App Secret |
| `LOG_LEVEL` | — | 日志级别（默认 `info`） |

## Prerequisites

- **Node.js** >= 18
- **opencode** CLI（须在 PATH 中，版本 >= 1.15.13）
- **飞书应用**（需开通 `im:message` 权限，事件订阅使用长连接模式）

## Production

| 命令 | 说明 |
|------|------|
| `npm start` | 后台启动（推荐生产用） |
| `npm run dev` | 前台运行 + watch 模式（仅开发调试） |
| `npm stop` | 停止后台进程 |
| `npm restart` | 重启 |

**生产必须用 `npm start`**，不要用 `npm run dev`（`tsx watch` 会因 src 文件写盘触发反复重启）。

## License

MIT
