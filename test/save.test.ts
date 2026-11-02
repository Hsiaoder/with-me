import { describe, it, expect } from 'vitest'
import { applyCare, defaultSave, migrate, toSaveFile } from '../src/shared/save.js'
import { SAVE_VERSION } from '../src/shared/config.js'

const NOW = 1_762_000_000_000

describe('defaultSave', () => {
  it('用传入的时刻，不读全局时钟', () => {
    const s = defaultSave(NOW)
    expect(s.version).toBe(SAVE_VERSION)
    expect(s.lastSeenAt).toBe(NOW)
    expect(s.stats).toEqual({ hunger: 80, mind: 80, clean: 80, mood: 80 })
    expect(s.warnings).toEqual([])
  })
})

describe('migrate', () => {
  it('无文件时用默认值', () => {
    const s = migrate(null, NOW)
    expect(s.version).toBe(SAVE_VERSION)
    expect(s.skin).toBe('block')
    expect(s.stats).toEqual({ hunger: 80, mind: 80, clean: 80, mood: 80 })
  })

  it('保留已有字段，补齐缺失字段', () => {
    const s = migrate({ version: 1, skin: 'block', stats: { hunger: 30 } }, NOW)
    expect(s.skin).toBe('block')
    expect(s.stats.hunger).toBe(30)
    expect(s.stats.mood).toBe(80)
  })

  it('版本高于支持范围时不猜字段含义，记 warning 并按默认值继续', () => {
    const s = migrate({ version: 99, skin: 'future', stats: { hunger: 1 } }, NOW)
    expect(s.version).toBe(SAVE_VERSION)
    expect(s.warnings.join()).toContain('99')
  })

  it('垃圾输入一律不抛异常', () => {
    for (const bad of ['not json', 42, [], true, undefined, NaN]) {
      expect(() => migrate(bad, NOW), `输入 ${String(bad)}`).not.toThrow()
      expect(migrate(bad, NOW).version).toBe(SAVE_VERSION)
    }
  })

  it('非有限数值不采信，避免 NaN 渗进存档', () => {
    const s = migrate({ version: 1, stats: { hunger: 'x', mind: NaN, clean: Infinity } }, NOW)
    expect(s.stats).toEqual({ hunger: 80, mind: 80, clean: 80, mood: 80 })
  })

  it('空字符串 skin 回默认，防止渲染层拿到空目录名', () => {
    expect(migrate({ version: 1, skin: '' }, NOW).skin).toBe('block')
  })

  it('stats 是数组或 null 时不炸', () => {
    expect(migrate({ version: 1, stats: [1, 2] }, NOW).stats.hunger).toBe(80)
    expect(migrate({ version: 1, stats: null }, NOW).stats.mood).toBe(80)
  })
})

describe('applyCare', () => {
  it('按增量累加并夹在 0..100', () => {
    const s = defaultSave(NOW)
    expect(applyCare(s, { hunger: -30 }).stats.hunger).toBe(50)
    expect(applyCare(s, { hunger: 99 }).stats.hunger).toBe(100)
    expect(applyCare(s, { hunger: -500 }).stats.hunger).toBe(0)
  })

  it('忽略非数值增量，也不动没提到的字段', () => {
    const s = applyCare(defaultSave(NOW), { mood: 5, hunger: Number.NaN })
    expect(s.stats).toEqual({ hunger: 80, mind: 80, clean: 80, mood: 85 })
  })

  it('返回新对象，不改原存档', () => {
    const s = defaultSave(NOW)
    applyCare(s, { mood: 1 })
    expect(s.stats.mood).toBe(80)
  })
})

describe('toSaveFile', () => {
  it('去掉 warnings，它属于本次读档的诊断而不是持久数据', () => {
    const file = toSaveFile(migrate({ version: 99 }, NOW))
    expect(file).toEqual({ version: SAVE_VERSION, skin: 'block', stats: defaultSave(NOW).stats, lastSeenAt: NOW })
    expect('warnings' in file).toBe(false)
  })
})
