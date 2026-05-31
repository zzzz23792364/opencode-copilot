import * as Lark from "@larksuiteoapi/node-sdk"
import { spawn } from "node:child_process"
import { createInterface } from "node:readline"

const APP_ID = "your_app_id"
const APP_SECRET = "your_app_secret"
const FEISHU_BASE = "https://open.feishu.cn/open-apis"

// ── Token ──
let tokenState: { token: string; expiresAt: number } | null = null
async function getToken(): Promise<string> {
  const now = Date.now()
  if (tokenState && tokenState.expiresAt - now > 300_000) return tokenState.token
  const resp = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  })
  const data = await resp.json() as any
  if (data.code !== 0) throw new Error(`Token error: ${data.msg}`)
  tokenState = { token: data.tenant_access_token, expiresAt: Date.now() + data.expire * 1000 }
  return tokenState.token
}

// ── Feishu API ──
async function sendText(chatId: string, text: string) {
  const token = await getToken()
  const resp = await fetch(`${FEISHU_BASE}/im/v1/messages?receive_id_type=chat_id`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    }),
  })
  return (await resp.json()) as any
}

// ── opencode run ──
const SESSION_ID = "ses_182054e56ffelRIDaWC5PHEVbD"

async function opencodeRun(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("opencode", ["run", "--session", SESSION_ID, "--format", "json", prompt], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    const lines: string[] = []
    const rl = createInterface({ input: proc.stdout })
    rl.on("line", (l) => lines.push(l))
    let stderr = ""
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk })
    proc.on("close", (code) => {
      if (code !== 0) console.error("[opencode:stderr]", stderr.slice(0, 300))
      let reply = ""
      for (const line of lines) {
        try {
          const ev = JSON.parse(line)
          if (ev.type === "text") reply += ev.part?.text ?? ""
        } catch {}
      }
      resolve(reply || "(no response)")
    })
    proc.on("error", reject)
  })
}

// ── Main ──
async function main() {
  console.log(`[e2e] Using session: ${SESSION_ID}`)
  console.log("[e2e] Starting Feishu WS...")

  const eventDispatcher = new Lark.EventDispatcher({})
  eventDispatcher.register({
    "im.message.receive_v1": async (data: any) => {
      const msg = data.message
      const sender = data.sender
      if (sender?.sender_type === "app") return

      const chatId = msg.chat_id
      let text = ""
      if (msg.message_type === "text") {
        text = JSON.parse(msg.content).text ?? ""
      } else {
        text = `[${msg.message_type} message]`
      }

      console.log(`\n[feishu] << "${text}" (from ${chatId})`)

      // Process through opencode
      console.log("[opencode] running...")
      const reply = await opencodeRun(text)
      console.log(`[opencode] >> "${reply.slice(0, 150)}"`)

      // Send back to Feishu
      const result = await sendText(chatId, reply)
      console.log(`[feishu] >> code=${result.code}`)
    },
  })

  const wsClient = new Lark.WSClient({
    appId: APP_ID,
    appSecret: APP_SECRET,
    loggerLevel: Lark.LoggerLevel.info,
  })

  wsClient.start({ eventDispatcher })
  console.log("[e2e] Ready! Send a message to the bot on Feishu.")
}

main().catch(console.error)
