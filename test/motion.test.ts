import { describe, it, expect } from 'vitest'
import { bodyInsetOf, createMotion, feetOffsetOf } from '../src/shared/motion.js'
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

describe('不夹取的落点（setPositionUnclamped）', () => {
  /**
   * 「鲸鲸会飞」要的正是能抛出屏幕：这条存在的意义就是和上面「拖拽落点夹取」对照——
   * 同一个 y，setPosition 夹回 0，setPositionUnclamped 原样交出去。哪天有人手滑让游戏改走
   * setPosition，宠物就被夹在顶边飞不出去（真出过的 bug），这条会先红。
   */
  it('y 越屏幕上沿时原样交出，不像 setPosition 那样夹回 0', () => {
    const m = make()
    expect(m.setPosition({ x: 100, y: -5000 }).y).toBe(0)            // 拖拽那条：夹住
    expect(m.setPositionUnclamped({ x: 100, y: -5000 }).y).toBe(-5000)  // 游戏那条：放行
    expect(m.pos().y).toBe(-5000)
  })
})

describe('按身体框夹取（bodyInset）', () => {
  /**
   * 画布 640 宽里角色只占中间一段，左右各有大片空白。以前夹的是舞台矩形，
   * 于是角色永远碰不到屏幕左右边缘——差的就是那截空白（实测约 95 CSS 像素）。
   * 传了 bodyInset 之后，夹取按角色实际占位算，身体能贴住屏幕边。
   */
  const inset = { left: 95, right: 92, top: 10 }
  const make2 = (over = {}) => make({ bodyInset: inset, ...over })

  it('往左拖到底时，身体左沿贴住屏幕左边（舞台可以走出屏幕）', () => {
    const m = make2()
    expect(m.setPosition({ x: -500, y: 100 }).x).toBe(-inset.left)
  })

  it('往右拖到底时，身体右沿贴住屏幕右边', () => {
    const m = make2()
    const x = m.setPosition({ x: 5000, y: 100 }).x
    expect(x).toBe(bounds.w - STAGE_W_CSS + inset.right)
    expect(x + STAGE_W_CSS - inset.right).toBe(bounds.w)
  })

  it('往上拖时头顶可以贴住屏幕上沿', () => {
    const m = make2()
    expect(m.setPosition({ x: 100, y: -500 }).y).toBe(-inset.top)
  })

  it('不传 bodyInset 时行为不变（老用例的区间照旧）', () => {
    expect(make().setPosition({ x: -500, y: 100 }).x).toBe(0)
    expect(make().setPosition({ x: 5000, y: 100 }).x).toBe(bounds.w - STAGE_W_CSS)
  })

  it('走路的两端也用同一个区间', () => {
    // 100px/s × 100ms = 每拍 10px；从 0 走到 -95 需要 10 拍，第 11 拍就掉头了
    const m = make2({ start: { x: 0, y: bottomY }, facing: 'left' as const })
    for (let i = 0; i < 10; i++) m.step(100)
    expect(m.pos().x).toBe(-inset.left)
    expect(m.facing()).toBe('right')
  })
})

describe('工作区变化时重算夹取（setBounds）', () => {
  /**
   * 屏幕工作区在运行中会变（改分辨率/缩放/旋转/任务栏自动隐藏），主进程会把覆盖层重摆，
   * 渲染层收到 resize 后必须把走动/拖拽的夹取边界一起重算——否则屏幕缩小后宠物留在旧坐标，
   * 跑到已经消失的下半屏里，看不也点不着。这一组钉的就是"跟屏幕变"这件事。
   */
  it('屏幕变矮后当前身体被夹回新地面，宠物不会留在已经消失的下半屏', () => {
    const m = make({ start: { x: 100, y: bottomY } })   // 站在 600 高屏的地面
    expect(m.pos().y).toBe(bottomY)
    const p = m.setBounds({ x: 0, y: 0, w: 1000, h: 300 })
    const newBottom = 300 - (STAGE_H_CSS - feetOffset)
    expect(p.y).toBe(newBottom)
    expect(m.pos().y).toBe(newBottom)
    // 之后的落点也按新范围夹
    expect(m.setPosition({ x: 100, y: 99999 }).y).toBe(newBottom)
  })

  it('屏幕变宽后能走进新出现的区域', () => {
    const m = make({ start: { x: bounds.w - STAGE_W_CSS, y: bottomY }, facing: 'right' as const })
    m.setBounds({ x: 0, y: 0, w: 2000, h: 600 })   // 右限从 680 抬到 1680
    m.step(500)                                     // 100px/s × 500ms = +50，旧范围会夹住、新范围放行
    expect(m.pos().x).toBe(bounds.w - STAGE_W_CSS + 50)
  })

  it('bodyInset 场景下 setBounds 后身体仍贴住新的右边缘', () => {
    const inset = { left: 95, right: 92, top: 10 }
    const m = createMotion({ bounds, speedPxPerSec: 100, feetOffsetCss: feetOffset, bodyInset: inset, start: { x: 0, y: bottomY } })
    m.setBounds({ x: 0, y: 0, w: 800, h: 600 })
    expect(m.setPosition({ x: 99999, y: 100 }).x).toBe(800 - STAGE_W_CSS + inset.right)
  })
})

describe('bodyInsetOf', () => {
  it('画布身体框换算成舞台内的 CSS 空白', () => {
    // 试穿皮肤实测的框：x 191..455，y 21 起
    const i = bodyInsetOf({ x: 191, y: 21, w: 264, h: 312 })
    expect(i.left).toBeCloseTo(191 * STAGE_SCALE, 9)
    expect(i.right).toBeCloseTo((640 - 191 - 264) * STAGE_SCALE, 9)
    expect(i.top).toBeCloseTo(21 * STAGE_SCALE, 9)
  })
})
