import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createLogger } from '../utils/logger.js'

const log = createLogger('opencode-run')

export interface RunResult {
  text: string
  sessionId?: string
}

export function opencodeRun(prompt: string, sessionId?: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const args = ['run', '--format', 'json']
    if (sessionId) args.push('--session', sessionId)
    args.push(prompt)

    log.info({ sessionId, prompt: prompt.slice(0, 50) }, 'spawning opencode')

    const proc = spawn('opencode', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let resolved = false
    let resolvedSessionId: string | undefined
    let text = ''

    const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity })
    rl.on('line', (line) => {
      try {
        const ev = JSON.parse(line) as { type: string; sessionID?: string; part?: { text?: string } }
        if (ev.type === 'step_start' && ev.sessionID && !resolvedSessionId) {
          resolvedSessionId = ev.sessionID
        }
        if (ev.type === 'text' && ev.part?.text) {
          text += ev.part.text
        }
      } catch {
        // skip malformed lines
      }
    })

    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    proc.on('close', (code) => {
      if (resolved) return
      resolved = true
      if (code !== 0) log.warn({ exit: code, stderr: stderr.slice(0, 300) }, 'opencode non-zero exit')
      resolve({ text: text || '(no response)', sessionId: resolvedSessionId })
    })

    proc.on('error', (err) => {
      if (resolved) return
      resolved = true
      reject(err)
    })
  })
}
