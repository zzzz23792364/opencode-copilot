/**
 * Streaming Outbound Hook — adapted from clowder-local.
 * Manages placeholder → PATCH update → finalize lifecycle for streaming cards.
 */
import type { Logger } from '../feishu/types.js'
import type { IStreamableOutboundAdapter } from '../feishu/FeishuAdapter.js'
import { pickReceiptLine } from '../feishu/feishu-receipt-lines.js'

const DEFAULT_UPDATE_INTERVAL_MS = 2000
const DEFAULT_MIN_DELTA_CHARS = 200

interface StreamingSession {
  readonly externalChatId: string
  platformMessageId: string
  lastUpdateAt: number
  lastContentLength: number
  catDisplayName: string
}

export interface StreamingOutboundHookOptions {
  readonly adapters: Map<string, IStreamableOutboundAdapter>
  readonly log: Logger
  readonly catDisplayName?: string
  readonly updateIntervalMs?: number
  readonly minDeltaChars?: number
}

/** Sender hint for group @mention prefix (AC-A8 in clowder-local) */
export interface SenderHint {
  id: string
  name?: string
}

export class StreamingOutboundHook {
  private readonly sessions = new Map<string, StreamingSession>()
  private readonly pendingCleanup = new Map<string, StreamingSession>()
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
      // F157: Cat-personality receipt line for Feishu
      // AC-A8: Group chat @mention — add sender name to prefix
      const senderSuffix = connectorId === 'feishu' && senderHint?.name ? `→${senderHint.name}` : ''
      const prefix = `【${displayName}🐱${senderSuffix}】`
      const placeholderText = `${prefix}${pickReceiptLine(catId)}`
      const msgId = await adapter.sendPlaceholder(externalChatId, placeholderText)
      if (msgId) {
        this.sessions.set(externalChatId, {
          externalChatId,
          platformMessageId: msgId,
          lastUpdateAt: Date.now(),
          lastContentLength: 0,
          catDisplayName: displayName,
        })
      }
    } catch (err) {
      this.opts.log.warn({ err: String(err), connectorId }, '[StreamingOutbound] sendPlaceholder failed')
    }
  }

  async onStreamChunk(connectorId: string, externalChatId: string, accumulatedText: string): Promise<void> {
    const session = this.sessions.get(externalChatId)
    if (!session) return

    const now = Date.now()
    const elapsed = now - session.lastUpdateAt
    const delta = accumulatedText.length - session.lastContentLength
    if (elapsed < this.updateIntervalMs || delta < this.minDeltaChars) return

    const adapter = this.opts.adapters.get(connectorId)
    if (!adapter?.editMessage || !session.platformMessageId) return

    try {
      await adapter.editMessage(session.externalChatId, session.platformMessageId, `${accumulatedText} ▌`)
      session.lastUpdateAt = now
      session.lastContentLength = accumulatedText.length
    } catch (err) {
      this.opts.log.warn({ err: String(err) }, '[StreamingOutbound] editMessage chunk failed')
    }
  }

  async onStreamEnd(connectorId: string, externalChatId: string, finalText: string): Promise<void> {
    const session = this.sessions.get(externalChatId)
    if (!session) return
    this.sessions.delete(externalChatId)

    const adapter = this.opts.adapters.get(connectorId)
    if (!session.platformMessageId) return

    // For simple bridge: always update the card with final text.
    // clowder-local sends a separate formatted reply and then cleans up the placeholder.
    // We use the streaming card AS the reply.
    try {
      await adapter?.editMessage?.(session.externalChatId, session.platformMessageId, finalText)
    } catch (err) {
      this.opts.log.warn({ err: String(err) }, '[StreamingOutbound] onStreamEnd editMessage failed')
    }
  }

  /**
   * F157: Prefer finalizeStreamCard (edit to "✅ 已回复") over deleteMessage
   * to avoid Feishu's "recalled a message" notification.
   */
  async cleanupPlaceholders(connectorId: string, externalChatId: string): Promise<void> {
    const session = this.pendingCleanup.get(externalChatId)
    if (!session) return
    this.pendingCleanup.delete(externalChatId)

    const adapter = this.opts.adapters.get(connectorId)
    if (!session.platformMessageId) return

    try {
      if (adapter?.finalizeStreamCard) {
        await adapter.finalizeStreamCard(session.externalChatId, session.platformMessageId, session.catDisplayName)
      } else if (adapter?.deleteMessage) {
        await adapter.deleteMessage(session.platformMessageId)
      }
    } catch (err) {
      this.opts.log.warn({ err: String(err) }, '[StreamingOutbound] cleanupPlaceholders failed')
    }
  }
}
