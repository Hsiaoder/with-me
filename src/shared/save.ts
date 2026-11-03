import { SAVE_VERSION } from './config.js'

/**
 * 存档的迁移与默认值。规则：**永远不抛异常**——坏档就回退默认值，并把原因记进
 * `warnings`，让上层能显示出来。桌宠的存档坏了还顺便让程序起不来，是最难被原谅的 bug。
 *
 * `now` 由调用方传入而不是读 `Date.now()`：这样默认值也可测、可复现。
 */

export type Stats = { hunger: number; mind: number; clean: number; mood: number }

/** 落盘形状。`warnings` 是本次读档的诊断，不属于持久数据。 */
export type SaveFile = { version: number; skin: string; stats: Stats; lastSeenAt: number }

export type SaveData = SaveFile & {
  warnings: string[]
  /**
   * 文件版本比本程序新。这种档只能读来跑一场，**不能写回去**：
   * 我们不认识它的字段，写回就等于把用户在新版本里存的东西降级覆盖掉。
   * 诊断字段，和 warnings 一样不落盘。
   */
  fromFuture: boolean
}

const DEFAULT_STATS: Stats = { hunger: 80, mind: 80, clean: 80, mood: 80 }

export function defaultSave(now: number): SaveData {
  return {
    version: SAVE_VERSION,
    skin: 'block',
    stats: { ...DEFAULT_STATS },
    lastSeenAt: now,
    warnings: [],
    fromFuture: false,
  }
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** 数值写入的唯一入口。v1 没有调用方改数值，通道先定死形状。 */
export function applyCare(save: SaveData, delta: Partial<Stats>): SaveData {
  const clamp = (v: number): number => Math.max(0, Math.min(100, v))
  const stats: Stats = { ...save.stats }
  for (const key of ['hunger', 'mind', 'clean', 'mood'] as const) {
    const d = delta[key]
    if (typeof d === 'number' && Number.isFinite(d)) stats[key] = clamp(save.stats[key] + d)
  }
  return { ...save, stats }
}

/**
 * 把任意来源（磁盘 JSON、旧版本、垃圾数据）收敛成可用的 SaveData。
 * 版本高于本程序时不猜字段含义，按默认值继续跑并记一条 warning。
 */
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
  return {
    version: SAVE_VERSION,
    skin: typeof r.skin === 'string' && r.skin ? r.skin : base.skin,
    stats: {
      hunger: num(st.hunger, DEFAULT_STATS.hunger),
      mind: num(st.mind, DEFAULT_STATS.mind),
      clean: num(st.clean, DEFAULT_STATS.clean),
      mood: num(st.mood, DEFAULT_STATS.mood),
    },
    lastSeenAt: num(r.lastSeenAt, base.lastSeenAt),
    warnings,
    fromFuture: false,
  }
}

/** 去掉诊断字段，得到可以写盘的形状。 */
export function toSaveFile(save: SaveData): SaveFile {
  return { version: save.version, skin: save.skin, stats: save.stats, lastSeenAt: save.lastSeenAt }
}
