import type { Database } from 'bun:sqlite'
import { createLogger } from './utils/logger.js'
import type { FeishuAdapter } from './feishu/FeishuAdapter.js'
import { getSessionStmt, getForwardedStmt } from './utils/db.js'
import { spawn } from 'node:child_process'
import type { SessionRow } from './utils/db.js'

const log = createLogger('poller')

export interface PollerOpts {
  db: Database
  adapter: FeishuAdapter
  intervalMs?: number  // default 3s
}

export function startPoller(opts: PollerOpts): () => void {
  const { db, adapter } = opts
  const intervalMs = opts.intervalMs ?? 3000
  const stmt = getSessionStmt(db)
  const fwd = getForwardedStmt(db)

  let running = true
  let timer: Timer | null = null

  async function poll() {
    if (!running) return

    const sessions = stmt.list.all() as SessionRow[]
    for (const session of sessions) {
      try {
        const messages = await exportSession(session.session_id)
        if (!messages || messages.length === 0) continue

        // Check the last user message
        const lastUser = messages.slice().reverse().find(m => m.role === 'user')
        if (!lastUser) continue

        // Check if already forwarded
        if (fwd.has.get(lastUser.id as string)?.c) continue

        // Mark as forwarded
        fwd.insert.run(lastUser.id, session.session_id, Date.now())

        // Extract text from user message
        const text = extractUserText(lastUser)
        if (!text) continue

        log.info({ sessionId: session.session_id, text: text.slice(0, 80) }, 'Forwarding to Feishu')
        await adapter.sendReply(session.feishu_key, `📤 [TUI] ${text}`)
      } catch (err) {
        log.warn({ err: String(err), feishuKey: session.feishu_key }, 'Poller error')
      }
    }
  }

  timer = setInterval(poll, intervalMs)

  return () => {
    running = false
    if (timer) clearInterval(timer)
  }
}

function exportSession(sessionId: string): Promise<Array<{ id: string; role: string; content?: string; text?: string }> | null> {
  return new Promise((resolve) => {
    // Try opencode export
    const proc = spawn('opencode', ['export', sessionId, '--format', 'json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let out = ''
    proc.stdout.on('data', (chunk: Buffer) => { out += chunk.toString() })

    proc.on('close', () => {
      try {
        const data = JSON.parse(out)
        resolve(data.messages ?? data)
      } catch {
        resolve(null)
      }
    })

    proc.on('error', () => resolve(null))
  })
}

function extractUserText(msg: { role: string; content?: string; text?: string; parts?: Array<{ text?: string }> }): string {
  if (typeof msg.content === 'string') return msg.content
  if (typeof msg.text === 'string') return msg.text
  if (Array.isArray(msg.parts)) {
    return msg.parts.map(p => p.text ?? '').join('')
  }
  return ''
}
