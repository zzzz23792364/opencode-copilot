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
import { opencodeRun } from './bridge/opencode-run.js'
import { MediaService } from './bridge/media-service.js'
import { createCommandHandler } from './commands/handlers.js'
import { buildSessionListCard, buildProjectListCard, sendCard, handleCardAction } from './feishu/card-interaction.js'
import type { FeishuInboundMessage } from './feishu/FeishuAdapter.js'
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
    catDisplayName: config.feishuBotName || 'opencode-copilot',
  })

  const outbound = createOutboundHandler(adapter, streamingHook)
  const mediaService = new MediaService(adapter)
  await mediaService.ensureDir()
  const messageHandler = createMessageHandler(sessionManager, dedup, outbound, mediaService)

  // Inflight request tracker for graceful shutdown
  let inflightCount = 0
  let shuttingDown = false

  function enterRequest() { inflightCount++ }
  function leaveRequest() { inflightCount-- }

  // ── Unified onMessage: parse via adapter.parseEvent() ──

  async function onMessage(data: Record<string, unknown>) {
    if (shuttingDown) return
    enterRequest()
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
        if (cmdResult.kind === 'thread') {
          const session = sessionManager.getSession(parsed.chatId)
          const result = await opencodeRun(cmdResult.message, cmdResult.sessionId, session?.opencode_cwd || undefined)
          await outbound.sendFormatted(parsed.chatId, result.text)
        } else if (cmdResult.kind === 'card') {
          const projectName = parsed.text === '/list -all' ? 'all' : 'local'
          const card = buildSessionListCard(parsed.chatId, cmdResult.context.sessionList, projectName)
          await sendCard(adapter, parsed.chatId, card, cmdResult.context).catch(() => {})
        } else {
          outbound.sendFormatted(parsed.chatId, cmdResult.text, '命令结果').catch(() => {})
        }
        return
      }

      // Regular message pipeline
      await messageHandler.handle(parsed)
    } catch (err) {
      log.error({ err: String(err) }, 'Unhandled error in onMessage')
    } finally {
      leaveRequest()
    }
  }

  // ── Card action handler ──

  async function onCardAction(action: FeishuCardAction & { open_message_id?: string }) {
    if (shuttingDown) return
    enterRequest()
    try {
      log.info({ senderId: action.senderId, actionValue: action.actionValue }, 'Card action')
      await handleCardAction(action, adapter, db)
    } finally {
      leaveRequest()
    }
  }

  // Start Feishu WS
  const ws = createWSClient({
    appId: config.feishuAppId,
    appSecret: config.feishuAppSecret,
    onMessage,
    onCardAction,
  })
  ws.start()

  // Graceful shutdown: wait for inflight requests to finish
  let shutdownTimer: ReturnType<typeof setTimeout> | null = null

  function shutdown() {
    if (shuttingDown) return
    shuttingDown = true
    streamingHook.stopAllHeartbeats()
    log.info({ inflightCount }, 'Shutting down...')

    // Force exit after 30s if requests don't finish
    shutdownTimer = setTimeout(() => {
      log.warn({ inflightCount }, 'Force exit after grace period')
      process.exit(0)
    }, 30_000)

    // Poll until inflightCount reaches 0
    const check = setInterval(() => {
      if (inflightCount <= 0) {
        clearInterval(check)
        if (shutdownTimer) clearTimeout(shutdownTimer)
        log.info('All requests drained, exiting')
        process.exit(0)
      }
    }, 200)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  log.info('opencode-copilot ready')
}

main().catch((err) => {
  log.error({ err: String(err) }, 'Fatal error')
  process.exit(1)
})
