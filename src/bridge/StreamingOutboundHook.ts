/**
 * Streaming Outbound Hook — adapted from clowder-local.
 * Manages placeholder → PATCH update → finalize lifecycle for streaming cards.
 */
import type { Logger } from '../feishu/types.js'
import type { IStreamableOutboundAdapter } from '../feishu/FeishuAdapter.js'
import { pickReceiptLine } from '../feishu/feishu-receipt-lines.js'

const DEFAULT_UPDATE_INTERVAL_MS = 2000
const DEFAULT_MIN_DELTA_CHARS = 50
const HEARTBEAT_INTERVAL_MS = 5000

interface StreamingSession {
  readonly externalChatId: string
  readonly connectorId: string
  platformMessageId: string
  lastUpdateAt: number
  lastContentLength: number
  catDisplayName: string
  /** True until the first text chunk is PATCHed — used for immediate-first-chunk optimization */
  firstChunk: boolean
  /** Current tool status text shown in card */
  toolStatus: string
  /** Heartbeat timer for idle indication */
  heartbeatTimer?: ReturnType<typeof setInterval>
}

export interface StreamingOutboundHookOptions {
  readonly adapters: Map<string, IStreamableOutboundAdapter>
  readonly log: Logger
  readonly catDisplayName?: string
  readonly updateIntervalMs?: number
  readonly minDeltaChars?: number
}

export interface SenderHint {
  id: string
  name?: string
}

export class StreamingOutboundHook {
  private readonly sessions = new Map<string, StreamingSession>()
  private readonly updateIntervalMs: number
  private readonly minDeltaChars: number

  constructor(private readonly opts: StreamingOutboundHookOptions) {
    this.updateIntervalMs = opts.updateIntervalMs ?? DEFAULT_UPDATE_INTERVAL_MS
    this.minDeltaChars = opts.minDeltaChars ?? DEFAULT_MIN_DELTA_CHARS
  }

  async onStreamStart(
    externalChatId: string,
    connectorId: string,
    senderHint?: SenderHint,
    catId?: string,
  ): Promise<void> {
    const adapter = this.opts.adapters.get(connectorId)
    if (!adapter?.sendPlaceholder) return

    try {
      const displayName = this.opts.catDisplayName || 'bot'
      const senderSuffix = connectorId === 'feishu' && senderHint?.name ? `→${senderHint.name}` : ''
      const prefix = `【${displayName}🐱${senderSuffix}】`
      const placeholderText = `${prefix}${pickReceiptLine(catId)}`
      const msgId = await adapter.sendPlaceholder(externalChatId, placeholderText)
      if (msgId) {
        const session: StreamingSession = {
          externalChatId,
          connectorId,
          platformMessageId: msgId,
          lastUpdateAt: Date.now(),
          lastContentLength: 0,
          catDisplayName: displayName,
          firstChunk: true,
          toolStatus: '',
        }
        // Start heartbeat: if idle for too long, show thinking indicator
        session.heartbeatTimer = setInterval(() => {
          this.heartbeat(session)
        }, HEARTBEAT_INTERVAL_MS)

        this.sessions.set(externalChatId, session)
        this.opts.log.info({ externalChatId, messageId: msgId }, '[StreamingOutbound] placeholder sent, heartbeat started')
      }
    } catch (err) {
      this.opts.log.warn({ err: String(err), connectorId }, '[StreamingOutbound] sendPlaceholder failed')
    }
  }

  /** Update card to show current tool execution status */
  async onToolUse(externalChatId: string, toolName: string, state: 'running' | 'done' | 'error'): Promise<void> {
    const session = this.sessions.get(externalChatId)
    if (!session) return

    const icons: Record<string, string> = { running: '🔧', done: '✅', error: '❌' }
    const icon = icons[state] || '🔧'
    const shortName = toolName.replace(/^Bash\(/, '').replace(/^Read\(/, '').replace(/^Write\(/, '').replace(/^Edit\(/, '').replace(/\)$/, '').slice(0, 20)

    session.toolStatus = state === 'done' ? '' : `${icon} ${shortName}`
    session.lastUpdateAt = Date.now() // reset throttle so this shows immediately

    const content = buildCardContent(session, '')
    const adapter = this.opts.adapters.get(session.connectorId)
    if (adapter?.editMessage && session.platformMessageId) {
      adapter.editMessage(session.externalChatId, session.platformMessageId, content)
        .then(() => this.opts.log.debug({ tool: shortName, state }, '[StreamingOutbound] tool status PATCH'))
        .catch((err) => this.opts.log.warn({ err: String(err) }, '[StreamingOutbound] tool PATCH failed'))
    }
  }

  async onStreamChunk(connectorId: string, externalChatId: string, accumulatedText: string): Promise<void> {
    const session = this.sessions.get(externalChatId)
    if (!session) return

    const now = Date.now()
    const elapsed = now - session.lastUpdateAt
    const delta = accumulatedText.length - session.lastContentLength

    // #1: First chunk fires immediately (bypass delta check)
    if (!session.firstChunk && elapsed < this.updateIntervalMs && delta < this.minDeltaChars) return

    session.firstChunk = false

    const adapter = this.opts.adapters.get(connectorId)
    if (!adapter?.editMessage || !session.platformMessageId) return

    const content = buildCardContent(session, `${accumulatedText} ▌`)
    adapter.editMessage(session.externalChatId, session.platformMessageId, content)
      .then(() => {
        this.opts.log.debug({ externalChatId, len: accumulatedText.length, elapsed, delta }, '[StreamingOutbound] PATCH ok')
      })
      .catch((err) => {
        this.opts.log.warn({ err: String(err) }, '[StreamingOutbound] editMessage chunk failed')
      })
    session.lastUpdateAt = now
    session.lastContentLength = accumulatedText.length
  }

  async onStreamEnd(connectorId: string, externalChatId: string, finalText: string): Promise<void> {
    const session = this.sessions.get(externalChatId)
    if (!session) return

    // Stop heartbeat
    if (session.heartbeatTimer) clearInterval(session.heartbeatTimer)
    this.sessions.delete(externalChatId)

    const adapter = this.opts.adapters.get(connectorId)
    if (!session.platformMessageId) return

    // #4: Final PATCH without ▌ cursor
    const content = buildCardContent(session, finalText)
    try {
      await adapter?.editMessage?.(session.externalChatId, session.platformMessageId, content)
    } catch (err) {
      this.opts.log.warn({ err: String(err) }, '[StreamingOutbound] onStreamEnd editMessage failed')
    }
  }

  async cleanupPlaceholders(connectorId: string, externalChatId: string): Promise<void> {
    const session = this.sessions.get(externalChatId)
    if (session?.heartbeatTimer) clearInterval(session.heartbeatTimer)
    this.sessions.delete(externalChatId)
  }

  /** #3: Heartbeat — if no text has arrived for a while, show thinking indicator */
  private heartbeat(session: StreamingSession): void {
    if (session.firstChunk) return // don't override the receipt-line placeholder before first text

    const adapter = this.opts.adapters.get(session.connectorId)
    if (!adapter?.editMessage || !session.platformMessageId) return

    const content = buildCardContent(session, '⏳ 思考中...')
    adapter.editMessage(session.externalChatId, session.platformMessageId, content)
      .catch(() => { /* silent */ })
    session.lastUpdateAt = Date.now()
  }
}

/** Build card markdown content from session state. */
function buildCardContent(session: StreamingSession, text: string): string {
  let content = ''
  if (session.toolStatus) {
    content += `${session.toolStatus}\n\n`
  }
  content += text
  return content
}
