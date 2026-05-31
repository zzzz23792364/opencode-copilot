import type { Database } from 'bun:sqlite'
import { getSessionStmt } from '../utils/db.js'
import { createLogger } from '../utils/logger.js'
import type { SessionManager } from '../bridge/session-manager.js'

const log = createLogger('commands')

export type CommandResult = { text: string } | null  // null means "not a command"

export interface CommandHandler {
  handle(text: string, chatId: string, sessionManager: SessionManager, db: Database): Promise<CommandResult>
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
    sessionManager: SessionManager,
    db: Database,
  ): Promise<CommandResult> {
    const trimmed = text.trim()

    // /new — create new session
    if (trimmed === '/new' || trimmed.startsWith('/new ')) {
      const stmt = getStmt(db)
      const existing = sessionManager.getSession(chatId)
      if (existing) {
        stmt.remove.run(chatId)
      }
      const { sessionId } = await sessionManager.getOrCreate(chatId)
      log.info({ chatId, sessionId }, 'Created new session')
      return { text: `✅ 新会话已创建\nSession: ${sessionId}` }
    }

    // /sessions — list sessions
    if (trimmed === '/sessions') {
      const stmt = getStmt(db)
      const sessions = stmt.list.all() as Array<{
        feishu_key: string
        session_id: string
        last_active: number
      }>
      if (sessions.length === 0) {
        return { text: '📭 暂无活动会话' }
      }
      const lines = sessions.map(s => {
        const time = new Date(s.last_active).toLocaleTimeString('zh-CN')
        return `- chat: ${s.feishu_key.slice(0, 16)}... → session: ${s.session_id} (${time})`
      })
      return { text: `📋 活动会话 (${sessions.length}):\n${lines.join('\n')}` }
    }

    // /connect <session_id> — bind current chat to a session
    if (trimmed.startsWith('/connect ')) {
      const sessionId = trimmed.slice('/connect '.length).trim()
      if (!sessionId.startsWith('ses_')) {
        return { text: '❌ 无效的 session ID 格式，应以 ses_ 开头' }
      }
      const stmt = getStmt(db)
      stmt.upsert.run(chatId, sessionId, 'default', null, Date.now(), Date.now())
      return { text: `✅ 已绑定到 Session: ${sessionId}` }
    }

    // /help
    if (trimmed === '/help') {
      return {
        text: `🐱 **opencode-copilot 命令帮助**

\`/new\` — 创建新会话
\`/sessions\` — 查看活跃会话
\`/connect <session_id>\` — 绑定当前对话到指定 session
\`/help\` — 显示此帮助

当前 chat: ${chatId}`,
      }
    }

    return null  // not a command
  }

  return { handle }
}
