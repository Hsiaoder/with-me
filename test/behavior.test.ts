import { describe, it, expect } from 'vitest'
import { createPicker } from '../src/shared/behavior.js'
import { AMBIENT_POOLS } from '../src/shared/config.js'

/** 线性同余：同种子必得同序列，等价于 Java 单测里 new Random(42)。 */
function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

const skin = { pools: { idle: ['a', 'b', 'c'], turn: ['left'], move: ['step'] } }

describe('pickFrom', () => {
  it('空池返回 null 而不是崩溃', () => {
    expect(createPicker(() => 0).pickFrom({ pools: { idle: [] } }, 'idle', null)).toBeNull()
    expect(createPicker(() => 0).pickFrom(skin, 'nosuchpool', null)).toBeNull()
  })

  it('同种子给出同序列', () => {
    const a = createPicker(seeded(42))
    const b = createPicker(seeded(42))
    const seq = (p: ReturnType<typeof createPicker>): string[] =>
      Array.from({ length: 8 }, () => p.pickFrom(skin, 'idle', null)?.name ?? '-')
    expect(seq(a)).toEqual(seq(b))
  })

  it('排除刚播过那条，否则连着播同一个动作看着像卡住', () => {
    const p = createPicker(() => 0)
    expect(p.pickFrom(skin, 'idle', { pool: 'idle', name: 'a' })?.name).not.toBe('a')
  })

  it('跨池不算「刚播过」：播完 click 还能回到 idle 的第一条', () => {
    const p = createPicker(() => 0)
    expect(p.pickFrom(skin, 'idle', { pool: 'click', name: 'a' })?.name).toBe('a')
  })

  it('池里只剩一条时只能重复它', () => {
    const solo = { pools: { idle: ['only'] } }
    expect(createPicker(() => 0).pickFrom(solo, 'idle', { pool: 'idle', name: 'only' })?.name).toBe('only')
  })

  it('rng 给到边界值也不越界', () => {
    expect(createPicker(() => 1).pickFrom(skin, 'idle', null)?.name).toBe('c')
    expect(createPicker(() => 0.999999).pickFrom(skin, 'idle', null)).not.toBeNull()
  })
})

describe('pickAmbient', () => {
  it('权重高的池被选中的比例明显更高', () => {
    const p = createPicker(seeded(7))
    const weighted = { pools: { idle: ['a'], move: ['m'] }, weights: { idle: 1, move: 3 } }
    const counts = { idle: 0, move: 0 }
    for (let i = 0; i < 3000; i++) {
      const r = p.pickAmbient(weighted, null)
      if (r) counts[r.pool as 'idle' | 'move']++
    }
    expect(counts.move).toBeGreaterThan(counts.idle * 2)
  })

  it('没写 weights 时按均匀处理', () => {
    const p = createPicker(seeded(11))
    const even = { pools: { idle: ['a'], move: ['m'] } }
    const counts = { idle: 0, move: 0 }
    for (let i = 0; i < 3000; i++) {
      const r = p.pickAmbient(even, null)
      if (r) counts[r.pool as 'idle' | 'move']++
    }
    expect(counts.idle).toBeGreaterThan(1000)
    expect(counts.move).toBeGreaterThan(1000)
  })

  it('反应池不会被自主选中，哪怕权重给得极高', () => {
    const p = createPicker(seeded(3))
    const s = { pools: { idle: ['a'], click: ['tapped'], drag: ['pulled'] }, weights: { click: 999, drag: 999 } }
    for (let i = 0; i < 500; i++) {
      const r = p.pickAmbient(s, null)
      expect(AMBIENT_POOLS).toContain(r?.pool)
    }
  })

  it('环境池一个都不剩时返回 null', () => {
    expect(createPicker(() => 0).pickAmbient({ pools: { click: ['x'] } }, null)).toBeNull()
  })

  it('权重全为 0 时仍能给出动画，不会卡住行为链', () => {
    const r = createPicker(() => 0).pickAmbient({ pools: { idle: ['a'] }, weights: { idle: 0 } }, null)
    expect(r).toEqual({ pool: 'idle', name: 'a' })
  })
})
