/**
 * Simple structured logger — console-based.
 * No external dependencies (no winston/pino).
 */

export interface Logger {
  info(obj: Record<string, unknown> | string, msg?: string): void
  warn(obj: Record<string, unknown> | string, msg?: string): void
  error(obj: Record<string, unknown> | string, msg?: string): void
  debug(obj: Record<string, unknown> | string, msg?: string): void
}

export function createLogger(namespace: string): Logger {
  const fmt = (level: string, obj: Record<string, unknown> | string, msg?: string) => {
    const ts = new Date().toISOString()
    if (typeof obj === 'string') {
      console.error(`[${ts}] [${level}] [${namespace}] ${obj}`)
    } else {
      const extra = msg ? ` ${msg}` : ''
      console.error(`[${ts}] [${level}] [${namespace}]${extra}`, JSON.stringify(obj))
    }
  }

  return {
    info: (o, m) => fmt('INFO', o, m),
    warn: (o, m) => fmt('WARN', o, m),
    error: (o, m) => fmt('ERROR', o, m),
    debug: (o, m) => fmt('DEBUG', o, m),
  }
}
