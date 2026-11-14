import { app, dialog, screen } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_HOST, CURSOR_POLL_MS, SKIN_ANIMATION_DIR, SKIN_HOST } from '../shared/config.js'
import { IPC } from '../shared/ipc.js'
import { toSkinPayload, validateManifest } from '../shared/skin.js'
import { applySettings } from '../shared/save.js'
import { startStats, type StatsSnapshot } from './stats.js'
import { loadFrom, saveTo } from './storage.js'
import { FALLBACK_SKIN, findSkinDir, listSkinDirs, platformDataDir, userSkinsDir } from './paths.js'
import { createClickThroughBridge } from './clickthrough.js'
import { startMediaWatch } from './media.js'
import { startVisibilityWatch, type VisibilityWatch } from './visibility.js'
import { createTrayController, type TrayController } from './tray.js'
import { createSettingsHub, createTrayExit } from './tray-integration.js'
import { installSkinPack, inspectSkinPack } from './skin-import.js'
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

  /**
   * 养成的时钟。它拿的是同一份 save：每次变化就地落盘并广播——
   * 数值丢了比动画错了更疼，所以不能只在退出时写。
   *
   * 广播先接到一个空函数上：`platform.send` 要问窗口要句柄，而离线补算发生在建窗之前。
   * 建窗后换成真的发送；此前那一次并不丢——页面就绪时本来就会推一次快照。
   */
  let statsSink: (snapshot: StatsSnapshot) => void = () => {}
  const stats = startStats({
    save,
    persist: (s) => {
      if (!saveTo(dataDir, s)) console.log('[save] 存档版本比本程序新，跳过写回')
    },
    broadcast: (snapshot) => statsSink(snapshot),
    now: Date.now,
  })

  /**
   * watch 要等建窗之后才起，而渲染层的设置消息首帧就可能到；先放一个安全的空实现，
   * 避免回调里撞上 temporal dead zone。真正的 watch 建好后原地替换。
   */
  let watch: VisibilityWatch = {
    stop() {}, setSettings() {}, hideManually() {}, showManually() {}, reveal: () => false,
  }
  let tray: TrayController | null = null

  /**
   * 设置只有这一条写路径：托盘勾选、渲染层改设置都走它。
   * 顺序见 tray-integration.ts——先改内存，再同步可见性，落盘后回灌渲染层并刷新托盘。
   */
  const updateSettings = createSettingsHub({
    applySettings: (patch) => (save.settings = applySettings(save, patch).settings),
    setVisibility: (s) => watch.setSettings(s),
    persist: () => {
      if (!saveTo(dataDir, save)) console.log('[save] 存档版本比本程序新，跳过写回')
    },
    broadcast: (s) => platform.send(IPC.settingsLoaded, s),
    refreshTray: () => tray?.refresh(),
  })

  // 监听必须早于建窗：渲染层首帧就会发消息。
  registerIpc(platform, bridge, updateSettings, (raw) => stats.event(raw), (raw) => stats.identity(raw), () => app.quit(), (raw) => {
    // 调试改档只在开发者模式开着时接受。设置里关掉只是把按钮藏起来——真正的权限闸在这侧，
    // 否则 renderer 一旦被注入脚本就能绕过界面直接改真实存档。
    if (save.settings.developerMode !== true) return
    stats.debugSet(raw)
  })
  platform.createWindow()
  statsSink = (snapshot) => platform.send(IPC.statsLoaded, snapshot)

  // 装载失败也要发过去：渲染层会把错误摊在屏幕上，而不是静默换一只默认宠物。
  // 挂在 createWindow 之后——onPageReady 要碰 webContents；同一段同步代码里订阅，
  // 不会漏掉 did-finish-load。
  const payload = loaded.ok ? toSkinPayload(loaded.skin, warnings) : { errors: loaded.errors, warnings }
  /** 有没有播放器在放东西。第一拍可能比页面就绪还早，所以缓存一份、就绪时补推。 */
  let mediaPlaying = false
  platform.onPageReady(() => {
    platform.send(IPC.skinLoaded, payload)
    platform.send(IPC.settingsLoaded, save.settings)
    platform.send(IPC.statsLoaded, stats.snapshot())
    platform.send(IPC.media, { playing: mediaPlaying })
  })

  // 可见性策略。探测是个常驻 PowerShell 子进程，必须跟着退出收掉。
  // 只能排在建窗之后：句柄要问窗口要，而 createWindow 之前 up() 会抛。
  watch = startVisibilityWatch(platform, save.settings)

  /**
   * 播放器探测：有音乐在放时，日常动画会偏向「哼歌 / 吹笛 / 拉琴 / 摇摆」那一组
   * （权重在 shared/animation.ts）。和可见性探测一样是常驻子进程，退出必须收掉；
   * 起不来就静默降级——这只是个彩蛋，不该让宠物起不来。
   */
  const mediaWatch = startMediaWatch((playing) => {
    mediaPlaying = playing
    platform.send(IPC.media, { playing })
  })

  /**
   * 托盘放在 watch 之后创建：菜单里的显示/隐藏直接调可见性策略。
   * 图标在开发期从仓库读，打包后从 resources 读（见 electron-builder 的 extraResources）。
   *
   * 按顺序试三个位置，而不是只认 `isPackaged`：想验打包产物时用的那条旁路
   * （dev 的 electron.exe 直接跑 release 里的 app.asar，绕开 Smart App Control）
   * 会让 `isPackaged` 保持 false、`getAppPath()` 又指向 asar 内部——只认一条的话
   * 托盘图标读不到，连「退出」都没有入口，只能去任务管理器杀进程。
   */
  const trayIconPath = [
    join(process.resourcesPath, 'with-me.ico'),
    join(app.getAppPath(), 'assets', 'with-me.ico'),
    // appPath 是 ...\resources\app.asar 时，`..` 正好回到 resources（asar 是文件，path.join 按目录段处理）
    join(app.getAppPath(), '..', 'with-me.ico'),
  ].find((p) => existsSync(p)) ?? join(app.getAppPath(), 'assets', 'with-me.ico')

  /** 托盘里的皮肤菜单：读 manifest 的展示名，坏掉的包按目录名显示但不隐藏。 */
  const listSkins = (): { id: string; name: string }[] => listSkinDirs().map(({ id, dir }) => {
    try {
      const checked = validateManifest(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')))
      return { id, name: checked.ok ? checked.manifest.name : id }
    } catch {
      return { id, name: id }
    }
  })

  /**
   * 换皮肤要在启动时装载，热换会牵动协议、渲染层和整条皮肤缓存，所以保存后直接重启。
   * 先落盘再重启：app.exit 不触发 before-quit，不能指望那里再写一次。
   */
  const applySkinAndRestart = (id: string): void => {
    save.skin = id
    if (!saveTo(dataDir, save)) {
      console.log('[save] 存档版本比本程序新，跳过换皮肤')
      return
    }
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 120)
  }

  const selectSkin = (id: string): void => {
    if (id === save.skin || findSkinDir(id) === null) return
    applySkinAndRestart(id)
  }

  /**
   * 用户自己挑一个皮肤 zip。压缩包先整体校验再落盘，确认框里把包内许可摊给用户看，
   * 导入成功后直接切过去并重启——和托盘里点皮肤同一条路径。
   */
  const importSkin = async (): Promise<void> => {
    const picked = await dialog.showOpenDialog({
      title: '选择皮肤包',
      properties: ['openFile'],
      filters: [{ name: '皮肤包', extensions: ['zip'] }],
    })
    if (picked.canceled || picked.filePaths.length === 0) return

    let zip: Uint8Array
    try {
      zip = readFileSync(picked.filePaths[0]!)
    } catch (e) {
      dialog.showErrorBox('无法读取文件', e instanceof Error ? e.message : String(e))
      return
    }

    const inspected = inspectSkinPack(zip)
    if (!inspected.ok) {
      dialog.showErrorBox('这个皮肤包不能导入', inspected.error)
      return
    }

    const { pack } = inspected
    const terms = [
      pack.attribution ? pack.attribution : '',
      pack.license ? `许可：${pack.license}` : '',
      '第三方皮肤包的条款由作者提供，导入即表示你接受包内许可。'
        + '如果它标记了「禁止商用」，请勿把皮肤用于商业用途。',
    ].filter(Boolean).join('\n\n')

    const confirm = await dialog.showMessageBox({
      type: 'question',
      title: '导入皮肤包',
      message: `导入「${pack.manifest.name}」（id: ${pack.id}）并重启桌宠？`,
      detail: terms.slice(0, 2000),
      buttons: ['取消', '导入并重启'],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    })
    if (confirm.response !== 1) return

    const installed = installSkinPack(zip, userSkinsDir())
    if (!installed.ok) {
      dialog.showErrorBox('导入失败', installed.error)
      return
    }
    applySkinAndRestart(installed.id)
  }
  const trayExit = createTrayExit({
    // 先清手动门控再强制亮出窗口：全屏规则此刻仍说「隐藏」也要让人看见告别。
    reveal: () => { watch.showManually(); watch.reveal() },
    sendQuitRequested: () => platform.send(IPC.quitRequested, null),
    scheduleFallback: (run, ms) => {
      const timer = setTimeout(run, ms)
      timer.unref()
      return timer
    },
    cancelFallback: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    quit: () => app.quit(),
  })
  tray = createTrayController({
    iconPath: trayIconPath,
    getSettings: () => save.settings,
    listSkins,
    getSkin: () => save.skin,
    selectSkin,
    importSkin: () => { void importSkin() },
    show: () => watch.showManually(),
    hide: () => watch.hideManually(),
    updateSettings,
    quit: trayExit.request,
  })

  // 覆盖层与主屏工作区重合。工作区在运行中会变（改分辨率 / 系统缩放 / 旋转 / 任务栏自动隐藏），
  // 所以原点不再"取一次"：refit 重读 workArea，同一件事里既改窗口尺寸又换光标原点，跟着显示器事件走。
  let origin = { x: 0, y: 0 }
  const refit = (): void => {
    const wa = screen.getPrimaryDisplay().workArea
    origin = { x: wa.x, y: wa.y }
    platform.setOverlayBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height })
  }
  // 建窗时已按同一个 workArea 摆好，这一次 refit 的 setBounds 会被 windows 层守卫夹成 no-op；
  // 之后任何一次显示器变化才真的重摆。非主屏变化也会触发 metrics 事件，但 refit 读主屏，无害。
  refit()
  screen.on('display-metrics-changed', refit)
  screen.on('display-added', refit)
  screen.on('display-removed', refit)
  // e2e 可以冻住操作系统光标的影响：只要有人在动鼠标，注入给渲染层的坐标下一拍就被顶掉，
  // 「光标静止满 400ms 自动弹面板」这类检查实际上是在赌这台机器没人碰鼠标。
  // 冻住的只是数据来源，`__petDebug.cursor` 走的还是同一个 handleCursor，逻辑一点没绕开。
  const stopPolling = process.env.PET_FREEZE_CURSOR === '1'
    ? () => {}
    : startCursorPolling(() => {
      const c = screen.getCursorScreenPoint()
      return { x: c.x - origin.x, y: c.y - origin.y }
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
    stats.stop()
    trayExit.cancel()
    tray?.dispose()
    watch.stop()
    mediaWatch.stop()
    try {
      if (!saveTo(dataDir, save)) console.log('[save] 存档版本比本程序新，跳过退出写回')
    } catch (e) {
      // 存档写不进去不该拦住退出，但必须留痕
      console.error('[save] 退出落盘失败：', e)
    }
  })
})
