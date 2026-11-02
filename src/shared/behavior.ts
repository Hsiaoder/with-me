import { AMBIENT_POOLS } from './config.js'
import type { ClipRef } from './types.js'

/**
 * 随机层：在规则层选好的池里挑一条具体动画，以及在无人交互时挑一个池。
 *
 * 池表和权重都来自皮肤 manifest，代码里不写一个数字；`rng` 由调用方注入，
 * 这样同一颗种子必然给出同一条序列，测试不用碰真实随机数。
 */

export type PoolSource = {
  pools: Record<string, string[]>
  weights?: Record<string, number>
}

export interface Picker {
  /** 在指定池里挑一条。空池返回 null。多条时会排除刚播过那条，只有一条时只能重复。 */
  pickFrom(skin: PoolSource, pool: string, current: ClipRef | null): ClipRef | null
  /** 无人交互时自主挑一条环境动画（待机 / 走走 / 转身）。 */
  pickAmbient(skin: PoolSource, current: ClipRef | null): ClipRef | null
}

export function createPicker(rng: () => number): Picker {
  const index = (n: number): number => {
    const i = Math.floor(rng() * n)
    return i >= n ? n - 1 : i          // rng 返回恰好 1 时的兜底
  }

  function pickFrom(skin: PoolSource, pool: string, current: ClipRef | null): ClipRef | null {
    const names = skin.pools[pool] ?? []
    if (names.length === 0) return null
    // 连着播同一条会看着像卡住；但池里只剩一条时没得选，只能重复
    const candidates =
      names.length > 1 && current?.pool === pool
        ? names.filter((n) => n !== current.name)
        : names
    const name = candidates[index(candidates.length)]
    return name ? { pool, name } : null
  }

  function pickAmbient(skin: PoolSource, current: ClipRef | null): ClipRef | null {
    const candidates = AMBIENT_POOLS.filter((pool) => (skin.pools[pool]?.length ?? 0) > 0)
    if (candidates.length === 0) return null
    const weightOf = (pool: string): number => skin.weights?.[pool] ?? 1
    const total = candidates.reduce((sum, pool) => sum + weightOf(pool), 0)
    if (total <= 0) return pickFrom(skin, candidates[0] ?? 'idle', current)

    let roll = rng() * total
    for (const pool of candidates) {
      roll -= weightOf(pool)
      if (roll < 0) return pickFrom(skin, pool, current)
    }
    return pickFrom(skin, candidates[candidates.length - 1] ?? 'idle', current)
  }

  return { pickFrom, pickAmbient }
}
