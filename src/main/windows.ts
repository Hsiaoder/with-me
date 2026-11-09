import { BrowserWindow, screen } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_ORIGIN } from '../shared/config.js'
import { IPC } from '../shared/ipc.js'
import type { Point } from '../shared/types.js'
import type { Platform } from './platform.js'

const here = dirname(fileURLToPath(import.meta.url))   // 运行时是 dist/main

/**
 * Windows 实现。整屏覆盖窗：透明 + 置顶 + 穿透，尺寸跟主屏工作区走。
 * 平时**从不改大小**（窗口改尺寸是这个品类里故障最多的一件事），只有显示器工作区真的变了
 * （改分辨率 / 缩放 / 旋转 / 任务栏自动隐藏）才由 `setOverlayBounds` 重摆一次，且带守卫防抖。
 */
export function createWindowsPlatform(): Platform {
  let win: BrowserWindow | null = null

  const up = (): BrowserWindow => {
    if (!win) throw new Error('窗口还没建：先调 createWindow()')
    return win
  }

  return {
    createWindow() {
      win = new BrowserWindow({
        ...screen.getPrimaryDisplay().workArea,
        show: false,
        frame: false,
        transparent: true,
        hasShadow: false,
        resizable: false,
        movable: false,
        focusable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        // WS_EX_TOOLWINDOW。Chromium 类应用（浏览器、抖音这些）会把一个工作区尺寸的大窗
        // 算成"把我盖住了"，一旦我们取消穿透（鼠标落在宠物上）它们就停止绘制，
        // 观感就是别的软件卡住一下、要再点一下才醒。工具窗不参与这个判定，
        // 顺带也不进 Alt+Tab 列表。参考实现 qqpet 同样带这一位并注明了这个坑。
        ...(process.platform === 'win32' && { type: 'toolbar' }),
        webPreferences: {
          preload: join(here, '../preload/index.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      })
      win.setAlwaysOnTop(true, 'screen-saver')
      win.setIgnoreMouseEvents(true)
      win.once('ready-to-show', () => win?.showInactive())
      // 宠物页永不跳转：素材里的链接不许把整扇窗换掉
      win.webContents.on('will-navigate', (e) => e.preventDefault())
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      // 不能走 file://：Chromium 不许它 import ES 模块，也会把带 alpha 的 webm 当跨源素材
      void win.loadURL(`${APP_ORIGIN}renderer/index.html`)
    },
    setInteractive(on) {
      up().setIgnoreMouseEvents(!on)
    },
    sendCursor(p: Point) {
      up().webContents.send(IPC.cursor, p)
    },
    setFocusable(on) {
      up().setFocusable(on)
    },
    onPageReady(cb) {
      up().webContents.once('did-finish-load', cb)
    },
    send(channel, payload) {
      up().webContents.send(channel, payload)
    },
    show() {
      const w = up()
      w.showInactive()
      // hide() 之后重新显示会把窗口重新插进 z 序：WS_EX_TOPMOST 的样式位还在，
      // 但排位可能落回普通带，于是宠物被普通窗口盖住。实测过一次，之后一直不复现，
      // 所以这条是便宜的兜底而不是已证实的病因解药——重新声明一次置顶，幂等。
      w.setAlwaysOnTop(true, 'screen-saver')
    },
    hide() {
      up().hide()
    },
    setOverlayBounds(b) {
      const w = up()
      // 守卫：display-metrics-changed 会为同一个显示器连发多次，且非主屏变化也会触发回调。
      // 尺寸没真的变就直接返回——无脑 setBounds 正是这套架构最怕的"改尺寸抖动"。
      const cur = w.getBounds()
      if (cur.x === b.x && cur.y === b.y && cur.width === b.width && cur.height === b.height) return
      w.setBounds(b)
      // setBounds 会把窗口重新插回 z 序（和 hide→show 同一个坑，见 show()），重新声明一次置顶，幂等。
      w.setAlwaysOnTop(true, 'screen-saver')
    },
  }
}
