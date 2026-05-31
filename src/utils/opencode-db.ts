import Database from 'better-sqlite3'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DB_PATH = join(homedir(), '.local', 'share', 'opencode', 'opencode.db')

interface OpenSession {
  id: string
  title: string | null
  directory: string | null
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