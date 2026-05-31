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

    // /list — alias for /sessions with numbered output
    if (trimmed === '/list' || trimmed === '/sessions') {
      const stmt = getStmt(db)
      const sessions = stmt.list.all() as Array<{
        feishu_key: string; session_id: string; last_active: number
      }>
      if (sessions.length === 0) return { text: '📭 暂无活动会话\n使用 /new 创建新会话' }
      const lines = sessions.map((s, i) => {
        const time = new Date(s.last_active).toLocaleTimeString('zh-CN')
        const shortId = s.session_id.slice(0, 12) + '...'
        const chat = s.feishu_key.slice(0, 12) + '...'
        return `[${i + 1}] ${shortId}  (${chat})  ${time}`
      })
      return {
        text: `📋 活动会话 (${sessions.length}):\n${lines.join('\n')}\n\n用 /use <编号> 绑定`,
      }
    }

    // /connect <session_id> — direct bind
    if (trimmed.startsWith('/connect ')) {
      const sessionId = trimmed.slice('/connect '.length).trim()
      if (!sessionId.startsWith('ses_')) return { text: '❌ 无效的 session ID' }
      const stmt = getStmt(db)
      stmt.upsert.run(chatId, sessionId, 'default', null, Date.now(), Date.now())
      return { text: `✅ 已绑定到 Session: ${sessionId}` }
    }

    // /use <N> | <session_id> | <prefix> — smart bind
    if (trimmed.startsWith('/use ')) {
      const query = trimmed.slice('/use '.length).trim()
      const stmt = getStmt(db)
      const sessions = stmt.list.all() as Array<{
        feishu_key: string; session_id: string; last_active: number
      }>

      // Try numeric index
      const index = parseInt(query, 10)
      if (index >= 1 && index <= sessions.length) {
        const sessionId = sessions[index - 1].session_id
        stmt.upsert.run(chatId, sessionId, 'default', null, Date.now(), Date.now())
        return { text: `✅ 已绑定到 #${index}: ${sessionId}` }
      }

      // Try exact ID match
      if (query.startsWith('ses_')) {
        stmt.upsert.run(chatId, query, 'default', null, Date.now(), Date.now())
        return { text: `✅ 已绑定到 Session: ${query}` }
      }

      // Try prefix match
      const matches = sessions.filter(s => s.session_id.startsWith(query))
      if (matches.length === 1) {
        stmt.upsert.run(chatId, matches[0].session_id, 'default', null, Date.now(), Date.now())
        return { text: `✅ 已绑定到 Session: ${matches[0].session_id}` }
      }
      if (matches.length > 1) {
        return { text: `❌ 多个匹配，请用完整 ID:\n${matches.map(s => `  ${s.session_id}`).join('\n')}` }
      }

      return { text: `❌ 未找到匹配: "${query}"\n用 /list 查看可用会话，或用 /connect ses_xxx 直接绑定` }
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
\`/list\` — 查看活跃会话（带编号）
\`/use <编号|ID>\` — 绑定会话（编号/ID/前缀）
\`/connect <id>\` — 直接绑定到指定 session
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
