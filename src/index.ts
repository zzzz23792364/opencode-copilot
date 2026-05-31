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
import { MediaService } from './bridge/media-service.js'
import { createCommandHandler } from './commands/handlers.js'
import { startPoller } from './feishu-poller.js'
import type { FeishuInboundMessage, FeishuCardAction } from './feishu/FeishuAdapter.js'
import type { Database } from 'bun:sqlite'

const log = createLogger('index')

async function main() {
  log.info('Starting opencode-copilot...')

  const config = loadConfig()
  log.info({ appId: config.feishuAppId.slice(0, 8) + '...' }, 'Config loaded')

  // Initialize DB
  const dbDir = join(homedir(), '.opencode-copilot')
  await mkdir(dbDir, { recursive: true })
  const db = createDatabase(join(dbDir, 'sessions.db'))

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

  const streamingHook = new StreamingOutboundHook({
    adapters: new Map([['feishu', adapter]]),
    log,
    catDisplayName: 'catcaffe',
  })

  const outbound = createOutboundHandler(adapter, streamingHook)
  const mediaService = new MediaService(adapter)
  await mediaService.ensureDir()
  const messageHandler = createMessageHandler(sessionManager, dedup, outbound, mediaService)

  // ── Unified onMessage: parse via adapter.parseEvent() ──

  async function onMessage(data: Record<string, unknown>) {
    try {
      // Wrap raw WS data in envelope format expected by parseEvent
      const envelope = {
        header: { event_type: 'im.message.receive_v1' },
        event: data,
      }

      const parsed = adapter.parseEvent(envelope)
      if (!parsed) {
        log.info({ chatId: (data as any)?.message?.chat_id }, 'Event skipped by parseEvent (unsupported/not-mentioned)')
        return
      }

      // Add reaction as instant feedback
      try {
        await adapter.addReaction(parsed.messageId, 'THUMBSUP')
      } catch {
        // non-fatal
      }

      // Check commands
      const cmdResult = await commandHandler.handle(
        parsed.text,
        parsed.chatId,
        parsed.senderId,
        sessionManager,
        db,
      )
      if (cmdResult) {
        outbound.sendFormatted(parsed.chatId, cmdResult.text, '命令结果').catch(() => {})
        return
      }

      // Regular message pipeline
      await messageHandler.handle(parsed)
    } catch (err) {
      log.error({ err: String(err) }, 'Unhandled error in onMessage')
    }
  }

  // ── Card action handler ──

  async function onCardAction(action: FeishuCardAction) {
    log.info({ senderId: action.senderId, actionValue: action.actionValue }, 'Card action received')
    // Future: route card actions to appropriate handlers
  }

  // Start Feishu WS
  const ws = createWSClient({
    appId: config.feishuAppId,
    appSecret: config.feishuAppSecret,
    onMessage,
    onCardAction,
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
