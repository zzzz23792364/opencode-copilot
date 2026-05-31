import type { Database } from 'bun:sqlite'
import { spawn } from 'node:child_process'
import { getSessionStmt } from '../utils/db.js'
import { createLogger } from '../utils/logger.js'
import type { SessionManager } from '../bridge/session-manager.js'

const log = createLogger('commands')

export type CommandResult =
  | { kind: 'reply'; text: string }
  | { kind: 'thread'; sessionId: string; message: string }
  | null

export interface CommandHandler {
  handle(text: string, chatId: string, senderId: string, sessionManager: SessionManager, db: Database): Promise<CommandResult>
}

export function createCommandHandler(): CommandHandler {
  const stmtCache = new WeakMap<Database, ReturnType<typeof getSessionStmt>>()

  function getStmt(db: Database) {
    if (!stmtCache.has(db)) stmtCache.set(db, getSessionStmt(db))
    return stmtCache.get(db)!
  }

  function bindSession(db: Database, chatId: string, sessionId: string) {
    getStmt(db).upsert.run(chatId, sessionId, 'default', null, Date.now(), Date.now())
  }

  /** Query opencode for all sessions with titles. Returns { id, title }[]. */
  async function getOpendcodeSessions(): Promise<Array<{ id: string; title: string }>> {
    return new Promise((resolve) => {
      const proc = spawn('opencode', ['session', 'list', '--format', 'json'])
      let out = ''
      proc.stdout.on('data', (chunk: Buffer) => { out += chunk.toString() })
      proc.on('close', () => {
        try {
          const sessions = JSON.parse(out) as Array<{ id: string; title: string }>
          resolve(sessions)
        } catch {
          resolve([])
        }
      })
      proc.on('error', () => resolve([]))
    })
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
      getStmt(db).remove.run(chatId)
      const sessionId = await sessionManager.getOrCreate(chatId)
      log.info({ chatId, sessionId }, 'Created new session via /new')
      return { kind: 'reply', text: `✅ 新会话已创建\nSession: ${sessionId}` }
    }

    // /list /sessions — shows opencode session titles
    if (trimmed === '/list' || trimmed === '/sessions') {
      const stmt = getStmt(db)
      const localSessions = stmt.list.all() as Array<{
        feishu_key: string; session_id: string; last_active: number
      }>
      // Get opencode titles
      const opencodeSessions = await getOpendcodeSessions()
      const titleMap = new Map(opencodeSessions.map(s => [s.id, s.title]))

      if (localSessions.length === 0) {
        // Show all opencode sessions even if no binding exists
        if (opencodeSessions.length === 0) return { kind: 'reply', text: '📭 暂无活动会话\n使用 /new 创建新会话' }
        const lines = opencodeSessions.slice(0, 10).map((s, i) => {
          const shortId = s.id.slice(0, 12) + '...'
          return `[${i + 1}] ${s.title || shortId}`
        })
        return { kind: 'reply', text: `📋 可用会话 (${opencodeSessions.length}):\n${lines.join('\n')}\n\n用 /use <编号> 绑定` }
      }

      const lines = localSessions.map((s, i) => {
        const time = new Date(s.last_active).toLocaleTimeString('zh-CN')
        const shortId = s.session_id.slice(0, 12) + '...'
        const title = titleMap.get(s.session_id) || shortId
        return `[${i + 1}] ${title}  ${time}`
      })
      return {
        kind: 'reply',
        text: `📋 活动会话 (${localSessions.length}):\n${lines.join('\n')}\n\n用 /use <编号|标题> 绑定`,
      }
    }

    // /thread <id> <message> — bind + send in one shot
    const threadMatch = trimmed.match(/^\/thread\s+(\S+)\s+(.+)$/s)
    if (threadMatch) {
      const [, idPart, msg] = threadMatch
      const stmt = getStmt(db)
      const sessions = stmt.list.all() as Array<{ feishu_key: string; session_id: string }>

      const resolved = resolveSession(sessions, idPart)
      if (!resolved) {
        // Try opencode title search
        const external = await getOpendcodeSessions()
        const titleMatch = external.find(s => s.title.toLowerCase().includes(idPart.toLowerCase()))
        if (titleMatch) {
          bindSession(db, chatId, titleMatch.id)
          return { kind: 'thread', sessionId: titleMatch.id, message: msg }
        }
        return { kind: 'reply', text: `❌ 未找到匹配: "${idPart}"\n用 /list 查看可用会话` }
      }

      bindSession(db, chatId, resolved)
      return { kind: 'thread', sessionId: resolved, message: msg }
    }

    // /connect <session_id>
    if (trimmed.startsWith('/connect ')) {
      const sessionId = trimmed.slice('/connect '.length).trim()
      if (!sessionId.startsWith('ses_')) return { kind: 'reply', text: '❌ 无效的 session ID' }
      bindSession(db, chatId, sessionId)
      return { kind: 'reply', text: `✅ 已绑定到 Session: ${sessionId}` }
    }

    // /use <N> | <session_id> | <prefix> | <title substring>
    if (trimmed.startsWith('/use ')) {
      const query = trimmed.slice('/use '.length).trim()
      const stmt = getStmt(db)
      const sessions = stmt.list.all() as Array<{ feishu_key: string; session_id: string }>

      // Try numeric index
      const index = parseInt(query, 10)
      if (index >= 1 && index <= sessions.length) {
        const sessionId = sessions[index - 1].session_id
        bindSession(db, chatId, sessionId)
        return { kind: 'reply', text: `✅ 已绑定到 #${index}: ${sessionId}` }
      }

      // Try exact ID match
      if (query.startsWith('ses_')) {
        bindSession(db, chatId, query)
        return { kind: 'reply', text: `✅ 已绑定到 Session: ${query}` }
      }

      // Try prefix match on session_id
      const byPrefix = sessions.filter(s => s.session_id.startsWith(query))
      if (byPrefix.length === 1) {
        bindSession(db, chatId, byPrefix[0].session_id)
        return { kind: 'reply', text: `✅ 已绑定到 Session: ${byPrefix[0].session_id}` }
      }
      if (byPrefix.length > 1) {
        return { kind: 'reply', text: `❌ 多个匹配:\n${byPrefix.map(s => '  ' + s.session_id).join('\n')}` }
      }

      // Try title match by querying opencode
      const external = await getOpendcodeSessions()
      const titleMatch = external.find(s => s.title.toLowerCase().includes(query.toLowerCase()))
      if (titleMatch) {
        bindSession(db, chatId, titleMatch.id)
        return { kind: 'reply', text: `✅ 已绑定到 "${titleMatch.title}": ${titleMatch.id}` }
      }

      return { kind: 'reply', text: `❌ 未找到匹配: "${query}"\n用 /list 查看可用会话，或用标题匹配` }
    }

    // /unbind
    if (trimmed === '/unbind') {
      const existing = sessionManager.getSession(chatId)
      if (!existing) return { kind: 'reply', text: '❌ 当前对话没有绑定的会话' }
      getStmt(db).remove.run(chatId)
      return { kind: 'reply', text: `✅ 已取消绑定\n原 Session: ${existing.session_id}` }
    }

    // /where /status
    if (trimmed === '/where' || trimmed === '/status') {
      const existing = sessionManager.getSession(chatId)
      if (!existing) return { kind: 'reply', text: '❌ 当前对话没有绑定的会话\n\n用 /new 创建新会话 或 /use <id> 绑定已有会话' }
      const time = new Date(existing.last_active).toLocaleString('zh-CN')
      return {
        kind: 'reply',
        text: `📍 当前绑定\nSession: ${existing.session_id}\n最近活跃: ${time}\nChat: ${chatId.slice(0, 16)}...`,
      }
    }

    // /commands /help
    if (trimmed === '/commands' || trimmed === '/help') {
      return {
        kind: 'reply',
        text: `🐱 **opencode-copilot**\n
\`/new\` — 创建新会话
\`/list\` — 查看活跃会话（带编号）
\`/use <编号|ID|前缀|标题>\` — 绑定会话
\`/thread <id> <msg>\` — 绑定并直接发消息
\`/connect <id>\` — 直接绑定
\`/unbind\` — 取消绑定
\`/where\` / \`/status\` — 查看当前绑定
\`/commands\` / \`/help\` — 命令列表

Chat: ${chatId.slice(0, 16)}...`,
      }
    }

    return null
  }

  return { handle }
}

/** Resolve session from local list by numeric index, full ID, or prefix. */
function resolveSession(
  sessions: Array<{ feishu_key: string; session_id: string }>,
  query: string,
): string | null {
  const num = parseInt(query, 10)
  if (num >= 1 && num <= sessions.length) return sessions[num - 1].session_id
  if (query.startsWith('ses_') && sessions.some(s => s.session_id === query)) return query
  const prefix = sessions.filter(s => s.session_id.startsWith(query))
  if (prefix.length === 1) return prefix[0].session_id
  return null
}
