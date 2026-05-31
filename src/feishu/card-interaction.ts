import type { Database } from 'better-sqlite3'
import { getSessionStmt } from '../utils/db.js'
import { listSessions, listProjects } from '../utils/opencode-db.js'
import { createLogger } from '../utils/logger.js'
import type { FeishuAdapter, FeishuCardAction } from '../feishu/FeishuAdapter.js'

const log = createLogger('card-interact')

/** Registry of active opencode runs: chatId → abort() */
const activeRuns = new Map<string, () => void>()

/** Register an abort function for the given chat. */
export function registerRun(chatId: string, abort: () => void): void {
  activeRuns.set(chatId, abort)
}

/** Unregister a run (called when normal completion). */
export function unregisterRun(chatId: string): void {
  activeRuns.delete(chatId)
}

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
    case 'abort_stream': {
      const chatId = value.chat_id as string || action.chatId
      const abort = activeRuns.get(chatId)
      if (abort) {
        abort()
        activeRuns.delete(chatId)
        log.info({ chatId }, 'Card: stream aborted')
        if (openMessageId) {
          try {
            await patchCard(adapter, openMessageId, {
              header: {
                title: { tag: 'plain_text' as const, content: '❌ 已终止' },
                template: 'red' as const,
              },
              elements: [{ tag: 'markdown', content: '流式生成已终止' }],
            })
          } catch { /* non-fatal */ }
        }
      }
      break
    }

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

    case 'select_project': {
      await handleProjectSelect(action, adapter, db)
      break
    }

    case 'cf_toggle': {
      await handleToggleFlag(action, adapter, db)
      break
    }

    default:
      log.warn({ actionType }, 'Unknown card action')
  }
}

/**
 * Build /projects interactive card with project selection buttons.
 */
export function buildProjectListCard(
  chatId: string,
  projects: Array<{ directory: string; count: number }>,
  currentCwd: string | null,
): object {
  const elements: object[] = [{ tag: 'markdown', content: '点击按钮选择项目：' }]

  const buttons = projects.map((p, i) => {
    const dirName = p.directory.split('/').pop() || p.directory
    const mark = p.directory === currentCwd ? ' ✓' : ''
    return {
      tag: 'button' as const,
      text: { tag: 'plain_text' as const, content: `[${i + 1}] ${dirName} (${p.count})${mark}` },
      value: { action: 'select_project', directory: p.directory, index: i + 1 },
      type: p.directory === currentCwd ? 'primary' as const : 'default' as const,
    }
  })

  for (let i = 0; i < buttons.length; i += 5) {
    elements.push({ tag: 'action' as const, actions: buttons.slice(i, i + 5) })
  }

  return {
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text' as const, content: `📁 项目 (${projects.length})` },
      template: 'blue' as const,
    },
    elements,
  }
}

/** Handle select_project card action — set opencode_cwd for the chat. */
async function handleProjectSelect(
  action: FeishuCardAction & { open_message_id?: string },
  adapter: FeishuAdapter,
  db: Database,
): Promise<void> {
  const directory = action.actionValue.directory as string
  if (!directory) return

  const dirName = directory.split('/').pop()
  const openMessageId = (action as any).open_message_id as string | undefined

  // Check if this came from /sw (switch flow: project → session)
  const sourceCard = openMessageId ? activeCards.get(openMessageId) : undefined
  const isSwitchFlow = sourceCard?.actionType === 'sw_projects'

  // Ensure row exists with cwd
  const stmt = getSessionStmt(db)
  const existing = stmt.get.get(action.chatId)
  if (existing) {
    db.prepare('UPDATE feishu_sessions SET opencode_cwd = ?, last_active = ? WHERE feishu_key = ?').run(directory, Date.now(), action.chatId)
  } else {
    stmt.upsert.run(action.chatId, 'placeholder', 'default', null, directory, Date.now(), Date.now())
  }

  log.info({ chatId: action.chatId, directory, isSwitchFlow }, 'Card: project selected')

  if (openMessageId) {
    try {
      await patchCard(adapter, openMessageId, {
        config: { update_multi: true },
        header: {
          title: { tag: 'plain_text' as const, content: `✅ 已选择: ${dirName}` },
          template: 'green' as const,
        },
        elements: [{ tag: 'markdown', content: `项目: ${directory}\n用 /list 查看会话，或用 /project 选择其他项目` }],
      })
      activeCards.delete(openMessageId)
    } catch (err) {
      log.warn({ err: String(err) }, 'Failed to patch project card')
    }
  }

  // /sw flow: after project selection, auto-send session list card
  if (isSwitchFlow) {
    const sessions = listSessions(directory)
    if (sessions.length > 0) {
      const card = buildSessionListCard(action.chatId, sessions, dirName!)
      await sendCard(adapter, action.chatId, card, { actionType: 'list_sessions' })
    }
  }
}

/**
 * Build /cf interactive card with toggle buttons for opencode run flags.
 */
export function buildConfigCard(chatId: string, currentFlagsJson: string | null): object {
  let flags: Record<string, boolean> = {}
  try { if (currentFlagsJson) flags = JSON.parse(currentFlagsJson) } catch {}

  const dangerOn = !!flags.danger

  return {
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text' as const, content: '⚙ 运行配置' },
      template: 'blue' as const,
    },
    elements: [
      {
        tag: 'markdown' as const,
        content: `**--danger** 允许危险操作（跳过权限确认）\n当前: ${dangerOn ? '✅ 开启' : '❌ 关闭'}`,
      },
      {
        tag: 'action' as const,
        actions: [{
          tag: 'button' as const,
          text: { tag: 'plain_text' as const, content: dangerOn ? '关闭 --danger' : '开启 --danger' },
          type: dangerOn ? 'default' as const : 'primary' as const,
          value: { action: 'cf_toggle', flag: 'danger', chat_id: chatId },
        }],
      },
    ],
  }
}

/** Handle cf_toggle card action — flip a flag and repatch the card. */
async function handleToggleFlag(
  action: FeishuCardAction & { open_message_id?: string },
  adapter: FeishuAdapter,
  db: Database,
): Promise<void> {
  const flag = action.actionValue.flag as string
  const openMessageId = (action as any).open_message_id as string | undefined
  if (!flag) return

  const stmt = getSessionStmt(db)
  const row = stmt.get.get(action.chatId) as { flags: string | null } | undefined
  const current: Record<string, boolean> = row?.flags ? JSON.parse(row.flags) : {}

  current[flag] = !current[flag]

  const newFlags = JSON.stringify(current)
  db.prepare('UPDATE feishu_sessions SET flags = ?, last_active = ? WHERE feishu_key = ?').run(newFlags, Date.now(), action.chatId)

  log.info({ chatId: action.chatId, flag, value: current[flag] }, 'Card: flag toggled')

  if (openMessageId) {
    try {
      await patchCard(adapter, openMessageId, buildConfigCard(action.chatId, newFlags) as any)
    } catch (err) {
      log.warn({ err: String(err) }, 'Failed to patch config card')
    }
  }
}
