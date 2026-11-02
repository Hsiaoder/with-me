import { ipcMain } from 'electron'
import { IPC, type ClickThroughPayload, type FocusablePayload } from '../shared/ipc.js'
import type { Platform } from './platform.js'
import type { ClickThroughBridge } from './clickthrough.js'

/**
 * 注册主进程侧的监听。必须在建窗之前调用：渲染层在首帧就会发消息，
 * 挂晚了那条消息直接丢且不报错（spike 实测踩过，见 spike/README.md）。
 *
 * debugOverlay 与 playClip 两条通道还没有实现，等第 12、13 节各自的任务再注册。
 */
export function registerIpc(platform: Platform, bridge: ClickThroughBridge): void {
  ipcMain.on(IPC.clickThroughRequest, (_e, p: ClickThroughPayload) => bridge.request(p.grab))
  ipcMain.on(IPC.focusable, (_e, on: FocusablePayload) => platform.setFocusable(on))
}
