import { describe, it, expect } from 'vitest'
import { createPicker, nextClip } from '../src/shared/behavior.js'
import { createRuleEngine } from '../src/shared/rules.js'
import type { ClipRef } from '../src/shared/types.js'
import { AMBIENT_POOLS } from '../src/shared/config.js'

/** 线性同余：同种子必得同序列，等价于 Java 单测里 new Random(42)。 */
function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

const skin = { pools: { idle: ['a', 'b', 'c'], turn: ['left'], move: ['step'] } }

describe('pickNamed', () => {
  /**
   * 「点火锅播到白饭的吃相」的根因：食物表里存了 clip 名，运行时却只递池名，
   * 于是池里有什么就随机播什么。pickNamed 是把名字接回来的那一步——
   * 它查的是皮肤**实际有什么**，不是 FOODS 表写了什么，所以皮肤可以只做其中几口。
   */
  const eatSkin = { pools: { eat: ['rice', 'hotpot'] } }

  it('皮肤里有这个名字就给整条引用，不看随机数', () => {
    expect(createPicker(() => 0.99).pickNamed(eatSkin, 'eat', 'hotpot')).toEqual({ pool: 'eat', name: 'hotpot' })
    expect(createPicker(() => 0).pickNamed(eatSkin, 'eat', 'rice')).toEqual({ pool: 'eat', name: 'rice' })
  })

  it('皮肤里没做这一口就返回 null，由调用方降级（绝不随机给一口别的）', () => {
    expect(createPicker(() => 0).pickNamed(eatSkin, 'eat', 'dumpling')).toBeNull()
    expect(createPicker(() => 0).pickNamed(eatSkin, 'sleep', 'rice')).toBeNull()
    expect(createPicker(() => 0).pickNamed({ pools: { eat: [] } }, 'eat', 'rice')).toBeNull()
  })
})

describe('pickFrom', () => {
  it('空池返回 null 而不是崩溃', () => {
    expect(createPicker(() => 0).pickFrom({ pools: { idle: [] } }, 'idle', null)).toBeNull()
    expect(createPicker(() => 0).pickFrom(skin, 'nosuchpool', null)).toBeNull()
  })

  it('同种子给出同序列', () => {
    const a = createPicker(seeded(42))
    const b = createPicker(seeded(42))
    const seq = (p: ReturnType<typeof createPicker>): string[] =>
      Array.from({ length: 8 }, () => p.pickFrom(skin, 'idle', null)?.name ?? '-')
    expect(seq(a)).toEqual(seq(b))
  })

  it('排除刚播过那条，否则连着播同一个动作看着像卡住', () => {
    const p = createPicker(() => 0)
    expect(p.pickFrom(skin, 'idle', { pool: 'idle', name: 'a' })?.name).not.toBe('a')
  })

  it('跨池不算「刚播过」：播完 click 还能回到 idle 的第一条', () => {
    const p = createPicker(() => 0)
    expect(p.pickFrom(skin, 'idle', { pool: 'click', name: 'a' })?.name).toBe('a')
  })

  it('池里只剩一条时只能重复它', () => {
    const solo = { pools: { idle: ['only'] } }
    expect(createPicker(() => 0).pickFrom(solo, 'idle', { pool: 'idle', name: 'only' })?.name).toBe('only')
  })

  it('rng 给到边界值也不越界', () => {
    expect(createPicker(() => 1).pickFrom(skin, 'idle', null)?.name).toBe('c')
    expect(createPicker(() => 0.999999).pickFrom(skin, 'idle', null)).not.toBeNull()
  })
})

describe('pickAmbient', () => {
  it('自主池里没有 move：宠物不再自己平行走动', () => {
    expect(AMBIENT_POOLS).not.toContain('move')
  })

  it('权重高的池被选中的比例明显更高', () => {
    const p = createPicker(seeded(7))
    const weighted = { pools: { idle: ['a'], turn: ['t'] }, weights: { idle: 1, turn: 3 } }
    const counts = { idle: 0, turn: 0 }
    for (let i = 0; i < 3000; i++) {
      const r = p.pickAmbient(weighted, null)
      if (r) counts[r.pool as 'idle' | 'turn']++
    }
    expect(counts.turn).toBeGreaterThan(counts.idle * 2)
  })

  it('没写 weights 时按均匀处理', () => {
    const p = createPicker(seeded(11))
    const even = { pools: { idle: ['a'], turn: ['t'] } }
    const counts = { idle: 0, turn: 0 }
    for (let i = 0; i < 3000; i++) {
      const r = p.pickAmbient(even, null)
      if (r) counts[r.pool as 'idle' | 'turn']++
    }
    expect(counts.idle).toBeGreaterThan(1000)
    expect(counts.turn).toBeGreaterThan(1000)
  })

  it('反应池不会被自主选中，哪怕权重给得极高', () => {
    const p = createPicker(seeded(3))
    const s = { pools: { idle: ['a'], click: ['tapped'], drag: ['pulled'] }, weights: { click: 999, drag: 999 } }
    for (let i = 0; i < 500; i++) {
      const r = p.pickAmbient(s, null)
      expect(AMBIENT_POOLS).toContain(r?.pool)
    }
  })

  it('环境池一个都不剩时返回 null', () => {
    expect(createPicker(() => 0).pickAmbient({ pools: { click: ['x'] } }, null)).toBeNull()
  })

  it('权重全为 0 时仍能给出动画，不会卡住行为链', () => {
    const r = createPicker(() => 0).pickAmbient({ pools: { idle: ['a'] }, weights: { idle: 0 } }, null)
    expect(r).toEqual({ pool: 'idle', name: 'a' })
  })
})

/**
 * 行为链的「播完这一条之后播什么」。
 *
 * 单独抽出来测，是因为这类问题在渲染层里测不到：pickAmbient 之前有单测、
 * 但没人调用它，皮肤权重全死在链路外（复审 #2 的 P1-2）。
 */
describe('nextClip', () => {
  /** 已过 IDLE_LONG_MS：规则层交出决策权。构造时把 lastInteraction 记在 0 点。 */
  const ambientRules = () => { let t = 0; const r = createRuleEngine(() => t, 1000); t = 1500; return r }

  const loops = (ref: ClipRef): boolean => ref.pool === 'idle' || ref.pool === 'turn' || ref.pool === 'move'

  it('规则层交出决策权后按权重选池，turn 能自主出现', () => {
    const src = { pools: { idle: ['patrol'], turn: ['left'], move: ['step'] }, weights: { idle: 0.0001, move: 0, turn: 100 } }
    const n = nextClip({
      rules: ambientRules(),
      picker: createPicker(() => 0.99),
      source: src,
      loops,
      ref: { pool: 'idle', name: 'patrol' },
    })
    expect(n).toEqual({ kind: 'play', ref: { pool: 'turn', name: 'left' }, ambient: true })
  })

  it('move 拿不到自主决策权：权重全给它也不会走动', () => {
    const src = { pools: { idle: ['patrol'], turn: ['left'], move: ['step'] }, weights: { idle: 0, turn: 0, move: 100 } }
    const n = nextClip({
      rules: ambientRules(),
      picker: createPicker(() => 0.99),
      source: src,
      loops,
      ref: { pool: 'idle', name: 'patrol' },
    })
    expect(n.ref.pool).not.toBe('move')
    // 只剩 idle/turn 且权重都是 0，走的是「权重和为 0 也要给出动画」那条兜底
    expect(n.ref.pool).toBe('idle')
  })

  it('权重抽到当前这条循环动画时走无缝续播，不产生接缝', () => {
    const src = { pools: { idle: ['patrol'], click: ['tapped'] } }
    const n = nextClip({
      rules: ambientRules(),
      picker: createPicker(() => 0),
      source: src,
      loops,
      ref: { pool: 'idle', name: 'patrol' },
    })
    expect(n).toEqual({ kind: 'loop', ref: { pool: 'idle', name: 'patrol' }, ambient: true })
  })

  it('刚互动完那一拍给 idle，当前正循环 idle 就继续挂着', () => {
    const rules = createRuleEngine(() => 0, 60_000)
    rules.feed('interacted')
    const n = nextClip({
      rules,
      picker: createPicker(() => 0),
      source: { pools: { idle: ['patrol', 'patrol2'], click: ['tapped'] } },
      loops,
      ref: { pool: 'idle', name: 'patrol' },
    })
    expect(n).toEqual({ kind: 'loop', ref: { pool: 'idle', name: 'patrol' } })
  })

  it('反应动画播完归位到待机：换成 idle 池的动画', () => {
    const rules = createRuleEngine(() => 0, 60_000)
    rules.feed('interacted')
    const n = nextClip({
      rules,
      picker: createPicker(() => 0),
      source: { pools: { idle: ['patrol'], click: ['tapped'] } },
      loops,
      ref: { pool: 'click', name: 'tapped' },
    })
    expect(n).toEqual({ kind: 'play', ref: { pool: 'idle', name: 'patrol' } })
  })

  it('环境池全空时原地重播，行为链不会断', () => {
    const n = nextClip({
      rules: ambientRules(),
      picker: createPicker(() => 0),
      source: { pools: { click: ['tapped'] } },
      loops,
      ref: { pool: 'click', name: 'tapped' },
    })
    expect(n).toEqual({ kind: 'play', ref: { pool: 'click', name: 'tapped' }, ambient: true })
  })

  /**
   * 装配层要靠这个标记决定「要不要考虑开口」：只有交出决策权那一拍才是宠物主动闲逛，
   * 刚互动完的归位、反应动画播完的回待机都不算——那时候说话等于抢用户的话。
   */
  it('交出决策权那一条带 ambient，规则层钦定池的那条不带', () => {
    const src = { pools: { idle: ['patrol'], turn: ['left'] } }
    const amb = nextClip({
      rules: ambientRules(),
      picker: createPicker(() => 0),
      source: src,
      loops,
      ref: { pool: 'idle', name: 'patrol' },
    })
    expect(amb.ambient).toBe(true)

    const justInteracted = createRuleEngine(() => 0, 60_000)
    justInteracted.feed('interacted')
    const forced = nextClip({
      rules: justInteracted,
      picker: createPicker(() => 0),
      source: src,
      loops,
      ref: { pool: 'click', name: 'tapped' },
    })
    expect(forced.ambient).toBeUndefined()
  })
})
