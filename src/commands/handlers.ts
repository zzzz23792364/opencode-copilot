import type { Database } from 'better-sqlite3'
import { spawn } from 'node:child_process'
import { getSessionStmt } from '../utils/db.js'
import { createLogger } from '../utils/logger.js'
import type { SessionManager } from '../bridge/session-manager.js'
import { listProjects, listSessions } from '../utils/opencode-db.js'

const log = createLogger('commands')

export type CommandResult =
  | { kind: 'reply'; text: string }
  | { kind: 'thread'; sessionId: string; message: string }
  | { kind: 'card'; card: object; context: CardContext }
  | null

export interface CardContext {
  actionType: string
  sessionList?: Array<{ id: string; title: string | null }>
  projectList?: Array<{ directory: string; count: number }>
  projectName?: string
  currentCwd?: string | null
}

export interface CommandHandler {
  handle(text: string, chatId: string, senderId: string, sessionManager: SessionManager, db: Database): Promise<CommandResult>
}

/** Resolve a session ID from a list by numeric index, exact ID, or prefix match. */
function resolveSession(
  sessions: Array<{ id: string; title?: string | null }>,
  query: string,
): string | null {
  const num = parseInt(query, 10)
  if (num >= 1 && num <= sessions.length) return sessions[num - 1].id
  if (query.startsWith('ses_') && sessions.some(s => s.id === query)) return query
  const prefix = sessions.filter(s => s.id.startsWith(query))
  if (prefix.length === 1) return prefix[0].id
  return null
}

export function createCommandHandler(): CommandHandler {
  const stmtCache = new WeakMap<Database, ReturnType<typeof getSessionStmt>>()

  function getStmt(db: Database) {
    if (!stmtCache.has(db)) stmtCache.set(db, getSessionStmt(db))
    return stmtCache.get(db)!
  }

  function bindSession(db: Database, chatId: string, sessionId: string) {
    getStmt(db).upsert.run(chatId, sessionId, 'default', null, null, Date.now(), Date.now())
  }

  /** Get the opengcode project directory for the current chat. */
  function getCwd(db: Database, chatId: string): string | null {
    const row = getStmt(db).get.get(chatId) as { opencode_cwd: string | null } | null
    return row?.opencode_cwd ?? null
  }

  function setCwd(db: Database, chatId: string, cwd: string) {
    // Ensure a row exists (upsert with the cwd)
    getStmt(db).upsert.run(chatId, 'placeholder', 'default', null, cwd, Date.now(), Date.now())
    // Update just the cwd
    const stmt = db.prepare('UPDATE feishu_sessions SET opencode_cwd = ?, last_active = ? WHERE feishu_key = ?')
    stmt.run(cwd, Date.now(), chatId)
  }

  /** Get sessions for the selected (or default) project. */
  function getSessionsForCurrent(db: Database, chatId: string, defaultCwd: string) {
    const cwd = getCwd(db, chatId) || defaultCwd
    return { cwd, sessions: listSessions(cwd) }
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
      const oldCwd = getCwd(db, chatId)
      getStmt(db).remove.run(chatId)
      const { sessionId } = await sessionManager.getOrCreate(chatId, oldCwd || undefined)
      log.info({ chatId, sessionId, cwd: oldCwd }, 'Created new session via /new')
      const cwdNote = oldCwd ? `\n项目: ${oldCwd.split('/').pop()}` : ''
      return { kind: 'reply', text: `✅ 新会话已创建\nSession: ${sessionId}${cwdNote}` }
    }

    // /projects — list all project directories (interactive card)
    if (trimmed === '/projects') {
      const projects = listProjects()
      if (projects.length === 0) return { kind: 'reply', text: '📭 暂无 opencode 项目' }
      const currentCwd = getCwd(db, chatId)
      return {
        kind: 'card',
        card: null as any,
        context: { actionType: 'list_projects', projectList: projects, currentCwd },
      }
    }

    // /sw — switch session: project picker → session picker (two-step card flow)
    if (trimmed === '/sw') {
      const projects = listProjects()
      if (projects.length === 0) return { kind: 'reply', text: '📭 暂无 opencode 项目' }
      const currentCwd = getCwd(db, chatId)
      return {
        kind: 'card',
        card: null as any,
        context: { actionType: 'sw_projects', projectList: projects, currentCwd },
      }
    }

    // /project <N> — select project directory
    if (trimmed.startsWith('/project ')) {
      const query = trimmed.slice('/project '.length).trim()
      const projects = listProjects()
      const num = parseInt(query, 10)
      if (num >= 1 && num <= projects.length) {
        setCwd(db, chatId, projects[num - 1].directory)
        const dirName = projects[num - 1].directory.split('/').pop()
        return { kind: 'reply', text: `✅ 已选择项目: ${dirName}\n\n用 /list 查看会话` }
      }
      return { kind: 'reply', text: `❌ 无效的项目编号，用 /projects 查看可用项目` }
    }

    // /list [-all] — list sessions (default: selected project; -all: all projects)
    if (trimmed === '/list' || trimmed === '/sessions' || trimmed === '/list -all' || trimmed === '/list --all') {
      const allMode = trimmed.includes('-all')
      const defaultCwd = process.cwd()
      const bound = sessionManager.getSession(chatId)

      if (allMode) {
        const projects = listProjects()
        if (projects.length === 0) return { kind: 'reply', text: '📭 暂无会话' }
        const lines: string[] = []
        let idx = 0
        for (const p of projects) {
          const dirName = p.directory.split('/').pop() || p.directory
          lines.push(`📁 ${dirName}`)
          const sessions = listSessions(p.directory, 5)
          for (const s of sessions) {
            idx++
            const mark = bound?.session_id === s.id ? ' ✓' : ''
            lines.push(`  [${idx}] ${s.title || s.id.slice(0, 12) + '...'}${mark}`)
          }
        }
        return { kind: 'reply', text: `📋 全部会话 (✓ = 当前):\n${lines.join('\n')}\n\n用 /project <编号> 选择项目` }
      }

      // Default: selected project — return interactive card
      const currentCwd = getCwd(db, chatId) || defaultCwd
      const sessions = listSessions(currentCwd)
      const dirName = currentCwd.split('/').pop() || currentCwd
      if (sessions.length === 0) {
        return { kind: 'reply', text: `📭 ${dirName} 暂无会话\n用 /projects 查看其他项目` }
      }
      return {
        kind: 'card',
        card: null as any, // card built in index.ts
        context: { actionType: 'list_sessions', sessionList: sessions, projectName: dirName, currentCwd },
      }
    }

    // /thread <id> <message>
    const threadMatch = trimmed.match(/^\/thread\s+(\S+)\s+(.+)$/s)
    if (threadMatch) {
      const [, idPart, msg] = threadMatch
      const defaultCwd = process.cwd()
      const currentCwd = getCwd(db, chatId) || defaultCwd
      const sessions = listSessions(currentCwd)

      const resolved = resolveSession(sessions, idPart)
      if (!resolved) {
        // Try title match
        const titleMatch = sessions.find(s => (s.title || '').toLowerCase().includes(idPart.toLowerCase()))
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

    // /use <N> | <session_id> | <prefix> | <title>
    if (trimmed.startsWith('/use ')) {
      const query = trimmed.slice('/use '.length).trim()
      const defaultCwd = process.cwd()
      const currentCwd = getCwd(db, chatId) || defaultCwd
      const sessions = listSessions(currentCwd)

      const resolved = resolveSession(sessions, query)
      if (resolved) {
        bindSession(db, chatId, resolved)
        return { kind: 'reply', text: `✅ 已绑定到 Session: ${resolved}` }
      }

      // Try title match
      const titleMatch = sessions.find(s => (s.title || '').toLowerCase().includes(query.toLowerCase()))
      if (titleMatch) {
        bindSession(db, chatId, titleMatch.id)
        return { kind: 'reply', text: `✅ 已绑定到 "${titleMatch.title}": ${titleMatch.id}` }
      }

      const dirName = currentCwd.split('/').pop()
      return { kind: 'reply', text: `❌ 未找到匹配: "${query}"\n项目: ${dirName}\n用 /list 查看可用会话` }
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
      const currentCwd = getCwd(db, chatId) || process.cwd()
      const dirName = currentCwd.split('/').pop()
      const bindText = existing
        ? `Session: ${existing.session_id}\n最近活跃: ${new Date(existing.last_active).toLocaleString('zh-CN')}`
        : '未绑定会话'
      return {
        kind: 'reply',
        text: `📍 当前状态\n项目: ${dirName}\n${bindText}\nChat: ${chatId.slice(0, 16)}...`,
      }
    }

    // /commands /help
    if (trimmed === '/commands' || trimmed === '/help') {
      return {
        kind: 'reply',
        text: `**opencode-copilot**\n
\`/new\` — 创建新会话
\`/sw\` — 快速切换项目和会话（两步卡片）
\`/projects\` — 查看所有项目目录
\`/project <编号>\` — 选择项目目录
\`/list\` — 查看当前项目的会话
\`/list -all\` — 查看所有项目的会话
\`/use <编号|ID|前缀|标题>\` — 绑定会话
\`/thread <id> <msg>\` — 绑定并直接发消息
\`/connect <id>\` — 直接绑定
\`/unbind\` — 取消绑定
\`/where\` / \`/status\` — 查看当前绑定信息
\`/commands\` / \`/help\` — 命令列表`,
      }
    }

    return null
  }

  return { handle }
}
