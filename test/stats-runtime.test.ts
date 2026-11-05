import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { startStats } from '../src/main/stats.js'
import { defaultSave, migrate } from '../src/shared/save.js'
import { DAILY_OPEN_GAP_MS, DECAY_PER_MIN, INITIAL_STATS, OFFLINE_MAX_LOSS, OFFLINE_RATE, PLAY_BOND, REPLY_BOND, STAT_TICK_MS } from '../src/shared/stats.js'
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
    expect(h.rt.snapshot().exp).toBeCloseTo(0.2, 6)
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
    expect(h.rt.snapshot().exp).toBeCloseTo(0.2, 6)
    h.setNow(T0 + 5 * MIN)
    h.rt.event({ kind: 'feed', food: 'rice' })
    expect(h.rt.snapshot().exp).toBeCloseTo(0.3, 6)
    // 距离**上一次**过了窗口才是全额：闸量的是连点间隔，不是每天限量
    h.setNow(T0 + 16 * MIN)
    h.rt.event({ kind: 'feed', food: 'rice' })
    expect(h.rt.snapshot().exp).toBeCloseTo(0.5, 6)
  })

  it('逗玩与回复的经验等于它们那份亲密（引用同一批常量，不会漂）', () => {
    const h = harness()
    h.rt.event({ kind: 'play' })
    expect(h.rt.snapshot().exp).toBeCloseTo(PLAY_BOND, 6)
    h.setNow(T0 + 11 * MIN)
    h.rt.event({ kind: 'reply' })
    expect(h.rt.snapshot().exp).toBeCloseTo(PLAY_BOND + REPLY_BOND, 6)
  })

  it('经验落盘并跨重启累计；日开仍受 20 小时门槛管，不会重启再领一次', () => {
    const a = harness()
    a.rt.event({ kind: 'feed', food: 'rice' })
    a.rt.event({ kind: 'daily-open' })
    const written = a.persisted.at(-1)!
    expect(written.exp).toBeCloseTo(0.4, 6)

    const b = harness({ ...defaultSave(T0), ...written })
    expect(b.rt.snapshot().exp).toBeCloseTo(0.4, 6)
    b.rt.event({ kind: 'daily-open' })
    expect(b.rt.snapshot().exp).toBeCloseTo(0.4, 6)
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
