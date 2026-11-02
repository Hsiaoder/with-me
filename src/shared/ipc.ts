import type { ClipRef, Point } from './types.js'
import type { SkinErrorPayload, SkinPayload } from './skin.js'

/**
 * IPC 通道名的唯一来源。加一条通道只能改这里，并在 main/ipc.ts 注册、preload 内联、
 * 以及 test/preload-contract.test.ts 里被自动核对。
 */
export const IPC = {
  cursor: 'pet:cursor',                  // main → renderer，Point（覆盖层内坐标）
  skinLoaded: 'pet:skin-loaded',         // main → renderer，LoadedSkin 或 { errors }
  clickThroughRequest: 'pet:click-through', // renderer → main，{ grab }
  focusable: 'pet:focusable',            // renderer → main，boolean
  debugOverlay: 'pet:debug-overlay',     // renderer → main，boolean
  playClip: 'pet:play-clip',             // renderer → main（面板与 e2e 用），ClipRef
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

export type CursorPayload = Point
export type ClickThroughPayload = { grab: boolean }
/** 装载成功给皮肤，失败给逐条错误——两条路都走同一个通道，渲染层不必猜。 */
export type SkinLoadedPayload = SkinPayload | SkinErrorPayload
export type FocusablePayload = boolean
export type DebugOverlayPayload = boolean
export type PlayClipPayload = ClipRef

/** 所有已知通道，供测试穷举核对。 */
export const ALL_CHANNELS: readonly IpcChannel[] = Object.values(IPC)
