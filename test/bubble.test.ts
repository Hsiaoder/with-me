import { describe, it, expect } from 'vitest'
import {
  BUBBLE_GAME_SECONDS, BUBBLE_LANES, BUBBLE_MAX_SIZE, BUBBLE_MIN_SIZE, BUBBLE_HUES, BUBBLE_CALM_SECONDS,
  bubbleSpeedFactor, makeBubble,
} from '../src/shared/bubble.js'

const fixed = (v: number) => () => v

describe('点泡泡 · 纯逻辑', () => {
  it('限时是个合理的正整数秒', () => {
    expect(BUBBLE_GAME_SECONDS).toBeGreaterThan(0)
    expect(Number.isInteger(BUBBLE_GAME_SECONDS)).toBe(true)
  })

  it('makeBubble：尺寸/位置/速度都在范围内，色相来自给定集合', () => {
    const W = 1000
    for (let seed = 0; seed < 30; seed++) {
      const b = makeBubble(fixed(seed / 30), W)
      expect(b.size).toBeGreaterThanOrEqual(BUBBLE_MIN_SIZE)
      expect(b.size).toBeLessThanOrEqual(BUBBLE_MAX_SIZE)
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.x + b.size).toBeLessThanOrEqual(W)        // 整个泡泡落在屏内
      expect(b.speed).toBeGreaterThan(0)
      expect(BUBBLE_HUES).toContain(b.hue)
    }
  })

  it('rng 不同 → 泡泡参数会变（不是写死一个）', () => {
    const a = makeBubble(fixed(0.1), 1000)
    const b = makeBubble(fixed(0.9), 1000)
    expect(`${a.size}|${a.x}|${a.hue}`).not.toBe(`${b.size}|${b.x}|${b.hue}`)
  })

  it('窄屏也不产生负宽度区间（x 夹在 [0, max(1, W-size)]）', () => {
    const b = makeBubble(fixed(0.5), 10)
    expect(b.x).toBeGreaterThanOrEqual(0)
  })

  it('车道落点：第 lane 条的泡泡只落在自己那段（左右铺得匀，不挤一侧）', () => {
    const W = 1000
    const laneW = W / BUBBLE_LANES
    for (let lane = 0; lane < BUBBLE_LANES; lane++) {
      for (let seed = 0; seed < 8; seed++) {
        const b = makeBubble(fixed(seed / 8), W, lane, BUBBLE_LANES)
        expect(b.x).toBeGreaterThanOrEqual(lane * laneW - 0.001)   // 不早于本条起点
        expect(b.x).toBeLessThanOrEqual((lane + 1) * laneW)        // 不越过下条起点
        expect(b.x + b.size).toBeLessThanOrEqual(W)                // 仍在屏内
      }
    }
  })

  it('轮转各车道 → 起点严格递增（泡泡横向必然铺开，不会全挤同一侧）', () => {
    const W = 1000
    const starts: number[] = []
    for (let lane = 0; lane < BUBBLE_LANES; lane++) {
      // 同一 rng 值，唯一变量是 lane：x 应随 lane 单调右移
      starts.push(makeBubble(fixed(0.5), W, lane, BUBBLE_LANES).x)
    }
    for (let i = 1; i < starts.length; i++) expect(starts[i]!).toBeGreaterThan(starts[i - 1]!)
  })

  it('速度倍率：前 3 秒匀速（=1），之后随时间单调爬升', () => {
    expect(bubbleSpeedFactor(0)).toBe(1)
    expect(bubbleSpeedFactor(BUBBLE_CALM_SECONDS)).toBe(1)
    expect(bubbleSpeedFactor(BUBBLE_CALM_SECONDS + 10)).toBeCloseTo(2, 6)   // 每秒 +10%
    expect(bubbleSpeedFactor(20)).toBeGreaterThan(bubbleSpeedFactor(10))
    expect(bubbleSpeedFactor(30)).toBeGreaterThan(bubbleSpeedFactor(20))
  })
})
