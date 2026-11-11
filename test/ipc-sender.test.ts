import { describe, it, expect, vi } from 'vitest'

/**
 * IPC sender 校验：renderer→main 每条通道必须只认宠物那扇窗发来的消息。
 * 现在只有一扇窗，但改档 / 抢焦点 / 退进程这些高权限动作一旦对任意 webContents 敞开，
 * 将来多个窗口或一次 renderer 注入就会直接踩穿。这里用假 ipcMain 抓住注册的监听，
 * 分别喂「宠物窗口 id」和「别的 id」，验只有前者放行。
 */

// 必须在 import ipc.js 之前 mock 掉 electron，否则 ipcMain 是真 Electron 的。
const listeners = new Map<string, (e: unknown, ...a: unknown[]) => void>()
vi.mock('electron', () => ({
  ipcMain: { on: (ch: string, cb: (e: unknown, ...a: unknown[]) => void) => listeners.set(ch, cb) },
}))

const { registerIpc } = await import('../src/main/ipc.js')
const { IPC } = await import('../src/shared/ipc.js')

const PET_ID = 1
const OTHER_ID = 99

function wire() {
  const calls = { settings: 0, stat: 0, identity: 0, quit: 0, debug: 0, grab: 0 }
  const platform = {
    ownsSender: (id: number) => id === PET_ID,
  }
  const bridge = { request: () => { calls.grab++ } }
  registerIpc(
    platform as never,
    bridge as never,
    () => { calls.settings++ },
    () => { calls.stat++ },
    () => { calls.identity++ },
    () => { calls.quit++ },
    () => { calls.debug++ },
  )
  return calls
}

const fire = (ch: string, senderId: number, payload?: unknown): void => {
  listeners.get(ch)?.({ sender: { id: senderId } }, payload)
}

describe('IPC sender 校验', () => {
  it('每个通道都注册上了', () => {
    wire()
    for (const ch of [IPC.clickThroughRequest, IPC.settings, IPC.statsEvent, IPC.statsDebug, IPC.identity, IPC.quit]) {
      expect(listeners.has(ch), ch).toBe(true)
    }
  })

  it('宠物窗发的每条都放行', () => {
    const c = wire()
    fire(IPC.clickThroughRequest, PET_ID, { grab: true })
    fire(IPC.settings, PET_ID, { onFullscreen: 'hide' })
    fire(IPC.statsEvent, PET_ID, { kind: 'feed', food: 'rice' })
    fire(IPC.statsDebug, PET_ID, { stats: { hunger: 5 } })
    fire(IPC.identity, PET_ID, { gender: 'female' })
    fire(IPC.quit, PET_ID)
    expect(c).toEqual({ settings: 1, stat: 1, identity: 1, quit: 1, debug: 1, grab: 1 })
  })

  it('别的 webContents 发的每一条都被丢掉（改档 / 调试 / 退出全挡）', () => {
    const c = wire()
    fire(IPC.clickThroughRequest, OTHER_ID, { grab: true })
    fire(IPC.settings, OTHER_ID, { onFullscreen: 'hide' })
    fire(IPC.statsEvent, OTHER_ID, { kind: 'feed', food: 'rice' })
    fire(IPC.statsDebug, OTHER_ID, { stats: { hunger: 5 } })
    fire(IPC.identity, OTHER_ID, { gender: 'female' })
    fire(IPC.quit, OTHER_ID)
    expect(Object.values(c).every((n) => n === 0)).toBe(true)
  })
})
