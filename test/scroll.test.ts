import { describe, it, expect } from 'vitest'
import { clampScroll, maxScroll, pageStep, thumbGeometry } from '../src/shared/scroll.js'

const CONTENT = 716   // 12 项：12×56 + 11×4
const VIEW = 236      // 一屏 4 项：4×56 + 3×4

describe('clampScroll', () => {
  it('夹在 [0, content − viewport]', () => {
    expect(clampScroll(-40, CONTENT, VIEW)).toBe(0)
    expect(clampScroll(99999, CONTENT, VIEW)).toBe(CONTENT - VIEW)
    expect(clampScroll(100, CONTENT, VIEW)).toBe(100)
  })

  it('全部放得下时恒为 0（max 是负数，不能让它变成正数倒着滚）', () => {
    expect(clampScroll(50, 200, VIEW)).toBe(0)
    expect(clampScroll(50, VIEW, VIEW)).toBe(0)
  })

  it('非有限数退回 0，不传染成 NaN', () => {
    expect(clampScroll(Number.NaN, CONTENT, VIEW)).toBe(0)
    expect(clampScroll(Number.POSITIVE_INFINITY, CONTENT, VIEW)).toBe(0)
  })

  it('maxScroll 不早于 0', () => {
    expect(maxScroll(100, VIEW)).toBe(0)
    expect(maxScroll(CONTENT, VIEW)).toBe(480)
  })
})

describe('pageStep', () => {
  it('整屏步进 = 可见格数 ×（格子 + 间距），也就是 240', () => {
    expect(pageStep(4, 56, 4)).toBe(240)
  })

  it('一格都放不下时步进为 0，翻页按钮不该把内容推没', () => {
    expect(pageStep(0, 56, 4)).toBe(0)
  })
})

describe('thumbGeometry', () => {
  it('放得下就返回 null：没有可滚的东西就别画一条假横条', () => {
    expect(thumbGeometry(0, 200, VIEW)).toBeNull()
    expect(thumbGeometry(0, VIEW, VIEW)).toBeNull()
  })

  it('起点在 0，宽度按可见比例', () => {
    const g = thumbGeometry(0, CONTENT, VIEW)
    expect(g?.x).toBe(0)
    expect(g?.w).toBeCloseTo(VIEW * (VIEW / CONTENT), 3)
  })

  it('滚到最右时滑块右沿正好贴轨道右端', () => {
    const g = thumbGeometry(CONTENT - VIEW, CONTENT, VIEW)
    expect((g?.x ?? 0) + (g?.w ?? 0)).toBeCloseTo(VIEW, 3)
  })

  it('中间位置线性对应', () => {
    const half = thumbGeometry((CONTENT - VIEW) / 2, CONTENT, VIEW)
    const track = VIEW - (half?.w ?? 0)
    expect(half?.x).toBeCloseTo(track / 2, 3)
  })

  it('内容极长时滑块也有下限宽度，否则点不到', () => {
    const g = thumbGeometry(0, 100_000, VIEW)
    expect(g?.w).toBeGreaterThanOrEqual(8)
  })
})
