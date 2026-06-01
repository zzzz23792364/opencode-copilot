import 'dotenv/config'
import { spawn, execSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync, openSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PID_DIR = join(homedir(), '.opencode-copilot')
const PID_FILE = join(PID_DIR, 'bridge.pid')
const LOG_FILE = join(PID_DIR, 'bridge.log')

function ensureDir() {
  if (!existsSync(PID_DIR)) mkdirSync(PID_DIR, { recursive: true })
}

function isRunning(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

function sleep(ms: number) {
  const t = Date.now()
  while (Date.now() - t < ms) { /* busy-wait */ }
}

function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null
  try { return parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10) } catch { return null }
}

function findBridgeNodePids(): number[] {
  try {
    const out = execSync(
      "ps -eo pid,args --no-headers 2>/dev/null | grep 'node.*--require.*preflight.*src/index\\.ts' | grep -v grep",
      { encoding: 'utf-8', timeout: 3000 },
    ).trim()
    if (!out) return []
    return out.split('\n')
      .map(l => parseInt(l.trim().split(/\s+/)[0], 10))
      .filter(p => p && p !== process.pid)
  } catch { return [] }
}

function findExistingBridge(): number | null {
  const pids = findBridgeNodePids()
  if (pids.length > 0) return pids[0]
  const f = readPid()
  return f && isRunning(f) ? f : null
}

function verifySingleInstance() {
  // Poll up to 5s for the actual bridge (tsx preflight) to start
  for (let i = 0; i < 10; i++) {
    const pids = findBridgeNodePids()
    if (pids.length === 1) { console.log(`Verified: single bridge instance (PID ${pids[0]})`); return }
    if (pids.length > 1) { console.error(`ERROR: ${pids.length} instances: ${pids.join(', ')}`); process.exit(1) }
    sleep(500)
  }
  console.error('ERROR: Bridge not running after start'); process.exit(1)
}

function start() {
  const existing = findExistingBridge()
  if (existing) { console.error(`Bridge already running (PID ${existing})`); process.exit(1) }
  ensureDir()
  const appId = process.env.FEISHU_APP_ID
  const appSecret = process.env.FEISHU_APP_SECRET
  if (!appId || !appSecret) { console.error('FEISHU_APP_ID/SECRET required'); process.exit(1) }
  const out = openSync(LOG_FILE, 'a')
  const proc = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: process.cwd(), detached: true, stdio: ['ignore', out, out],
    env: { ...process.env, FEISHU_APP_ID: appId, FEISHU_APP_SECRET: appSecret },
  })
  proc.unref()
  writeFileSync(PID_FILE, String(proc.pid))
  console.log(`Bridge started (PID ${proc.pid}), log: ${LOG_FILE}`)
  verifySingleInstance()
}

function stop() {
  const pids = findBridgeNodePids()
  for (const p of pids) {
    if (isRunning(p)) {
      try { process.kill(p, 'SIGKILL'); console.log(`Killed bridge (PID ${p})`) } catch { /* gone */ }
    }
  }
  const stored = readPid()
  if (stored && !pids.includes(stored) && isRunning(stored)) {
    try { process.kill(stored, 'SIGKILL'); console.log(`Killed npm wrapper (PID ${stored})`) } catch { /* gone */ }
  }
  try { unlinkSync(PID_FILE) } catch { /* ok */ }
  if (pids.length === 0 && (!stored || !isRunning(stored))) console.log('Bridge was not running')
}

function status() {
  const pids = findBridgeNodePids()
  const stored = readPid()
  if (pids.length > 0) {
    console.log(`Bridge: RUNNING (PID ${pids[0]})`)
    if (pids.length > 1) console.log(`  ${pids.length - 1} orphan(s): ${pids.slice(1).join(', ')}`)
  } else if (stored) {
    console.log(`Bridge: STALE (PID ${stored})`)
  } else {
    console.log('Bridge: NOT RUNNING')
  }
  console.log(`Log: ${LOG_FILE}`)
}

const cmd = process.argv[2]
switch (cmd) {
  case 'start': start(); break
  case 'stop': stop(); break
  case 'status': status(); break
  case 'restart': { stop(); start(); break }
  default: console.log('Usage: tsx scripts/manage.ts <start|stop|status|restart>')
}
