import { createLogger } from '../utils/logger.js'
import type { FeishuInboundMessage } from '../feishu/FeishuAdapter.js'
import type { SessionManager } from './session-manager.js'
import type { OutboundHandler } from './outbound.js'
import { opencodeRun } from './opencode-run.js'
import { registerRun, unregisterRun } from '../feishu/card-interaction.js'
import type { MediaService } from './media-service.js'

const log = createLogger('message-handler')

export interface MessageHandler {
  handle(parsed: FeishuInboundMessage): Promise<void>
}

export function createMessageHandler(
  sessionManager: SessionManager,
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

    const { sessionId, cwd, flags, model, cliArgs } = await sessionManager.getOrCreate(chatId)

    log.info({ chatId, sessionId }, 'Running opencode (streaming)')
    sessionManager.setBusy(chatId, true)

    try {
      const streaming = await outbound.sendStreaming(chatId, 'feishu')

      let aborted = false

      const result = await opencodeRun({
        prompt,
        sessionId,
        cwd: cwd || undefined,
        flags,
        model: model || undefined,
        cliArgs,
        onText: (chunk) => { streaming.onChunk(chunk).catch(() => {}) },
        onToolUse: (toolName) => { streaming.onToolUse(toolName, 'running').catch(() => {}) },
        onStart: (abort) => {
          registerRun(chatId, () => {
            aborted = true
            abort()
            streaming.cancel()
          })
        },
      })

      unregisterRun(chatId)

      if (aborted) return

      if (result.sessionId && result.sessionId !== sessionId) {
        log.info({ old: sessionId, new: result.sessionId }, 'Session ID changed')
      }

      log.info({ chatId, replyLen: result.text.length }, 'Got reply')
      await streaming.onEnd(result.text)
    } finally {
      sessionManager.setBusy(chatId, false)
    }
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
