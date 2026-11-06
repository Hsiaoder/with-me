import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { startStats } from '../src/main/stats.js'
import { defaultSave, migrate, migrateExp } from '../src/shared/save.js'
import {
  DAILY_OPEN_GAP_MS,
  DECAY_PER_MIN,
  DIMINISH_MULT,
  EXP_GAIN,
  IDLE_EXP_PER_MIN,
  INITIAL_STATS,
  LEVEL_CUM,
  LEVEL_STEPS,
  MAX_LEVEL,
  OFFLINE_MAX_LOSS,
  OFFLINE_RATE,
  STAT_TICK_MS,
} from '../src/shared/stats.js'
import type { SaveData } from '../src/shared/save.js'
import type { StatsSnapshot } from '../src/main/stats.js'

const T0 = 1_700_000_000_000
const MIN = 60_000

const harness = (save: SaveData = defaultSave(T0)) => {
  const persisted: SaveData[] = []
  const sent: StatsSnapshot[] = []
  let now = T0
  const rt = startStats({
    save,
    persist: (s) => persisted.push({ ...s }),
    broadcast: (snap) => sent.push(snap),
    now: () => now,
  })
  return { rt, persisted, sent, setNow: (t: number) => { now = t }, save }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('开局离线补算', () => {
  it('离开一小时：按在线速率的 30% 折算，不是全额', () => {
    const save = { ...defaultSave(T0 - 60 * MIN) }
    const { rt } = harness(save)
    expect(rt.snapshot().stats.hunger).toBeCloseTo(70 - 60 * DECAY_PER_MIN.hunger * OFFLINE_RATE, 6)
  })

  it('离开一整夜：每条最多损失上限那么多，回来不会看到一只饿到底的宠物', () => {
    const save = { ...defaultSave(T0 - 12 * 60 * MIN) }
    const { rt } = harness(save)
    expect(70 - rt.snapshot().stats.hunger).toBeCloseTo(OFFLINE_MAX_LOSS, 6)
    expect(70 - rt.snapshot().stats.mood).toBeCloseTo(OFFLINE_MAX_LOSS, 6)
  })

  it('体重离线不掉：睡觉不会瘦', () => {
    const save = { ...defaultSave(T0 - 12 * 60 * MIN) }
    expect(startStats({ save, persist: () => {}, broadcast: () => {}, now: () => T0 }).snapshot().stats.weight)
      .toBe(INITIAL_STATS.weight)
  })

  it('刚关掉就重开（不足一分钟）什么都不补，也不落盘', () => {
    const save = { ...defaultSave(T0 - 30_000) }
    const h = harness(save)
    expect(h.rt.snapshot().stats).toEqual(INITIAL_STATS)
    expect(h.persisted).toHaveLength(0)
  })

  it('lastSeenAt 是垃圾值时不炸也不补（时钟回拨不能把宠物饿死）', () => {
    for (const bad of [Number.NaN, Infinity, 'x', undefined]) {
      const save = { ...defaultSave(T0), lastSeenAt: bad as unknown as number }
      expect(() => startStats({ save, persist: () => {}, broadcast: () => {}, now: () => T0 })).not.toThrow()
    }
  })
})

describe('每分钟 tick', () => {
  it('按真实经过的分钟结算，不是一 tick 掉固定量', () => {
    const h = harness()
    h.setNow(T0 + 5 * MIN)
    vi.advanceTimersByTime(STAT_TICK_MS)
    expect(h.rt.snapshot().stats.hunger).toBeCloseTo(70 - 5 * DECAY_PER_MIN.hunger, 6)
  })

  it('每次 tick 都落盘并广播，状态栏才可能一直是对的', () => {
    const h = harness()
    h.setNow(T0 + MIN)
    vi.advanceTimersByTime(STAT_TICK_MS)
    expect(h.persisted).toHaveLength(1)
    expect(h.sent).toHaveLength(1)
  })

  it('stop 之后定时器不再推进数值', () => {
    const h = harness()
    h.rt.stop()
    h.setNow(T0 + 10 * MIN)
    vi.advanceTimersByTime(STAT_TICK_MS * 3)
    expect(h.rt.snapshot().stats).toEqual(INITIAL_STATS)
    expect(h.persisted).toHaveLength(0)
  })

  it('时钟回拨（NTP 校正）不该倒着喂宠物', () => {
    const h = harness()
    h.setNow(T0 - 5 * MIN)
    vi.advanceTimersByTime(STAT_TICK_MS)
    expect(h.rt.snapshot().stats).toEqual(INITIAL_STATS)
  })
})

describe('动作增益', () => {
  it('喂食涨饥饿并立刻广播；10 分钟内第二次只有一半', () => {
    const h = harness()
    h.rt.event({ kind: 'feed', food: 'rice' })
    const after1 = h.rt.snapshot().stats.hunger
    h.rt.event({ kind: 'feed', food: 'rice' })
    const after2 = h.rt.snapshot().stats.hunger
    expect(after1).toBeGreaterThan(70)
    expect(after2 - after1).toBeCloseTo((after1 - 70) / 2, 6)
    expect(h.sent).toHaveLength(2)
  })

  it('孤独加速看的是「距上次互动」，不是「距开机」', () => {
    // 同样结算 40 分钟：一边全程没人理，一边刚逗玩过。前者掉得更多。
    const a = harness()
    a.setNow(T0 + 40 * MIN)
    vi.advanceTimersByTime(STAT_TICK_MS)
    const b = harness()
    b.setNow(T0 + 39 * MIN)
    b.rt.event({ kind: 'play' })
    b.setNow(T0 + 40 * MIN)
    vi.advanceTimersByTime(STAT_TICK_MS)
    expect(b.rt.snapshot().stats.mood).toBeGreaterThan(a.rt.snapshot().stats.mood)
  })

  it('畸形事件一律忽略：不落盘、不广播、不抛', () => {
    const h = harness()
    for (const bad of [null, undefined, 42, 'feed', { kind: 'feed' }, { kind: 'nope' }, { kind: 'feed', food: '毒药' }]) {
      expect(() => h.rt.event(bad)).not.toThrow()
    }
    expect(h.persisted).toHaveLength(0)
    expect(h.sent).toHaveLength(0)
  })

  it('改名与改性别走同一个快照通道，非法值不动存档', () => {
    const h = harness()
    h.rt.identity({ name: '团子', gender: 'male' })
    expect(h.rt.snapshot().identity).toEqual({ name: '团子', gender: 'male' })
    h.rt.identity({ gender: '外星人' })
    expect(h.rt.snapshot().identity.gender).toBe('male')
    expect(h.persisted).toHaveLength(1)
  })
})

/**
 * codex 复审 #3 P1：daily-open 的门槛跨 20 小时，比一次运行长得多，
 * 只活在内存里就等于「重启一遍再拿一次亲密度」，也和「每天第一次」的说明对不上。
 * 所以这里测的是**跨 runtime**：奖励时刻必须落在存档里，下一个进程读得到。
 */
describe('daily-open 跨重启', () => {
  it('奖励时刻落盘：重启后 20 小时内再开面板不再给亲密', () => {
    const a = harness()
    a.rt.event({ kind: 'daily-open' })
    const bond = a.rt.snapshot().stats.bond
    expect(bond).toBeGreaterThan(0)
    const written = a.persisted.at(-1)
    expect(typeof written?.dailyOpenAt).toBe('number')

    const b = harness({ ...defaultSave(T0), ...written! })
    b.rt.event({ kind: 'daily-open' })
    expect(b.rt.snapshot().stats.bond).toBe(bond)
    // 什么都没发出去就不该为此写一遍文件
    expect(b.persisted).toHaveLength(0)
  })

  it('跨过窗口后重新奖励', () => {
    const a = harness()
    a.rt.event({ kind: 'daily-open' })
    const written = a.persisted.at(-1)!
    const b = harness({ ...defaultSave(T0), ...written })
    b.setNow(T0 + DAILY_OPEN_GAP_MS + MIN)
    b.rt.event({ kind: 'daily-open' })
    expect(b.rt.snapshot().stats.bond).toBeGreaterThan(written.stats.bond)
  })

  it('dailyOpenAt 是垃圾值就当没有：不能因为一个坏值把奖励永久锁死', () => {
    for (const bad of [Number.NaN, 'x', null, Infinity, -Infinity]) {
      // migrate 是外部数据真正进来的那道门：垃圾值必须连键都不留
      const save = migrate({ version: 2, skin: 'dshtry', dailyOpenAt: bad }, T0)
      expect('dailyOpenAt' in save, `垃圾值 ${String(bad)} 没被丢掉`).toBe(false)
      // 有人绕过 migrate 直接把档递进来时，runtime 自己也不认
      const h = harness({ ...defaultSave(T0), dailyOpenAt: bad as unknown as number })
      h.rt.event({ kind: 'daily-open' })
      expect(h.rt.snapshot().stats.bond).toBeGreaterThan(0)
    }
  })
})

/**
 * 等级那本账。它和亲密度**分开记**：喂食涨经验但不涨亲密条（那条的平衡早就调好了，
 * 不该被一个「也算照顾」的决定顺带改掉）；而且只增不减，冷落几天会掉亲密但不会掉级。
 */
describe('经验与等级', () => {
  it('喂食给经验，但不碰亲密度条：两条账各走各的', () => {
    const h = harness()
    h.rt.event({ kind: 'feed', food: 'rice' })
    expect(h.rt.snapshot().exp).toBeCloseTo(EXP_GAIN.feed, 6)
    expect(h.rt.snapshot().stats.bond).toBe(INITIAL_STATS.bond)
    expect(h.rt.snapshot().stats.hunger).toBeGreaterThan(70)
  })

  /**
   * 这条钉的是顺序：expGain 读的是「上一次这条动作是什么时候」，而 applyEvent 会把那个时刻
   * 更新成此刻。谁要是把经验结算挪到 applyEvent 之后，每一次都会被判成「10 分钟内连点」而砍半。
   */
  it('第一次喂食拿全额、10 分钟内第二次减半', () => {
    const h = harness()
    h.rt.event({ kind: 'feed', food: 'rice' })
    expect(h.rt.snapshot().exp).toBeCloseTo(EXP_GAIN.feed, 6)
    h.setNow(T0 + 5 * MIN)
    h.rt.event({ kind: 'feed', food: 'rice' })
    expect(h.rt.snapshot().exp).toBeCloseTo(EXP_GAIN.feed * (1 + DIMINISH_MULT), 6)
    // 距离**上一次**过了窗口才是全额：闸量的是连点间隔，不是每天限量
    h.setNow(T0 + 16 * MIN)
    h.rt.event({ kind: 'feed', food: 'rice' })
    expect(h.rt.snapshot().exp).toBeCloseTo(EXP_GAIN.feed * (2 + DIMINISH_MULT), 6)
  })

  it('逗玩与回复各按自己那档给经验（和亲密的数值已经分家，不再绑常量）', () => {
    const h = harness()
    h.rt.event({ kind: 'play' })
    expect(h.rt.snapshot().exp).toBeCloseTo(EXP_GAIN.play, 6)
    h.setNow(T0 + 11 * MIN)
    h.rt.event({ kind: 'reply' })
    expect(h.rt.snapshot().exp).toBeCloseTo(EXP_GAIN.play + EXP_GAIN.reply, 6)
  })

  /**
   * 在线挂机的经验（用户 2026-11-07：「挂机的时候也会增加等级」，并确认「进程在跑就算」）。
   * 这条同时钉住另一半：**离线那段一格都不给**——开局补算只补会掉的饱食/心情，
   * 否则「关掉应用三天回来直接 Lv.20」，陪伴这件事就变成放置游戏了。
   */
  it('进程在跑就按分钟给经验；关掉应用那段不算', () => {
    /**
     * 推进时要**同时**动两只钟：`vi.advanceTimersByTime` 让 setInterval 的回调真的跑一次，
     * 而回调里算的 `minutes` 读的是 harness 自己那个假 `now()`。只推前者，回调会算出
     * 「这次隔了 0 分钟」直接 return——上一版就是这么绿着骗过自己的。
     */
    const h = harness()
    let elapsed = 0
    const runMin = (n: number): void => {
      for (let i = 0; i < n; i++) {
        elapsed += 1
        // 先动逻辑时钟再放定时器：回调读的是 `now()`，反过来的话第一次 fire 看到的还是
        // 起点，算出「隔了 0 分钟」直接 return，十分钟只结九次——上一版就是这么少 0.2。
        h.setNow(T0 + elapsed * MIN)
        vi.advanceTimersByTime(STAT_TICK_MS)
      }
    }
    runMin(10)
    expect(h.rt.snapshot().exp).toBeCloseTo(IDLE_EXP_PER_MIN * 10, 6)
    // 攒满一级就真升级（这条同时是 addExp 收口的现场验证：0.2 × 100 分钟 = 20，不多不少）
    runMin(90)
    expect(h.rt.snapshot().exp, '挂机 100 分钟该正好攒满第一级').toBe(LEVEL_STEPS[0])
    // 离线补算那条路：lastSeenAt 是三小时前，重开只补数值、不补经验
    const away = { ...defaultSave(T0 - 180 * MIN) }
    const b = harness(away)
    expect(b.rt.snapshot().exp ?? 0, '关机期间不该涨经验').toBe(0)
    expect(b.rt.snapshot().stats.hunger).toBeLessThan(INITIAL_STATS.hunger)  // 那边照旧会饿
  })

  it('v2 的档迁移到 v3：等级一格不动，经验条正好空着', () => {
    /**
     * 旧规则是 `floor(exp/10)+1`。16.9 在旧表是 Lv.2；直接拿原值查新表就变 Lv.1——
     * 那是我们把公式改了却把他的成长一起改了。所以迁移保等级：给他新表里 Lv.2 的门槛 20。
     */
    expect(migrateExp(16.9, 2)).toBe(LEVEL_CUM[1])
    expect(migrateExp(16.9, 2)).toBe(20)
    expect(migrate({ version: 2, exp: 16.9 }, T0).exp).toBe(20)
    // 已经是 v3 的原样通过，别再乘一遍
    expect(migrateExp(123.4, 3)).toBe(123.4)
    // 旧档高经验也不能迁出满级之外
    expect(migrateExp(9999, 2)).toBe(LEVEL_CUM[MAX_LEVEL - 1])
  })

  it('经验落盘并跨重启累计；日开仍受 20 小时门槛管，不会重启再领一次', () => {
    const a = harness()
    a.rt.event({ kind: 'feed', food: 'rice' })
    a.rt.event({ kind: 'daily-open' })
    const written = a.persisted.at(-1)!
    expect(written.exp).toBeCloseTo(EXP_GAIN.feed + EXP_GAIN['daily-open'], 6)

    const b = harness({ ...defaultSave(T0), ...written })
    expect(b.rt.snapshot().exp).toBeCloseTo(EXP_GAIN.feed + EXP_GAIN['daily-open'], 6)
    b.rt.event({ kind: 'daily-open' })
    expect(b.rt.snapshot().exp).toBeCloseTo(EXP_GAIN.feed + EXP_GAIN['daily-open'], 6)
    expect(b.persisted).toHaveLength(0)
  })

  it('exp 是垃圾值（NaN、负数、字符串）就当没有：migrate 连键都不留', () => {
    for (const bad of [Number.NaN, -1, 'x', null, Infinity]) {
      const save = migrate({ version: 2, skin: 'dshtry', exp: bad }, T0)
      expect('exp' in save, `垃圾值 ${String(bad)} 没被丢掉`).toBe(false)
      expect(save.exp, '没键就该从 0 攒').toBeUndefined()
    }
  })
})
