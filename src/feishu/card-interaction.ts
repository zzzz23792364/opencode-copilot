import type { Database } from 'bun:sqlite'
import { getSessionStmt } from '../utils/db.js'
import { listSessions } from '../utils/opencode-db.js'
import { createLogger } from '../utils/logger.js'
import type { FeishuAdapter, FeishuCardAction } from '../feishu/FeishuAdapter.js'

const log = createLogger('card-interact')

/** In-memory store of active cards: open_message_id → context */
const activeCards = new Map<string, { chatId: string; actionType: string; sessionList?: Array<{ id: string; title: string | null }> }>()

/**
 * Build /list interactive card with session buttons.
 */
export function buildSessionListCard(
  chatId: string,
  sessions: Array<{ id: string; title: string | null }>,
  projectName: string,
): object {
  const cardId = `list_${Date.now()}`

  const elements: object[] = [{ tag: 'markdown', content: `**${projectName}** — 点击按钮绑定会话：` }]

  // Build action rows, max 5 buttons per row
  const buttons = sessions.slice(0, 20).map((s, i) => ({
    tag: 'button' as const,
    text: { tag: 'plain_text' as const, content: `[${i + 1}] ${(s.title || s.id).slice(0, 20)}` },
    value: {
      action: 'use_session',
      session_id: s.id,
    },
    type: 'default' as const,
  }))

  // Chunk into rows of 5 buttons (Feishu limit)
  for (let i = 0; i < buttons.length; i += 5) {
    elements.push({
      tag: 'action' as const,
      actions: buttons.slice(i, i + 5),
    })
  }

  const card = {
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text' as const, content: `📋 会话列表 (${sessions.length})` },
      template: 'blue' as const,
    },
    elements,
  }

  return card
}

/**
 * Send an interactive card via adapter and store card context.
 */
export async function sendCard(
  adapter: FeishuAdapter,
  chatId: string,
  card: object,
  context: { actionType: string; sessionList?: Array<{ id: string; title: string | null }> },
): Promise<void> {
  const result = await (adapter as any).sendLarkMessage(chatId, 'interactive', JSON.stringify(card)) as any
  const messageId = result?.data?.message_id ?? result?.message_id
  if (messageId) {
    activeCards.set(messageId, { chatId, ...context })
    log.info({ messageId, actionType: context.actionType }, 'Interactive card sent')
  }
}

/**
 * Patch an existing interactive card with new content.
 */
export async function patchCard(
  adapter: FeishuAdapter,
  messageId: string,
  card: object,
): Promise<void> {
  await (adapter as any).client.im.message.patch({
    path: { message_id: messageId },
    data: { content: JSON.stringify(card) },
  })
}

/**
 * Handle a card.action.trigger event.
 */
export async function handleCardAction(
  action: FeishuCardAction & { open_message_id?: string },
  adapter: FeishuAdapter,
  db: Database,
): Promise<void> {
  const value = action.actionValue
  const actionType = value.action as string | undefined
  const openMessageId = (action as any).open_message_id as string | undefined

  if (!actionType) return

  log.info({ actionType, openMessageId, senderId: action.senderId }, 'Handling card action')

  switch (actionType) {
    case 'use_session': {
      const sessionId = value.session_id as string
      if (!sessionId) return

      const stmt = getSessionStmt(db)
      const row = stmt.get.get(action.chatId) as { opencode_cwd: string | null } | null
      const cwd = row?.opencode_cwd ?? null
      stmt.upsert.run(action.chatId, sessionId, 'default', null, cwd, Date.now(), Date.now())

      log.info({ chatId: action.chatId, sessionId }, 'Card: session bound')

      // Patch the card to show success
      if (openMessageId) {
        try {
          await patchCard(adapter, openMessageId, {
            config: { update_multi: true },
            header: {
              title: { tag: 'plain_text' as const, content: `✅ 已绑定` },
              template: 'green' as const,
            },
            elements: [{ tag: 'markdown', content: `Session: ${sessionId}\n用 /list 查看或 /new 创建新会话` }],
          })
        } catch (err) {
          log.warn({ err: String(err) }, 'Failed to patch card')
        }
        activeCards.delete(openMessageId)
      }

      // Also send a toast confirmation
      // (Feishu WS callback response handles this)
      break
    }

    default:
      log.warn({ actionType }, 'Unknown card action')
  }
}
