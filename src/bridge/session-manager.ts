import type { Database } from 'better-sqlite3'
import { spawn } from 'node:child_process'
import { createLogger } from '../utils/logger.js'
import { getSessionStmt, type SessionRow } from '../utils/db.js'

const log = createLogger('session-manager')

export interface RunFlags {
  danger?: boolean
}

export interface SessionManager {
  getOrCreate(feishuKey: string, cwd?: string): Promise<{ sessionId: string; cwd: string | null; flags: RunFlags; model: string | null; cliArgs: string[] }>
  getSession(feishuKey: string): SessionRow | null
  touch(feishuKey: string): void
  setBusy(feishuKey: string, busy: boolean): void
  isBusy(feishuKey: string): boolean
}

function parseFlags(raw: string | null): RunFlags {
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

function parseCliArgs(raw: string | null): string[] {
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

export function createSessionManager(db: Database): SessionManager {
  const stmt = getSessionStmt(db)
  const busyChats = new Set<string>()

  function getSession(feishuKey: string): SessionRow | null {
    return stmt.get.get(feishuKey) ?? null
  }

  function touch(feishuKey: string): void {
    stmt.touch.run(Date.now(), feishuKey)
  }

  function setBusy(feishuKey: string, busy: boolean) {
    if (busy) busyChats.add(feishuKey)
    else busyChats.delete(feishuKey)
  }

  function isBusy(feishuKey: string): boolean {
    return busyChats.has(feishuKey)
  }

  async function getOrCreate(feishuKey: string, cwd?: string): Promise<{ sessionId: string; cwd: string | null; flags: RunFlags; model: string | null; cliArgs: string[] }> {
    const existing = getSession(feishuKey)
    if (existing && existing.session_id !== 'placeholder') {
      stmt.touch.run(Date.now(), feishuKey)
      const resolvedCwd = existing.opencode_cwd || cwd || null
      log.info({ feishuKey, sessionId: existing.session_id, cwd: resolvedCwd }, 'Reusing existing session')
      return { sessionId: existing.session_id, cwd: resolvedCwd, flags: parseFlags(existing.flags), model: existing.model, cliArgs: parseCliArgs(existing.cli_args) }
    }

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

    const upsertCwd = cwd || null
    db.prepare(
      'INSERT OR REPLACE INTO feishu_sessions (feishu_key, session_id, agent, model, opencode_cwd, flags, cli_args, created_at, last_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(feishuKey, sessionId, 'default', null, upsertCwd, null, null, Date.now(), Date.now())

    log.info({ feishuKey, sessionId, cwd }, 'Session mapping created from discovery')
    return { sessionId, cwd: upsertCwd, flags: {}, model: null, cliArgs: [] }
  }

  return { getOrCreate, getSession, touch, setBusy, isBusy }
}