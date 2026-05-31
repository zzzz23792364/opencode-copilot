import { createLogger } from '../utils/logger.js'
import type { FeishuAdapter } from '../feishu/FeishuAdapter.js'
import type { StreamingOutboundHook } from './StreamingOutboundHook.js'

const log = createLogger('outbound')

export interface OutboundHandler {
  sendText(chatId: string, text: string): Promise<void>
  sendFormatted(chatId: string, body: string, subtitle?: string): Promise<void>
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
    await sendFormatted(chatId, text)
  }

  async function sendFormatted(chatId: string, body: string, subtitle?: string): Promise<void> {
    const footer = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    log.info({ chatId, bodyLen: body.length }, 'Sending formatted reply')

    await adapter.sendFormattedReply(chatId, {
      header: 'opencode-copilot',
      subtitle: subtitle ?? '',
      body,
      footer,
    })
    log.info({ chatId }, 'Formatted reply sent')
  }

  return {
    sendText,
    sendFormatted,

    async sendStreaming(chatId: string, connectorId: string) {
      if (!streamingHook) {
        return {
          onChunk: async (t: string) => {},
          onEnd: async (finalText: string) => {
            await sendFormatted(chatId, finalText)
          },
          onError: (err: Error) => {
            log.warn({ err: String(err), chatId }, 'Streaming not available, error ignored')
          },
        }
      }

      await streamingHook.onStreamStart(chatId, connectorId)
      streamingHook.startHeartbeat(chatId)

      let accumulated = ''
      return {
        onChunk: async (chunk: string) => {
          accumulated += chunk
          await streamingHook.onStreamChunk(connectorId, chatId, accumulated)
        },
        onToolUse: async (toolName: string, state: 'running' | 'done' | 'error') => {
          await streamingHook.onToolUse(chatId, toolName, state)
        },
        onEnd: async (finalText: string) => {
          await streamingHook.onStreamEnd(connectorId, chatId, finalText)
        },
        onError: (err: Error) => {
          log.warn({ err: String(err), chatId }, 'Streaming error')
        },
      }
    },
  }
}
