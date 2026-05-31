import { createLogger } from './logger.js'

const log = createLogger('config')

export interface Config {
  feishuAppId: string
  feishuAppSecret: string
  feishuBotOpenId?: string
  feishuBotName?: string
  feishuVerificationToken?: string
  feishuWebhookPort?: number
  opencodeCwd?: string
  logLevel?: string
}

let _config: Config | null = null

export function loadConfig(): Config {
  if (_config) return _config

  const env = process.env

  const config: Config = {
    feishuAppId: env.FEISHU_APP_ID || '',
    feishuAppSecret: env.FEISHU_APP_SECRET || '',
    feishuBotOpenId: env.FEISHU_BOT_OPEN_ID || undefined,
    feishuBotName: env.FEISHU_BOT_NAME || 'opencode-copilot',
    feishuVerificationToken: env.FEISHU_VERIFICATION_TOKEN || undefined,
    feishuWebhookPort: env.FEISHU_WEBHOOK_PORT ? parseInt(env.FEISHU_WEBHOOK_PORT, 10) : undefined,
    opencodeSessionId: env.OPENCODE_SESSION_ID || undefined,
    logLevel: env.LOG_LEVEL || 'info',
  }

  if (!config.feishuAppId || !config.feishuAppSecret) {
    throw new Error('FEISHU_APP_ID and FEISHU_APP_SECRET are required')
  }

  log.info({ appId: config.feishuAppId.slice(0, 8) + '...' }, 'Config loaded')
  _config = config
  return config
}
