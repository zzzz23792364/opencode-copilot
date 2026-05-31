import * as Lark from "@larksuiteoapi/node-sdk"

const APP_ID = "your_app_id"
const APP_SECRET = "your_app_secret"

const eventDispatcher = new Lark.EventDispatcher({})

eventDispatcher.register({
  "im.message.receive_v1": async (data: any) => {
    console.log("\n=== EVENT RECEIVED ===")
    console.log(JSON.stringify(data, null, 2).slice(0, 1000))
    console.log("=== END EVENT ===\n")
  },
})

const wsClient = new Lark.WSClient({
  appId: APP_ID,
  appSecret: APP_SECRET,
  loggerLevel: Lark.LoggerLevel.info,
})

console.log("[test] Starting WS...")
wsClient.start({ eventDispatcher })
console.log("[test] WS started, waiting for events...")

// Keep alive
setInterval(() => {}, 1 << 30)
