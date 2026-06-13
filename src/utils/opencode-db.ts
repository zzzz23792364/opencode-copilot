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