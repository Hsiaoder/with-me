import { app, screen } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_HOST, CURSOR_POLL_MS, SKIN_ANIMATION_DIR, SKIN_HOST } from '../shared/config.js'
import { IPC } from '../shared/ipc.js'
import { toSkinPayload } from '../shared/skin.js'
import { loadFrom, saveTo } from './storage.js'
import { FALLBACK_SKIN, findSkinDir, platformDataDir } from './paths.js'
import { createClickThroughBridge } from './clickthrough.js'
import { startFullscreenWatch } from './fullscreen.js'
import { startCursorPolling } from './cursor.js'
import { registerIpc } from './ipc.js'
import { attachAppHandler, declareAppScheme } from './protocol.js'
import { loadSkin } from './skin-store.js'
import { createWindowsPlatform } from './windows.js'

const here = dirname(fileURLToPath(import.meta.url))   // 运行时是 dist/main

/**
 * 存档与用户皮肤的位置。测试要把它挪到临时目录，否则"换皮肤"这条端到端
 * 只能靠手工改真实 %APPDATA%。只允许显式环境变量指定，不给默认值。
 */
if (process.env.PET_USER_DATA) app.setPath('userData', process.env.PET_USER_DATA)

// 协议特权必须在 ready 之前声明，且整个进程只声明一次。
declareAppScheme()
// 硬件加速保持开启（全局约束，spike 已验过整屏透明 + 硬件加速成立）。这里只补一条：
// 无人交互时也要能自动播放，否则宠物上台就是静音静止的一帧。
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

void app.whenReady().then(() => {
  const dataDir = platformDataDir()
  const save = loadFrom(dataDir)
  const warnings = [...save.warnings]

  // 用哪个皮肤来自存档。找不到时不静默换：记一条警告发给渲染层显示。
  let skinDir = findSkinDir(save.skin)
  if (!skinDir) {
    warnings.push(`找不到皮肤「${save.skin}」，改用内置的 ${FALLBACK_SKIN}`)
    skinDir = findSkinDir(FALLBACK_SKIN) ?? join(here, '..', '..', 'skins', FALLBACK_SKIN)
  }

  const loaded = loadSkin(skinDir)
  attachAppHandler({
    // 页面在 dist/renderer、模块在 dist/shared，都从 assets 根按路径往下走，
    // 这样 `../shared/config.js` 这类相对 import 才会留在同一个主机里。
    [APP_HOST]: join(here, '..'),
    [SKIN_HOST]: join(loaded.ok ? loaded.skin.dir : skinDir, SKIN_ANIMATION_DIR),
  })

  const platform = createWindowsPlatform()
  const bridge = createClickThroughBridge(platform, Date.now)
  // 监听必须早于建窗：渲染层首帧就会发消息。
  registerIpc(platform, bridge)
  platform.createWindow()

  // 装载失败也要发过去：渲染层会把错误摊在屏幕上，而不是静默换一只默认宠物。
  // 挂在 createWindow 之后——onPageReady 要碰 webContents；同一段同步代码里订阅，
  // 不会漏掉 did-finish-load。
  const payload = loaded.ok ? toSkinPayload(loaded.skin, warnings) : { errors: loaded.errors, warnings }
  platform.onPageReady(() => platform.send(IPC.skinLoaded, payload))

  // 覆盖层与主屏工作区重合且永不移动，所以原点取一次即可。
  const { x: originX, y: originY } = screen.getPrimaryDisplay().workArea
  const stopPolling = startCursorPolling(() => {
    const c = screen.getCursorScreenPoint()
    return { x: c.x - originX, y: c.y - originY }
  }, (p) => platform.sendCursor(p))

  // 兜底心跳：渲染层卡死时由主进程把穿透放开。
  const sweeper = setInterval(() => bridge.sweep(), CURSOR_POLL_MS)
  sweeper.unref()

  // 全屏应用让路。探测是个常驻 PowerShell 子进程，必须跟着退出收掉。
  const stopWatch = startFullscreenWatch(platform, platform.windowHandle())

  // 退出前收掉定时器与子进程并落盘。落盘放最后：saveTo 会刷新 lastSeenAt。
  let closing = false
  app.on('before-quit', () => {
    if (closing) return
    closing = true
    stopPolling()
    clearInterval(sweeper)
    stopWatch()
    try {
      saveTo(dataDir, save)
    } catch (e) {
      // 存档写不进去不该拦住退出，但必须留痕
      console.error('[save] 退出落盘失败：', e)
    }
  })
})
