/**
 * Bridge lifecycle manager — start / stop / status / restart.
 * Usage: tsx scripts/manage.ts <start|stop|status|restart>
 */
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

function findBridgeNodePid(): number | null {
  // Find the actual node process running the bridge, not the npm wrapper
  try {
    const out = execSync(
      "ps -eo pid,args --no-headers 2>/dev/null | grep 'node.*/tsx src/index.ts' | grep -v grep",
      { encoding: 'utf-8', timeout: 3000 },
    ).trim()
    if (out) {
      const pid = parseInt(out.split(/\s+/)[0], 10)
      if (pid && pid !== process.pid) return pid
    }
  } catch { /* non-fatal */ }
  return null
}

function findExistingBridge(): number | null {
  // Prefer the actual node process over npm wrapper
  const nodePid = findBridgeNodePid()
  if (nodePid) return nodePid

  const pidFromFile = readPid()
  if (pidFromFile && isRunning(pidFromFile)) return pidFromFile

  // Broader scan for any wrapper processes
  try {
    const out = execSync(
      "ps -eo pid,args --no-headers 2>/dev/null | grep 'npx.*tsx src/index' | grep -v grep",
      { encoding: 'utf-8', timeout: 3000 },
    ).trim()
    if (out) {
      for (const line of out.split('\n')) {
        const pid = parseInt(line.trim().split(/\s+/)[0], 10)
        if (pid && pid !== process.pid) return pid
      }
    }
  } catch { /* non-fatal */ }

  return null
}

function sleep(ms: number) {
  execSync(`sleep ${ms / 1000}`, { timeout: ms + 1000 })
}

function start() {
  const existingPid = findExistingBridge()
  if (existingPid) {
    console.error(`Bridge is already running (PID ${existingPid}). Use "restart" or "stop" first.`)
    process.exit(1)
  }

  ensureDir()
  const appId = process.env.FEISHU_APP_ID
  const appSecret = process.env.FEISHU_APP_SECRET
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
  const nodePid = findBridgeNodePid()

  const targetPid = pid || nodePid
  if (!targetPid) {
    console.log('Bridge is not running (no PID file and no process found)')
    return
  }

  if (!isRunning(targetPid)) {
    console.log(`PID ${targetPid} is not running, cleaning up`)
    try { unlinkSync(PID_FILE) } catch {}
    return
  }

  try {
    // Kill the actual Node process (the bridge itself)
    if (nodePid && isRunning(nodePid)) {
      process.kill(nodePid, 'SIGTERM')
      console.log(`Sent SIGTERM to bridge (PID ${nodePid})`)
    }

    // Also kill the npm wrapper if it's still alive and different
    if (pid && pid !== nodePid && isRunning(pid)) {
      process.kill(pid, 'SIGTERM')
      console.log(`Sent SIGTERM to npm wrapper (PID ${pid})`)
    }

    const target = nodePid || pid!
    let waited = 0
    while (waited < 5000) {
      if (!isRunning(target)) {
        console.log(`PID ${target} exited`)
        break
      }
      sleep(300)
      waited += 300
    }

    if (isRunning(target)) {
      console.log(`PID ${target} still alive after 5s, force killing`)
      try { process.kill(target, 'SIGKILL') } catch {}
    }

    try { unlinkSync(PID_FILE) } catch {}
  } catch {
    console.error(`Failed to stop PID ${targetPid}`)
  }
}

function status() {
  const nodePid = findBridgeNodePid()
  const pid = readPid()

  if (nodePid) {
    const storedInfo = pid && isRunning(pid) ? ` (stored: ${pid})` : ''
    console.log(`Bridge: RUNNING (PID ${nodePid}${storedInfo})`)
    console.log(`Log: ${LOG_FILE}`)
  } else if (pid) {
    console.log(`Bridge: STALE (PID ${pid} not found)`)
  } else {
    console.log('Bridge: NOT RUNNING')
  }
}

const cmd = process.argv[2]
switch (cmd) {
  case 'start': start(); break
  case 'stop': stop(); break
  case 'status': status(); break
  case 'restart': {
    stop()
    start()
    break
  }
  default:
    console.log('Usage: tsx scripts/manage.ts <start|stop|status|restart>')
}
