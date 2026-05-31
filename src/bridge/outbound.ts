import { createLogger } from '../utils/logger.js'
import type { FeishuAdapter } from '../feishu/FeishuAdapter.js'
import type { StreamingOutboundHook } from './StreamingOutboundHook.js'

const log = createLogger('outbound')

export interface OutboundHandler {
  sendText(chatId: string, text: string): Promise<void>
  sendStreaming(chatId: string, connectorId: string): Promise<{
    onChunk: (text: string) => Promise<void>
    onEnd: (finalText: string) => Promise<void>
    onError: (err: Error) => void
  }>
}

export function createOutboundHandler(
  adapter: FeishuAdapter,
  streamingHook?: StreamingOutboundHook,
): OutboundHandler {
  async function sendText(chatId: string, text: string): Promise<void> {
    log.info({ chatId, textLen: text.length }, 'Sending text reply')
    await adapter.sendReply(chatId, text)
    log.info({ chatId }, 'Text reply sent')
  }

  return {
    sendText,

    async sendStreaming(chatId: string, connectorId: string) {
      if (!streamingHook) {
        return {
          onChunk: async (t: string) => {},
          onEnd: async (finalText: string) => {
            await sendText(chatId, finalText)
          },
          onError: (err: Error) => {
            log.warn({ err: String(err), chatId }, 'Streaming not available, error ignored')
          },
        }
      }

      // Start placeholder card
      await streamingHook.onStreamStart(chatId, connectorId)

      let accumulated = ''
      return {
        onChunk: async (chunk: string) => {
          accumulated += chunk
          await streamingHook.onStreamChunk(connectorId, chatId, accumulated)
        },
        onEnd: async (finalText: string) => {
          await streamingHook.onStreamEnd(connectorId, chatId, finalText)
          await streamingHook.cleanupPlaceholders(connectorId, chatId, 'bot')
        },
        onError: (err: Error) => {
          log.warn({ err: String(err), chatId }, 'Streaming error')
        },
      }
    },
  }
}
