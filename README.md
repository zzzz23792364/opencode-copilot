# opencode-copilot

飞书与 opencode TUI 共享同一个 AI 会话的双向桥。

```
你在飞书发消息 → opencode 处理 → 回复同时出现在 TUI 和飞书
你在 TUI 发消息 → 自动转发到飞书（通知你）
```

## Quick Start

```bash
# 1. 安装
npm install -g opencode-copilot

# 2. 配置（在运行目录创建 .env）
cat > .env << 'EOF'
FEISHU_APP_ID=cli_xxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxx
EOF

# 3. 启动
opencode-copilot start

# 4. 在飞书给 bot 发消息即可
```

## Slash Commands

在飞书对话中发送以下命令：

| 命令 | 说明 |
|------|------|
| `/new` | 创建新会话 |
| `/sw` | 快速切换项目和会话（两步卡片流） |
| `/projects` / `/project <编号>` | 查看/选择项目目录 |
| `/list` | 查看活跃会话（带编号和标题） |
| `/use <编号\|ID\|前缀\|标题>` | 绑定会话 |
| `/thread <编号\|ID> <消息>` | 绑定并直接发消息 |
| `/connect <session_id>` | 直接绑定指定 session |
| `/unbind` | 取消绑定当前对话 |
| `/where` / `/status` | 查看当前绑定信息 |
| `/commands` / `/help` | 显示命令列表 |

## Environment Variables

| 变量 | 必须 | 说明 |
|------|:---:|------|
| `FEISHU_APP_ID` | ✅ | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | ✅ | 飞书应用 App Secret |
| `FEISHU_BOT_OPEN_ID` | — | Bot 的 Open ID（群聊 @提及检测用） |
| `LOG_LEVEL` | — | 日志级别（默认 `info`） |

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

**核心原理**：直接用 `opencode run --session <id> --format json` 写入 opencode 的 SQLite 数据库，TUI 读取同一个 DB，实现双向共享。

## Session Mapping

首次消息时自动发现或创建 session，映射关系存储在 `~/.opencode-copilot/sessions.db`：

```
feishu_key (chat_id) → session_id (ses_xxx)
```

重启不丢失，用 `/list` `/use` 管理绑定。

## Prerequisites

- **Node.js** >= 18（通过 nvm 或系统包管理器）
- **opencode** CLI（共享 session）
- **飞书应用**（需开通 `im:message` 权限，事件订阅长连接模式）

## Development

```bash
git clone https://github.com/zzzz23792364/opencode-copilot.git
cd opencode-copilot
npm install
cp .env.example .env  # 填入你的 App ID/Secret
npm run dev            # 前台运行（watch 模式）
```

详细设计文档见 [docs/specs/tech-architecture.md](docs/specs/tech-architecture.md)，文档索引见 [docs/README.md](docs/README.md)。
