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
/**
 * 状态栏与飘字共用的标签，**统一两个字**（用户 2026-11-07：「亲密度改为亲密，都要两个字的」）。
 * 原来这条是「亲密度」，比另外三个长一个字——同一栏里标签长短不齐，值那一列就跟着歪。
 * 飘字芯片读的是同一份，所以那边也从「亲密度 +99.9」变成「亲密 +99.9」，更窄更好读。
 */
export const STAT_LABELS: Record<StatKey, string> = {
  hunger: '饥饿',
  mood: '心情',
  weight: '体重',
  bond: '亲密',
}

export const STAT_MAX = 100

/** 结算周期。所有速率都是「每分钟」口径，所以 tick 就是一分钟；改它要连速率一起想。 */
export const STAT_TICK_MS = 60_000

/** 体重取中位：它是「养出来的痕迹」，一上来不该偏胖也不该偏瘦；亲密度从 0 攒。 */
export const INITIAL_STATS: Stats = { hunger: 70, mood: 70, weight: 50, bond: 0 }

/**
 * 每分钟自然变化（**只在在线时结算**，关闭宠物期间数值冻结，见 main/stats.ts）。
 * 节奏故意压得很慢，桌面陪伴不该催人 upkeep：饥饿满→空约 33 小时、心情约 42 小时（一天喂一两次就够）。
 * 体重是 0——它不随时间掉，只能靠活动消耗，这正是它的效果来源（喂胖了很难自己瘦回去）。
 * 亲密度按「每天 0.2」折算，是长期账，掉快了等于白养。
 */
export const DECAY_PER_MIN: Record<StatKey, number> = {
  hunger: 0.05,
  mood: 0.04,
  weight: 0,
  bond: 0.2 / 1440,
}

/** 连续没人理满这么久，心情掉得更快：它在乎你来没来。 */
export const LONELY_AFTER_MS = 30 * 60_000
export const MOOD_LONELY_PER_MIN = 0.12

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

export type FoodEffect = { hunger: number; mood: number; weight: number }
/**
 * 饥饿按「顶饱程度」、体重按热量。名字是皮肤里的 clip slug，与 FOODS 对齐。
 *
 * 12 条一起排的时候守三条：
 * ① **顶饱 ≠ 热量**——西瓜顶饱 10 但只有 0.3（水分大），零食顶饱 7 却有 1.4（不长饭但长肉）；
 *    这两个数拉不开，「吃什么会长胖」这件事就没有答案。
 * ② 每档（Lv.1/2/4）里都要有「顶饱但清淡」和「不顶饱但厚味」各一，
 *    不然玩家只会挑数值最高那条，选择就变成了比大小。
 * ③ 单条不超过火锅的 22/1.5（那是这一版的上界），要加更大的先回来看这条。
 */
/**
 * 每种食物给多少。**键是食物 id，不是动画 slug**。
 *
 * 上一版按 slug 建键（lunch / breakfast / watermelon / ricecake），而面板报给主进程的是 id
 * （noodle / youtiao / melon / niangao）——`toStatEvent` 查不到就整条丢掉，于是
 * **这四样点下去什么账都不走**：吃相播了、气泡也说了，饥饿和体重却一动不动。
 * 六样同名的时候没人发现，e2e 一直喂的是 rice 与 dumpling（都同名）。
 * 现在按 id 建键，并由 `test/food.test.ts` 那条「每个 id 都在表里」钉住——
 * `anim.name` 只管播哪条吃相，它和数值是两件事，不该共用一张表的键。
 */
export const FOOD_EFFECT: Record<string, FoodEffect> = {
  // 2026-11-07 数值重设计：开局几格饱食低（5–10），越高等级饱食通常越高；
  // 零食/冰淇淋是「特殊口」——饱食加得少但心情加得多；火锅饱食与心情双高。
  // 2026-11-09 体重列整体减半（用户要「体重变化不要太大」），饱食/心情不变，相对设计（顶饱≠热量）保留。
  // 家常（开局）
  token: { hunger: 5, mood: 2, weight: 0.2 },
  rice: { hunger: 8, mood: 2, weight: 0.2 },
  noodle: { hunger: 9, mood: 3, weight: 0.35 },
  youtiao: { hunger: 7, mood: 4, weight: 0.6 },        // 油条：香但油，热量偏高
  // 等级档：饱食大体随等级往上走
  dinner: { hunger: 10, mood: 4, weight: 0.45 },       // 晚餐：家常正餐
  tanghulu: { hunger: 6, mood: 8, weight: 0.4 },       // 糖葫芦：酸甜零嘴，不太顶饱
  dumpling: { hunger: 11, mood: 5, weight: 0.55 },
  melon: { hunger: 8, mood: 7, weight: 0.15 },         // 西瓜：水分大，几乎不长肉
  snack: { hunger: 4, mood: 16, weight: 0.7 },         // 特殊口：不顶饱，专管哄开心
  niangao: { hunger: 12, mood: 6, weight: 0.8 },       // 年糕：糯米扎实，热量最高档
  tangyuan: { hunger: 11, mood: 9, weight: 0.65 },     // 汤圆：甜馅暖胃
  qingtuan: { hunger: 10, mood: 8, weight: 0.55 },     // 青团：豆沙清甜
  labaporridge: { hunger: 13, mood: 6, weight: 0.3 },  // 腊八粥：粥水顶饱、清淡
  icecream: { hunger: 5, mood: 18, weight: 0.65 },     // 特殊口：凉甜，饱食少心情高
  crab: { hunger: 16, mood: 10, weight: 0.5 },         // 大闸蟹：硬菜，顶饱
  hotpot: { hunger: 20, mood: 18, weight: 0.9 },       // 火锅：饱食与心情双高，热量也最狠
}

/** 正饿着时吃到东西额外开心一点（叠在该食物自己的 mood 上）。 */
export const FEED_MOOD_HUNGRY_BONUS = 3
export const PLAY_MOOD = 6
export const PLAY_WEIGHT_COST = 0.25
export const PLAY_BOND = 0.15
/**
 * 「鲸鲸会飞」落地一次的账：心情、亲密往上，饱食、体重往下——抛来抛去是一场运动，
 * 玩累了会饿、会掉肉，陪它玩也涨亲密。逗玩只有 +6/-0.25/+0.15，游戏更费力气也更哄开心，
 * 所以四项都比它高一档，但喂食仍是涨饱食的最大头（游戏是往下拉的，不冲突）。
 * 亲密增益整体压到约 1/3、体重消耗减半（用户 2026-11-09：亲密别加太多、体重别变太大）。
 */
export const GAME_MOOD = 8
export const GAME_BOND = 0.2
export const GAME_HUNGER_COST = 6
export const GAME_WEIGHT_COST = 0.6
/**
 * 一局游戏按「答对/抛成次数」结算时的封顶：猜动作答对越多给越多，但一场最多按 5 次算，
 * 免得连对十几下把饱食/体重一次抽干。鲸鲸会飞固定 count=1，不受影响。
 */
export const GAME_COUNT_CAP = 5
export const REPLY_MOOD = 2
export const REPLY_BOND = 0.1
export const DAILY_OPEN_BOND = 0.1
/** 「每天第一次」用 20 小时而不是日历日：跨时区与夏令时的日界不值得为一条数值去算。 */
export const DAILY_OPEN_GAP_MS = 20 * 3600_000

export type StatEvent =
  | { kind: 'feed'; food: string }
  | { kind: 'play' }
  | { kind: 'game'; count?: number }
  | { kind: 'reply' }
  | { kind: 'daily-open' }

/** 动作的归类键：递减按它算。所有食物共用一条闸，免得换着花样连点。 */
export const eventKey = (e: StatEvent): string => e.kind

/** 游戏这一局按几次结算：count 夹在 [1, GAME_COUNT_CAP]；非游戏动作恒为 1。 */
export function gameCount(e: StatEvent): number {
  if (e.kind !== 'game') return 1
  const c = typeof e.count === 'number' && Number.isFinite(e.count) ? e.count : 1
  return Math.max(1, Math.min(GAME_COUNT_CAP, Math.round(c)))
}

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
        // 已经吃撑了（>FULL_ABOVE）饥饿**不再涨**——这是「食物能一直点」的收口，比原来的减半更硬。
        hunger: full ? 0 : f.hunger * mult,
        weight: f.weight * mult,
        mood: (f.mood + (hungry ? FEED_MOOD_HUNGRY_BONUS : 0)) * mult,
      }
    }
    case 'play':
      return { mood: PLAY_MOOD * mult, weight: -PLAY_WEIGHT_COST * mult, bond: PLAY_BOND * mult }
    case 'game': {
      const n = gameCount(e)
      return {
        mood: GAME_MOOD * mult * n,
        bond: GAME_BOND * mult * n,
        hunger: -GAME_HUNGER_COST * mult * n,
        weight: -GAME_WEIGHT_COST * mult * n,
      }
    }
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
 * 满级。用户 2026-11-07 要「一级级往上升，最高 60 级」，节奏拍的是**一个月到满级**。
 */
export const MAX_LEVEL = 60

/**
 * 从第 n 级升到 n+1 还要攒多少：**越到后面越多**（`20 + 2×(n−1)`）。
 * 落成一张表而不是各处现算——`levelOf`、经验条、存档迁移、测试读的都是同一份，改曲线只改这一行。
 * Lv.1→2 要 20，Lv.10→11 要 38，Lv.30→31 要 78，Lv.59→60 要 136，全程累计 **4602**（59 段，不是 60 段）。
 *
 * 为什么开头给得这么松：用户要的是「一级级升」的看得见的成长，第一级就要几十次互动的话
 * 第一天根本不动。陡的部分留给后面——全程 4602 按下面的速率约合一个月（见 IDLE_EXP_PER_MIN 那条账）。
 */
export const LEVEL_STEPS: readonly number[] = Array.from({ length: MAX_LEVEL - 1 }, (_, i) => 20 + 2 * i)

/** 攒到第 n 级所需的**累计**经验：`LEVEL_CUM[0]` = Lv.1 = 0。 */
export const LEVEL_CUM: readonly number[] = LEVEL_STEPS.reduce<number[]>(
  (acc, step) => [...acc, acc[acc.length - 1]! + step],
  [0],
)

/**
 * 在线挂机每分钟给多少经验。**只算进程在跑的那段**（用户拍的板：关掉应用不涨）——
 * 所以它挂在主进程那条一分钟 tick 上，和饱食/心情的自然衰减同一个时钟，不另开计时器。
 *
 * 这笔账是整条曲线的分母：在线 10 小时 = 600 分钟 = 120 经验/天，
 * 加上互动那几十（喂食 2 / 游戏 3 / 回应 1，一天约 50）≈ 170/天 → 4602 约 27 天走完。
 */
export const IDLE_EXP_PER_MIN = 0.2

/**
 * 加经验，**并按一位小数收口**。
 *
 * 为什么不是 `prev + gain` 直接加：所有增量都是 0.1 的倍数，但二进制浮点存不下 0.1，
 * 于是 9.6 + 0.2 + 0.2 = **9.999999999999998**，`levelOf` 那一档 floor(0.9999…)=0 → 永远差一口气到下一级。
 * 实测撞上过（e2e 里喂到第 10.0 那一口就是不升级）。收口到一位小数是这台的读数精度，
 * 也是 `toFixed(1)` 显示出来的精度——攒的人看到的和升级判据用的是同一个数。
 */
export const addExp = (prev: number, gain: number): number => Math.round((prev + gain) * 10) / 10

/**
 * 每条动作给多少经验。**和亲密度的账分开记**：喂食也涨等级，但不该顺带动那条已经调好平衡的亲密条
 * （它现在只由陪伴类动作涨，见 eventDeltas 的 feed 分支）。
 * 2026-11-07 起这两本账的**量级也分开了**：等级一个月要走 60 级，亲密条仍是 0~100 的读数，
 * 所以这里不再引用 PLAY_BOND 那几个常量，改成各写各的数——绑在一起反而会让调亲密顺手把曲线压平。
 */
export const EXP_GAIN: Record<StatEvent['kind'], number> = {
  feed: 2,
  play: 3,
  game: 3,
  reply: 1,
  'daily-open': 2,
}

/** 这一刻这条动作给多少经验：过同一道 10 分钟递减闸，今天开过面板的日开给 0。 */
export function expGain(e: StatEvent, ctx: EventCtx): number {
  // 「这条此刻到底给不给得出东西」已经由 eventDeltas 判掉了（认不出的食物、跨不过 20 小时的日开
  // 都返回空对象）。这里跟着它的结论走，别自己再写一份日界判断——那才是两份真相。
  if (Object.keys(eventDeltas(e, ctx)).length === 0) return 0
  return EXP_GAIN[e.kind] * diminish(eventKey(e), ctx) * gameCount(e)
}

/**
 * 等级由经验查表算出来，不入库：入库就有两份真相，还会漂。
 * 到顶就封顶（`MAX_LEVEL`），经验可以继续涨——语义是「你陪过它多少次」，不该因为满级就停账。
 */
export function levelOf(exp: number): number {
  const e = Math.max(0, Number.isFinite(exp) ? exp : 0)
  let level = 1
  while (level < MAX_LEVEL && e >= LEVEL_CUM[level]!) level++
  return level
}

/** 本级攒到哪一格了（0..1，经验条的宽度）。满级就是 1。 */
export function levelFraction(exp: number): number {
  const level = levelOf(exp)
  if (level >= MAX_LEVEL) return 1
  const base = LEVEL_CUM[level - 1]!
  const step = LEVEL_CUM[level]! - base
  return Math.max(0, Math.min(1, (Math.max(0, exp) - base) / step))
}

/** 升到下一级还差多少（经验条那一行写的数）。满级给 0。 */
export const expToNext = (exp: number): number => {
  const level = levelOf(exp)
  return level >= MAX_LEVEL ? 0 : Math.max(0, LEVEL_CUM[level]! - Math.max(0, exp))
}

/** 涨了多少写成人话：整数值不带小数点，其余一位；四舍五入成 0 的干脆不写。 */
export function gainText(label: string, delta: number, signed = false): string | null {
  const rounded = Math.round(delta * 10) / 10
  if (rounded === 0) return null
  // 默认只飘涨的：自然衰减每分钟都在动，跟着飘负数就刷屏。
  // `signed` 是给「一次明确动作」用的（如小游戏落地：饱食/体重是往下掉的，那也得让用户看见）。
  if (rounded < 0 && !signed) return null
  const mag = Math.abs(rounded)
  const num = Number.isInteger(mag) ? String(mag) : mag.toFixed(1)
  return `${label} ${rounded > 0 ? '+' : '−'}${num}`
}

/** 一条飘字：挂在哪个数值上（CSS 按它上色上色）+ 写出来的人话。 */
export type FloatGain = { key: StatKey; text: string }

/**
 * 两份快照之间该飘出来的那些字。
 *
 * 三条规矩，都是照 qqpet 的观感定的：
 * ① **只有涨的飘**。自然衰减每分钟都在动，要是也飘，屏幕上永远在刷负数，
 *    而衰减本来就不该被注意到（注意到了才叫打扰）。
 * ② **经验不飘**。它是 0.2 / 0.3 这种小碎步，飘出来只会把真正要紧的那两条挤走。
 * ③ 四舍五入成 0 的不飘（`+0.0` 比不飘更怪）。
 *
 * 纯函数、不碰 DOM：渲染层只管把拿到的每条贴上去，「该飘什么」这件事由这里说。
 * 带 `key` 出去是为了让样式认得出「这是哪条」——颜色按数值分，不按涨了多少分。
 */
export function gainsToFloat(prev: Stats, next: Stats, signed = false): FloatGain[] {
  const out: FloatGain[] = []
  for (const key of STAT_KEYS) {
    const text = gainText(STAT_LABELS[key], next[key] - prev[key], signed)
    if (text !== null) out.push({ key, text })
  }
  return out
}


// ---- 调试面板：直接改数值/经验 ----
/** 调试 patch 的形状：只认四条数值键的部分 + exp。渲染层送来、主进程收敛后写进存档。 */
export type DebugStatsPatch = { stats?: Partial<Stats>; exp?: number }

/**
 * 把 IPC 送来的 debug patch 收敛成合法形状：只认 `STAT_KEYS` 里的数值键（有限数、夹到 [0,STAT_MAX]）
 * 和 `exp`（有限、≥0）。一个都不认得就返回 null——这条路的另一端是外部输入，不是自家函数。
 */
export function sanitizeDebugPatch(raw: unknown): DebugStatsPatch | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const out: DebugStatsPatch = {}
  if (r.stats !== null && typeof r.stats === 'object' && !Array.isArray(r.stats)) {
    const s = r.stats as Record<string, unknown>
    const partial: Partial<Stats> = {}
    for (const k of STAT_KEYS) {
      const v = s[k]
      if (typeof v === 'number' && Number.isFinite(v)) partial[k] = clamp(v)
    }
    if (Object.keys(partial).length > 0) out.stats = partial
  }
  if (typeof r.exp === 'number' && Number.isFinite(r.exp) && r.exp >= 0) out.exp = r.exp
  return out.stats !== undefined || out.exp !== undefined ? out : null
}

/** 把收敛过的 patch 应用到当前数值/经验上：只覆盖给出的键，其余原样。 */
export function applyDebugPatch(cur: { stats: Stats; exp: number }, p: DebugStatsPatch): { stats: Stats; exp: number } {
  const stats = { ...cur.stats }
  if (p.stats) for (const k of STAT_KEYS) if (p.stats[k] !== undefined) stats[k] = p.stats[k]!
  return { stats, exp: p.exp !== undefined ? p.exp : cur.exp }
}

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

export type TickCtx = { minutes: number; idleMs: number }

/**
 * 按分钟结算自然变化（**只在线调用**；关闭宠物期间不结算，数值冻结）。
 * `minutes ≤ 0` 原样返回：时钟回拨不该掉两次。
 */
export function tickStats(s: Stats, ctx: TickCtx): Stats {
  if (!(ctx.minutes > 0)) return s
  const moodRate = ctx.idleMs > LONELY_AFTER_MS ? MOOD_LONELY_PER_MIN : DECAY_PER_MIN.mood
  return {
    hunger: clamp(s.hunger - DECAY_PER_MIN.hunger * ctx.minutes),
    mood: clamp(s.mood - moodRate * ctx.minutes),
    weight: clamp(s.weight - DECAY_PER_MIN.weight * ctx.minutes),
    bond: clamp(s.bond - DECAY_PER_MIN.bond * ctx.minutes),
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
