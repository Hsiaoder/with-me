import {
  applyEvent,
  eventDeltas,
  FOOD_EFFECT,
  STAT_TICK_MS,
  tickStats,
  type StatEvent,
} from '../shared/stats.js'
import { applyIdentity, type Identity, type SaveData, type StatsSnapshot } from '../shared/save.js'

/**
 * 养成的时钟放在**主进程**，不放渲染层：渲染层跟着页面重载、皮肤重装载，
 * 而数值是这只宠物的长期账——它不该因为一次刷新就丢了结算起点。
 * 渲染层只上报动作、只订阅快照，不参与算。
 */

export type { StatsSnapshot }

export interface StatsRuntime {
  snapshot(): StatsSnapshot
  /** 渲染层上报的动作。任何畸形输入一律忽略：这条路的另一端是 IPC，不是自家函数。 */
  event(raw: unknown): void
  /** 改名 / 改性别。没有真的变化就不落盘。 */
  identity(raw: unknown): void
  stop(): void
}

/** 只认得这四种动作，食物还必须真的在效果表里。 */
export function toStatEvent(raw: unknown): StatEvent | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  switch (r.kind) {
    case 'feed':
      return typeof r.food === 'string' && FOOD_EFFECT[r.food] !== undefined ? { kind: 'feed', food: r.food } : null
    case 'play':
      return { kind: 'play' }
    case 'reply':
      return { kind: 'reply' }
    case 'daily-open':
      return { kind: 'daily-open' }
    default:
      return null
  }
}

const sameIdentity = (a: Identity, b: Identity): boolean => a.name === b.name && a.gender === b.gender

export function startStats(o: {
  save: SaveData
  persist: (save: SaveData) => void
  broadcast: (snapshot: StatsSnapshot) => void
  now: () => number
}): StatsRuntime {
  const { save, persist, broadcast, now } = o
  const MIN_MS = 60_000

  const snapshot = (): StatsSnapshot => ({ stats: save.stats, identity: save.identity })

  /** 上次结算到的时刻。开机先拿存档里的 lastSeenAt 补一次离线，再把起点拧到现在。 */
  let lastTick = now()
  /** 上次「有互动」的时刻：心情掉得快不快看它，不看开机时间。 */
  let lastInteractionAt = now()
  /**
   * 各动作的上一次时刻（同类 10 分钟内递减）。这一份不入库：它只是软闸，重启清零可以接受。
   * **daily-open 是例外**——它的门槛跨 20 小时，比一次运行长得多，只活在内存里就等于
   * 「重启一遍再拿一次亲密度」，而且和「每天第一次」的产品说明对不上（codex 复审 #3 P1）。
   * 所以它单独落在存档的 dailyOpenAt，开机时把它镜像回来。
   */
  let lastEventAt: Record<string, number> = {}
  if (typeof save.dailyOpenAt === 'number' && Number.isFinite(save.dailyOpenAt)) lastEventAt['daily-open'] = save.dailyOpenAt

  const commit = (): void => {
    persist(save)
    broadcast(snapshot())
  }

  const seen = save.lastSeenAt
  if (typeof seen === 'number' && Number.isFinite(seen)) {
    const away = (now() - seen) / MIN_MS
    if (away >= 1) {
      save.stats = tickStats(save.stats, { minutes: away, idleMs: away * MIN_MS, offline: true })
      commit()
    }
  }

  const timer = setInterval(() => {
    const t = now()
    const minutes = (t - lastTick) / MIN_MS
    lastTick = t
    if (!(minutes > 0)) return          // 时钟回拨（NTP 校正）不许倒着喂宠物
    save.stats = tickStats(save.stats, { minutes, idleMs: t - lastInteractionAt })
    commit()
  }, STAT_TICK_MS)
  timer.unref()

  return {
    snapshot,
    event(raw: unknown): void {
      const e = toStatEvent(raw)
      if (e === null) return
      const t = now()
      const deltas = eventDeltas(e, { now: t, lastEventAt, stats: save.stats })
      // 今天已经开过面板、或这条动作此刻什么都给不出：不算一次互动，也不落盘。
      // 少了这道判断，用户连点会每次都写一遍文件。
      if (Object.keys(deltas).length === 0) return
      const applied = applyEvent(save.stats, e, { now: t, lastEventAt })
      save.stats = applied.stats
      lastEventAt = applied.lastEventAt
      // 只有这条跨 20 小时的门槛要落盘；其余动作的时刻仍是内存软闸
      if (e.kind === 'daily-open') save.dailyOpenAt = t
      lastInteractionAt = t
      commit()
    },
    identity(raw: unknown): void {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return
      const patch = raw as { name?: unknown; gender?: unknown }
      const next = applyIdentity(save, {
        name: typeof patch.name === 'string' ? patch.name : undefined,
        gender: typeof patch.gender === 'string' ? patch.gender : undefined,
      })
      if (sameIdentity(save.identity, next.identity)) return
      save.identity = next.identity
      commit()
    },
    stop(): void {
      clearInterval(timer)
    },
  }
}
