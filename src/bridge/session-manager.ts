import type { Database } from 'bun:sqlite'
import { createLogger } from '../utils/logger.js'
import { getSessionStmt, type SessionRow } from '../utils/db.js'

const log = createLogger('session-manager')

export interface SessionManager {
  getOrCreate(feishuKey: string): Promise<string>
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

  async function getOrCreate(feishuKey: string): Promise<string> {
    const existing = getSession(feishuKey)
    if (existing) {
      stmt.touch.run(Date.now(), feishuKey)
      log.info({ feishuKey, sessionId: existing.session_id }, 'Reusing existing session')
      return existing.session_id
    }

    // No existing mapping — discover from opencode
    const { spawn } = await import('node:child_process')

    const sessionId = await new Promise<string>((resolve, reject) => {
      const proc = spawn('opencode', ['session', 'list', '--format', 'json', '-n', '1'])
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

    stmt.upsert.run(feishuKey, sessionId, 'default', null, Date.now(), Date.now())
    log.info({ feishuKey, sessionId }, 'Session mapping created from discovery')
    return sessionId
  }

  return { getOrCreate, getSession, touch }
}
