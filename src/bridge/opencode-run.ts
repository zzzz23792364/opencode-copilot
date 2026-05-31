import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createLogger } from '../utils/logger.js'

const log = createLogger('opencode-run')

export interface RunResult {
  text: string
  sessionId?: string
}

export interface OpenCodeRunOptions {
  prompt: string
  sessionId?: string
  cwd?: string
  onText?: (text: string) => void | Promise<void>
  onToolUse?: (toolName: string, state: 'running' | 'done' | 'error') => void
  /** Called after spawn — receives an abort() function to kill the process */
  onStart?: (abort: () => void) => void
}

export function opencodeRun(opts: OpenCodeRunOptions & { prompt: string; sessionId?: string }): Promise<RunResult>
export function opencodeRun(prompt: string, sessionId?: string, cwd?: string, onText?: (text: string) => void, onToolUse?: (toolName: string, state: 'running' | 'done' | 'error') => void): Promise<RunResult>
export function opencodeRun(
  promptOrOpts: string | OpenCodeRunOptions,
  sessionId?: string,
  cwd?: string,
  onText?: (text: string) => void,
  onToolUse?: (toolName: string, state: 'running' | 'done' | 'error') => void,
): Promise<RunResult> {
  const opts: OpenCodeRunOptions = typeof promptOrOpts === 'string'
    ? { prompt: promptOrOpts, sessionId, cwd, onText, onToolUse }
    : promptOrOpts

  return new Promise((resolve, reject) => {
    const args = ['run', '--format', 'json']
    if (opts.sessionId) args.push('--session', opts.sessionId)
    args.push(opts.prompt)

    log.info({ sessionId: opts.sessionId, prompt: opts.prompt.slice(0, 50) }, 'spawning opencode')

    const proc = spawn('opencode', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: opts.cwd || undefined,
    })

    let resolved = false
    let resolvedSessionId: string | undefined
    let fullText = ''

    // Expose abort capability
    if (opts.onStart) {
      opts.onStart(() => {
        if (resolved) return
        resolved = true
        clearTimeout(timeout)
        proc.kill('SIGTERM')
      })
    }

    // Timeout: kill after 10 minutes to prevent zombie processes
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        proc.kill('SIGKILL')
        log.warn({ sessionId: opts.sessionId }, 'opencode timed out after 10min, killed')
        resolve({ text: fullText || '(timeout)', sessionId: resolvedSessionId })
      }
    }, 600_000)

    const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity })
    let lastOnText = Promise.resolve()

    rl.on('line', (line) => {
      try {
        const ev = JSON.parse(line) as {
          type: string; sessionID?: string
          part?: { text?: string; name?: string; type?: string }
        }
        if (ev.type === 'step_start' && ev.sessionID && !resolvedSessionId) {
          resolvedSessionId = ev.sessionID
        }
        if (ev.type === 'text' && ev.part?.text) {
          fullText += ev.part.text
          if (opts.onText) {
            const chunk = ev.part.text
            lastOnText = lastOnText.then(() => {
              try { return opts.onText!(chunk) } catch { /* ignore */ }
            })
          }
        }
        if (ev.type === 'tool_use' && opts.onToolUse && ev.part) {
          const toolName = ev.part.name || ev.part.type || 'tool'
          opts.onToolUse(toolName, 'running')
        }
      } catch {
        // skip malformed lines
      }
    })

    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    proc.on('close', async (code) => {
      if (resolved) return
      resolved = true
      clearTimeout(timeout)
      await lastOnText.catch(() => {})
      if (code !== 0) log.warn({ exit: code, stderr: stderr.slice(0, 300) }, 'opencode non-zero exit')
      resolve({ text: fullText || '(no response)', sessionId: resolvedSessionId })
    })

    proc.on('error', (err) => {
      if (resolved) return
      resolved = true
      clearTimeout(timeout)
      reject(err)
    })
  })
}
