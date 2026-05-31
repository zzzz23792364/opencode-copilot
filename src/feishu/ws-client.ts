import * as Lark from '@larksuiteoapi/node-sdk'
import { createLogger } from '../utils/logger.js'
import type { FeishuCardAction } from './FeishuAdapter.js'

const log = createLogger('feishu-ws')

export interface WSClientDeps {
  appId: string
  appSecret: string
  /** Raw WS event for im.message.receive_v1 — wrapped as { header, event } envelope */
  onMessage: (data: Record<string, unknown>) => Promise<void>
  onCardAction?: (action: FeishuCardAction) => Promise<void>
}

export function createWSClient(deps: WSClientDeps) {
  const { appId, appSecret, onMessage, onCardAction } = deps

  const eventDispatcher = new Lark.EventDispatcher({})

  eventDispatcher.register({
    'im.message.receive_v1': async (data: any) => {
      try {
        const sender = data.sender
        if (sender?.sender_type === 'app') return

        await onMessage(data)
      } catch (err) {
        log.error({ err: String(err) }, 'Error handling WS message')
      }
    },
  })

  if (onCardAction) {
    eventDispatcher.register({
      'card.action.trigger': async (data: any) => {
        try {
          const action: FeishuCardAction & { open_message_id?: string } = {
            chatId: data.context?.open_chat_id ?? '',
            senderId: data.operator?.open_id ?? 'unknown',
            actionValue: data.action?.value ?? {},
            open_message_id: data.context?.open_message_id ?? '',
          }
          void onCardAction(action).catch((err) => {
            log.error({ err: String(err) }, 'Error in card action handler')
          })
          return { toast: { type: 'success', content: '✅ 已收到' } }
        } catch (err) {
          log.error({ err: String(err) }, 'Error handling card action')
          return {}
        }
      },
    })
  }

  const wsClient = new Lark.WSClient({
    appId,
    appSecret,
    loggerLevel: Lark.LoggerLevel.info,
  })

  return {
    start() {
      log.info('Starting Feishu WS...')
      wsClient.start({ eventDispatcher })
      log.info('Feishu WS started')
    },
  }
}
