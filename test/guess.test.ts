import { describe, it, expect } from 'vitest'
import {
  GUESS_ACTIONS, GUESS_OPTIONS, GUESS_POOL, GUESS_QUESTIONS, buildRound, pickTargets,
} from '../src/shared/guess.js'

/** 定值 rng：每次调用返回同一个数，让洗牌结果可复现。 */
const fixed = (v: number) => () => v
/** 递增 rng：每次调用换个数，让多题 deck 真随机起来（不然定值 rng 会洗出固定序）。 */
const counting = () => { let i = 0; return () => (i++ % 97) / 97 }

describe('猜动作 · 纯逻辑', () => {
  it('动作库正好 20 条，全在 guess 池，label 非空', () => {
    expect(GUESS_ACTIONS).toHaveLength(20)
    for (const a of GUESS_ACTIONS) {
      expect(a.pool).toBe(GUESS_POOL)
      expect(a.label.length).toBeGreaterThan(0)
    }
  })

  it('没有「吃东西」类，且 name 互不重复（同池里名字撞了 pickNamed 会点错）', () => {
    const cats = new Set(GUESS_ACTIONS.map((a) => a.category))
    expect(cats.has('吃东西')).toBe(false)
    expect(new Set(GUESS_ACTIONS.map((a) => a.name)).size).toBe(GUESS_ACTIONS.length)
  })

  it('每个分类至少 GUESS_OPTIONS 条：这样任一目标都凑得出够数的同类干扰项', () => {
    for (const cat of new Set(GUESS_ACTIONS.map((a) => a.category))) {
      expect(GUESS_ACTIONS.filter((a) => a.category === cat).length).toBeGreaterThanOrEqual(GUESS_OPTIONS)
    }
  })

  it('pickTargets：一局抽 GUESS_QUESTIONS 个目标，互不重复、都来自库', () => {
    const deck = pickTargets(counting(), GUESS_QUESTIONS)
    expect(deck).toHaveLength(GUESS_QUESTIONS)
    expect(new Set(deck.map((a) => a.name)).size, '一局里出现了重复动作').toBe(deck.length)
    for (const t of deck) expect(GUESS_ACTIONS.some((a) => a.name === t.name)).toBe(true)
  })

  it('pickTargets 不会多抽出比库更多的题（count 夹在库大小内）', () => {
    expect(pickTargets(fixed(0.5), GUESS_ACTIONS.length + 5)).toHaveLength(GUESS_ACTIONS.length)
  })

  it('buildRound：3 个选项、互不相同，目标在选项里，且干扰项全与目标同分类', () => {
    for (const target of GUESS_ACTIONS) {
      const r = buildRound(target, counting())
      expect(r.target).toBe(target)
      expect(r.options).toHaveLength(GUESS_OPTIONS)
      expect(new Set(r.options.map((o) => o.name)).size).toBe(GUESS_OPTIONS)
      expect(r.options.map((o) => o.name)).toContain(target.name)
      for (const o of r.options) expect(o.category).toBe(target.category)
    }
  })

  it('buildRound 的选项顺序会随 rng 变（正确答案不总在第一颗）', () => {
    const t = GUESS_ACTIONS[0]!
    const a = buildRound(t, fixed(0.2)).options.map((o) => o.name).join(',')
    const b = buildRound(t, fixed(0.8)).options.map((o) => o.name).join(',')
    expect(a).not.toBe(b)
  })
})
