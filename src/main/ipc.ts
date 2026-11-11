import { ipcMain } from 'electron'
import { IPC, type ClickThroughPayload } from '../shared/ipc.js'
import { isVisibility, type Settings } from '../shared/visibility.js'
import type { Platform } from './platform.js'
import type { ClickThroughBridge } from './clickthrough.js'

/**
 * 注册主进程侧的监听。必须在建窗之前调用：渲染层在首帧就会发消息，
 * 挂晚了那条消息直接丢且不报错（spike 实测踩过，见 spike/README.md）。
 *
 * 每条通道都先验 sender 是不是宠物那扇窗（见 Platform.ownsSender），再按各自形状收敛入参。
 * 命中区可视化、点歌仍由渲染层本地做，不过 IPC。
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
  if (isVisibility(r.onFullscreen)) out.onFullscreen = r.onFullscreen
  for (const key of ['developerMode', 'muted'] as const) {
    if (typeof r[key] === 'boolean') out[key] = r[key]
  }
  return Object.keys(out).length > 0 ? out : null
}

export function registerIpc(
  platform: Platform,
  bridge: ClickThroughBridge,
  onSettings: (patch: Partial<Settings>) => void,
  onStatEvent: (raw: unknown) => void,
  onIdentity: (raw: unknown) => void,
  onQuit: () => void,
  onStatsDebug: (raw: unknown) => void,
): void {
  // 每条 renderer→main 消息都先验来源是不是宠物那扇窗，再走业务。见 Platform.ownsSender。
  const fromPet = (senderId: number): boolean => platform.ownsSender(senderId)
  ipcMain.on(IPC.clickThroughRequest, (e, p: unknown) => {
    if (!fromPet(e.sender.id)) return
    const grab = toBool((p as ClickThroughPayload | null | undefined)?.grab)
    bridge.request(grab)
  })
  ipcMain.on(IPC.settings, (e, s: unknown) => {
    if (!fromPet(e.sender.id)) return
    const next = toSettings(s)
    if (next !== null) onSettings(next)
  })
  // 数值与身份的形状校验在持有存档的那一侧（main/stats.ts）做：
  // 它才知道哪些食物真的有效、哪些值写进存档才不会把状态栏弄坏。
  ipcMain.on(IPC.statsEvent, (e, raw: unknown) => {
    if (!fromPet(e.sender.id)) return
    onStatEvent(raw)
  })
  // 调试面板直接设数值/经验：来源验过，权限（开发者模式）在 onStatsDebug 那一侧按存档判。
  ipcMain.on(IPC.statsDebug, (e, raw: unknown) => {
    if (!fromPet(e.sender.id)) return
    onStatsDebug(raw)
  })
  ipcMain.on(IPC.identity, (e, raw: unknown) => {
    if (!fromPet(e.sender.id)) return
    onIdentity(raw)
  })
  // 用户点了「退出桌宠」——渲染层已经先说过 bye，这条就是让它落盘并收窗。
  ipcMain.on(IPC.quit, (e) => {
    if (!fromPet(e.sender.id)) return
    onQuit()
  })
}
