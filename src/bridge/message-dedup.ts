import type { Database } from 'bun:sqlite'
import { getDedupStmt } from '../utils/db.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('dedup')

export interface MessageDedup {
  isDuplicate(messageId: string): boolean
  mark(messageId: string): void
  cleanup(): void
}

export function createMessageDedup(db: Database, ttlMs = 60_000): MessageDedup {
  const stmt = getDedupStmt(db)

  function isDuplicate(messageId: string): boolean {
    const row = stmt.has.get(messageId) as { c: number } | undefined
    return (row?.c ?? 0) > 0
  }

  function mark(messageId: string): void {
    stmt.insert.run(messageId, Date.now())
  }

  function cleanup(): void {
    const cutoff = Date.now() - ttlMs
    stmt.cleanup.run(cutoff)
  }

  // Periodic cleanup every 30s
  setInterval(cleanup, 30_000).unref()

  return { isDuplicate, mark, cleanup }
}
