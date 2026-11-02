import { describe, it, expect } from 'vitest'
import { createHoverTimer } from '../src/shared/hover.js'
import { HOVER_DWELL_MS, HOVER_RELEASE_MS } from '../src/shared/config.js'

const on = { x: 1, y: 1 }
const off = { x: 9, y: 9 }

/** 一个可控时钟：测试自己决定「现在几点」，不靠真实时间睡等。 */
function clock() {
  let t = 0
  return { now: () => t, set(v: number) { t = v }, advance(v: number) { t += v } }
}

describe('悬停打开', () => {
  it('进入身体后立刻弹出不算，要停留满 HOVER_DWELL_MS', () => {
    const c = clock()
    const h = createHoverTimer(c.now)
    expect(h.onPoint(on, true, false)).toBe('none')
    c.set(HOVER_DWELL_MS - 1)
    expect(h.onPoint(on, true, false)).toBe('none')
    c.set(HOVER_DWELL_MS)
    expect(h.onPoint(on, true, false)).toBe('open')
  })

  it('已经开着时重复停留不再触发 open', () => {
    const c = clock()
    const h = createHoverTimer(c.now)
    h.onPoint(on, true, false)
    c.set(500)
    expect(h.onPoint(on, true, false)).toBe('open')
    c.set(600)
    expect(h.onPoint(on, true, false)).toBe('none')
    expect(h.isOpen).toBe(true)
  })

  it('在身体上进出会重新计时，不会攒够零碎停留就弹', () => {
    const c = clock()
    const h = createHoverTimer(c.now)
    h.onPoint(on, true, false)
    c.set(300)
    h.onPoint(off, false, false)      // 没开过，离开不该有 close
    c.set(350)
    h.onPoint(on, true, false)        // 重新进入，计时从头
    c.set(700)
    expect(h.onPoint(on, true, false)).toBe('none')   // 距 350 只有 350ms
    c.set(750)
    expect(h.onPoint(on, true, false)).toBe('open')
  })
})

describe('悬停关闭', () => {
  it('光标移到面板上算保持停留，不关', () => {
    const c = clock()
    const h = createHoverTimer(c.now)
    h.onPoint(on, true, false)
    c.set(500)
    expect(h.onPoint(on, true, false)).toBe('open')
    c.set(1000)
    expect(h.onPoint(on, false, true)).toBe('none')
    expect(h.isOpen).toBe(true)
  })

  it('离开身体与面板满 HOVER_RELEASE_MS 才 close', () => {
    const c = clock()
    const h = createHoverTimer(c.now)
    h.onPoint(on, true, false)
    c.set(900)
    h.onPoint(on, true, false)
    c.set(901)
    expect(h.onPoint(off, false, false)).toBe('none')
    c.set(901 + HOVER_RELEASE_MS - 1)
    expect(h.onPoint(off, false, false)).toBe('none')
    c.set(901 + HOVER_RELEASE_MS)
    expect(h.onPoint(off, false, false)).toBe('close')
    expect(h.isOpen).toBe(false)
  })

  it('离开途中又回到面板，离开计时清零，不产生 close', () => {
    const c = clock()
    const h = createHoverTimer(c.now)
    h.onPoint(on, true, false)
    c.set(900)
    h.onPoint(on, true, false)
    c.set(950)
    h.onPoint(off, false, false)
    c.set(1200)
    expect(h.onPoint(on, false, true)).toBe('none')
    c.set(2000)
    expect(h.onPoint(off, false, false)).toBe('none')   // 刚重置，还没满
    c.set(2000 + HOVER_RELEASE_MS)
    expect(h.onPoint(off, false, false)).toBe('close')
  })

  it('面板开着时皮肤切换，reset 立即关掉且不补一条 close', () => {
    const c = clock()
    const h = createHoverTimer(c.now)
    h.onPoint(on, true, false)
    c.set(500)
    expect(h.onPoint(on, true, false)).toBe('open')
    h.reset()
    expect(h.isOpen).toBe(false)
    c.set(600)
    expect(h.onPoint(off, false, false)).toBe('none')
  })
})
