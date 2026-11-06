/**
 * 养成数值模型。纯函数：时钟、随机、动作时刻全部由调用方注入，所以衰减、增益、
 * 离线补算、防刷都能在单测里钉死，主进程只负责按分钟推它一把。
 *
 * 口径照 qqpet 用「每分钟」，但速率慢得多——桌面陪伴不是游戏。
 * 每条数值都必须同时有「哪个动作能抬它」和「低了它演什么」，缺一条就不该存在。
 */

export type StatKey = 'hunger' | 'mood' | 'weight' | 'bond'
export type Stats = Record<StatKey, number>

export const STAT_KEYS: readonly StatKey[] = ['hunger', 'mood', 'weight', 'bond']
export const STAT_LABELS: Record<StatKey, string> = {
  hunger: '饥饿',
  mood: '心情',
  weight: '体重',
  bond: '亲密度',
}

export const STAT_MAX = 100

/** 结算周期。所有速率都是「每分钟」口径，所以 tick 就是一分钟；改它要连速率一起想。 */
export const STAT_TICK_MS = 60_000

/** 体重取中位：它是「养出来的痕迹」，一上来不该偏胖也不该偏瘦；亲密度从 0 攒。 */
export const INITIAL_STATS: Stats = { hunger: 70, mood: 70, weight: 50, bond: 0 }

/**
 * 每分钟自然变化。体重是 0——它不随时间掉，只能靠活动消耗，这正是它的效果来源
 * （喂胖了很难自己瘦回去）。亲密度按「每天 0.2」折算，是长期账，掉快了等于白养。
 */
export const DECAY_PER_MIN: Record<StatKey, number> = {
  hunger: 0.8,
  mood: 0.5,
  weight: 0,
  bond: 0.2 / 1440,
}

/** 连续没人理满这么久，心情掉得更快：它在乎你来没来。 */
export const LONELY_AFTER_MS = 30 * 60_000
export const MOOD_LONELY_PER_MIN = 1.2

/**
 * 离线（关机/休眠）按在线速率的 30% 折算，并且每条最多损失这么多。
 * 全额补算会让「关电脑」变成惩罚，用户开始不敢关；完全不补又让数值失去意义。
 * 离线期间不叠加「没人理」加速，也不动体重——没人在这儿冷落它，只是它自己待着。
 */
export const OFFLINE_RATE = 0.3
export const OFFLINE_MAX_LOSS = 30

/** 同类动作在这个窗口内再做一次，收益减半。qqpet 缺这道闸，逗脸能连点刷满。 */
export const DIMINISH_WINDOW_MS = 10 * 60_000
export const DIMINISH_MULT = 0.5

/** 超过这条再喂就是「吃不下」，饥饿收益减半。 */
export const HUNGRY_BELOW = 30
export const FULL_ABOVE = 90
export const STARVING_BELOW = 10
export const BLUE_BELOW = 30
export const CHEER_ABOVE = 70
export const CHUBBY_ABOVE = 75

export type FoodEffect = { hunger: number; weight: number }
/** 饥饿按「顶饱程度」、体重按热量。名字是皮肤里的 clip slug，与 FOODS 对齐。 */
export const FOOD_EFFECT: Record<string, FoodEffect> = {
  token: { hunger: 6, weight: 0.6 },
  rice: { hunger: 14, weight: 0.4 },
  tanghulu: { hunger: 8, weight: 0.9 },
  crab: { hunger: 18, weight: 1.0 },
  hotpot: { hunger: 22, weight: 1.5 },
  dumpling: { hunger: 16, weight: 1.2 },
}

export const FEED_MOOD = 2
/** 正饿着时吃到东西额外开心一点。 */
export const FEED_MOOD_HUNGRY_BONUS = 3
export const PLAY_MOOD = 6
export const PLAY_WEIGHT_COST = 0.5
export const PLAY_BOND = 0.4
export const REPLY_MOOD = 2
export const REPLY_BOND = 0.3
export const DAILY_OPEN_BOND = 0.2
/** 「每天第一次」用 20 小时而不是日历日：跨时区与夏令时的日界不值得为一条数值去算。 */
export const DAILY_OPEN_GAP_MS = 20 * 3600_000

export type StatEvent =
  | { kind: 'feed'; food: string }
  | { kind: 'play' }
  | { kind: 'reply' }
  | { kind: 'daily-open' }

/** 动作的归类键：递减按它算。所有食物共用一条闸，免得换着花样连点。 */
export const eventKey = (e: StatEvent): string => e.kind

export type EventCtx = { now: number; lastEventAt: Record<string, number>; stats?: Stats }

const clamp = (v: number): number => Math.max(0, Math.min(STAT_MAX, v))

/** 同一个动作 10 分钟内再做，收益减半。 */
function diminish(key: string, ctx: EventCtx): number {
  const last = ctx.lastEventAt[key]
  if (typeof last !== 'number') return 1
  return ctx.now - last < DIMINISH_WINDOW_MS ? DIMINISH_MULT : 1
}

/** 这条动作此刻能给多少（已经算过递减与「吃不下」）。返回空对象 = 今天已经给过了。 */
export function eventDeltas(e: StatEvent, ctx: EventCtx): Partial<Stats> {
  const mult = diminish(eventKey(e), ctx)
  switch (e.kind) {
    case 'feed': {
      const f = FOOD_EFFECT[e.food]
      if (!f) return {}
      const before = ctx.stats
      const full = before !== undefined && before.hunger > FULL_ABOVE
      const hungry = before !== undefined && before.hunger < HUNGRY_BELOW
      return {
        hunger: f.hunger * mult * (full ? DIMINISH_MULT : 1),
        weight: f.weight * mult,
        mood: (FEED_MOOD + (hungry ? FEED_MOOD_HUNGRY_BONUS : 0)) * mult,
      }
    }
    case 'play':
      return { mood: PLAY_MOOD * mult, weight: -PLAY_WEIGHT_COST * mult, bond: PLAY_BOND * mult }
    case 'reply':
      return { mood: REPLY_MOOD * mult, bond: REPLY_BOND * mult }
    case 'daily-open': {
      const last = ctx.lastEventAt['daily-open']
      if (typeof last === 'number' && ctx.now - last < DAILY_OPEN_GAP_MS) return {}
      return { bond: DAILY_OPEN_BOND }
    }
  }
}

/** 只问亲密那一项给多少（状态栏与测试用）。 */
export function bondGain(e: StatEvent | 'daily-open', ctx: EventCtx): number {
  const ev: StatEvent = typeof e === 'string' ? { kind: e } : e
  return eventDeltas(ev, ctx).bond ?? 0
}

// ---- 等级 ----
/**
 * 一级要多少经验。按现速率，「一天认真陪」（5 次逗玩 + 5 次回复 + 1 次日开 ≈ 3.7）约三天一级，
 * 一个月 Lv.11 —— 桌面陪伴不是游戏，升级就该是慢的。
 */
export const EXP_PER_LEVEL = 10

/**
 * 每条动作给多少经验。**和亲密度的账分开记**：喂食也涨等级，但不该顺带动那条已经调好平衡的亲密条
 * （它现在只由陪伴类动作涨，见 eventDeltas 的 feed 分支）。
 * 其余三档写成对亲密常量的引用而不是抄数——这两份账在陪伴类动作上本来就该同涨，抄数会漂。
 */
export const EXP_GAIN: Record<StatEvent['kind'], number> = {
  feed: 0.2,
  play: PLAY_BOND,
  reply: REPLY_BOND,
  'daily-open': DAILY_OPEN_BOND,
}

/** 这一刻这条动作给多少经验：过同一道 10 分钟递减闸，今天开过面板的日开给 0。 */
export function expGain(e: StatEvent, ctx: EventCtx): number {
  // 「这条此刻到底给不给得出东西」已经由 eventDeltas 判掉了（认不出的食物、跨不过 20 小时的日开
  // 都返回空对象）。这里跟着它的结论走，别自己再写一份日界判断——那才是两份真相。
  if (Object.keys(eventDeltas(e, ctx)).length === 0) return 0
  return EXP_GAIN[e.kind] * diminish(eventKey(e), ctx)
}

/** 等级由经验算出来，不入库：入库就有两份真相，还会漂。 */
export const levelOf = (exp: number): number => Math.floor(Math.max(0, exp) / EXP_PER_LEVEL) + 1

export function applyEvent(
  stats: Stats,
  e: StatEvent,
  ctx: { now: number; lastEventAt: Record<string, number> },
): { stats: Stats; lastEventAt: Record<string, number> } {
  const deltas = eventDeltas(e, { ...ctx, stats })
  const next = { ...stats }
  for (const key of STAT_KEYS) {
    const d = deltas[key]
    if (typeof d === 'number' && Number.isFinite(d)) next[key] = clamp(next[key] + d)
  }
  return { stats: next, lastEventAt: { ...ctx.lastEventAt, [eventKey(e)]: ctx.now } }
}

export type TickCtx = { minutes: number; idleMs: number; offline?: boolean }

/** 按分钟结算自然变化。`minutes ≤ 0` 原样返回：时钟回拨不该掉两次。 */
export function tickStats(s: Stats, ctx: TickCtx): Stats {
  if (!(ctx.minutes > 0)) return s
  const rate = ctx.offline ? OFFLINE_RATE : 1
  const moodRate = !ctx.offline && ctx.idleMs > LONELY_AFTER_MS ? MOOD_LONELY_PER_MIN : DECAY_PER_MIN.mood
  const floor = (key: StatKey, value: number): number =>
    ctx.offline ? Math.max(value, s[key] - OFFLINE_MAX_LOSS) : value

  return {
    hunger: clamp(floor('hunger', s.hunger - DECAY_PER_MIN.hunger * rate * ctx.minutes)),
    mood: clamp(floor('mood', s.mood - moodRate * rate * ctx.minutes)),
    // 体重离线不掉：睡觉不会瘦。
    weight: clamp(s.weight - (ctx.offline ? 0 : DECAY_PER_MIN.weight * ctx.minutes)),
    bond: clamp(floor('bond', s.bond - DECAY_PER_MIN.bond * rate * ctx.minutes)),
  }
}

// ---- 状态判定：数值 → 它演什么 ----
export const isHungry = (s: Pick<Stats, 'hunger'>): boolean => s.hunger < HUNGRY_BELOW
export const isStarving = (s: Pick<Stats, 'hunger'>): boolean => s.hunger < STARVING_BELOW
export const isBlue = (s: Pick<Stats, 'mood'>): boolean => s.mood < BLUE_BELOW
export const isCheerful = (s: Pick<Stats, 'mood'>): boolean => s.mood > CHEER_ABOVE
export const isChubby = (s: Pick<Stats, 'weight'>): boolean => s.weight > CHUBBY_ABOVE

/** 进度条颜色分档（抄 qqpet 的口径：>60 蓝、>20 黄、否则红）。 */
export const BAND_HIGH_ABOVE = 60
export const BAND_MID_ABOVE = 20
export type Band = 'high' | 'mid' | 'low'
export const statBand = (v: number): Band => (v > BAND_HIGH_ABOVE ? 'high' : v > BAND_MID_ABOVE ? 'mid' : 'low')
