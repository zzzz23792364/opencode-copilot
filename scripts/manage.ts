/**
 * Bridge lifecycle manager — start / stop / status / restart.
 * Usage: tsx scripts/manage.ts <start|stop|status|restart>
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { openSync } from 'node:fs'

const PID_DIR = join(homedir(), '.opencode-copilot')
const PID_FILE = join(PID_DIR, 'bridge.pid')
const LOG_FILE = join(PID_DIR, 'bridge.log')

function ensureDir() {
  if (!existsSync(PID_DIR)) mkdirSync(PID_DIR, { recursive: true })
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10)
    return pid
  } catch {
    return null
  }
}

function start() {
  const existing = readPid()
  if (existing && isRunning(existing)) {
    console.log(`Bridge is already running (PID ${existing})`)
    return
  }

  ensureDir()
  const appId = process.env.FEISHU_APP_ID || ''
  const appSecret = process.env.FEISHU_APP_SECRET || ''

  if (!appId || !appSecret) {
    console.error('Error: FEISHU_APP_ID and FEISHU_APP_SECRET must be set')
    process.exit(1)
  }

  const out = openSync(LOG_FILE, 'a')
  const proc = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, FEISHU_APP_ID: appId, FEISHU_APP_SECRET: appSecret },
  })

  proc.unref()
  writeFileSync(PID_FILE, String(proc.pid))
  console.log(`Bridge started (PID ${proc.pid})`)
  console.log(`Log: ${LOG_FILE}`)
}

function stop() {
  const pid = readPid()
  if (!pid) {
    console.log('Bridge is not running (no PID file)')
    return
  }

  if (!isRunning(pid)) {
    console.log(`PID ${pid} is not running, cleaning up`)
    try { unlinkSync(PID_FILE) } catch {}
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
    console.log(`Sent SIGTERM to PID ${pid}`)
    try { unlinkSync(PID_FILE) } catch {}
  } catch {
    console.error(`Failed to stop PID ${pid}`)
  }
}

function status() {
  const pid = readPid()
  if (!pid) {
    console.log('Bridge: NOT RUNNING (no PID file)')
    return
  }

  if (isRunning(pid)) {
    console.log(`Bridge: RUNNING (PID ${pid})`)
    console.log(`Log: ${LOG_FILE}`)
  } else {
    console.log(`Bridge: STALE (PID ${pid} not found)`)
  }
}

const cmd = process.argv[2]
switch (cmd) {
  case 'start': start(); break
  case 'stop': stop(); break
  case 'status': status(); break
  case 'restart': stop(); setTimeout(start, 1000); break
  default:
    console.log('Usage: tsx scripts/manage.ts <start|stop|status|restart>')
}