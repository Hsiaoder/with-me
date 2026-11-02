import { describe, it, expect } from 'vitest'
import { createMotion, feetOffsetOf } from '../src/shared/motion.js'
import { CANVAS_H, FEET_Y, STAGE_H_CSS, STAGE_SCALE, STAGE_W_CSS } from '../src/shared/config.js'

const bounds = { x: 0, y: 0, w: 1000, h: 600 }
const feetOffset = feetOffsetOf(FEET_Y, CANVAS_H)          // (360-330)*0.5 = 15
const bottomY = bounds.h - (STAGE_H_CSS - feetOffset)      // 舞台顶边

const make = (over = {}) =>
  createMotion({ bounds, speedPxPerSec: 100, feetOffsetCss: feetOffset, start: { x: 100, y: bottomY }, ...over })

describe('脚底对齐', () => {
  it('脚底线贴住范围下沿，而不是舞台底边', () => {
    const m = make({ start: { x: 100, y: 0 } })
    m.snapToBottom()
    expect(m.pos().y).toBe(bottomY)
    // 舞台顶边 + 脚底在舞台内的位置 = 范围下沿
    expect(m.pos().y + (STAGE_H_CSS - feetOffset)).toBe(bounds.h)
  })

  it('feetOffsetOf 按画布脚底线上缩放', () => {
    expect(feetOffsetOf(FEET_Y, CANVAS_H)).toBeCloseTo((CANVAS_H - FEET_Y) * STAGE_SCALE, 9)
    expect(feetOffsetOf(CANVAS_H, CANVAS_H)).toBe(0)
  })
})

describe('step 积分', () => {
  it('向右走到右边界停下并转向', () => {
    const m = make({ start: { x: bounds.w - STAGE_W_CSS - 30, y: bottomY } })
    m.step(500)                                   // +50 → 越界，夹到右限
    expect(m.pos().x).toBe(bounds.w - STAGE_W_CSS)
    expect(m.facing()).toBe('left')
    m.step(500)                                   // 再走就往回
    expect(m.pos().x).toBe(bounds.w - STAGE_W_CSS - 50)
  })

  it('走到左边界转向右', () => {
    const m = make({ start: { x: 30, y: bottomY }, facing: 'left' })
    m.step(500)
    expect(m.pos().x).toBe(0)
    expect(m.facing()).toBe('right')
  })

  it('dt 为 0 或负数不产生位移', () => {
    const m = make()
    m.step(0)
    expect(m.pos().x).toBe(100)
    m.step(-500)
    expect(m.pos().x).toBe(100)
  })

  it('速度为 0 时原地不动', () => {
    const m = make({ speedPxPerSec: 0 })
    m.step(1000)
    expect(m.pos().x).toBe(100)
  })

  it('走路不改变高度', () => {
    const m = make()
    const y = m.pos().y
    m.step(1000)
    expect(m.pos().y).toBe(y)
  })
})

describe('拖拽落点夹取', () => {
  it('拖出右边界时夹回，不会找不回来', () => {
    const m = make()
    const p = m.setPosition({ x: 99999, y: bottomY })
    expect(p.x).toBe(bounds.w - STAGE_W_CSS)
  })

  it('拖到屏幕上方时夹住顶边，拖到下方时脚底贴住下沿', () => {
    const m = make()
    expect(m.setPosition({ x: 100, y: -5000 }).y).toBe(0)
    expect(m.setPosition({ x: 100, y: 99999 }).y).toBe(bottomY)
  })

  it('范围比舞台还窄时右限退化成 0，不产生负宽度区间', () => {
    const m = createMotion({ bounds: { x: 0, y: 0, w: 100, h: 600 }, speedPxPerSec: 100, feetOffsetCss: feetOffset })
    expect(m.setPosition({ x: 500, y: 0 }).x).toBe(0)
  })
})
