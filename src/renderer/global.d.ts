import type { Point } from '../shared/types.js'
import type { SkinLoadedPayload } from '../shared/ipc.js'
import type { StatsSnapshot } from '../shared/save.js'
import type { Stats } from '../shared/stats.js'
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
      /** 调试面板直接设数值 / 经验，主进程收敛后落盘并广播。 */
      debugStats(patch: { stats?: Partial<Stats>; exp?: number }): void
      setIdentity(patch: { name?: string; gender?: string }): void
      onStats(cb: (s: StatsSnapshot) => void): void
      /** 用户点了「退出桌宠」：渲染层说完 bye 后调它，主进程落盘并 app.quit()。 */
      quitApp(): void
    }
  }
}

export {}
