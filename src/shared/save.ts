import { SAVE_VERSION } from './config.js'
import { DEFAULT_SETTINGS, isVisibility, type Settings } from './visibility.js'
import { INITIAL_STATS, LEVEL_CUM, MAX_LEVEL, STAT_KEYS, type Stats } from './stats.js'

/**
 * 存档的迁移与默认值。规则：**永远不抛异常**——坏档就回退默认值，并把原因记进
 * `warnings`，让上层能显示出来。桌宠的存档坏了还顺便让程序起不来，是最难被原谅的 bug。
 *
 * `now` 由调用方传入而不是读 `Date.now()`：这样默认值也可测、可复现。
 */

/**
 * 推给渲染层的那一份读数：数值 + 身份。它跨了 stats 与 save 两个模块，
 * 所以放在同时认识两者的这里，让渲染层与主进程用同一个名字（不放 main/，
 * 渲染层不该 import 主进程模块；也不放 stats.ts，那会让两个模块互相 import）。
 */
/**
 * 主进程推给渲染层的那一份「宠物此刻怎么样」。
 * `startedAt` 是**本次进程启动的时刻**（不入库）：状态栏那行「在线时间」读的是
 * 「这只宠物这次陪了你多久」，跟存档里的 `lastSeenAt`（上次见到你是多久前）不是一回事，
 * 两者混用会把「关机八小时」显示成「在线八小时」。
 */
export type StatsSnapshot = { stats: Stats; identity: Identity; exp: number; startedAt: number }

/** 性别只有两档，落盘存 ascii，显示用中文（动物的说法：雌/雄）。 */
export type Gender = 'female' | 'male'
export const GENDER_LABELS: Record<Gender, string> = { female: '雌', male: '雄' }
/**
 * 状态栏里性别只占一个符号（用户要的），颜色在 CSS 里：粉=雌、蓝=雄。
 * 用 U+2640/2642 而不是图片：微软雅黑带这两个字形，换颜色换大小都是一行的事，
 * 而且读屏能念出来。渲染有没有真的出字由 e2e 截图与 label 断言钉，别只看代码。
 */
export const GENDER_GLYPHS: Record<Gender, string> = { female: '♀', male: '♂' }
export const otherGender = (g: Gender): Gender => (g === 'female' ? 'male' : 'female')
export type Identity = { name: string; gender: Gender }

/** 状态栏表头那一行宽度是死的，名字按码点截到这里。 */
export const IDENTITY_NAME_MAX = 8
export const DEFAULT_IDENTITY: Identity = { name: '小鲸', gender: 'female' }

const isGender = (v: unknown): v is Gender => v === 'female' || v === 'male'

/** 落盘形状。`warnings` 是本次读档的诊断，不属于持久数据。 */
export type SaveFile = {
  version: number
  skin: string
  identity: Identity
  stats: Stats
  settings: Settings
  lastSeenAt: number
  /**
   * 上一次「今天第一次打开面板」奖励亲密度时刻到的时间戳。
   * 只有这一条要入库：它的门槛跨 20 小时，比一次运行长得多，不存就等于重启刷亲密，
   * 也和「每天第一次」的产品说明对不上。其余防刷（同类 10 分钟递减）是内存软闸，不落盘。
   */
  dailyOpenAt?: number
  /**
   * 累计经验（只增不减）。等级是从它算出来的读数，不另存一份。
   * 和 dailyOpenAt 一样是可选键：老档没这个字段就是 0，从 Lv.1 重新攒。
   * 为什么只增：亲密条会掉、体重会掉，但「你陪过它多少次」不该被冷落实几天抹掉——
   * 那才是等级该有的语义。
   */
  exp?: number
}

export type SaveData = SaveFile & {
  warnings: string[]
  /**
   * 文件版本比本程序新。这种档只能读来跑一场，**不能写回去**：
   * 我们不认识它的字段，写回就等于把用户在新版本里存的东西降级覆盖掉。
   * 诊断字段，和 warnings 一样不落盘。
   */
  fromFuture: boolean
}

export function defaultSave(now: number): SaveData {
  return {
    version: SAVE_VERSION,
    skin: 'block',
    identity: { ...DEFAULT_IDENTITY },
    stats: { ...INITIAL_STATS },
    settings: { ...DEFAULT_SETTINGS },
    lastSeenAt: now,
    warnings: [],
    fromFuture: false,
  }
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const clampStat = (v: number): number => Math.max(0, Math.min(100, v))

/**
 * 数值写入的唯一入口：整份覆盖（主进程算完再递进来），逐条夹在 0..100。
 * 非有限值保持原样——NaN 一旦进存档就会一路传染下去。
 */
export function applyStats(save: SaveData, next: Partial<Stats>): SaveData {
  const stats: Stats = { ...save.stats }
  for (const key of STAT_KEYS) {
    const v = next[key]
    if (typeof v === 'number' && Number.isFinite(v)) stats[key] = clampStat(v)
  }
  return { ...save, stats }
}

/** 改名与改性别。名字去空白后为空就保持原名，性别认不出就保持原值（静默丢弃，调用方是自家渲染层）。 */
export function applyIdentity(
  save: SaveData,
  patch: { name?: string | undefined; gender?: string | undefined },
): SaveData {
  const identity: Identity = { ...save.identity }
  if (typeof patch.name === 'string') {
    const trimmed = patch.name.trim()
    if (trimmed !== '') identity.name = [...trimmed].slice(0, IDENTITY_NAME_MAX).join('')
  }
  if (isGender(patch.gender)) identity.gender = patch.gender
  return { ...save, identity }
}

/** 设置写入的唯一入口：可见性只认 'show'/'hide'，布尔项只认真布尔，其余静默丢弃。 */
export function applySettings(save: SaveData, patch: Partial<Settings>): SaveData {
  const settings: Settings = { ...save.settings }
  for (const key of ['onFullscreen', 'onPresentation'] as const) {
    const v = patch[key]
    if (isVisibility(v)) settings[key] = v
  }
  for (const key of ['developerMode', 'muted'] as const) {
    const v = patch[key]
    if (typeof v === 'boolean') settings[key] = v
  }
  return { ...save, settings }
}

/** 旧档没有这一项就安静用默认值；有但值认不出才记 warning。 */
function migrateSettings(r: Record<string, unknown>, warnings: string[]): Settings {
  const settings: Settings = { ...DEFAULT_SETTINGS }
  if (r.settings === undefined) return settings
  if (r.settings === null || typeof r.settings !== 'object' || Array.isArray(r.settings)) {
    warnings.push('存档的 settings 读不出来，已用默认值')
    return settings
  }
  const s = r.settings as Record<string, unknown>
  for (const key of ['onFullscreen', 'onPresentation'] as const) {
    const v = s[key]
    if (v === undefined) continue
    if (isVisibility(v)) settings[key] = v
    else {
      settings[key] = DEFAULT_SETTINGS[key]
      warnings.push(`settings.${key}「${String(v)}」不认识，已用默认值`)
    }
  }
  for (const key of ['developerMode', 'muted'] as const) {
    const v = s[key]
    if (v === undefined) continue
    if (typeof v === 'boolean') settings[key] = v
    else {
      settings[key] = DEFAULT_SETTINGS[key]
      warnings.push(`settings.${key}「${String(v)}」不认识，已用默认值`)
    }
  }
  return settings
}

/** 旧档没有 identity 就安静用默认值；有但某个值认不出才记 warning（同 settings 的规矩）。 */
function migrateIdentity(r: Record<string, unknown>, warnings: string[]): Identity {
  const identity: Identity = { ...DEFAULT_IDENTITY }
  if (r.identity === undefined) return identity
  if (r.identity === null || typeof r.identity !== 'object' || Array.isArray(r.identity)) {
    warnings.push('存档的 identity 读不出来，已用默认值')
    return identity
  }
  const s = r.identity as Record<string, unknown>
  if (s.name !== undefined) {
    if (typeof s.name === 'string' && s.name.trim() !== '') {
      identity.name = [...s.name.trim()].slice(0, IDENTITY_NAME_MAX).join('')
    } else {
      warnings.push('identity.name 不是能用的字符串，已用默认名')
    }
  }
  if (s.gender !== undefined) {
    if (isGender(s.gender)) identity.gender = s.gender
    else warnings.push(`identity.gender「${String(s.gender)}」不认识，已用默认性别`)
  }
  return identity
}

/**
 * 把任意来源（磁盘 JSON、旧版本、垃圾数据）收敛成可用的 SaveData。
 * 版本高于本程序时不猜字段含义，按默认值继续跑并记一条 warning。
 */
/**
 * 经验账的版本迁移。v3 把「攒满 10 升一级」换成了一张递增的表（`shared/stats.ts` 的 LEVEL_STEPS），
 * 同一份 exp 在新表下会算出**低得多**的等级——16.9 旧档是 Lv.2，直接查新表就变 Lv.1，
 * 那是「你陪过它多少次」被我们改了公式给抹掉了一截。
 *
 * 所以迁移保的是**等级**，不是原值：拿旧公式算出他现在是几级，再发给他新表里那一级的门槛。
 * 效果是等级一格不动、经验条正好空着（本级 0%），下一次升上去要从头攒——
 * 比「按比例放大」诚实：放大等于凭空送人几级，而送出去的等级没人能在画面上看到它是怎么来的。
 */
export function migrateExp(exp: number, fromVersion: number): number {
  if (fromVersion >= 3) return exp
  const OLD_PER_LEVEL = 10 // v2 及以前：floor(exp / 10) + 1。这条只活在这里，别再引回现算的公式
  const old = Math.min(MAX_LEVEL, Math.floor(Math.max(0, exp) / OLD_PER_LEVEL) + 1)
  return LEVEL_CUM[old - 1]!
}

export function migrate(raw: unknown, now: number): SaveData {
  const base = defaultSave(now)
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...base, warnings: ['存档无法识别，已用默认值'] }
  }
  const r = raw as Record<string, unknown>
  if (typeof r.version === 'number' && r.version > SAVE_VERSION) {
    return {
      ...base,
      warnings: [`存档版本 ${r.version} 高于本程序支持的 ${SAVE_VERSION}，按默认值继续且不回写`],
      fromFuture: true,
    }
  }
  const warnings: string[] = []
  const st = (r.stats !== null && typeof r.stats === 'object' ? r.stats : {}) as Record<string, unknown>
  const stats: Stats = { ...INITIAL_STATS }
  for (const key of STAT_KEYS) {
    const v = num(st[key], INITIAL_STATS[key])
    stats[key] = clampStat(v)
  }
  // v1 的 stats 是占位形状（mind/clean 两条没人写过），认不出的键直接丢，不记 warning 吓用户。
  // dailyOpenAt / exp 同理：垃圾值就当没有（宁可不发今天的奖励、宁可从 Lv.1 重攒，
  // 也不能因为一个 NaN 把门槛或经验清零——清零还会一路传染回写盘）。
  const dailyOpenAt = typeof r.dailyOpenAt === 'number' && Number.isFinite(r.dailyOpenAt) ? r.dailyOpenAt : undefined
  const rawExp = typeof r.exp === 'number' && Number.isFinite(r.exp) && r.exp >= 0 ? r.exp : undefined
  const exp = rawExp === undefined ? undefined : migrateExp(rawExp, typeof r.version === 'number' ? r.version : 1)
  return {
    version: SAVE_VERSION,
    skin: typeof r.skin === 'string' && r.skin ? r.skin : base.skin,
    identity: migrateIdentity(r, warnings),
    stats,
    settings: migrateSettings(r, warnings),
    lastSeenAt: num(r.lastSeenAt, base.lastSeenAt),
    ...(dailyOpenAt === undefined ? {} : { dailyOpenAt }),
    ...(exp === undefined ? {} : { exp }),
    warnings,
    fromFuture: false,
  }
}

/** 去掉诊断字段，得到可以写盘的形状。 */
export function toSaveFile(save: SaveData): SaveFile {
  return {
    version: save.version,
    skin: save.skin,
    identity: save.identity,
    stats: save.stats,
    settings: save.settings,
    lastSeenAt: save.lastSeenAt,
    // 没有就别写这个键（exactOptionalPropertyTypes 下 `undefined` 也算一个值，落盘会变成 null）
    ...(save.dailyOpenAt === undefined ? {} : { dailyOpenAt: save.dailyOpenAt }),
    ...(save.exp === undefined ? {} : { exp: save.exp }),
  }
}
