import type { Database } from 'better-sqlite3'
import { execSync } from 'node:child_process'
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
      const row = stmt.get.get(action.chatId) as { opencode_cwd: string | null; cli_args: string | null } | null
      const cwd = row?.opencode_cwd ?? null
      const cliArgs = row?.cli_args ?? null
      stmt.upsert.run(action.chatId, sessionId, 'default', null, cwd, null, cliArgs, Date.now(), Date.now())

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

    case 'cli_arg_toggle': {
      await handleCliArgToggle(action, adapter, db)
      break
    }

    case 'select_model': {
      await handleModelSelect(action, adapter, db)
      break
    }

    case 'select_model_provider': {
      await handleProviderSelect(action, adapter, db)
      break
    }

    case 'select_model_set': {
      await handleModelSet(action, adapter, db)
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
    stmt.upsert.run(action.chatId, 'placeholder', 'default', null, directory, null, null, Date.now(), Date.now())
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
export function buildConfigCard(chatId: string, session: { flags: string | null; cli_args: string | null; model: string | null } | null): object {
  const cliArgs: string[] = []
  if (session?.cli_args) { try { cliArgs.push(...JSON.parse(session.cli_args)) } catch {} }
  const dangerOn = cliArgs.includes('--dangerously-skip-permissions')
  const thinkingOn = cliArgs.includes('--thinking')
  const currentModel = session?.model || '未设置'

  return {
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text' as const, content: '⚙ 运行配置' },
      template: 'blue' as const,
    },
    elements: [
      {
        tag: 'markdown' as const,
        content: `**模型**: ${currentModel}\n**--dangerously-skip-permissions**: ${dangerOn ? '✅' : '❌'}\n**--thinking**: ${thinkingOn ? '✅' : '❌'}`,
      },
      {
        tag: 'action' as const,
        actions: [
          {
            tag: 'button' as const,
            text: { tag: 'plain_text' as const, content: '选择模型' },
            type: 'default' as const,
            value: { action: 'select_model', chat_id: chatId },
          },
          {
            tag: 'button' as const,
            text: { tag: 'plain_text' as const, content: dangerOn ? '关闭 --dangerously-skip-permissions' : '开启 --dangerously-skip-permissions' },
            type: dangerOn ? 'default' as const : 'primary' as const,
            value: { action: 'cli_arg_toggle', arg: '--dangerously-skip-permissions', chat_id: chatId },
          },
          {
            tag: 'button' as const,
            text: { tag: 'plain_text' as const, content: thinkingOn ? '关闭 --thinking' : '开启 --thinking' },
            type: thinkingOn ? 'default' as const : 'primary' as const,
            value: { action: 'cli_arg_toggle', arg: '--thinking', chat_id: chatId },
          },
        ],
      },
    ],
  }
}

/** Toggle a CLI arg in/out of the cli_args JSON array. */
async function handleCliArgToggle(
  action: FeishuCardAction & { open_message_id?: string },
  adapter: FeishuAdapter,
  db: Database,
): Promise<void> {
  const arg = action.actionValue.arg as string
  const openMessageId = (action as any).open_message_id as string | undefined
  if (!arg) return

  const row = (getSessionStmt(db).get.get(action.chatId) as { cli_args: string | null } | undefined)
  const current: string[] = row?.cli_args ? JSON.parse(row.cli_args) : []

  const idx = current.indexOf(arg)
  if (idx >= 0) current.splice(idx, 1)
  else current.push(arg)

  db.prepare('UPDATE feishu_sessions SET cli_args = ?, last_active = ? WHERE feishu_key = ?')
    .run(JSON.stringify(current), Date.now(), action.chatId)

  log.info({ chatId: action.chatId, arg, enabled: idx < 0 }, 'Card: cli_arg toggled')

  if (openMessageId) {
    try {
      const sessionRow = getSessionStmt(db).get.get(action.chatId) as { flags: string | null; cli_args: string | null; model: string | null } | null
      await patchCard(adapter, openMessageId, buildConfigCard(action.chatId, sessionRow) as any)
    } catch (err) {
      log.warn({ err: String(err) }, 'Failed to patch config card after cli_arg_toggle')
    }
  }
}

/** Build provider selection card (first step of model selection flow). */
function buildProviderListCard(chatId: string, providers: Array<{ name: string; count: number }>): object {
  const elements: object[] = [{ tag: 'markdown', content: '选择 provider 查看可用模型：' }]
  const buttons = providers.map(p => ({
    tag: 'button' as const,
    text: { tag: 'plain_text' as const, content: `${p.name} (${p.count})` },
    type: 'default' as const,
    value: { action: 'select_model_provider', provider: p.name, chat_id: chatId },
  }))
  for (let i = 0; i < buttons.length; i += 5) {
    elements.push({ tag: 'action' as const, actions: buttons.slice(i, i + 5) })
  }
  return {
    config: { update_multi: true },
    header: { title: { tag: 'plain_text' as const, content: '🤖 选择 Provider' }, template: 'blue' as const },
    elements,
  }
}

/** Build model list card for a given provider (second step). */
function buildModelListCard(chatId: string, provider: string, models: string[]): object {
  return {
    config: { update_multi: true },
    header: { title: { tag: 'plain_text' as const, content: `🤖 ${provider}` }, template: 'blue' as const },
    elements: [
      { tag: 'markdown', content: `选择 ${provider} 下的模型：` },
      ...models.map(m => ({
        tag: 'action' as const,
        actions: [{
          tag: 'button' as const,
          text: { tag: 'plain_text' as const, content: m },
          type: 'default' as const,
          value: { action: 'select_model_set', model: m, chat_id: chatId },
        }],
      })),
    ],
  }
}

/** Handle select_model card action — run `opencode models` and show provider list. */
async function handleModelSelect(
  action: FeishuCardAction & { open_message_id?: string },
  adapter: FeishuAdapter,
  db: Database,
): Promise<void> {
  const chatId = action.actionValue.chat_id as string || action.chatId
  const openMessageId = (action as any).open_message_id as string | undefined

  // Fetch models from opencode CLI
  let models: string[] = []
  try {
    const out = execSync('opencode models', { encoding: 'utf-8', timeout: 15000 }).trim()
    models = out.split('\n').filter(Boolean)
  } catch {
    log.warn({}, 'Failed to query opencode models')
    if (openMessageId) {
      await patchCard(adapter, openMessageId, {
        header: { title: { tag: 'plain_text', content: '❌ 查询失败' }, template: 'red' },
        elements: [{ tag: 'markdown', content: '无法获取模型列表，opencode CLI 是否可用？' }],
      })
    }
    return
  }

  // Group by provider (prefix before /)
  const groups = new Map<string, string[]>()
  for (const m of models) {
    const sep = m.indexOf('/')
    const provider = sep > 0 ? m.slice(0, sep) : '__other'
    if (!groups.has(provider)) groups.set(provider, [])
    groups.get(provider)!.push(m)
  }

  const providers = [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, ms]) => ({ name, count: ms.length }))

  const card = buildProviderListCard(chatId, providers)
  if (openMessageId) {
    await patchCard(adapter, openMessageId, card as any)
  } else {
    await sendCard(adapter, chatId, card, { actionType: 'select_model_provider' })
  }
}

/** Handle provider selection — show models for that provider. */
async function handleProviderSelect(
  action: FeishuCardAction & { open_message_id?: string },
  adapter: FeishuAdapter,
  db: Database,
): Promise<void> {
  const chatId = action.actionValue.chat_id as string || action.chatId
  const provider = action.actionValue.provider as string
  const openMessageId = (action as any).open_message_id as string | undefined
  if (!provider) return

  let models: string[] = []
  try {
    const out = execSync('opencode models', { encoding: 'utf-8', timeout: 15000 }).trim()
    models = out.split('\n').filter(Boolean)
  } catch {
    log.warn({}, 'Failed to query opencode models')
    return
  }

  const prefix = provider + '/'
  const filtered = models.filter(m => m.startsWith(prefix))
  const card = buildModelListCard(chatId, provider, filtered)

  if (openMessageId) {
    await patchCard(adapter, openMessageId, card as any)
  } else {
    await sendCard(adapter, chatId, card, { actionType: 'select_model_set' })
  }
}

/** Handle model selection — save to DB and show config card. */
async function handleModelSet(
  action: FeishuCardAction & { open_message_id?: string },
  adapter: FeishuAdapter,
  db: Database,
): Promise<void> {
  const chatId = action.actionValue.chat_id as string || action.chatId
  const model = action.actionValue.model as string
  const openMessageId = (action as any).open_message_id as string | undefined
  if (!model) return

  db.prepare('UPDATE feishu_sessions SET model = ?, last_active = ? WHERE feishu_key = ?')
    .run(model, Date.now(), action.chatId)

  log.info({ chatId, model }, 'Card: model selected')

  if (openMessageId) {
    try {
      const sessionRow = getSessionStmt(db).get.get(action.chatId) as { flags: string | null; cli_args: string | null; model: string | null } | null
      await patchCard(adapter, openMessageId, buildConfigCard(action.chatId, sessionRow) as any)
    } catch (err) {
      log.warn({ err: String(err) }, 'Failed to patch config card after model select')
    }
  }
}
