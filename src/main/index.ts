import { app, screen } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_HOST, CURSOR_POLL_MS, SKIN_ANIMATION_DIR, SKIN_HOST } from '../shared/config.js'
import { IPC } from '../shared/ipc.js'
import { toSkinPayload } from '../shared/skin.js'
import { applySettings } from '../shared/save.js'
import { loadFrom, saveTo } from './storage.js'
import { FALLBACK_SKIN, findSkinDir, platformDataDir } from './paths.js'
import { createClickThroughBridge } from './clickthrough.js'
import { startVisibilityWatch } from './visibility.js'
import { startCursorPolling } from './cursor.js'
import { registerIpc } from './ipc.js'
import { attachAppHandler, declareAppScheme } from './protocol.js'
import { loadSkin } from './skin-store.js'
import { createWindowsPlatform } from './windows.js'

const here = dirname(fileURLToPath(import.meta.url))   // 运行时是 dist/main

/**
 * 存档与用户皮肤的位置。测试要把它挪到临时目录，否则"换皮肤"这条端到端
 * 只能靠手工改真实 %APPDATA%。只允许显式环境变量指定，不给默认值。
 *
 * 必须排在单实例锁之前：锁是按 userData 目录分的，先申请锁就等于
 * 所有测试实例共用一把锁，不同临时目录也照样互相顶掉（复审 #2 实测复现）。
 */
if (process.env.PET_USER_DATA) app.setPath('userData', process.env.PET_USER_DATA)

/**
 * 只允许一个实例。桌宠跑起两份就是屏幕上叠两只宠物，而且都是整屏透明窗，
 * 第二份还会抢着接住鼠标——排查起来非常费劲（开发期真的踩过：调试残留了 9 个实例）。
 * 拿不到锁就退出，并说明原因，不要出现"看起来没启动但桌面上多了一只"。
 */
const gotInstanceLock = app.requestSingleInstanceLock()
if (!gotInstanceLock) {
  console.log('[pet] 已经有一只宠物在跑了，这个实例退出')
  app.quit()
}

// 协议特权必须在 ready 之前声明，且整个进程只声明一次。
declareAppScheme()
// 硬件加速保持开启（全局约束，spike 已验过整屏透明 + 硬件加速成立）。这里只补一条：
// 无人交互时也要能自动播放，否则宠物上台就是静音静止的一帧。
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

void app.whenReady().then(() => {
  // app.quit() 在 ready 之前调用不保证拦住这个回调，所以这里再挡一次
  if (!gotInstanceLock) return

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
  registerIpc(platform, bridge, (patch) => {
    // 改设置要当场落盘：只在退出时写的话，进程被杀就丢，而设置丢了很难查
    save.settings = applySettings(save, patch).settings
    watch.setSettings(save.settings)
    if (!saveTo(dataDir, save)) console.log('[save] 存档版本比本程序新，跳过写回')
  })
  platform.createWindow()

  // 装载失败也要发过去：渲染层会把错误摊在屏幕上，而不是静默换一只默认宠物。
  // 挂在 createWindow 之后——onPageReady 要碰 webContents；同一段同步代码里订阅，
  // 不会漏掉 did-finish-load。
  const payload = loaded.ok ? toSkinPayload(loaded.skin, warnings) : { errors: loaded.errors, warnings }
  platform.onPageReady(() => {
    platform.send(IPC.skinLoaded, payload)
    platform.send(IPC.settingsLoaded, save.settings)
  })

  // 可见性策略。探测是个常驻 PowerShell 子进程，必须跟着退出收掉。
  // 只能排在建窗之后：句柄要问窗口要，而 createWindow 之前 up() 会抛。
  const watch = startVisibilityWatch(platform, save.settings)

  // 覆盖层与主屏工作区重合且永不移动，所以原点取一次即可。
  const { x: originX, y: originY } = screen.getPrimaryDisplay().workArea
  // e2e 可以冻住操作系统光标的影响：只要有人在动鼠标，注入给渲染层的坐标下一拍就被顶掉，
  // 「光标静止满 400ms 自动弹面板」这类检查实际上是在赌这台机器没人碰鼠标。
  // 冻住的只是数据来源，`__petDebug.cursor` 走的还是同一个 handleCursor，逻辑一点没绕开。
  const stopPolling = process.env.PET_FREEZE_CURSOR === '1'
    ? () => {}
    : startCursorPolling(() => {
      const c = screen.getCursorScreenPoint()
      return { x: c.x - originX, y: c.y - originY }
    }, (p) => platform.sendCursor(p))

  // 兜底心跳：渲染层卡死时由主进程把穿透放开。
  const sweeper = setInterval(() => bridge.sweep(), CURSOR_POLL_MS)
  sweeper.unref()

  // 退出前收掉定时器与子进程并落盘。落盘放最后：saveTo 会刷新 lastSeenAt。
  let closing = false
  app.on('before-quit', () => {
    if (closing) return
    closing = true
    stopPolling()
    clearInterval(sweeper)
    watch.stop()
    try {
      if (!saveTo(dataDir, save)) console.log('[save] 存档版本比本程序新，跳过退出写回')
    } catch (e) {
      // 存档写不进去不该拦住退出，但必须留痕
      console.error('[save] 退出落盘失败：', e)
    }
  })
})
