import Database from 'better-sqlite3'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DB_PATH = join(homedir(), '.local', 'share', 'opencode', 'opencode.db')

interface OpenSession {
  id: string
  title: string | null
  directory: string | null
}

export interface TodoItem {
  content: string
  status: string
  priority: string
  position: number
}

export interface SessionInfo {
  id: string
  title: string | null
  agent: string | null
  model: string | null
  cost: number
  tokensInput: number
  tokensOutput: number
  tokensReasoning: number
  tokensCacheRead: number
  tokensCacheWrite: number
}

function openReadonly() {
  return new Database(DB_PATH, { readonly: true })
}

export function listProjects(): Array<{ directory: string; count: number }> {
  const db = openReadonly()
  try {
    const rows = db.prepare(
      'SELECT directory, COUNT(*) as count FROM session WHERE directory IS NOT NULL GROUP BY directory ORDER BY count DESC'
    ).all() as Array<{ directory: string; count: number }>
    return rows
  } finally {
    db.close()
  }
}

export function listSessions(directory: string, limit = 20): OpenSession[] {
  const db = openReadonly()
  try {
    const rows = db.prepare(
      'SELECT id, title, directory FROM session WHERE directory = ? AND (title IS NULL OR title NOT LIKE \'%@explore%\' AND title NOT LIKE \'%@general%\' AND title NOT LIKE \'%@task%\') ORDER BY time_updated DESC LIMIT ?'
    ).all(directory, limit) as OpenSession[]
    return rows
  } finally {
    db.close()
  }
}

export function getSessionById(sessionId: string): OpenSession | null {
  const db = openReadonly()
  try {
    const row = db.prepare('SELECT id, title, directory FROM session WHERE id = ?').get(sessionId) as OpenSession | undefined
    return row ?? null
  } finally {
    db.close()
  }
}

export function listTodos(sessionId: string): TodoItem[] {
  const db = openReadonly()
  try {
    const rows = db.prepare(
      'SELECT content, status, priority, position FROM todo WHERE session_id = ? ORDER BY status, position'
    ).all(sessionId) as TodoItem[]
    return rows
  } finally {
    db.close()
  }
}

export function getSessionInfo(sessionId: string): SessionInfo | null {
  const db = openReadonly()
  try {
    const row = db.prepare(
      `SELECT id, title, agent, model, cost,
              tokens_input AS tokensInput,
              tokens_output AS tokensOutput,
              tokens_reasoning AS tokensReasoning,
              tokens_cache_read AS tokensCacheRead,
              tokens_cache_write AS tokensCacheWrite
       FROM session WHERE id = ?`
    ).get(sessionId) as SessionInfo | undefined
    return row ?? null
  } finally {
    db.close()
  }
}

export function getLastReplyText(sessionId: string): string | null {
  const db = openReadonly()
  try {
    const rows = db.prepare(
      'SELECT data FROM part WHERE session_id = ? ORDER BY time_created DESC LIMIT 20'
    ).all(sessionId) as Array<{ data: string }>
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.data)
        if (parsed.type === 'text' && parsed.text) {
          return parsed.text as string
        }
      } catch { /* skip unparseable */ }
    }
    return null
  } finally {
    db.close()
  }
}

export interface HistoryEntry {
  userQuery: string
  thinking: string | null
  reply: string
}

export function getSessionHistory(sessionId: string, count: number): HistoryEntry[] {
  const db = openReadonly()
  try {
    // 1) One query: all messages for this session
    const allMsgs = db.prepare(
      'SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created ASC'
    ).all(sessionId) as Array<{ id: string; data: string }>

    // Build indexes in JS (no more DB queries)
    const byId = new Map<string, { role: string; parentID: string | null }>()
    const userMsgIds: string[] = []
    for (const m of allMsgs) {
      let role = ''
      let parentID: string | null = null
      try {
        const d = JSON.parse(m.data)
        role = d.role || ''
        parentID = d.parentID || null
      } catch { /* skip */ }
      byId.set(m.id, { role, parentID })
      if (role === 'user') userMsgIds.push(m.id)
    }

    // Take the last N user messages
    const targetUserIds = userMsgIds.slice(-count)
    if (targetUserIds.length === 0) return []

    // Build parentID → children map
    const childrenOf = new Map<string, string[]>()
    for (const [id, info] of byId) {
      if (info.parentID && info.role === 'assistant') {
        const list = childrenOf.get(info.parentID) || []
        list.push(id)
        childrenOf.set(info.parentID, list)
      }
    }

    // Collect all assistant message IDs that we need parts for
    const assistIds = new Set<string>()
    for (const uid of targetUserIds) {
      const children = childrenOf.get(uid)
      if (children) for (const cid of children) assistIds.add(cid)
    }

    // 2) One query: all relevant parts
    const partsMap = new Map<string, Array<{ type: string; text: string }>>()
    if (assistIds.size > 0) {
      const placeholders = Array.from(assistIds).map(() => '?').join(',')
      const partRows = db.prepare(
        `SELECT message_id, data FROM part WHERE message_id IN (${placeholders}) ORDER BY message_id, time_created`
      ).all(...Array.from(assistIds)) as Array<{ message_id: string; data: string }>
      for (const pr of partRows) {
        try {
          const pd = JSON.parse(pr.data)
          if (pd.type === 'text' || pd.type === 'reasoning') {
            const list = partsMap.get(pr.message_id) || []
            list.push({ type: pd.type, text: pd.text || '' })
            partsMap.set(pr.message_id, list)
          }
        } catch { /* skip */ }
      }
    }

    // Build entries
    const entries: HistoryEntry[] = []
    for (const uid of targetUserIds) {
      let userQuery = ''
      try {
        const raw = allMsgs.find(m => m.id === uid)
        if (raw) {
          const d = JSON.parse(raw.data)
          if (d.summary?.diffs?.[0]?.newContent) userQuery = d.summary.diffs[0].newContent
          else if (d.content) userQuery = d.content
        }
      } catch { /* ignore */ }

      let thinking: string | null = null
      let reply = ''
      const children = childrenOf.get(uid) || []
      for (const cid of children) {
        const parts = partsMap.get(cid) || []
        for (const p of parts) {
          if (p.type === 'reasoning' && p.text) thinking = (thinking ? thinking + '\n\n' : '') + p.text
          if (p.type === 'text' && p.text) reply += (reply ? '\n\n' : '') + p.text
        }
      }

      entries.push({ userQuery, thinking, reply })
    }
    return entries
  } finally {
    db.close()
  }
}

export function isSessionBusy(sessionId: string): boolean {
  const db = openReadonly()
  try {
    const lastMsg = db.prepare(
      'SELECT data FROM message WHERE session_id = ? ORDER BY time_created DESC LIMIT 1'
    ).get(sessionId) as { data: string } | undefined
    if (!lastMsg) return false

    const d = JSON.parse(lastMsg.data)
    if (d.role === 'user') return true
    if (d.role === 'assistant' && !d.finish) return true
    return false
  } catch {
    return false
  } finally {
    db.close()
  }
}