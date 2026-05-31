import { spawn } from "node:child_process"
import { createInterface } from "node:readline"

const APP_ID = "your_app_id"
const APP_SECRET = "your_app_secret"
const FEISHU_BASE = "https://open.feishu.cn/open-apis"

async function getToken() {
  const resp = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  })
  const data = await resp.json() as any
  console.log("[token]", data.code === 0 ? "OK" : "FAIL")
  return data.tenant_access_token
}

async function opencodeRun(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("opencode", ["run", "--format", "json", prompt], {
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
      resolve(reply)
    })
    proc.on("error", reject)
  })
}

async function sendFeishu(token: string, openId: string, text: string) {
  const resp = await fetch(`${FEISHU_BASE}/im/v1/messages?receive_id_type=open_id`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      receive_id: openId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    }),
  })
  const data = await resp.json() as any
  console.log(`[feishu] send: code=${data.code}`)
  return data.code === 0
}

async function main() {
  const token = await getToken()
  const targetOpenId = "ou_e0b85cf1af229d7fc9d148b35babb51c"

  // 1. Test Feishu API alone
  console.log("\n--- Test 1: Feishu sendMessage ---")
  await sendFeishu(token, targetOpenId, "🤖 Bridge test: Feishu API works!")

  // 2. Test opencode run alone
  console.log("\n--- Test 2: opencode run --format json ---")
  const reply1 = await opencodeRun("你好，用一句话自我介绍")
  console.log(`[opencode] reply:`, reply1.slice(0, 200))

  // 3. Test combined: Feishu → opencode → Feishu
  console.log("\n--- Test 3: Combined (Feishu → opencode → Feishu) ---")
  const reply2 = await opencodeRun("用一句话说明反向代理")
  console.log(`[opencode] reply:`, reply2.slice(0, 200))
  await sendFeishu(token, targetOpenId, `🤖 opencode回复: ${reply2.slice(0, 500)}`)

  console.log("\n=== All tests passed ===")
}

main().catch(console.error)
