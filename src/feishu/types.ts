/**
 * Shared types — inlined from clowder-local to avoid monorepo coupling.
 */

export type { Logger } from '../utils/logger.js'

// ── RichBlock types (minimal subset used by feishu-card-formatter) ──

export type RichBlockKind =
  | 'card'
  | 'diff'
  | 'checklist'
  | 'media_gallery'
  | 'audio'
  | 'interactive'
  | 'html_widget'
  | 'file'

export interface RichBlockBase {
  id: string
  kind: RichBlockKind
  v: 1
}

export interface RichCardBlock extends RichBlockBase {
  kind: 'card'
  title: string
  bodyMarkdown?: string
  tone?: 'info' | 'success' | 'warning' | 'danger'
  fields?: Array<{ label: string; value: string }>
}

export interface RichDiffBlock extends RichBlockBase {
  kind: 'diff'
  filePath: string
  diff: string
  languageHint?: string
}

export interface RichChecklistBlock extends RichBlockBase {
  kind: 'checklist'
  title?: string
  items: Array<{ id: string; text: string; checked?: boolean }>
}

export interface RichMediaGalleryBlock extends RichBlockBase {
  kind: 'media_gallery'
  title?: string
  items: Array<{ url: string; alt?: string; caption?: string }>
}

export interface RichAudioBlock extends RichBlockBase {
  kind: 'audio'
  url: string
  text?: string
  speaker?: string
  title?: string
  durationSec?: number
  mimeType?: string
}

export type RichBlock =
  | RichCardBlock
  | RichDiffBlock
  | RichChecklistBlock
  | RichMediaGalleryBlock
  | RichAudioBlock
  | RichBlockBase

// ── Message envelope ──

export interface MessageEnvelope {
  header: string
  subtitle?: string
  body: string
  footer?: string
  origin?: string
}

// ── Feishu message event (from WebSocket) ──

export interface FeishuMessageEvent {
  event_id: string
  chat_id: string
  chat_type: 'p2p' | 'group'
  message_id: string
  root_id?: string
  parent_id?: string
  sender: {
    sender_id: { open_id: string; user_id?: string }
    sender_type: string
    tenant_key: string
  }
  message: {
    message_type: string
    content: string
  }
  mentions?: Array<{ id: { open_id: string }; name: string }>
}
