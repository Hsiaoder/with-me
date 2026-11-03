import { ipcMain } from 'electron'
import { IPC, type ClickThroughPayload } from '../shared/ipc.js'
import type { Platform } from './platform.js'
import type { ClickThroughBridge } from './clickthrough.js'

/**
 * 注册主进程侧的监听。必须在建窗之前调用：渲染层在首帧就会发消息，
 * 挂晚了那条消息直接丢且不报错（spike 实测踩过，见 spike/README.md）。
 *
 * 只注册真正有行为的两条。命中区可视化由渲染层本地切换（Ctrl+Shift+点），
 * 点歌由渲染层直接调播放器——它们都不需要过 IPC，所以对应的通道没有加：
 * 留一条没人发的通道，比少一条通道更糟。
 */
/**
 * 渲染层送来的值当外部输入看：只认真布尔 `true`，其余一律算关。
 *
 * 不用 `Boolean(x)`：那样字符串 `"false"`、非零数字、任何对象都会变成 true，
 * 一条畸形消息就能把整块屏幕的鼠标接走。
 */
export function toBool(v: unknown): boolean {
  return v === true
}

export function registerIpc(platform: Platform, bridge: ClickThroughBridge): void {
  ipcMain.on(IPC.clickThroughRequest, (_e, p: unknown) => {
    const grab = toBool((p as ClickThroughPayload | null | undefined)?.grab)
    bridge.request(grab)
  })
  ipcMain.on(IPC.focusable, (_e, on: unknown) => platform.setFocusable(toBool(on)))
}
