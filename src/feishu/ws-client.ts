import * as Lark from '@larksuiteoapi/node-sdk'
import { createLogger } from '../utils/logger.js'
import type { FeishuMessageEvent } from './types.js'

const log = createLogger('feishu-ws')

export interface WSClientDeps {
  appId: string
  appSecret: string
  onMessage: (event: FeishuMessageEvent) => Promise<void>
}

export function createWSClient(deps: WSClientDeps) {
  const { appId, appSecret, onMessage } = deps

  const eventDispatcher = new Lark.EventDispatcher({})

  eventDispatcher.register({
    'im.message.receive_v1': async (data: any) => {
      try {
        const msg = data.message
        const sender = data.sender
        if (sender?.sender_type === 'app') return

        const event: FeishuMessageEvent = {
          event_id: data.event_id ?? msg.message_id ?? `ws_${Date.now()}`,
          chat_id: msg.chat_id,
          chat_type: msg.chat_type as 'p2p' | 'group',
          message_id: msg.message_id,
          root_id: msg.root_id,
          parent_id: msg.parent_id,
          sender: {
            sender_id: sender?.sender_id ?? { open_id: 'unknown' },
            sender_type: sender?.sender_type ?? 'unknown',
            tenant_key: sender?.tenant_key ?? 'unknown',
          },
          message: {
            message_type: msg.message_type,
            content: msg.content,
          },
          mentions: msg.mentions,
        }

        await onMessage(event)
      } catch (err) {
        log.error({ err: String(err) }, 'Error handling WS message')
      }
    },
  })

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
