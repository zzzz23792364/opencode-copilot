import { createLogger } from '../utils/logger.js'
import type { FeishuMessageEvent } from '../feishu/types.js'
import type { SessionManager } from './session-manager.js'
import type { MessageDedup } from './message-dedup.js'
import type { OutboundHandler } from './outbound.js'
import { opencodeRun } from './opencode-run.js'

const log = createLogger('message-handler')

export interface MessageHandler {
  handle(event: FeishuMessageEvent): Promise<void>
}

export function createMessageHandler(
  sessionManager: SessionManager,
  dedup: MessageDedup,
  outbound: OutboundHandler,
): MessageHandler {
  const queues = new Map<string, Promise<void>>()

  function parseText(event: FeishuMessageEvent): string {
    const msgType = event.message.message_type
    if (msgType === 'text') {
      try {
        const content = JSON.parse(event.message.content)
        return content.text ?? ''
      } catch {
        return event.message.content
      }
    }
    if (msgType === 'post') {
      try {
        const post = JSON.parse(event.message.content)
        const texts: string[] = []
        const content = post?.content
        if (Array.isArray(content)) {
          for (const p of content) {
            if (Array.isArray(p)) {
              for (const e of p) {
                if (typeof e.text === 'string') texts.push(e.text)
              }
            }
          }
        }
        return texts.join('\n') || '[富文本]'
      } catch {
        return '[富文本]'
      }
    }
    if (msgType === 'image') return '[图片]'
    if (msgType === 'file') return '[文件]'
    if (msgType === 'audio') return '[语音]'
    return `[${msgType}]`
  }

  async function processEvent(event: FeishuMessageEvent): Promise<void> {
    const { chat_id, message_id } = event
    const text = parseText(event)

    if (!text) {
      log.info({ chat_id, message_id }, 'Empty message, skipping')
      return
    }

    if (dedup.isDuplicate(message_id)) {
      log.info({ message_id }, 'Duplicate message, skipping')
      return
    }
    dedup.mark(message_id)

    log.info({ chat_id, text: text.slice(0, 80) }, 'Processing message')

    const sessionId = await sessionManager.getOrCreate(chat_id)

    log.info({ chat_id, sessionId }, 'Running opencode')
    const result = await opencodeRun(text, sessionId)

    // Update session ID if it changed
    if (result.sessionId && result.sessionId !== sessionId) {
      log.info({ old: sessionId, new: result.sessionId }, 'Session ID changed')
    }

    log.info({ chat_id, replyLen: result.text.length }, 'Got reply')
    await outbound.sendText(chat_id, result.text)
  }

  async function handle(event: FeishuMessageEvent): Promise<void> {
    const chatId = event.chat_id

    // Serialize per-chat: append to existing chain or start new
    const prev = queues.get(chatId) ?? Promise.resolve()
    const next = prev
      .then(() => processEvent(event))
      .catch((err) => {
        log.error({ err: String(err), chatId }, 'Message processing failed')
      })
      .finally(() => {
        if (queues.get(chatId) === next) {
          queues.delete(chatId)
        }
      })

    queues.set(chatId, next)
    return next
  }

  return { handle }
}
