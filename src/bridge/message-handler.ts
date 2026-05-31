import { createLogger } from '../utils/logger.js'
import type { FeishuInboundMessage } from '../feishu/FeishuAdapter.js'
import type { SessionManager } from './session-manager.js'
import type { MessageDedup } from './message-dedup.js'
import type { OutboundHandler } from './outbound.js'
import { opencodeRun } from './opencode-run.js'
import type { MediaService } from './media-service.js'

const log = createLogger('message-handler')

export interface MessageHandler {
  handle(parsed: FeishuInboundMessage): Promise<void>
}

export function createMessageHandler(
  sessionManager: SessionManager,
  dedup: MessageDedup,
  outbound: OutboundHandler,
  media?: MediaService,
): MessageHandler {
  const queues = new Map<string, Promise<void>>()

  async function processEvent(parsed: FeishuInboundMessage): Promise<void> {
    const { chatId, messageId, text } = parsed

    if (!text) {
      log.info({ chatId, messageId }, 'Empty message, skipping')
      return
    }

    if (dedup.isDuplicate(messageId)) {
      log.info({ messageId }, 'Duplicate message, skipping')
      return
    }
    dedup.mark(messageId)

    log.info({ chatId, text: text.slice(0, 80) }, 'Processing message')

    // Download attachments if present
    let prompt = text
    if (media && parsed.attachments && parsed.attachments.length > 0) {
      const downloads = await media.downloadAttachments(parsed.messageId, parsed.attachments)
      if (downloads.length > 0) {
        const paths = downloads.map(d => d.filePath).join('\n')
        prompt = `${text}\n\n附件文件路径:\n${paths}`
        log.info({ count: downloads.length }, 'Attachments downloaded')
      }
    }

    const { sessionId, cwd } = await sessionManager.getOrCreate(chatId)

    log.info({ chatId, sessionId }, 'Running opencode')
    const result = await opencodeRun(prompt, sessionId, cwd || undefined)

    if (result.sessionId && result.sessionId !== sessionId) {
      log.info({ old: sessionId, new: result.sessionId }, 'Session ID changed')
    }

    log.info({ chatId, replyLen: result.text.length }, 'Got reply')
    await outbound.sendFormatted(chatId, result.text)
  }

  async function handle(parsed: FeishuInboundMessage): Promise<void> {
    const chatId = parsed.chatId

    const prev = queues.get(chatId) ?? Promise.resolve()
    const next = prev
      .then(() => processEvent(parsed))
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
