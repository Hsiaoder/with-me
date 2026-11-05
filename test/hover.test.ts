import { describe, it, expect } from 'vitest'
import { createHoverTimer } from '../src/shared/hover.js'
import { PANEL_HIDE_MS, VIEW_HIDE_MS } from '../src/shared/config.js'

const on = { x: 1, y: 1 }
const off = { x: 9, y: 9 }

/** 一个可控时钟：测试自己决定「现在几点」，不靠真实时间睡等。 */
function clock() {
  let t = 0
  return { now: () => t, set(v: number) { t = v }, advance(v: number) { t += v } }
}

/**
 * 面板由**点击**叫出来，不再由悬停叫出来（2026-11-04 改）。
 * 所以这个模块只剩一件事：开着的时候，离开身体与面板满 hideMs 就收。
 * 「停留 400ms 自动弹出」那半边连同 HOVER_DWELL_MS 一起删掉了——留着就是死代码。
 */
describe('收起计时（要 open() 过才生效）', () => {
  it('没 open 过：光标进出都不产生 close，也没有挂起计时', () => {
    const c = clock()
    const h = createHoverTimer(c.now)
    expect(h.onPoint(on, true, false)).toBe('none')
    c.set(PANEL_HIDE_MS * 3)
    expect(h.onPoint(off, false, false)).toBe('none')
    expect(h.pendingMs(c.now())).toBeNull()
  })

  it('open 之后光标还在身体上：不收', () => {
    const c = clock()
    const h = createHoverTimer(c.now)
    h.open()
    c.set(PANEL_HIDE_MS * 2)
    expect(h.onPoint(on, true, false)).toBe('none')
    expect(h.pendingMs(c.now())).toBeNull()      // 没离开过，没有挂起的转换
  })

  it('光标移到面板上算还在宠物旁边，不收', () => {
    const c = clock()
    const h = createHoverTimer(c.now)
    h.open()
    c.set(500)
    expect(h.onPoint(on, false, true)).toBe('none')
    c.set(PANEL_HIDE_MS)
    expect(h.onPoint(on, false, true)).toBe('none')
  })

  it('离开身体与面板满 PANEL_HIDE_MS 才 close，close 之后不再重复', () => {
    const c = clock()
    const h = createHoverTimer(c.now)
    h.open()
    c.set(901)
    expect(h.onPoint(off, false, false)).toBe('none')          // 离开计时从这一刻起算
    c.set(901 + PANEL_HIDE_MS - 1)
    expect(h.onPoint(off, false, false)).toBe('none')
    c.set(901 + PANEL_HIDE_MS)
    expect(h.onPoint(off, false, false)).toBe('close')
    c.set(901 + PANEL_HIDE_MS * 3)
    expect(h.onPoint(off, false, false)).toBe('none')
  })

  it('离开途中又回到面板：离开计时清零，从头再等', () => {
    const c = clock()
    const h = createHoverTimer(c.now)
    h.open()
    c.set(950)
    h.onPoint(off, false, false)
    c.set(1200)
    expect(h.onPoint(on, false, true)).toBe('none')
    c.set(2000)
    expect(h.onPoint(off, false, false)).toBe('none')
    c.set(2000 + PANEL_HIDE_MS)
    expect(h.onPoint(off, false, false)).toBe('close')
  })

  it('reset 立即停表且不补一条 close（面板已经被别的路收掉了）', () => {
    const c = clock()
    const h = createHoverTimer(c.now)
    h.open()
    c.set(100)
    h.onPoint(off, false, false)
    h.reset()
    c.set(PANEL_HIDE_MS * 2)
    expect(h.onPoint(off, false, false)).toBe('none')
    expect(h.pendingMs(c.now())).toBeNull()
  })
})

/**
 * 静止光标。主进程对相同坐标去重（cursor.ts），所以真的把手停住不动时
 * 不会再有任何 onPoint 进来——收起只能靠调用方的定时器催。
 * pendingMs 就是这个催债句：还剩多久收，没挂起返回 null。
 */
describe('静止光标的待转换计时', () => {
  it('刚离开：还有 PANEL_HIDE_MS 才收', () => {
    const c = clock()
    const h = createHoverTimer(c.now)
    h.open()
    c.set(600)
    h.onPoint(off, false, false)
    expect(h.pendingMs(c.now())).toBe(PANEL_HIDE_MS)
  })

  it('中途剩余时间跟着时钟递减，定时器把它催到点后不需要新光标事件就能 close', () => {
    const c = clock()
    const h = createHoverTimer(c.now)
    h.open()
    c.set(600)
    h.onPoint(off, false, false)
    c.set(600 + PANEL_HIDE_MS - 1)
    expect(h.pendingMs(c.now())).toBe(1)
    c.set(600 + PANEL_HIDE_MS)
    expect(h.pendingMs(c.now())).toBe(0)
    expect(h.onPoint(off, false, false)).toBe('close')
    expect(h.pendingMs(c.now())).toBeNull()
  })

  it('再点一次宠物叫出来：离开计时从头', () => {
    const c = clock()
    const h = createHoverTimer(c.now)
    h.open()
    c.set(100)
    h.onPoint(off, false, false)
    h.open()
    expect(h.pendingMs(c.now())).toBeNull()
    c.set(200)
    h.onPoint(off, false, false)
    expect(h.pendingMs(c.now())).toBe(PANEL_HIDE_MS)
  })

  it('postpone：到点但先不收，重新拿到完整一段，并且下一次到点还能 close', () => {
    /**
     * 吃饭那一口正到嘴边，装配层会拒掉这一次 close。拒完之后计时必须还活着：
     * close 已经把 armed 落下，如果 postpone 只是把 leftAt 清掉（open 的做法），
     * pendingMs 就永远返回 null，而主进程对同一坐标去重、静止的手不再产生事件——
     * 面板会挂在屏幕上再也收不掉。
     */
    const c = clock()
    const h = createHoverTimer(c.now)
    h.open()
    c.set(600)
    h.onPoint(off, false, false)
    c.set(600 + PANEL_HIDE_MS)
    expect(h.onPoint(off, false, false)).toBe('close')
    h.postpone()
    expect(h.pendingMs(c.now())).toBe(PANEL_HIDE_MS)
    c.set(600 + PANEL_HIDE_MS * 2)
    expect(h.onPoint(off, false, false)).toBe('close')
  })

  it('postpone 之后手回到面板上：照旧清零，不留挂起计时', () => {
    const c = clock()
    const h = createHoverTimer(c.now)
    h.open()
    c.set(600)
    h.onPoint(off, false, false)
    c.set(600 + PANEL_HIDE_MS)
    expect(h.onPoint(off, false, false)).toBe('close')
    h.postpone()
    c.set(600 + PANEL_HIDE_MS + 100)
    expect(h.onPoint(on, false, true)).toBe('none')
    expect(h.pendingMs(c.now())).toBeNull()
  })

  it('reset 之后 postpone 仍会重新上弦：收一个已经不在布局里的面板是幂等的', () => {
    const c = clock()
    const h = createHoverTimer(c.now)
    h.open()
    c.set(600)
    h.onPoint(off, false, false)
    h.reset()
    h.postpone()
    expect(h.pendingMs(c.now())).toBe(PANEL_HIDE_MS)
    c.set(600 + PANEL_HIDE_MS)
    expect(h.onPoint(off, false, false)).toBe('close')
  })
})

describe('收起延时可切换', () => {
  /** 叫出面板 → 离开，停在「还没到收起」的那一刻。 */
  const openedThenLeft = (c: ReturnType<typeof clock>) => {
    const h = createHoverTimer(c.now)
    h.open()
    c.set(901)
    h.onPoint(off, false, false)
    return h
  }

  it('换过延时后按新值收起，默认值不受影响', () => {
    const c = clock()
    const h = openedThenLeft(c)
    expect(h.onPoint(off, false, false)).toBe('none')
    h.setHideMs(VIEW_HIDE_MS)
    c.set(901 + PANEL_HIDE_MS)
    expect(h.onPoint(off, false, false)).toBe('none')
    c.set(901 + VIEW_HIDE_MS)
    expect(h.onPoint(off, false, false)).toBe('close')
  })

  it('pendingMs 报的是当前生效的延时，不然自动收起的定时器会按旧值催', () => {
    const c = clock()
    const h = openedThenLeft(c)
    expect(h.pendingMs(c.now())).toBe(PANEL_HIDE_MS)
    h.setHideMs(VIEW_HIDE_MS)
    expect(h.pendingMs(c.now())).toBe(VIEW_HIDE_MS)
  })

  it('换回 PANEL_HIDE_MS 就恢复原行为', () => {
    const c = clock()
    const h = openedThenLeft(c)
    h.setHideMs(VIEW_HIDE_MS)
    h.setHideMs(PANEL_HIDE_MS)
    c.set(901 + PANEL_HIDE_MS)
    expect(h.onPoint(off, false, false)).toBe('close')
  })
})
