import { ipcMain } from 'electron'
import { IPC, type ClickThroughPayload } from '../shared/ipc.js'
import { isVisibility, type Settings } from '../shared/visibility.js'
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

/**
 * 把送来的设置收敛成合法形状：只保留认得的那几项，一项都不认得就返回 null。
 * 返回 Partial 而不是整包——缺的那一项要由调用方按当前存档补齐，
 * 替用户「补」成默认值等于悄悄改掉他另一项设置。
 */
export function toSettings(raw: unknown): Partial<Settings> | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const out: Partial<Settings> = {}
  for (const key of ['onFullscreen', 'onPresentation'] as const) {
    if (isVisibility(r[key])) out[key] = r[key]
  }
  return Object.keys(out).length > 0 ? out : null
}

export function registerIpc(
  platform: Platform,
  bridge: ClickThroughBridge,
  onSettings: (patch: Partial<Settings>) => void,
  onStatEvent: (raw: unknown) => void,
  onIdentity: (raw: unknown) => void,
): void {
  ipcMain.on(IPC.clickThroughRequest, (_e, p: unknown) => {
    const grab = toBool((p as ClickThroughPayload | null | undefined)?.grab)
    bridge.request(grab)
  })
  ipcMain.on(IPC.focusable, (_e, on: unknown) => platform.setFocusable(toBool(on)))
  ipcMain.on(IPC.settings, (_e, s: unknown) => {
    const next = toSettings(s)
    if (next !== null) onSettings(next)
  })
  // 数值与身份的形状校验在持有存档的那一侧（main/stats.ts）做：
  // 它才知道哪些食物真的有效、哪些值写进存档才不会把状态栏弄坏。
  ipcMain.on(IPC.statsEvent, (_e, raw: unknown) => onStatEvent(raw))
  ipcMain.on(IPC.identity, (_e, raw: unknown) => onIdentity(raw))
}
