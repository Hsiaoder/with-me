import { STAGE_H_CSS, STAGE_SCALE, STAGE_W_CSS } from './config.js'
import type { Facing, Point, Rect } from './types.js'

/**
 * 自主走动的位移模型。纯逻辑，位置靠每帧 `step(dtMs)` 积分，不靠计时器去对齐动画帧。
 *
 * 脚底对齐是这里最容易搞错的一处：画布 640×360 里脚底在 `feetY`，舞台底边到脚底
 * 还留着一截空白。要让脚底贴住工作区下沿，得把这截减掉，不能拿舞台底边去贴。
 */

export type MotionOptions = {
  /** 可走范围，覆盖层 CSS 坐标（就是主屏工作区）。 */
  bounds: Rect
  /** 速度，CSS 像素/秒。 */
  speedPxPerSec: number
  /** 脚底线到舞台底边的距离（CSS 像素）= (CANVAS_H - feetY) * STAGE_SCALE。 */
  feetOffsetCss: number
  start?: Point
  facing?: Facing
}

export interface Motion {
  pos(): Point
  facing(): Facing
  setFacing(f: Facing): void
  /** 拖拽落点：夹进可走范围，y 也夹，免得被拖出屏幕找不回来。 */
  setPosition(p: Point): Point
  /** 脚底贴住范围下沿。 */
  snapToBottom(): Point
  /** 按时间积分推进一步，撞边界就掉头。 */
  step(dtMs: number): Point
}

export function createMotion(opts: MotionOptions): Motion {
  const { bounds, feetOffsetCss } = opts
  const minX = bounds.x
  const maxX = Math.max(bounds.x, bounds.x + bounds.w - STAGE_W_CSS)
  /** 舞台顶边的允许区间：脚底贴下沿，头顶不超出范围上沿。 */
  const bottomY = bounds.y + bounds.h - (STAGE_H_CSS - feetOffsetCss)
  const topY = Math.min(bottomY, bounds.y)

  let pos: Point = { ...opts.start ?? { x: minX, y: bottomY } }
  let facing: Facing = opts.facing ?? 'right'

  const clampY = (y: number): number => Math.min(bottomY, Math.max(topY, y))
  const clampX = (x: number): number => Math.min(maxX, Math.max(minX, x))

  return {
    pos: () => ({ ...pos }),
    facing: () => facing,
    setFacing(f) {
      facing = f
    },
    setPosition(p) {
      pos = { x: clampX(p.x), y: clampY(p.y) }
      return { ...pos }
    },
    snapToBottom() {
      pos = { ...pos, y: bottomY }
      return { ...pos }
    },
    step(dtMs) {
      if (dtMs <= 0 || opts.speedPxPerSec <= 0) return { ...pos }
      const d = (opts.speedPxPerSec * dtMs) / 1000
      let nx = pos.x + (facing === 'right' ? d : -d)
      if (nx >= maxX) {
        nx = maxX
        facing = 'left'
      } else if (nx <= minX) {
        nx = minX
        facing = 'right'
      }
      pos = { ...pos, x: nx }
      return { ...pos }
    },
  }
}

/** 画布脚底线换算到舞台内的 CSS 偏移，供装配层算 feetOffsetCss。 */
export const feetOffsetOf = (canvasFeetY: number, canvasH: number): number =>
  (canvasH - canvasFeetY) * STAGE_SCALE
