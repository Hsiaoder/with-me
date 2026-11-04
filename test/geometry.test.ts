import { describe, it, expect } from 'vitest'
import { anyContains, bodyRect, bubbleAnchor, panelAnchor, stageRect, unionRect } from '../src/shared/geometry.js'
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

describe('panelAnchor', () => {
  const screen = { x: 0, y: 0, w: 1600, h: 952 }
  const size = { w: 300, h: 40 }
  const body = { x: 500, y: 400, w: 120, h: 142 }

  // 对齐 qqpet：按钮条默认跟在脚底下，脚下没地方才翻到头顶。
  // 横向以角色的对称轴（身体框中线）为轴居中，不是贴着身体左沿——
  // 画布左右各有大片空白，贴左沿会让整排按钮明显偏左。
  it('默认摆在脚底下，留出一条 gap，并以身体中线居中', () => {
    expect(panelAnchor(body, size, screen, 16)).toEqual({ x: 560 - 150, y: 400 + 142 + 16 })
  })

  it('脚底下放不下（宠物站在地上）就翻到头顶', () => {
    const low = { ...body, y: 760 }
    expect(panelAnchor(low, size, screen, 16).y).toBe(760 - 40 - 16)
  })

  it('身体靠近右边缘时横向夹回屏幕内，不让按钮溢出到看不见的地方', () => {
    const right = { ...body, x: 1500 }
    expect(panelAnchor(right, size, screen, 16).x).toBe(1600 - 300)
  })

  it('身体靠近左边缘时不出现负坐标', () => {
    expect(panelAnchor({ ...body, x: -50 }, size, screen, 16).x).toBe(0)
  })

  it('上下都放不下时夹在屏幕内，不跑到负坐标', () => {
    const p = panelAnchor({ x: 10, y: 20, w: 100, h: 930 }, size, screen, 16)
    expect(p.y).toBe(0)
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

describe('unionRect', () => {
  const body = { x: 100, y: 200, w: 120, h: 140 }

  it('b 为 null 时退回只剩 a：面板收起，区域不该把看不见的地方也圈进来', () => {
    expect(unionRect(body, null)).toEqual(body)
  })

  it('取外接矩形，中间那段空隙也算在内', () => {
    // 面板在头顶，和身体之间隔着 10px 空隙。并集是两块不连通的矩形，
    // 光标要连续就得用外接矩形把空隙一起圈进来。
    const panel = { x: 90, y: 150, w: 160, h: 40 }
    expect(unionRect(body, panel)).toEqual({ x: 90, y: 150, w: 160, h: 190 })
  })

  it('谁在外面就取谁的边，四个方向都算', () => {
    const below = { x: 110, y: 350, w: 40, h: 20 }
    expect(unionRect(body, below)).toEqual({ x: 100, y: 200, w: 120, h: 170 })
    const left = { x: 60, y: 250, w: 20, h: 20 }
    expect(unionRect(body, left)).toEqual({ x: 60, y: 200, w: 160, h: 140 })
  })

  it('完全包含时不放大', () => {
    const inner = { x: 120, y: 220, w: 20, h: 20 }
    expect(unionRect(body, inner)).toEqual(body)
  })
})

describe('bubbleAnchor', () => {
  const screen = { x: 0, y: 0, w: 1600, h: 952 }
  const body = { x: 700, y: 700, w: 140, h: 180 }
  const size = { w: 128, h: 152 }

  it('没有面板时贴在身体上方，横向按身体对称轴居中', () => {
    expect(bubbleAnchor(body, null, size, screen, 12)).toEqual({ x: 706, y: 536 })
  })

  it('面板在头顶时接在面板外侧，而不是压在面板身上', () => {
    const panel = { x: 690, y: 650, w: 160, h: 34 }        // 底边 684 ≤ 身体顶 700 → 在头顶
    expect(bubbleAnchor(body, panel, size, screen, 12)).toEqual({ x: 706, y: 486 })
  })

  it('面板在脚下时气泡仍直接接在身体上方（永远在宠物上面）', () => {
    const panel = { x: 690, y: 890, w: 160, h: 34 }
    expect(bubbleAnchor(body, panel, size, screen, 12)).toEqual({ x: 706, y: 536 })
  })

  it('头顶空间不足时贴住屏幕顶，绝不翻到宠物下面', () => {
    const high = { x: 700, y: 100, w: 140, h: 180 }
    expect(bubbleAnchor(high, null, size, screen, 12)).toEqual({ x: 706, y: 0 })
  })

  it('横向夹回屏幕内。用窄身体测：气泡 128 比正常身体 140 还窄，宽身体贴边时中心必然越不出屏幕，夹取根本不生效', () => {
    const left = { x: 10, y: 700, w: 20, h: 180 }
    expect(bubbleAnchor(left, null, size, screen, 12).x).toBe(0)
    const right = { x: 1560, y: 700, w: 20, h: 180 }
    expect(bubbleAnchor(right, null, size, screen, 12).x).toBe(1600 - 128)
  })
})

describe('unionRect 可变参数', () => {
  const a = { x: 100, y: 200, w: 120, h: 140 }

  it('可以一次圈进三块，null 忽略', () => {
    const panel = { x: 90, y: 160, w: 160, h: 34 }
    const bubble = { x: 100, y: 8, w: 128, h: 152 }
    expect(unionRect(a, panel, bubble)).toEqual({ x: 90, y: 8, w: 160, h: 332 })
    expect(unionRect(a, null, bubble)).toEqual({ x: 100, y: 8, w: 128, h: 332 })
  })

  it('顺序无关', () => {
    const p = { x: 90, y: 160, w: 160, h: 34 }
    expect(unionRect(a, p)).toEqual(unionRect(a, null, p, null))
  })
})
