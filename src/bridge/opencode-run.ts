import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createLogger } from '../utils/logger.js'
import type { RunFlags } from './session-manager.js'

const log = createLogger('opencode-run')

export interface RunResult {
  text: string
  sessionId?: string
}

export interface OpenCodeRunOptions {
  prompt: string
  sessionId?: string
  cwd?: string
  flags?: RunFlags
  model?: string
  cliArgs?: string[]
  onText?: (text: string) => void | Promise<void>
  onToolUse?: (toolName: string, state: 'running' | 'done' | 'error') => void
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
    if (opts.model) args.push('-m', opts.model)
    if (opts.sessionId) args.push('--session', opts.sessionId)
    // New code path: cliArgs takes precedence over legacy flags.danger
    if (opts.cliArgs && opts.cliArgs.length > 0) {
      args.push(...opts.cliArgs)
    } else if (opts.flags?.danger) {
      args.push('--dangerously-skip-permissions')
    }
    // shell:true passes args through /bin/sh -c, so special chars like
    // () must be escaped. POSIX single-quote wrapping handles all chars.
    const quotedPrompt = "'" + opts.prompt.replace(/'/g, "'\\''") + "'"
    args.push(quotedPrompt)

    log.info({ sessionId: opts.sessionId, cwd: opts.cwd, args, prompt: opts.prompt.slice(0, 50) }, 'spawning opencode')

    const proc = spawn('opencode', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: opts.cwd || undefined,
      shell: true,
    })
    proc.stdin?.end()

    let resolved = false
    let resolvedSessionId: string | undefined
    let fullText = ''

    if (opts.onStart) {
      opts.onStart(() => {
        if (resolved) return
        resolved = true
        clearTimeout(timeout)
        proc.kill('SIGTERM')
      })
    }

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

    let rawStdout = ''
    proc.stdout.on('data', (chunk: Buffer) => { rawStdout += chunk.toString() })

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
        if (ev.type === 'reasoning' && ev.part?.text) {
          fullText += ev.part.text + '\n\n---\n\n'
          if (opts.onText) {
            const chunk = ev.part.text + '\n\n---\n\n'
            lastOnText = lastOnText.then(() => {
              try { return opts.onText!(chunk) } catch {}
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

      if (!fullText && rawStdout.trim()) {
        log.info({ sessionId: opts.sessionId, rawLen: rawStdout.length }, 'readline missed lines, parsing raw stdout')
        for (const line of rawStdout.split('\n')) {
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
            }
            if (ev.type === 'reasoning' && ev.part?.text) {
              fullText += ev.part.text + '\n\n---\n\n'
            }
          } catch { /* skip */ }
        }
      }

      if (code !== 0) {
        log.warn({ exit: code, stderr: stderr.slice(0, 300) }, 'opencode non-zero exit')
      } else if (stderr.trim()) {
        log.info({ sessionId: opts.sessionId, stderr: stderr.slice(0, 200) }, 'opencode stderr')
      }

      if (!fullText) {
        log.warn({ sessionId: opts.sessionId, exit: code, rawLen: rawStdout.length, stderr: stderr.slice(0, 500) }, 'opencode produced no text')
      }

      let fallbackText = '(no response)'
      if (!fullText && stderr.includes('permission requested')) {
        const m = stderr.match(/permission requested: (.*?);/)
        if (m) fallbackText = `(no response — ${m[1]})`
      }

      resolve({ text: fullText || fallbackText, sessionId: resolvedSessionId })
    })

    proc.on('error', (err) => {
      if (resolved) return
      resolved = true
      clearTimeout(timeout)
      reject(err)
    })
  })
}