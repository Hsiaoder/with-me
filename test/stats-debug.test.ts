import { describe, it, expect } from 'vitest'
import { sanitizeDebugPatch, applyDebugPatch, INITIAL_STATS, STAT_MAX } from '../src/shared/stats.js'

/**
 * 调试面板直接改数值/经验走的是 renderer → main 的 IPC，另一端是外部输入。
 * 收敛与夹取必须是纯函数、能单测钉死：畸形整包忽略，认得的键夹到合法区间。
 */
describe('sanitizeDebugPatch（外部输入收敛）', () => {
  it('认得四条数值键并夹到 [0, STAT_MAX]', () => {
    expect(sanitizeDebugPatch({ stats: { mood: 500, hunger: -5 } }))
      .toEqual({ stats: { mood: STAT_MAX, hunger: 0 } })
  })

  it('认得 exp（≥0，保留小数）', () => {
    expect(sanitizeDebugPatch({ exp: 123.4 })).toEqual({ exp: 123.4 })
  })

  it('非数值 / 未知键 / 负 exp / NaN / Infinity 一律丢掉，全丢完返回 null', () => {
    expect(sanitizeDebugPatch({ stats: { mood: 'x', bogus: 5 }, exp: -1 })).toBeNull()
    expect(sanitizeDebugPatch({ exp: NaN })).toBeNull()
    expect(sanitizeDebugPatch({ stats: { mood: Infinity } })).toBeNull()
    expect(sanitizeDebugPatch({ stats: { mood: 500, bogus: 1 } })).toEqual({ stats: { mood: STAT_MAX } })
  })

  it('非对象 / 数组 / null / 空对象 → null', () => {
    for (const v of [null, undefined, 5, 'x', [], {}]) expect(sanitizeDebugPatch(v)).toBeNull()
  })

  it('只给部分键时只回那部分', () => {
    expect(sanitizeDebugPatch({ stats: { bond: 10 } })).toEqual({ stats: { bond: 10 } })
  })
})

describe('applyDebugPatch', () => {
  it('只覆盖给出的键，其余保持；exp 一并换', () => {
    const cur = { stats: { ...INITIAL_STATS }, exp: 42 }
    const next = applyDebugPatch(cur, { stats: { mood: 10 }, exp: 100 })
    expect(next.stats).toEqual({ ...INITIAL_STATS, mood: 10 })
    expect(next.exp).toBe(100)
  })

  it('没给 exp 就保持原 exp', () => {
    const cur = { stats: { ...INITIAL_STATS }, exp: 42 }
    expect(applyDebugPatch(cur, { stats: { hunger: 5 } }).exp).toBe(42)
  })
})