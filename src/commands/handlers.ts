import type { Database } from 'bun:sqlite'
import { getSessionStmt } from '../utils/db.js'
import { createLogger } from '../utils/logger.js'
import type { SessionManager } from '../bridge/session-manager.js'
import type { FeishuAdapter } from '../feishu/FeishuAdapter.js'

const log = createLogger('commands')

export type CommandResult = { text: string } | null

export interface CommandHandler {
  handle(text: string, chatId: string, senderId: string, sessionManager: SessionManager, db: Database): Promise<CommandResult>
}

export function createCommandHandler(): CommandHandler {
  const stmtCache = new WeakMap<Database, ReturnType<typeof getSessionStmt>>()

  function getStmt(db: Database) {
    if (!stmtCache.has(db)) stmtCache.set(db, getSessionStmt(db))
    return stmtCache.get(db)!
  }

  async function handle(
    text: string,
    chatId: string,
    senderId: string,
    sessionManager: SessionManager,
    db: Database,
  ): Promise<CommandResult> {
    const trimmed = text.trim()

    // /new
    if (trimmed === '/new' || trimmed.startsWith('/new ')) {
      const stmt = getStmt(db)
      stmt.remove.run(chatId)
      const sessionId = await sessionManager.getOrCreate(chatId)
      log.info({ chatId, sessionId }, 'Created new session via /new')
      return { text: `✅ 新会话已创建\nSession: ${sessionId}` }
    }

    // /sessions
    if (trimmed === '/sessions') {
      const stmt = getStmt(db)
      const sessions = stmt.list.all() as Array<{
        feishu_key: string; session_id: string; last_active: number
      }>
      if (sessions.length === 0) return { text: '📭 暂无活动会话' }
      const lines = sessions.map(s =>
        `- ${s.feishu_key.slice(0, 16)}... → ${s.session_id} (${new Date(s.last_active).toLocaleTimeString('zh-CN')})`
      )
      return { text: `📋 活动会话 (${sessions.length}):\n${lines.join('\n')}` }
    }

    // /connect <session_id>
    if (trimmed.startsWith('/connect ')) {
      const sessionId = trimmed.slice('/connect '.length).trim()
      if (!sessionId.startsWith('ses_')) return { text: '❌ 无效的 session ID' }
      const stmt = getStmt(db)
      const now = Date.now()
      stmt.upsert.run(chatId, sessionId, 'default', null, now, now)
      return { text: `✅ 已绑定到 Session: ${sessionId}` }
    }

    // /unbind
    if (trimmed === '/unbind') {
      const stmt = getStmt(db)
      const existing = sessionManager.getSession(chatId)
      if (!existing) return { text: '❌ 当前对话没有绑定的会话' }
      stmt.remove.run(chatId)
      return { text: `✅ 已取消绑定\n原 Session: ${existing.session_id}` }
    }

    // /where — show current binding
    if (trimmed === '/where' || trimmed === '/status') {
      const existing = sessionManager.getSession(chatId)
      if (!existing) return { text: '❌ 当前对话没有绑定的会话\n\n用 /new 创建新会话 或 /connect <id> 绑定已有会话' }
      const time = new Date(existing.last_active).toLocaleString('zh-CN')
      return {
        text: `📍 当前绑定\nSession: ${existing.session_id}\n最近活跃: ${time}\nChat: ${chatId.slice(0, 16)}...`,
      }
    }

    // /commands
    if (trimmed === '/commands' || trimmed === '/help') {
      return {
        text: `🐱 **opencode-copilot**\n
\`/new\` — 创建新会话
\`/sessions\` — 查看活跃会话
\`/connect <id>\` — 绑定到指定 session
\`/unbind\` — 取消绑定当前对话
\`/where\` — 查看当前绑定信息
\`/status\` — 同 /where
\`/commands\` — 显示命令列表

Chat: ${chatId.slice(0, 16)}...`,
      }
    }

    return null
  }

  return { handle }
}
