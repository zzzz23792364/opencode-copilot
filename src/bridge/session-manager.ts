import type { Database } from 'better-sqlite3'
import { spawn } from 'node:child_process'
import { createLogger } from '../utils/logger.js'
import { getSessionStmt, type SessionRow } from '../utils/db.js'

const log = createLogger('session-manager')

export interface SessionManager {
  getOrCreate(feishuKey: string, cwd?: string): Promise<{ sessionId: string; cwd: string | null }>
  getSession(feishuKey: string): SessionRow | null
  touch(feishuKey: string): void
}

export function createSessionManager(db: Database): SessionManager {
  const stmt = getSessionStmt(db)

  function getSession(feishuKey: string): SessionRow | null {
    return stmt.get.get(feishuKey) ?? null
  }

  function touch(feishuKey: string): void {
    stmt.touch.run(Date.now(), feishuKey)
  }

  async function getOrCreate(feishuKey: string, cwd?: string): Promise<{ sessionId: string; cwd: string | null }> {
    const existing = getSession(feishuKey)
    if (existing && existing.session_id !== 'placeholder') {
      stmt.touch.run(Date.now(), feishuKey)
      const resolvedCwd = existing.opencode_cwd || cwd || null
      log.info({ feishuKey, sessionId: existing.session_id, cwd: resolvedCwd }, 'Reusing existing session')
      return { sessionId: existing.session_id, cwd: resolvedCwd }
    }

    // No existing mapping — discover from opengcode
    const spawnCwd = cwd || undefined
    const sessionId = await new Promise<string>((resolve, reject) => {
      const proc = spawn('opencode', ['session', 'list', '--format', 'json', '-n', '1'], { cwd: spawnCwd })
      let out = ''
      proc.stdout.on('data', (chunk: Buffer) => { out += chunk.toString() })
      proc.on('close', () => {
        try {
          const sessions = JSON.parse(out) as Array<{ id: string }>
          if (sessions?.[0]?.id) {
            resolve(sessions[0].id)
            return
          }
        } catch { /* no sessions */ }
        reject(new Error('No opencode sessions found. Start the TUI first or send a message to create one.'))
      })
      proc.on('error', reject)
    })

    // Store with optional cwd
    const upsertCwd = cwd || null
    db.prepare(
      'INSERT OR REPLACE INTO feishu_sessions (feishu_key, session_id, agent, model, opencode_cwd, created_at, last_active) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(feishuKey, sessionId, 'default', null, upsertCwd, Date.now(), Date.now())

    log.info({ feishuKey, sessionId, cwd }, 'Session mapping created from discovery')
    return { sessionId, cwd: upsertCwd }
  }

  return { getOrCreate, getSession, touch }
}
