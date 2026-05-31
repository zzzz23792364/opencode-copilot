import { Database } from 'bun:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DB_PATH = join(homedir(), '.local', 'share', 'opencode', 'opencode.db')

interface OpenSession {
  id: string
  title: string | null
  directory: string | null
}

/** Open the shared opencode SQLite DB in read-only mode. */
function openReadonly(): Database {
  return new Database(DB_PATH, { readonly: true })
}

/** List all distinct project directories with session counts. */
export function listProjects(): Array<{ directory: string; count: number }> {
  const db = openReadonly()
  try {
    const rows = db.query('SELECT directory, COUNT(*) as count FROM session WHERE directory IS NOT NULL GROUP BY directory ORDER BY count DESC').all() as Array<{ directory: string; count: number }>
    return rows
  } finally {
    db.close()
  }
}

/** List sessions for a specific project directory. */
export function listSessions(directory: string, limit = 20): OpenSession[] {
  const db = openReadonly()
  try {
    const rows = db.query(
      'SELECT id, title, directory FROM session WHERE directory = ? ORDER BY updated DESC LIMIT ?'
    ).all(limit ? directory : undefined, limit || undefined)
    return (rows as OpenSession[])
  } finally {
    db.close()
  }
}

/** Get session by ID (across all projects). */
export function getSessionById(sessionId: string): OpenSession | null {
  const db = openReadonly()
  try {
    const row = db.query('SELECT id, title, directory FROM session WHERE id = ?').get(sessionId) as OpenSession | undefined
    return row ?? null
  } finally {
    db.close()
  }
}
