import { app, screen } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_HOST, CURSOR_POLL_MS, SKIN_ANIMATION_DIR, SKIN_HOST } from '../shared/config.js'
import { createClickThroughBridge } from './clickthrough.js'
import { startCursorPolling } from './cursor.js'
import { registerIpc } from './ipc.js'
import { attachAppHandler, declareAppScheme } from './protocol.js'
import { createWindowsPlatform } from './windows.js'

const here = dirname(fileURLToPath(import.meta.url))   // 运行时是 dist/main

// 协议特权必须在 ready 之前声明，且整个进程只声明一次。
declareAppScheme()
// 硬件加速保持开启（全局约束，spike 已验过整屏透明 + 硬件加速成立）。这里只补一条：
// 无人交互时也要能自动播放，否则宠物上台就是静音静止的一帧。
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

void app.whenReady().then(() => {
  attachAppHandler({
    // 页面在 dist/renderer、模块在 dist/shared，两者都从 assets 根按路径往下走，
    // 这样 `../shared/config.js` 这类相对 import 才会留在同一个主机里。
    [APP_HOST]: join(here, '..'),
    [SKIN_HOST]: join(here, '..', '..', 'skins', 'block', SKIN_ANIMATION_DIR),
  })

  const platform = createWindowsPlatform()
  const bridge = createClickThroughBridge(platform, Date.now)
  // 监听必须早于建窗：渲染层首帧就会发消息。
  registerIpc(platform, bridge)
  platform.createWindow()

  // 覆盖层与主屏工作区重合且永不移动，所以原点取一次即可。
  const { x: originX, y: originY } = screen.getPrimaryDisplay().workArea
  startCursorPolling(() => {
    const c = screen.getCursorScreenPoint()
    return { x: c.x - originX, y: c.y - originY }
  }, (p) => platform.sendCursor(p))

  // 兜底心跳：渲染层卡死时由主进程把穿透放开。
  setInterval(() => bridge.sweep(), CURSOR_POLL_MS).unref()
})
