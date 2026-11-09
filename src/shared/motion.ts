import { CANVAS_W, STAGE_H_CSS, STAGE_SCALE, STAGE_W_CSS } from './config.js'
import type { Box } from './types.js'
import type { Facing, Point, Rect } from './types.js'

/**
 * 自主走动的位移模型。纯逻辑，位置靠每帧 `step(dtMs)` 积分，不靠计时器去对齐动画帧。
 *
 * 脚底对齐是这里最容易搞错的一处：画布 640×360 里脚底在 `feetY`，舞台底边到脚底
 * 还留着一截空白。要让脚底贴住工作区下沿，得把这截减掉，不能拿舞台底边去贴。
 * 同一个道理也用在左右和上边：夹取要按**身体框**算，不是按舞台矩形，
 * 否则角色会被画布的空白边距挡在屏幕边缘之外（见 bodyInset）。
 */

/** 身体框在舞台内的四边空白（CSS 像素）。 */
export type BodyInset = { left: number; right: number; top: number }

export type MotionOptions = {
  /** 可走范围，覆盖层 CSS 坐标（就是主屏工作区）。 */
  bounds: Rect
  /** 速度，CSS 像素/秒。 */
  speedPxPerSec: number
  /** 脚底线到舞台底边的距离（CSS 像素）= (CANVAS_H - feetY) * STAGE_SCALE。 */
  feetOffsetCss: number
  /**
   * 身体框在舞台内的左右上空白。给了它，夹取就按身体贴边——舞台允许部分走出屏幕，
   * 角色才能真的碰到屏幕边缘。不给就是 0，等于按舞台矩形夹（老行为）。
   */
  bodyInset?: BodyInset
  start?: Point
  facing?: Facing
}

export interface Motion {
  pos(): Point
  facing(): Facing
  setFacing(f: Facing): void
  /** 拖拽落点：夹进可走范围，y 也夹，免得被拖出屏幕找不回来。 */
  setPosition(p: Point): Point
  /**
   * 「鲸鲸会飞」专用：**不夹** y，宠物该能飞出屏幕上沿并继续被计数，落地前不回来。
   * 单开一个口子而不是把 `setPosition` 的夹取去掉——拖拽那条仍然必须夹（否则人被丢出屏幕找不回），
   * 两件事的意图相反，共用一个方法只会互相将死。
   */
  setPositionUnclamped(p: Point): Point
  /** 脚底贴住范围下沿。 */
  snapToBottom(): Point
  /** 按时间积分推进一步，撞边界就掉头。 */
  step(dtMs: number): Point
  /**
   * 工作区变了（改分辨率/缩放/旋转/任务栏自动隐藏）：按新范围重算夹取边界，
   * 并**立刻把当前身体夹回新范围**——屏幕缩小时这一下保证宠物不留在看不见的地方。
   */
  setBounds(b: Rect): Point
}

export function createMotion(opts: MotionOptions): Motion {
  const { feetOffsetCss } = opts
  const inset: BodyInset = opts.bodyInset ?? { left: 0, right: 0, top: 0 }
  /**
   * 夹的是身体框的四边，不是舞台矩形：舞台允许部分走出屏幕。
   * 用 `let` 而不是 `const`——工作区在运行中会变，`setBounds` 靠 `fit` 重算这一组边界；
   * 把它们钉死在创建时，就是"启动后不跟屏幕变"的根因。
   */
  let minX = 0
  let maxX = 0
  let bottomY = 0
  let topY = 0
  const fit = (bounds: Rect): void => {
    minX = bounds.x - inset.left
    maxX = Math.max(minX, bounds.x + bounds.w - STAGE_W_CSS + inset.right)
    /** 舞台顶边的允许区间：脚底贴下沿，头顶不超出范围上沿。 */
    bottomY = bounds.y + bounds.h - (STAGE_H_CSS - feetOffsetCss)
    topY = Math.min(bottomY, bounds.y - inset.top)
  }
  fit(opts.bounds)

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
    setPositionUnclamped(p) {
      pos = { ...p }
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
    setBounds(b) {
      fit(b)
      // 重算完立刻把当前身体夹回新范围：屏幕缩小时宠物可能已在旧地面，这一步把它拉回可见区。
      pos = { x: clampX(pos.x), y: clampY(pos.y) }
      return { ...pos }
    },
  }
}

/** 画布脚底线换算到舞台内的 CSS 偏移，供装配层算 feetOffsetCss。 */
export const feetOffsetOf = (canvasFeetY: number, canvasH: number): number =>
  (canvasH - canvasFeetY) * STAGE_SCALE

/** 画布身体框换算成舞台内的四边空白，供装配层算 bodyInset。 */
export const bodyInsetOf = (body: Box): BodyInset => ({
  left: body.x * STAGE_SCALE,
  right: (CANVAS_W - body.x - body.w) * STAGE_SCALE,
  top: body.y * STAGE_SCALE,
})
