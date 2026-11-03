import { BrowserWindow, screen } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_ORIGIN } from '../shared/config.js'
import { IPC } from '../shared/ipc.js'
import type { Point } from '../shared/types.js'
import type { Platform } from './platform.js'

const here = dirname(fileURLToPath(import.meta.url))   // 运行时是 dist/main

/**
 * Windows 实现。整屏覆盖窗：透明 + 置顶 + 穿透，尺寸取一次主屏工作区后永不改变。
 * 「永不改大小」是这套架构的关键——窗口改尺寸是这个品类里故障最多的一件事。
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
    windowHandle() {
      const h = up().getNativeWindowHandle()
      // 64 位系统句柄是 8 字节；按实际长度读，免得在 32 位上越界抛错
      return (h.byteLength >= 8 ? h.readBigUInt64LE() : BigInt(h.readUInt32LE(0))).toString()
    },
    show() {
      up().showInactive()
    },
    hide() {
      up().hide()
    },
  }
}
