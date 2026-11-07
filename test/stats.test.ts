import { describe, it, expect } from 'vitest'
import {
  applyEvent,
  bondGain,
  DECAY_PER_MIN,
  DIMINISH_MULT,
  eventDeltas,
  EXP_GAIN,
  expGain,
  expToNext,
  FOOD_EFFECT,
  gainText,
  gainsToFloat,
  IDLE_EXP_PER_MIN,
  INITIAL_STATS,
  addExp,
  isBlue,
  isCheerful,
  isChubby,
  levelFraction,
  levelOf,
  LEVEL_CUM,
  LEVEL_STEPS,
  MAX_LEVEL,
  isHungry,
  isStarving,
  LONELY_AFTER_MS,
  MOOD_LONELY_PER_MIN,
  OFFLINE_MAX_LOSS,
  OFFLINE_RATE,
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
  it('四条：饥饿 / 心情 / 体重 / 亲密，标签齐全且都是两个字', () => {
    expect(STAT_KEYS).toEqual(['hunger', 'mood', 'weight', 'bond'])
    expect(Object.values(STAT_LABELS)).toEqual(['饥饿', '心情', '体重', '亲密'])
    // 用户 2026-11-07「都要两个字的」：长短不齐时，状态栏那一列值的起笔会跟着歪
    for (const [k, v] of Object.entries(STAT_LABELS)) expect(v, `${k} 的标签不是两个字`).toHaveLength(2)
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
  it('十二种食物各有饥饿与热量（键是食物 id，和面板报上来的那个名字一致）', () => {
    expect(Object.keys(FOOD_EFFECT).sort()).toEqual(
      ['token', 'rice', 'noodle', 'youtiao', 'tanghulu', 'dumpling', 'melon', 'snack',
        'crab', 'hotpot', 'niangao', 'icecream'].sort(),
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
 * 等级。它是从「累计经验」查表算出来的读数，所以这里分三块：表本身长什么样、
 * 经验怎么攒（有闸）、读数怎么算（查表 + 封顶）。经验只增不减——冷落会掉亲密条，
 * 但抹不掉「你陪过它多少次」。
 */
describe('经验与等级', () => {
  it('曲线递增、首末有界、全程累计正好是设计值', () => {
    // 用户 2026-11-07 的两条要求：「越到后面升一级需要的经验越多」+「最高 60 级」，节奏一个月到满。
    expect(LEVEL_STEPS.length, '级的段数应该是 MAX_LEVEL − 1').toBe(MAX_LEVEL - 1)
    for (let i = 1; i < LEVEL_STEPS.length; i++) {
      expect(LEVEL_STEPS[i]!, `第 ${i + 1} 段不比第 ${i} 段难，曲线没递增`).toBeGreaterThan(LEVEL_STEPS[i - 1]!)
    }
    expect(LEVEL_STEPS[0]).toBe(20)
    expect(LEVEL_STEPS.at(-1)).toBe(136)
    // 累计这条是「一个月到满级」的分母：改了曲线就要重算速率，别让它悄悄漂。
    // 4602 = 59 段 × 20 + 2×(0+1+…+58) = 1180 + 3422（**是 59 段不是 60 段**——
    // 设计时我按 60 段口算成 4740，跑出来才对上：Lv.60 是第 60 级，段数只有 MAX_LEVEL − 1）。
    expect(LEVEL_CUM.length).toBe(MAX_LEVEL)
    expect(LEVEL_CUM[0]).toBe(0)
    expect(LEVEL_CUM.at(-1)).toBe(4602)
  })

  it('等级查表：门槛上算下一级，负数与 NaN 不许把等级算崩', () => {
    expect([levelOf(0), levelOf(19.9), levelOf(20), levelOf(21)]).toEqual([1, 1, 2, 2])
    expect(levelOf(LEVEL_CUM[10]!)).toBe(11)
    // 封顶：经验可以继续涨（语义是「陪过多少次」），但等级不再往上走
    expect(levelOf(LEVEL_CUM.at(-1)!)).toBe(MAX_LEVEL)
    expect(levelOf(999999), '满级之后经验该停账吗？现在是不停').toBe(MAX_LEVEL)
    expect(levelOf(-5)).toBe(1)
    expect(levelOf(-50)).toBe(1)
    expect(levelOf(Number.NaN), '垃圾值读成 Lv.NaN 会一路传染到界面').toBe(1)
  })

  it('经验条那两个数：还差多少、本级攒了几格', () => {
    // 曲线是 `20 + 2×(n−1)`，n 是**你当前这一级**：Lv.1→2 要 20，Lv.2→3 要 22，Lv.10→11 才要 38。
    expect(expToNext(0)).toBe(20)
    expect(expToNext(19)).toBe(1)
    expect(expToNext(20), '刚升级就该是下一级的整段（22，不是 38）').toBe(22)
    expect(expToNext(LEVEL_CUM[10]! - 1)).toBe(1)
    expect(levelFraction(0)).toBe(0)
    expect(levelFraction(30)).toBeCloseTo(10 / 22, 6)
    expect(levelFraction(19)).toBeCloseTo(19 / 20, 6)
    // 满级：条走满、差值归零，界面据此写「满级」
    expect(levelFraction(LEVEL_CUM.at(-1)!)).toBe(1)
    expect(expToNext(LEVEL_CUM.at(-1)!)).toBe(0)
  })

  it('加经验按一位小数收口：浮点误差不能把「攒满一级」变成永远差一口气', () => {
    /**
     * 这条是 e2e 逼出来的真 bug：所有增量都是 0.1 的倍数，但二进制存不下 0.1，
     * 于是 9.6 + 0.2 + 0.2 = 9.999999999999998，`levelOf` 出来还是 Lv.1——
     * 用户喂到第 50 口就是不升级，而且**没有任何地方报错**。
     * 现在门槛是 20，挂机每分钟 0.2，同一个坑会卡在 Lv.2 与 Lv.3 之间，照旧要收口。
     */
    expect(9.6 + 0.2 + 0.2 + 9.6 + 0.2 + 0.2).toBeLessThan(20)   // 裸加法的现状，钉住「为什么需要收口」
    let exp = 0
    for (let i = 0; i < 100; i++) exp = addExp(exp, IDLE_EXP_PER_MIN)
    expect(exp, '挂机 100 分钟该正好攒满第一级').toBe(LEVEL_STEPS[0])
    expect(levelOf(exp)).toBe(2)
    // 0.1 的倍数之外也别丢精度：0.4 那档加三次
    expect(addExp(addExp(addExp(0, 0.4), 0.4), 0.4)).toBe(1.2)
  })

  it('动作给的经验是各写各的数，不再绑亲密常量', () => {
    // 2026-11-07 起两本账连**量级**都分开了：等级一个月要走 60 级，亲密条仍是 0~100 的读数。
    // 以前 play/reply/日开写成对亲密常量的引用（防漂），现在引用反而会把两条绑死——
    // 调亲密就顺手把曲线压平了。所以这里钉数值，并钉住「喂食仍是最大头」。
    expect(EXP_GAIN).toEqual({ feed: 2, play: 3, reply: 1, 'daily-open': 2 })
    expect(EXP_GAIN.feed, '喂食不给经验的话，「喂着喂着长大了」这条就没了').toBeGreaterThan(0)
    expect(IDLE_EXP_PER_MIN * 60, '在线一小时给多少，是整条曲线的分母').toBe(12)
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

describe('飘字：涨的那几条才值得打扰主人', () => {
  it('整数值不带小数点，小数留一位', () => {
    expect(gainText('饥饿', 12)).toBe('饥饿 +12')
    expect(gainText('心情', 0.3)).toBe('心情 +0.3')
  })

  it('四舍五入成 0 的干脆不写：+0.0 比不飘更怪', () => {
    expect(gainText('亲密', 0.04)).toBeNull()
    expect(gainText('亲密', 0)).toBeNull()
  })

  it('掉的不飘：自然衰减每分钟都在动，跟着飘就成了刷屏', () => {
    expect(gainText('饥饿', -8)).toBeNull()
    const before = { ...INITIAL_STATS }
    const after = minutes(30)
    expect(gainsToFloat(before, after)).toEqual([])
  })

  it('喂一次飘出吃饭那条，其余没动的不出声', () => {
    const before = { ...INITIAL_STATS }
    const { stats } = applyEvent(before, { kind: 'feed', food: 'rice' }, { now: NOW, lastEventAt: {} })
    const out = gainsToFloat(before, stats)
    expect(out.length, '喂一次该有一条飘字').toBeGreaterThan(0)
    expect(out[0]?.text).toMatch(/^饥饿 \+\d/)
    for (const g of out) expect(g.key).not.toBe('bond')
  })

  it('经验不参与：Stats 结构里就没有这一格（等级/经验是另一本账）', () => {
    expect(STAT_KEYS).not.toContain('exp')
    expect(Object.keys(INITIAL_STATS)).not.toContain('exp')
  })

  it('四条同时涨就按 STAT_KEYS 的顺序出三条，每条带自己的 key 给 CSS 上色', () => {
    const before = { hunger: 10, mood: 10, weight: 10, bond: 10 }
    const out = gainsToFloat(before, { hunger: 20, mood: 21.5, weight: 10, bond: 12 })
    // 文案里的标签从 STAT_LABELS 推，不抄字符串——上一版抄了「亲密度」，
    // 标签一改名这条就红在期望值上，而不是红在「顺序/键/格式」这些真正要钉的东西上
    expect(out).toEqual([
      { key: 'hunger', text: `${STAT_LABELS.hunger} +10` },
      { key: 'mood', text: `${STAT_LABELS.mood} +11.5` },
      { key: 'bond', text: `${STAT_LABELS.bond} +2` },
    ])
  })
})
