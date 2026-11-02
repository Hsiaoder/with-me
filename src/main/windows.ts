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
        webPreferences: {
          preload: join(here, '../preload/index.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
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
    show() {
      up().showInactive()
    },
    hide() {
      up().hide()
    },
  }
}
