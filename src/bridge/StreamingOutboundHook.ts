/**
 * Streaming Outbound Hook — adapted from clowder-local.
 * Manages placeholder → PATCH update → finalize lifecycle for streaming cards.
 */
import type { Logger } from '../feishu/types.js'
import type { IStreamableOutboundAdapter } from '../feishu/FeishuAdapter.js'
import { pickReceiptLine } from '../feishu/feishu-receipt-lines.js'

const DEFAULT_UPDATE_INTERVAL_MS = 2000
const DEFAULT_MIN_DELTA_CHARS = 50
const THINKING_TICK_SEC = 5

interface StreamingSession {
  readonly externalChatId: string
  readonly connectorId: string
  platformMessageId: string
  lastUpdateAt: number
  lastContentLength: number
  startTime: number
  catDisplayName: string
  firstChunk: boolean
  pendingPatch?: Promise<void>
  tickerId?: ReturnType<typeof setTimeout>
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

  private startThinkingTicker(session: StreamingSession): void {
    const tick = async (elapsed: number) => {
      if (!this.sessions.has(session.externalChatId)) return
      if (!session.firstChunk) return

      try {
        await this.patchCardOnly(session, `⏳ 思考中... (${elapsed}s)`, 'orange')
      } catch { /* non-fatal */ }

      session.tickerId = setTimeout(() => tick(elapsed + THINKING_TICK_SEC), THINKING_TICK_SEC * 1000)
    }
    session.tickerId = setTimeout(() => tick(THINKING_TICK_SEC), THINKING_TICK_SEC * 1000)
  }

  private clearTicker(session: StreamingSession): void {
    if (session.tickerId) {
      clearTimeout(session.tickerId)
      session.tickerId = undefined
    }
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
      const prefix = `【${displayName}${senderSuffix}】`
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
        }
        this.sessions.set(externalChatId, session)
        this.startThinkingTicker(session)
      }
    } catch (err) {
      this.opts.log.warn({ err: String(err), connectorId }, '[StreamingOutbound] sendPlaceholder failed')
    }
  }

  private async patchCardOnly(session: StreamingSession, headerTitle: string, template: 'blue' | 'green' | 'red' | 'orange' = 'blue'): Promise<void> {
    const adapter = this.opts.adapters.get(session.connectorId) as any
    if (!adapter?.client?.im?.message?.patch || !session.platformMessageId) return

    const card: any = {
      config: { update_multi: true },
      header: { title: { tag: 'plain_text' as const, content: headerTitle }, template },
      elements: [{ tag: 'markdown', content: '...' }],
    }
    await adapter.client.im.message.patch({
      path: { message_id: session.platformMessageId },
      data: { content: JSON.stringify(card) },
    })
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

  async onStreamChunk(connectorId: string, externalChatId: string, accumulatedText: string): Promise<void> {
    const session = this.sessions.get(externalChatId)
    if (!session) return

    const now = Date.now()
    const elapsed = now - session.lastUpdateAt
    const delta = accumulatedText.length - session.lastContentLength

    if (!session.firstChunk && elapsed < this.updateIntervalMs && delta < this.minDeltaChars) return

    session.firstChunk = false
    this.clearTicker(session)

    session.pendingPatch = this.patchCard(session, `${accumulatedText} ▌`, { title: '💭 回复中...', template: 'blue' }, true)
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
    this.sessions.delete(externalChatId)
    this.clearTicker(session)

    if (session.pendingPatch) {
      await session.pendingPatch.catch(() => {})
    }

    const duration = Math.floor((Date.now() - session.startTime) / 1000)
    try {
      await this.patchCard(session, finalText, { title: `✅ 完成 (${duration}s)`, template: 'green' })
    } catch (err) {
      this.opts.log.warn({ err: String(err) }, '[StreamingOutbound] onStreamEnd editMessage failed')
    }
  }

  async cleanupPlaceholders(_connectorId: string, externalChatId: string): Promise<void> {
    const session = this.sessions.get(externalChatId)
    if (session) this.clearTicker(session)
    this.sessions.delete(externalChatId)
  }
}