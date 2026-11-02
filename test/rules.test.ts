import { describe, it, expect } from 'vitest'
import { createRuleEngine } from '../src/shared/rules.js'

function engine(idleLongMs: number) {
  let t = 0
  return { r: createRuleEngine(() => t, idleLongMs), set: (v: number) => { t = v } }
}

describe('规则层', () => {
  it('被点 → click，下一拍归位回 idle', () => {
    const { r } = engine(60_000)
    expect(r.feed('interacted')).toBe('click')
    expect(r.state).toBe('respond')
    expect(r.feed('tick')).toBe('idle')
    expect(r.state).toBe('active')
  })

  it('被拖 → drag，下一拍归位', () => {
    const { r } = engine(60_000)
    expect(r.feed('dragged')).toBe('drag')
    expect(r.feed('tick')).toBe('idle')
  })

  it('超过 idleLongMs 无人交互，tick 落到 move', () => {
    const { r, set } = engine(1000)
    expect(r.feed('tick')).toBe('idle')
    set(1500)
    expect(r.feed('tick')).toBe('move')
  })

  it('归位那一拍不顺便自主走动：刚互动完就自己跑开很怪', () => {
    const { r, set } = engine(1000)
    r.feed('interacted')
    set(1500)
    expect(r.feed('tick')).toBe('idle')     // 先归位
    expect(r.feed('tick')).toBe('move')     // 再下一拍才走
  })

  it('拖拽之后计时被重置，不会立刻判定久无人理', () => {
    const { r, set } = engine(1000)
    set(500)
    r.feed('dragged')
    set(900)
    r.feed('tick')                          // 归位
    set(1400)
    expect(r.feed('tick')).toBe('idle')     // 距拖拽只过了 500ms
    set(1600)
    expect(r.feed('tick')).toBe('move')
  })

  it('连续被点每次都回 click，不会累积状态', () => {
    const { r } = engine(60_000)
    expect(r.feed('interacted')).toBe('click')
    expect(r.feed('interacted')).toBe('click')
    expect(r.state).toBe('respond')
  })

  it('move 之后没人理会一直 move', () => {
    const { r, set } = engine(1000)
    set(1500)
    expect(r.feed('tick')).toBe('move')
    set(2500)
    expect(r.feed('tick')).toBe('move')
  })
})
