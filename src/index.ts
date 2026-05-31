import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from './utils/config.js'
import { createDatabase } from './utils/db.js'
import { createLogger } from './utils/logger.js'
import { createWSClient } from './feishu/ws-client.js'
import { FeishuAdapter } from './feishu/FeishuAdapter.js'
import { FeishuTokenManager } from './feishu/FeishuTokenManager.js'
import { createSessionManager } from './bridge/session-manager.js'
import { createMessageDedup } from './bridge/message-dedup.js'
import { createOutboundHandler } from './bridge/outbound.js'
import { createMessageHandler } from './bridge/message-handler.js'
import { StreamingOutboundHook } from './bridge/StreamingOutboundHook.js'
import { createCommandHandler } from './commands/handlers.js'
import { startPoller } from './feishu-poller.js'
import type { FeishuMessageEvent } from './feishu/types.js'

const log = createLogger('index')

async function main() {
  log.info('Starting opencode-copilot...')

  // Load config
  const config = loadConfig()
  log.info({ appId: config.feishuAppId.slice(0, 8) + '...' }, 'Config loaded')

  // Initialize DB
  const dbDir = join(homedir(), '.opencode-copilot')
  await mkdir(dbDir, { recursive: true })
  const dbPath = join(dbDir, 'sessions.db')
  const db = createDatabase(dbPath)

  // Create Feishu adapter
  const adapter = new FeishuAdapter(config.feishuAppId, config.feishuAppSecret, log)
  const tokenManager = new FeishuTokenManager({
    appId: config.feishuAppId,
    appSecret: config.feishuAppSecret,
  })
  adapter._injectTokenManager(tokenManager)

  if (config.feishuBotOpenId) {
    adapter.setBotOpenId(config.feishuBotOpenId)
  }

  // Create core components
  const sessionManager = createSessionManager(db)
  const dedup = createMessageDedup(db)
  const commandHandler = createCommandHandler()

  // Create streaming hook
  const streamingHook = new StreamingOutboundHook({
    adapters: new Map([['feishu', adapter]]),
    log,
    catDisplayName: 'catcaffe',
  })

  const outbound = createOutboundHandler(adapter, streamingHook)
  const messageHandler = createMessageHandler(sessionManager, dedup, outbound)

  // Handle incoming message
  async function onMessage(event: FeishuMessageEvent) {
    try {
      const chatId = event.chat_id
      const messageId = event.message_id

      // Parse text
      let text = ''
      const msgType = event.message.message_type
      if (msgType === 'text') {
        try {
          text = JSON.parse(event.message.content).text ?? ''
        } catch {
          text = event.message.content
        }
      } else {
        text = `[${msgType}]`
      }

      if (!text) return

      // Check commands
      const cmdResult = await commandHandler.handle(text, chatId, sessionManager, db)
      if (cmdResult) {
        // Command handled — send result directly
        await adapter.sendReply(chatId, cmdResult.text)
        return
      }

      // Regular message — process through pipeline
      await messageHandler.handle(event)
    } catch (err) {
      log.error({ err: String(err) }, 'Unhandled error in onMessage')
    }
  }

  // Start Feishu WS
  const ws = createWSClient({
    appId: config.feishuAppId,
    appSecret: config.feishuAppSecret,
    onMessage,
  })
  ws.start()

  // Start TUI→Feishu poller
  const stopPoller = startPoller({ db, adapter, intervalMs: 3000 })
  log.info('TUI→Feishu poller started')

  // Graceful shutdown
  const shutdown = () => {
    log.info('Shutting down...')
    stopPoller()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  log.info('opencode-copilot ready')
}

main().catch((err) => {
  log.error({ err: String(err) }, 'Fatal error')
  process.exit(1)
})
