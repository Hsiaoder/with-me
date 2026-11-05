import { describe, it, expect } from 'vitest'
import {
  applyEvent,
  bondGain,
  DAILY_OPEN_BOND,
  DECAY_PER_MIN,
  DIMINISH_MULT,
  eventDeltas,
  EXP_GAIN,
  EXP_PER_LEVEL,
  expGain,
  FOOD_EFFECT,
  INITIAL_STATS,
  isBlue,
  isCheerful,
  isChubby,
  levelOf,
  levelProgress,
  isHungry,
  isStarving,
  LONELY_AFTER_MS,
  MOOD_LONELY_PER_MIN,
  OFFLINE_MAX_LOSS,
  OFFLINE_RATE,
  PLAY_BOND,
  REPLY_BOND,
  STAT_KEYS,
  STAT_LABELS,
  tickStats,
  type FoodEffect,
  type StatEvent,
  type StatKey,
  type Stats,
} from '../src/shared/stats.js'

const NOW = 1_700_000_000_000
const fresh = () => ({ ...INITIAL_STATS })
const minutes = (m: number, idleMs = 0) => tickStats(fresh(), { minutes: m, idleMs })
/** 索引访问在 strict 下是 `T | undefined`；测试里宁可抛错也不要拿 undefined 去比。 */
const eff = (k: string): FoodEffect => {
  const f = FOOD_EFFECT[k]
  if (!f) throw new Error(`食物效果表里没有 ${k}`)
  return f
}
const need = (d: Partial<Stats>, k: StatKey): number => {
  const v = d[k]
  if (typeof v !== 'number') throw new Error(`增量里没有 ${k}`)
  return v
}

describe('数值形状', () => {
  it('四条：饥饿 / 心情 / 体重 / 亲密度，标签齐全', () => {
    expect(STAT_KEYS).toEqual(['hunger', 'mood', 'weight', 'bond'])
    expect(Object.values(STAT_LABELS)).toEqual(['饥饿', '心情', '体重', '亲密度'])
  })

  it('初值都在 0..100 内，体重取中位（它是"养出来的痕迹"，不该一上来就偏胖或偏瘦）', () => {
    for (const k of STAT_KEYS) expect(INITIAL_STATS[k]).toBeGreaterThanOrEqual(0)
    expect(INITIAL_STATS).toEqual({ hunger: 70, mood: 70, weight: 50, bond: 0 })
  })
})

describe('自然变化（每分钟口径）', () => {
  it('饥饿线性下降', () => {
    expect(minutes(10).hunger).toBeCloseTo(70 - 10 * DECAY_PER_MIN.hunger, 6)
  })

  it('体重不随时间自然下降——只能靠活动消耗', () => {
    expect(minutes(120).weight).toBe(50)
    expect(DECAY_PER_MIN.weight).toBe(0)
  })

  it('亲密度掉得极慢（它是长期账，掉快了等于白养）', () => {
    const s = tickStats({ ...INITIAL_STATS, bond: 50 }, { minutes: 60, idleMs: 0 })
    expect(s.bond).toBeCloseTo(50 - DECAY_PER_MIN.bond * 60, 6)
    expect(DECAY_PER_MIN.bond * 1440).toBeCloseTo(0.2, 6)
  })

  it('心情：没人理满 30 分钟后掉得更快', () => {
    const normal = minutes(10, 0).mood
    const lonely = minutes(10, LONELY_AFTER_MS + 1).mood
    expect(normal).toBeCloseTo(70 - 10 * DECAY_PER_MIN.mood, 6)
    expect(lonely).toBeCloseTo(70 - 10 * MOOD_LONELY_PER_MIN, 6)
    expect(lonely).toBeLessThan(normal)
  })

  it('一律夹在 0..100，不会出现负数或溢出', () => {
    expect(minutes(10_000).hunger).toBe(0)
    expect(tickStats({ ...INITIAL_STATS, hunger: 99 }, { minutes: 0.1, idleMs: 0 }).hunger).toBeLessThanOrEqual(100)
  })

  it('minutes ≤ 0 原样返回（时钟回拨或同一分钟重复 tick 不该掉两次）', () => {
    const s = fresh()
    expect(tickStats(s, { minutes: 0, idleMs: 0 })).toEqual(s)
    expect(tickStats(s, { minutes: -5, idleMs: 0 })).toEqual(s)
  })
})

describe('离线补算（温和档）', () => {
  it('按在线速率的 30% 折算', () => {
    const s = tickStats(fresh(), { minutes: 60, idleMs: 0, offline: true })
    expect(s.hunger).toBeCloseTo(70 - 60 * DECAY_PER_MIN.hunger * OFFLINE_RATE, 6)
  })

  it('离线再久也有一条损失上限，过夜回来不会饿到见底', () => {
    const s = tickStats(fresh(), { minutes: 100_000, idleMs: 99e9, offline: true })
    expect(70 - s.hunger).toBeCloseTo(OFFLINE_MAX_LOSS, 6)
    expect(70 - s.mood).toBeCloseTo(OFFLINE_MAX_LOSS, 6)
  })

  it('离线不叠加「没人理」的加速，也不动体重', () => {
    const s = tickStats(fresh(), { minutes: 60, idleMs: 99e9, offline: true })
    expect(s.mood).toBeCloseTo(70 - 60 * DECAY_PER_MIN.mood * OFFLINE_RATE, 6)
    expect(s.weight).toBe(50)
  })
})

describe('喂食效果', () => {
  it('六种食物各有饥饿与热量，热量高的一般也更顶饱', () => {
    expect(Object.keys(FOOD_EFFECT).sort()).toEqual(
      ['crab', 'dumpling', 'hotpot', 'rice', 'tanghulu', 'token'].sort(),
    )
    for (const f of Object.values(FOOD_EFFECT)) {
      expect(f.hunger).toBeGreaterThan(0)
      expect(f.weight).toBeGreaterThan(0)
    }
    expect(eff('hotpot').hunger).toBeGreaterThan(eff('tanghulu').hunger)
    expect(eff('hotpot').weight).toBeGreaterThan(eff('rice').weight)
  })

  it('快吃饱了再喂，收益减半（吃不下）——这是 qqpet 缺的那道防刷闸', () => {
    const notFull = eventDeltas({ kind: 'feed', food: 'rice' }, { now: NOW, lastEventAt: {}, stats: fresh() })
    const full = eventDeltas(
      { kind: 'feed', food: 'rice' },
      { now: NOW, lastEventAt: {}, stats: { ...INITIAL_STATS, hunger: 95 } },
    )
    expect(need(full, 'hunger')).toBeCloseTo(need(notFull, 'hunger') * DIMINISH_MULT, 6)
  })
})

describe('同类动作递减（防刷）', () => {
  const ev: StatEvent = { kind: 'play' }
  it('10 分钟内第二次同类动作收益减半', () => {
    const first = eventDeltas(ev, { now: NOW, lastEventAt: {}, stats: fresh() })
    const soon = eventDeltas(ev, { now: NOW, lastEventAt: { play: NOW - 5 * 60_000 }, stats: fresh() })
    const late = eventDeltas(ev, { now: NOW, lastEventAt: { play: NOW - 30 * 60_000 }, stats: fresh() })
    expect(need(soon, 'mood')).toBeCloseTo(need(first, 'mood') * DIMINISH_MULT, 6)
    expect(need(late, 'mood')).toBeCloseTo(need(first, 'mood'), 6)
  })

  it('递减只作用于同类动作：刚喂过不影响逗玩的收益', () => {
    const d = eventDeltas(ev, { now: NOW, lastEventAt: { feed: NOW - 1000 }, stats: fresh() })
    expect(need(d, 'mood')).toBeGreaterThan(0)
  })
})

describe('事件增益落进数值', () => {
  it('逗玩涨心情、掉体重', () => {
    const s = applyEvent(fresh(), { kind: 'play' }, { now: NOW, lastEventAt: {} })
    expect(s.stats.mood).toBeGreaterThan(70)
    expect(s.stats.weight).toBeLessThan(50)
  })

  it('点回应按钮既涨心情也涨亲密（你理它了，这条把对话接进养成）', () => {
    const s = applyEvent(fresh(), { kind: 'reply' }, { now: NOW, lastEventAt: {} })
    expect(s.stats.mood).toBeGreaterThan(70)
    expect(s.stats.bond).toBeGreaterThan(0)
  })

  it('喂食时正饿着，额外给一点心情（吃到正需要的东西）', () => {
    const hungry = applyEvent({ ...INITIAL_STATS, hunger: 20 }, { kind: 'feed', food: 'rice' }, { now: NOW, lastEventAt: {} })
    const full = applyEvent({ ...INITIAL_STATS, hunger: 95 }, { kind: 'feed', food: 'rice' }, { now: NOW, lastEventAt: {} })
    expect(hungry.stats.mood).toBeGreaterThan(full.stats.mood)
  })

  it('每天第一次打开面板给一点亲密，第二次就不给了', () => {
    const a = applyEvent(fresh(), { kind: 'daily-open' }, { now: NOW, lastEventAt: {} })
    expect(a.stats.bond).toBeGreaterThan(bondGain('daily-open', { now: NOW, lastEventAt: { 'daily-open': NOW } }))
  })

  it('返回新对象与新的 lastEventAt，不改调用方传进来的', () => {
    const s = fresh()
    const last = {}
    const r = applyEvent(s, { kind: 'play' }, { now: NOW, lastEventAt: last })
    expect(s).toEqual(INITIAL_STATS)
    expect(last).toEqual({})
    expect(r.lastEventAt.play).toBe(NOW)
  })

  it('夹在 0..100：连喂到顶也不会溢出', () => {
    let s = { ...INITIAL_STATS, hunger: 98 }
    for (let i = 0; i < 20; i++) s = applyEvent(s, { kind: 'feed', food: 'hotpot' }, { now: NOW + i * 60 * 60_000, lastEventAt: {} }).stats
    expect(s.hunger).toBe(100)
  })
})

describe('状态阈值', () => {
  it('饿了 / 快饿坏 / 蔫 / 欢 / 胖 各有自己的线', () => {
    expect(isHungry({ hunger: 29.9 })).toBe(true)
    expect(isHungry({ hunger: 30 })).toBe(false)
    expect(isStarving({ hunger: 9.9 })).toBe(true)
    expect(isBlue({ mood: 29.9 })).toBe(true)
    expect(isCheerful({ mood: 70.1 })).toBe(true)
    expect(isChubby({ weight: 75.1 })).toBe(true)
  })
})

/**
 * 等级。它是从「累计经验」算出来的读数，所以这里分两块：经验怎么攒（有闸），
 * 等级怎么读（纯除法）。经验只增不减——冷落会掉亲密条，但抹不掉「你陪过它多少次」。
 */
describe('经验与等级', () => {
  it('等级与到下一级的进度都从经验算，跨级那一格归零', () => {
    expect([levelOf(0), levelProgress(0)]).toEqual([1, 0])
    expect([levelOf(3.4), levelProgress(3.4)]).toEqual([1, 3.4])
    expect([levelOf(EXP_PER_LEVEL), levelProgress(EXP_PER_LEVEL)]).toEqual([2, 0])
    expect([levelOf(25), levelProgress(25)]).toEqual([3, 5])
    // 垃圾值不许把等级读成 Lv.0 或负数
    expect(levelOf(-50)).toBe(1)
  })

  it('逗玩与回复的经验就是它们那份亲密（写成引用，两处不会漂）', () => {
    expect(EXP_GAIN.play).toBe(PLAY_BOND)
    expect(EXP_GAIN.reply).toBe(REPLY_BOND)
    expect(EXP_GAIN['daily-open']).toBe(DAILY_OPEN_BOND)
  })

  it('喂食给经验但不给亲密：等级认「照顾」，亲密条仍只认陪伴', () => {
    const ctx = { now: NOW, lastEventAt: {} }
    expect(expGain({ kind: 'feed', food: 'rice' }, ctx)).toBeCloseTo(EXP_GAIN.feed, 6)
    expect(eventDeltas({ kind: 'feed', food: 'rice' }, ctx).bond).toBeUndefined()
  })

  it('认不出的食物、以及 20 小时内第二次日开，都不给经验', () => {
    expect(expGain({ kind: 'feed', food: '石头' }, { now: NOW, lastEventAt: {} })).toBe(0)
    expect(expGain({ kind: 'daily-open' }, { now: NOW, lastEventAt: { 'daily-open': NOW } })).toBe(0)
  })

  it('10 分钟内连点经验减半，过了窗口恢复全额', () => {
    const first = expGain({ kind: 'play' }, { now: NOW, lastEventAt: {} })
    const again = expGain({ kind: 'play' }, { now: NOW + 5 * 60_000, lastEventAt: { play: NOW } })
    expect(again).toBeCloseTo(first * DIMINISH_MULT, 6)
    expect(expGain({ kind: 'play' }, { now: NOW + 11 * 60_000, lastEventAt: { play: NOW } })).toBeCloseTo(first, 6)
  })
})
