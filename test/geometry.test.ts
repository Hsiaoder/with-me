import { describe, it, expect } from 'vitest'
import { anyContains, bodyRect, stageRect } from '../src/shared/geometry.js'
import { CANVAS_H, CANVAS_W, STAGE_H_CSS, STAGE_W_CSS } from '../src/shared/config.js'

const box = { x: 200, y: 50, w: 240, h: 285 }
const pos = { x: 400, y: 300 }   // 舞台左上角（覆盖层 CSS 坐标）
const sx = STAGE_W_CSS / CANVAS_W
const sy = STAGE_H_CSS / CANVAS_H

describe('stageRect', () => {
  it('舞台就是画框本身，位置由宠物决定', () => {
    expect(stageRect(pos)).toEqual({ x: 400, y: 300, w: STAGE_W_CSS, h: STAGE_H_CSS })
  })
  it('舞台保持 16:9，高度由宽度推导', () => {
    expect(CANVAS_W / CANVAS_H).toBeCloseTo(STAGE_W_CSS / STAGE_H_CSS, 9)
  })
})

describe('bodyRect', () => {
  it('画布身体框按缩放换算到覆盖层', () => {
    const r = bodyRect({ bodyBox: box }, pos)
    expect(r.x).toBeCloseTo(400 + 200 * sx, 6)
    expect(r.y).toBeCloseTo(300 + 50 * sy, 6)
    expect(r.w).toBeCloseTo(240 * sx, 6)
    expect(r.h).toBeCloseTo(285 * sy, 6)
  })

  it('占满画布的框换算后就是舞台', () => {
    expect(bodyRect({ bodyBox: { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H } }, pos)).toEqual(stageRect(pos))
  })

  it('单条动画可覆盖身体框（趴下时压扁）', () => {
    const r = bodyRect({ bodyBox: box }, pos, { x: 100, y: 200, w: 400, h: 100 })
    expect(r.x).toBeCloseTo(400 + 100 * sx, 6)
    expect(r.w).toBeCloseTo(400 * sx, 6)
    expect(r.h).toBeCloseTo(100 * sy, 6)
  })

  it('宠物移到舞台右下角时，身体框跟着走', () => {
    const moved = bodyRect({ bodyBox: box }, { x: 0, y: 0 })
    const back = bodyRect({ bodyBox: box }, pos)
    expect(back.x - moved.x).toBe(400)
    expect(back.y - moved.y).toBe(300)
  })
})

describe('anyContains', () => {
  const rects = [{ x: 0, y: 0, w: 10, h: 10 }, { x: 100, y: 100, w: 50, h: 20 }]

  it('身体 ∪ 面板 任一命中即为真', () => {
    expect(anyContains(rects, { x: 5, y: 5 })).toBe(true)
    expect(anyContains(rects, { x: 120, y: 110 })).toBe(true)
    expect(anyContains(rects, { x: 50, y: 50 })).toBe(false)
  })

  it('空集合恒为假，不能因为没框就当成命中', () => {
    expect(anyContains([], { x: 1, y: 1 })).toBe(false)
  })

  it('边界点算命中，含右下角', () => {
    expect(anyContains(rects, { x: 0, y: 0 })).toBe(true)
    expect(anyContains(rects, { x: 10, y: 10 })).toBe(true)
  })
})
