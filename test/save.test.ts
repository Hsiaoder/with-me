import { describe, it, expect } from 'vitest'
import { applyIdentity, applySettings, applyStats, DEFAULT_IDENTITY, defaultSave, IDENTITY_NAME_MAX, migrate, toSaveFile } from '../src/shared/save.js'
import { INITIAL_STATS } from '../src/shared/stats.js'
import { SAVE_VERSION } from '../src/shared/config.js'

const NOW = 1_762_000_000_000

describe('defaultSave', () => {
  it('用传入的时刻，不读全局时钟', () => {
    const s = defaultSave(NOW)
    expect(s.version).toBe(SAVE_VERSION)
    expect(s.lastSeenAt).toBe(NOW)
    expect(s.stats).toEqual(INITIAL_STATS)
    expect(s.identity).toEqual(DEFAULT_IDENTITY)
    expect(s.warnings).toEqual([])
  })
})

describe('migrate', () => {
  it('无文件时用默认值', () => {
    const s = migrate(null, NOW)
    expect(s.version).toBe(SAVE_VERSION)
    expect(s.skin).toBe('block')
    expect(s.stats).toEqual(INITIAL_STATS)
  })

  it('保留已有字段，补齐缺失字段', () => {
    const s = migrate({ version: 2, skin: 'block', stats: { hunger: 30 } }, NOW)
    expect(s.skin).toBe('block')
    expect(s.stats.hunger).toBe(30)
    expect(s.stats.mood).toBe(INITIAL_STATS.mood)
  })

  it('版本高于支持范围时不猜字段含义，记 warning 并按默认值继续', () => {
    const s = migrate({ version: 99, skin: 'future', stats: { hunger: 1 } }, NOW)
    expect(s.version).toBe(SAVE_VERSION)
    expect(s.warnings.join()).toContain('99')
    // 「按默认值处理」得是真的按默认值：未来版本的字段含义我不认识，
    // 只记 warning 却照抄字段，等于一边声明不猜一边猜。
    expect(s.skin).toBe(defaultSave(NOW).skin)
    expect(s.stats).toEqual(defaultSave(NOW).stats)
    expect(s.lastSeenAt).toBe(NOW)
    expect(s.fromFuture).toBe(true)
  })

  it('当前版本与更旧版本正常取值，且不背禁止写盘的标记', () => {
    const s = migrate({ version: SAVE_VERSION, skin: 'block', stats: { hunger: 1 } }, NOW)
    expect(s.skin).toBe('block')
    expect(s.stats.hunger).toBe(1)
    expect(s.fromFuture).toBe(false)
  })

  it('垃圾输入一律不抛异常', () => {
    for (const bad of ['not json', 42, [], true, undefined, NaN]) {
      expect(() => migrate(bad, NOW), `输入 ${String(bad)}`).not.toThrow()
      expect(migrate(bad, NOW).version).toBe(SAVE_VERSION)
    }
  })

  it('非有限数值不采信，避免 NaN 渗进存档', () => {
    const s = migrate({ version: 2, stats: { hunger: 'x', mood: NaN, weight: Infinity } }, NOW)
    expect(s.stats).toEqual(INITIAL_STATS)
  })

  it('空字符串 skin 回默认，防止渲染层拿到空目录名', () => {
    expect(migrate({ version: 2, skin: '' }, NOW).skin).toBe('block')
  })

  it('stats 是数组或 null 时不炸', () => {
    expect(migrate({ version: 2, stats: [1, 2] }, NOW).stats.hunger).toBe(INITIAL_STATS.hunger)
    expect(migrate({ version: 2, stats: null }, NOW).stats.mood).toBe(INITIAL_STATS.mood)
  })

  it('越界的数值夹回 0..100，别把 999 当真实读数', () => {
    const s = migrate({ version: 2, stats: { hunger: 999, mood: -50 } }, NOW)
    expect(s.stats.hunger).toBe(100)
    expect(s.stats.mood).toBe(0)
  })

  it('v1 旧档：hunger/mood 接着用，mind/clean 那两条占位丢弃，体重与亲密给默认', () => {
    // v1 的 stats 是占位形状（{hunger,mind,clean,mood} 全 80，且没有任何生产调用方改过它），
    // 所以旧值可以放心沿用；认不出的键直接丢，不必记 warning 吓用户。
    const s = migrate({ version: 1, stats: { hunger: 42, mind: 10, clean: 20, mood: 33 } }, NOW)
    expect(s.stats).toEqual({ hunger: 42, mood: 33, weight: 50, bond: 0 })
    expect(s.identity).toEqual(DEFAULT_IDENTITY)
    expect(s.warnings).toEqual([])
  })

  it('identity：认得的性别保留，认不出回默认；名字去空白、超长截断、空回默认', () => {
    expect(migrate({ version: 2, identity: { name: '  肥肥  ', gender: 'male' } }, NOW).identity).toEqual({
      name: '肥肥', gender: 'male',
    })
    expect(migrate({ version: 2, identity: { name: '', gender: '外星人' } }, NOW).identity).toEqual(DEFAULT_IDENTITY)
    const long = migrate({ version: 2, identity: { name: '一'.repeat(30) } }, NOW)
    expect([...long.identity.name].length).toBe(IDENTITY_NAME_MAX)
  })

  it('identity 是垃圾形状时不炸', () => {
    for (const bad of [null, 42, [], 'x']) {
      expect(() => migrate({ version: 2, identity: bad }, NOW)).not.toThrow()
    }
  })
})

describe('applyStats / applyIdentity', () => {
  it('写入整份数值时逐条夹在 0..100，非有限值保持原样', () => {
    const s = applyStats(defaultSave(NOW), { hunger: 500, mood: -3, weight: Number.NaN, bond: 12 })
    expect(s.stats).toEqual({ ...INITIAL_STATS, hunger: 100, mood: 0, bond: 12 })
  })

  it('只认得的两档性别，其余丢弃；返回新对象不改原存档', () => {
    const s = defaultSave(NOW)
    expect(applyIdentity(s, { name: '团子', gender: 'female' }).identity).toEqual({ name: '团子', gender: 'female' })
    expect(applyIdentity(s, { gender: '外星人' }).identity.gender).toBe(DEFAULT_IDENTITY.gender)
    expect(s.identity.name).toBe(DEFAULT_IDENTITY.name)
  })

  it('名字去空白并截到上限（状态栏那一行宽度是死的）', () => {
    const s = applyIdentity(defaultSave(NOW), { name: '  超长名字测试测试测试  ' })
    expect([...s.identity.name].length).toBeLessThanOrEqual(IDENTITY_NAME_MAX)
    expect(applyIdentity(defaultSave(NOW), { name: '   ' }).identity.name).toBe(DEFAULT_IDENTITY.name)
  })
})

describe('toSaveFile', () => {
  it('去掉 warnings，它属于本次读档的诊断而不是持久数据', () => {
    const file = toSaveFile(migrate({ version: 99 }, NOW))
    expect(file).toEqual({
      version: SAVE_VERSION, skin: 'block', identity: defaultSave(NOW).identity,
      stats: defaultSave(NOW).stats, settings: defaultSave(NOW).settings, lastSeenAt: NOW,
    })
    expect('warnings' in file).toBe(false)
    expect('fromFuture' in file).toBe(false)
  })

  it('dailyOpenAt 有就带上、没有就连键都不写', () => {
    // 写盘漏了这个键，「每天第一次」的门槛就永远存不住（codex 复审 #3 P1），
    // 而读侧的测试照样全绿——所以这条单独钉写侧。
    const withAt = toSaveFile({ ...defaultSave(NOW), dailyOpenAt: NOW - 1000 })
    expect(withAt.dailyOpenAt).toBe(NOW - 1000)
    const without = toSaveFile(defaultSave(NOW))
    expect('dailyOpenAt' in without).toBe(false)
    // 落盘再读回来必须还在：整条链就是靠这一步闭环的
    expect(migrate(withAt, NOW).dailyOpenAt).toBe(NOW - 1000)
  })
})

describe('settings', () => {
  it('旧档没有 settings 时补默认值：全屏陪我、调试关、声音开', () => {
    const s = migrate({ version: 1, skin: 'block', stats: {} }, NOW)
    expect(s.settings).toEqual({ onFullscreen: 'show', developerMode: false, muted: false })
  })

  it('认得的值保留，认不出的回默认并说清是哪一项；旧的 onPresentation 被忽略且不报错', () => {
    const s = migrate({ version: 1, settings: { onFullscreen: '也许', onPresentation: 'hide' } }, NOW)
    expect(s.settings.onFullscreen).toBe('show')   // 认不出 → 回默认
    expect('onPresentation' in s.settings).toBe(false)  // 放映并入全屏，旧字段直接丢
    expect(s.warnings.join()).toContain('onFullscreen')
  })

  it('settings 是垃圾也不炸', () => {
    for (const v of [null, 1, 'x', [], true]) {
      expect(() => migrate({ version: 1, settings: v }, NOW)).not.toThrow()
    }
  })

  it('applySettings 只改提到的那一项，且返回新对象', () => {
    const base = defaultSave(NOW)
    const next = applySettings(base, { onFullscreen: 'hide' })
    expect(next.settings).toEqual({ onFullscreen: 'hide', developerMode: false, muted: false })
    expect(base.settings.onFullscreen).toBe('show')
    expect(applySettings(base, { onFullscreen: '也许' as never }).settings).toEqual(base.settings)
  })

  it('developerMode/muted 只认真布尔，默认关，迁移旧档缺省补 false', () => {
    const base = defaultSave(NOW)
    expect(base.settings.developerMode).toBe(false)
    expect(base.settings.muted).toBe(false)
    const next = applySettings(base, { developerMode: true, muted: true })
    expect(next.settings.developerMode).toBe(true)
    expect(next.settings.muted).toBe(true)
    expect(applySettings(base, { muted: 'yes' as never }).settings.muted).toBe(false)
    const old = migrate({ version: 1, settings: { onFullscreen: 'show' } }, NOW)
    expect(old.settings.developerMode).toBe(false)
    expect(old.settings.muted).toBe(false)
  })
})
