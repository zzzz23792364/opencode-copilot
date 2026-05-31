/**
 * Streaming Outbound Hook — adapted from clowder-local.
 * Manages placeholder → PATCH update → finalize lifecycle for streaming cards.
 */
import type { Logger } from '../feishu/types.js'
import type { IStreamableOutboundAdapter } from '../feishu/FeishuAdapter.js'
import { pickReceiptLine } from '../feishu/feishu-receipt-lines.js'

const DEFAULT_UPDATE_INTERVAL_MS = 2000
const DEFAULT_MIN_DELTA_CHARS = 50
const HEARTBEAT_MS = 5000

interface StreamingSession {
  readonly externalChatId: string
  readonly connectorId: string
  platformMessageId: string
  lastUpdateAt: number
  lastContentLength: number
  startTime: number
  catDisplayName: string
  firstChunk: boolean
  heartbeatTimer: ReturnType<typeof setInterval> | null
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
          startTime: Date.now(),
          catDisplayName: displayName,
          firstChunk: true,
          heartbeatTimer: null,
        }
        this.sessions.set(externalChatId, session)
      }
    } catch (err) {
      this.opts.log.warn({ err: String(err), connectorId }, '[StreamingOutbound] sendPlaceholder failed')
    }
  }

  /** Start heartbeat timer — called by outbound after placeholder is sent. */
  startHeartbeat(externalChatId: string): void {
    const session = this.sessions.get(externalChatId)
    if (!session || session.heartbeatTimer) return

    session.heartbeatTimer = setInterval(() => {
      this.doHeartbeat(session)
    }, HEARTBEAT_MS)
  }

  private async patchCard(
    session: StreamingSession,
    text: string,
    header?: { title: string; template: 'grey' | 'blue' | 'green' | 'red' },
    showAbort = false,
  ): Promise<void> {
    const adapter = this.opts.adapters.get(session.connectorId) as any
    if (!adapter?.client?.im?.message?.patch || !session.platformMessageId) return

    const elements: any[] = [{ tag: 'markdown', content: text }]
    if (showAbort) {
      elements.push({
        tag: 'action',
        actions: [{
          tag: 'button',
          text: { tag: 'plain_text', content: '⏹ 终止' },
          type: 'danger',
          value: { action: 'abort_stream', chat_id: session.externalChatId },
        }],
      })
    }
    const card: any = { elements }
    if (header) {
      card.config = { update_multi: true }
      card.header = { title: { tag: 'plain_text', content: header.title }, template: header.template }
    }
    await adapter.client.im.message.patch({
      path: { message_id: session.platformMessageId },
      data: { content: JSON.stringify(card) },
    })
  }

  private doHeartbeat(session: StreamingSession): void {
    const elapsed = Date.now() - session.lastUpdateAt
    if (elapsed < HEARTBEAT_MS - 500 || !session.firstChunk) return

    const elapsedSec = Math.floor((Date.now() - session.startTime) / 1000)
    const content = `【${session.catDisplayName}🐱】⏳ 思考中... (${elapsedSec}s)`
    this.patchCard(session, content, { title: `⏳ 思考中... (${elapsedSec}s)`, template: 'grey' }, true)
      .then(() => this.opts.log.debug({ chatId: session.externalChatId }, '[StreamingOutbound] heartbeat PATCH'))
      .catch(() => { /* silent */ })
  }

  async onStreamChunk(connectorId: string, externalChatId: string, accumulatedText: string): Promise<void> {
    const session = this.sessions.get(externalChatId)
    if (!session) return

    const now = Date.now()
    const elapsed = now - session.lastUpdateAt
    const delta = accumulatedText.length - session.lastContentLength

    if (!session.firstChunk && elapsed < this.updateIntervalMs && delta < this.minDeltaChars) return

    session.firstChunk = false

    this.patchCard(session, `${accumulatedText} ▌`, { title: '💭 回复中...', template: 'blue' }, true)
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
    if (session.heartbeatTimer) clearInterval(session.heartbeatTimer)
    this.sessions.delete(externalChatId)

    const duration = Math.floor((Date.now() - session.startTime) / 1000)
    try {
      await this.patchCard(session, finalText, { title: `✅ 完成 (${duration}s)`, template: 'green' })
    } catch (err) {
      this.opts.log.warn({ err: String(err) }, '[StreamingOutbound] onStreamEnd editMessage failed')
    }
  }

  async cleanupPlaceholders(_connectorId: string, externalChatId: string): Promise<void> {
    const session = this.sessions.get(externalChatId)
    if (session?.heartbeatTimer) clearInterval(session.heartbeatTimer)
    this.sessions.delete(externalChatId)
  }
}
