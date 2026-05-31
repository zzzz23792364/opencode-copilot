---
topics: [guide, dev, setup]
doc_kind: note
created: 2026-05-31
---

# 开发环境搭建

## 前置条件

- **Bun** >= 1.1.0 — `curl -fsSL https://bun.sh/install | bash`
- **opencode CLI** — 已安装 (`which opencode`)
- **飞书应用** — 在 [飞书开放平台](https://open.feishu.cn) 创建自建应用

## 飞书应用配置

1. 在开发者后台创建应用，记录 `App ID` 和 `App Secret`
2. 开通权限：`im:message`（收发消息）
3. 事件订阅：
   - 订阅方式：**长连接（WebSocket）**
   - 添加事件：**`im.message.receive_v1`**
4. 可选：添加 `card.action.trigger` 事件（卡片按钮回传）

## 本地安装

```bash
git clone https://github.com/zzzz23792364/opencode-copilot.git
cd opencode-copilot
npm install
cp .env.example .env
# 编辑 .env，填入你的 App ID 和 App Secret
```

## 运行

```bash
npm run dev        # 前台开发（watch 模式，文件变更自动重载）
npm start          # 后台启动
npm restart        # 重启
npm stop           # 停止
npm run status     # 查看状态
```

## 测试

```bash
# 1. 启动 bridge
npm start

# 2. 飞书 bot 发测试消息
#    → 应收到 👍 表情 + 格式化卡片回复

# 3. 测试命令
#    在飞书发 /help → 应返回命令列表
#    发 /list → 应返回 session 列表

# 4. 检查日志
cat ~/.opencode-copilot/bridge.log
```

## 日志

`~/.opencode-copilot/bridge.log` — 包含所有请求处理、错误信息、openocde 进程状态。调试时优先查看。

## 目录结构

```
~/.opencode-copilot/
├── bridge.log          # Bridge 日志
├── bridge.pid          # PID 文件
└── sessions.db         # session 映射数据库
```
