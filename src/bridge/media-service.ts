import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLogger } from '../utils/logger.js'
import type { FeishuAdapter, FeishuAttachment } from '../feishu/FeishuAdapter.js'

const log = createLogger('media')

export interface DownloadedAttachment {
  type: 'image' | 'file' | 'audio'
  filePath: string
  fileName?: string
}

export class MediaService {
  private downloadDir: string

  constructor(private adapter: FeishuAdapter) {
    this.downloadDir = join(tmpdir(), 'opencode-copilot-media')
  }

  async ensureDir(): Promise<void> {
    await mkdir(this.downloadDir, { recursive: true })
  }

  /**
   * Download Feishu attachments to temp files.
   * Returns file paths that can be passed to opencode.
   */
  async downloadAttachments(
    messageId: string,
    attachments: FeishuAttachment[],
  ): Promise<DownloadedAttachment[]> {
    const results: DownloadedAttachment[] = []

    for (const att of attachments) {
      try {
        const res = await this.adapter.downloadResource(messageId, att.feishuKey, att.type)
        const ext = this.getExt(att.type, res.filename ?? att.fileName)
        const filePath = join(this.downloadDir, `feishu_${att.feishuKey}${ext}`)
        await writeFile(filePath, new Uint8Array(res.data))
        results.push({
          type: att.type,
          filePath,
          fileName: att.fileName ?? res.filename,
        })
        log.info({ filePath, size: res.data.length }, 'Downloaded attachment')
      } catch (err) {
        log.warn({ err: String(err), fileKey: att.feishuKey }, 'Failed to download attachment')
      }
    }

    return results
  }

  private getExt(type: 'image' | 'file' | 'audio', fileName?: string): string {
    if (fileName?.includes('.')) {
      return '.' + fileName.split('.').pop()
    }
    const map: Record<string, string> = { image: '.png', file: '.bin', audio: '.opus' }
    return map[type] ?? '.bin'
  }
}
