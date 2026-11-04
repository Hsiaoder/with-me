import type { Point } from '../shared/types.js'
import type { SkinLoadedPayload } from '../shared/ipc.js'
import type { StatsSnapshot } from '../shared/save.js'
import type { Settings } from '../shared/visibility.js'

/**
 * preload 暴露的白名单。方法名与参数要手工对齐 src/preload/index.cjs——
 * 那是一份零 import 的 cjs，不能 import 这里的类型（通道名一致性由测试锁定）。
 *
 * 声明成可选：jsdom 里跑面板单测时没有 preload，渲染层要能优雅地什么都不做。
 */
declare global {
  interface Window {
    petBridge?: {
      onCursor(cb: (p: Point) => void): void
      onSkin(cb: (skin: SkinLoadedPayload) => void): void
      requestGrab(grab: boolean): void
      setFocusable(on: boolean): void
      setSettings(s: Settings): void
      onSettings(cb: (s: Settings) => void): void
      /** 上报一次养成动作。给多少由主进程算，渲染层不猜。 */
      statEvent(e: unknown): void
      setIdentity(patch: { name?: string; gender?: string }): void
      onStats(cb: (s: StatsSnapshot) => void): void
    }
  }
}

export {}
