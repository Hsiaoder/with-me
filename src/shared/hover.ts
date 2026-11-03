import { HOVER_DWELL_MS, HOVER_RELEASE_MS } from './config.js'
import type { Point } from './types.js'

/**
 * 悬停计时：停留满 HOVER_DWELL_MS 才 open，离开身体与面板满 HOVER_RELEASE_MS 才 close。
 *
 * 为什么要两个方向的延时：路过就弹会闪，一走就收会让用户点不到按钮。
 * 面板算「还在宠物上」——光标从宠物挪到面板这几像素不该把面板收掉。
 *
 * 纯函数：时钟由调用方注入，测试里不睡等真实时间。
 */

export type HoverEvent = 'open' | 'close' | 'none'

export interface HoverTimer {
  readonly isOpen: boolean
  /** 每次光标移动调用一次（主进程 33ms 推进来）。 */
  onPoint(p: Point, overBody: boolean, overPanel: boolean): HoverEvent
  /**
   * 离下一次自动开/关还剩多少毫秒；没有挂起的转换返回 null。
   *
   * 主进程对相同坐标去重，手真的停住不动时不会再有 onPoint 进来。
   * 调用方拿这个值挂一个 setTimeout，到点用最后那个坐标再喂一次 onPoint，
   * 「悬停 400ms 弹面板」才是计时到点自动发生，而不是靠用户再动一下鼠标。
   */
  pendingMs(now: number): number | null
  /** 皮肤切换、宠物被拖走等场景要重置，否则面板挂在旧位置。 */
  reset(): void
}

export function createHoverTimer(now: () => number): HoverTimer {
  let enteredAt: number | null = null
  let leftAt: number | null = null
  let open = false

  return {
    get isOpen() {
      return open
    },
    onPoint(_p: Point, overBody: boolean, overPanel: boolean): HoverEvent {
      const inside = overBody || overPanel
      if (inside) {
        leftAt = null
        if (open) return 'none'
        enteredAt ??= now()
        if (now() - enteredAt < HOVER_DWELL_MS) return 'none'
        open = true
        enteredAt = null
        return 'open'
      }

      enteredAt = null
      if (!open) return 'none'
      leftAt ??= now()
      if (now() - leftAt < HOVER_RELEASE_MS) return 'none'
      open = false
      leftAt = null
      return 'close'
    },
    reset() {
      enteredAt = null
      leftAt = null
      open = false
    },
    pendingMs(now: number): number | null {
      if (!open && enteredAt !== null) return Math.max(0, HOVER_DWELL_MS - (now - enteredAt))
      if (open && leftAt !== null) return Math.max(0, HOVER_RELEASE_MS - (now - leftAt))
      return null
    },
  }
}
