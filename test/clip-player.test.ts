import { describe, it, expect } from 'vitest'
import { createFakePlayer } from '../src/renderer/player/fake-backend.js'
import { sameClip } from '../src/renderer/player/clip-player.js'

/**
 * 这组断言是 ClipPlayer 的**语义合同**，不是假实现的自测。
 * video 后端必须满足同一组约定（Task 10 的 e2e 会在真 DOM 上复现），
 * 所以这里钉死的每一条都要写成后端可对照的形式。
 */

const idle = { pool: 'idle', name: 'patrol' } as const
const other = { pool: 'idle', name: 'patrol2' } as const
const tapped = { pool: 'click', name: 'tapped' } as const

describe('generation', () => {
  it('每次 play 与 cancel 都递增', () => {
    const p = createFakePlayer()
    expect(p.generation).toBe(0)
    p.play(idle, { once: true })
    expect(p.generation).toBe(1)
    p.play(other, { once: true })
    expect(p.generation).toBe(2)
    p.cancel()
    expect(p.generation).toBe(3)
  })
})

describe('play 的收尾', () => {
  it('once 播放，素材播完后 resolve ended', async () => {
    const p = createFakePlayer()
    const r = p.play(tapped, { once: true })
    p.advance()
    await expect(r).resolves.toBe('ended')
  })

  it('cancel 使进行中的 play resolve cancelled', async () => {
    const p = createFakePlayer()
    const r = p.play(idle, { once: true })
    p.cancel()
    await expect(r).resolves.toBe('cancelled')
  })

  it('换播下一条会让上一条 resolve cancelled，不会留下悬着的 Promise', async () => {
    const p = createFakePlayer()
    const first = p.play(idle, { once: true })
    const second = p.play(other, { once: true })
    await expect(first).resolves.toBe('cancelled')
    p.advance()
    await expect(second).resolves.toBe('ended')
  })

  it('过期回调不许再改动状态：advance 之后重复 advance 不产生第二个结果', async () => {
    const p = createFakePlayer()
    const r = p.play(idle, { once: true })
    p.advance()
    p.advance()
    await expect(r).resolves.toBe('ended')
  })
})

describe('current', () => {
  it('播完不清空，行为层靠它排除刚播过那条', async () => {
    const p = createFakePlayer()
    const r = p.play(idle, { once: true })
    p.advance()
    await r
    expect(p.current).toEqual(idle)
  })

  it('被 cancel 也不清空', async () => {
    const p = createFakePlayer()
    const r = p.play(tapped, { once: true })
    p.cancel()
    await r
    expect(p.current).toEqual(tapped)
  })

  it('destroy 才清空', () => {
    const p = createFakePlayer()
    p.play(idle)
    p.destroy()
    expect(p.current).toBeNull()
  })
})

describe('prepare', () => {
  it('重复 prepare 同一条不产生第二次副作用', () => {
    const p = createFakePlayer()
    p.prepare(idle)
    p.prepare(idle)
    expect(p.prepared).toHaveLength(1)
    p.prepare(other)
    expect(p.prepared).toHaveLength(2)
  })
})

describe('sameClip', () => {
  it('同池同名才算同一条', () => {
    expect(sameClip(idle, idle)).toBe(true)
    expect(sameClip(idle, other)).toBe(false)
    expect(sameClip(null, idle)).toBe(false)
    expect(sameClip({ pool: 'idle', name: 'patrol' }, idle)).toBe(true)
  })
})
