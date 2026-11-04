import { AMBIENT_POOL, AMBIENT_POOLS } from './config.js'
import type { RuleEngine } from './rules.js'
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

/**
 * 播完一条之后该干什么：`loop` = 同一条无缝续挂，`play` = 换这条。
 * `ambient` 只在「规则层交出决策权」那一拍给——装配层用它决定要不要考虑主动开口，
 * 刚互动完的归位与反应动画播完的回待机都不算宠物自己闲逛，那时候说话是抢用户的话。
 */
export type NextClip =
  | { readonly kind: 'loop'; readonly ref: ClipRef; readonly ambient?: true }
  | { readonly kind: 'play'; readonly ref: ClipRef; readonly ambient?: true }

export interface NextClipDeps {
  rules: RuleEngine
  picker: Picker
  source: PoolSource
  /** 循环性来自皮肤 manifest，由调用方给判定，随机层不认识具体皮肤。 */
  loops: (ref: ClipRef) => boolean
  /** 刚播完的那条。 */
  ref: ClipRef
}

/**
 * 规则层 + 随机层的接缝，整条行为链的决策都在这里。
 *
 * 单独成一个函数是为了能在装配之外测它：`pickAmbient` 之前有完整单测却没人调用，
 * 于是皮肤的池权重和自主 turn 全死在链路外——「逻辑测到了、产品没接上」是
 * 这一层最容易犯的错，把接缝本身变成被测对象才防得住。
 */
export function nextClip(deps: NextClipDeps): NextClip {
  const { rules, picker, source, loops, ref } = deps
  const decision = rules.feed('tick')

  if (decision === AMBIENT_POOL) {
    const amb = picker.pickAmbient(source, ref)
    if (!amb) return { kind: 'play', ref, ambient: true }              // 环境池全空：原地重播，链子不断
    if (amb.pool === ref.pool && amb.name === ref.name && loops(amb)) return { kind: 'loop', ref: amb, ambient: true }
    return { kind: 'play', ref: amb, ambient: true }
  }

  if (decision === ref.pool && loops(ref)) return { kind: 'loop', ref }
  return { kind: 'play', ref: picker.pickFrom(source, decision, ref) ?? ref }
}
