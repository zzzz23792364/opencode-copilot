import { Database } from 'bun:sqlite'
import { createLogger } from './logger.js'

const log = createLogger('db')

export interface SessionRow {
  feishu_key: string
  session_id: string
  agent: string
  model: string | null
  opencode_cwd: string | null
  created_at: number
  last_active: number
}

export function createDatabase(dbPath: string): Database {
  const db = new Database(dbPath)

  db.exec('PRAGMA journal_mode=WAL')

  db.exec(`CREATE TABLE IF NOT EXISTS feishu_sessions (
    feishu_key   TEXT PRIMARY KEY,
    session_id   TEXT NOT NULL,
    agent        TEXT NOT NULL DEFAULT 'default',
    model        TEXT,
    opencode_cwd TEXT,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    last_active  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`)

  // Migration: add opencode_cwd column if missing
  try { db.exec('ALTER TABLE feishu_sessions ADD COLUMN opencode_cwd TEXT') } catch {}

  db.exec(`CREATE TABLE IF NOT EXISTS dedup (
    message_id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`)

  db.exec(`CREATE TABLE IF NOT EXISTS forwarded (
    message_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    forwarded_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`)

  const r = db.query('PRAGMA table_info(feishu_sessions)').all() as Array<{ name: string }>
  log.info({ tables: r.map(x => x.name).join(', ') }, 'DB initialized')

  return db
}

export function getSessionStmt(db: Database) {
  return {
    get: db.prepare<SessionRow, string>('SELECT * FROM feishu_sessions WHERE feishu_key = ?'),
    upsert: db.prepare(
      `INSERT OR REPLACE INTO feishu_sessions (feishu_key, session_id, agent, model, opencode_cwd, created_at, last_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ),
    touch: db.prepare(
      'UPDATE feishu_sessions SET last_active = ? WHERE feishu_key = ?'
    ),
    remove: db.prepare('DELETE FROM feishu_sessions WHERE feishu_key = ?'),
    list: db.prepare('SELECT * FROM feishu_sessions ORDER BY last_active DESC'),
  }
}

export function getDedupStmt(db: Database) {
  return {
    has: db.prepare<{ c: number }, string>('SELECT COUNT(*) as c FROM dedup WHERE message_id = ?'),
    insert: db.prepare('INSERT INTO dedup (message_id, created_at) VALUES (?, ?)'),
    cleanup: db.prepare('DELETE FROM dedup WHERE created_at < ?'),
  }
}

export function getForwardedStmt(db: Database) {
  return {
    has: db.prepare<{ c: number }, string>('SELECT COUNT(*) as c FROM forwarded WHERE message_id = ?'),
    insert: db.prepare('INSERT INTO forwarded (message_id, session_id, forwarded_at) VALUES (?, ?, ?)'),
  }
}
