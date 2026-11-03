// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createVideoPlayer } from '../src/renderer/player/video-backend.js'
import { CLIP_FADE_MS } from '../src/shared/config.js'

/**
 * 换片那一瞬不许漏光。
 *
 * 两层同时动（新层 0→1、旧层 1→0）叠出来的不透明度是 f+(1−f)²，中间只有 0.75，
 * 桌面会从宠物身上透过去——用户看到的是「闪一下」，而且**每次换片都闪**。
 * 正确做法是只让一层动：新层立刻满不透明压在下面，旧层盖在上面淡出，
 * 淡完再把它摘掉。这样合成结果恒等于 1。
 *
 * jsdom 不跑 CSS 也不跑过渡，所以这里测的是**类的交接**：谁在上一层、谁还满不透明、
 * 什么时候被摘掉。真实像素由 e2e 的 capturePage 那条检查守。
 */

const idle = { pool: 'idle', name: 'patrol' } as const
const tapped = { pool: 'click', name: 'tapped' } as const

let stage: HTMLElement
let videos: () => HTMLVideoElement[]

/** jsdom 的 readyState 是原型上的只读 getter，按实例盖掉才能喂 loadeddata。 */
function makeReady(v: HTMLVideoElement): void {
  Object.defineProperty(v, 'readyState', { configurable: true, value: 4 })
  Object.defineProperty(v, 'play', { configurable: true, value: () => Promise.resolve() })
  Object.defineProperty(v, 'pause', { configurable: true, value: () => {} })
  // jsdom 的 load() 会往 stderr 刷 "Not implemented"，盖掉它保持输出干净
  Object.defineProperty(v, 'load', { configurable: true, value: () => {} })
}

beforeEach(() => {
  vi.useFakeTimers()
  stage = document.createElement('div')
  document.body.replaceChildren(stage)
  videos = () => [...stage.querySelectorAll('video')] as HTMLVideoElement[]
})

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

/** 装配到「idle 正在播」：两个槽都解码就绪，第一次 play 走完交接。 */
function mounted() {
  const player = createVideoPlayer({ stage, urlFor: (r) => `app://skin/${r.pool}/${r.name}.webm` })
  videos().forEach(makeReady)
  player.play(idle)
  videos().forEach((v) => v.dispatchEvent(new Event('loadeddata')))
  return player
}

/** jsdom 不实现 currentSrc，但 src 会原样落到属性上，够认是哪条了。 */
const of = (ref: { pool: string; name: string }) =>
  videos().find((v) => (v.getAttribute('src') ?? '').includes(`${ref.pool}/${ref.name}`))!

describe('换片交接', () => {
  it('新层上任即满不透明（压在下面），旧层带着 is-out 盖在上面淡出', () => {
    const player = mounted()
    expect(of(idle).classList.contains('is-front')).toBe(true)

    player.play(tapped)
    videos().forEach((v) => v.dispatchEvent(new Event('loadeddata')))

    const out = of(idle)
    const front = of(tapped)
    expect(front.classList.contains('is-front')).toBe(true)
    expect(front.classList.contains('is-out')).toBe(false)
    // 旧层这时候必须还是满的：它一淡，新层也在淡，中间就漏光了
    expect(out.classList.contains('is-out')).toBe(true)
    expect(out.classList.contains('is-front')).toBe(false)
  })

  it('淡完才把旧层摘掉：is-out 存活满 CLIP_FADE_MS', () => {
    const player = mounted()
    player.play(tapped)
    videos().forEach((v) => v.dispatchEvent(new Event('loadeddata')))

    vi.advanceTimersByTime(CLIP_FADE_MS - 1)
    expect(of(idle).classList.contains('is-out')).toBe(true)

    vi.advanceTimersByTime(2)
    expect(of(idle).classList.contains('is-out')).toBe(false)
  })

  it('连着换两次不会留下过期的 is-out（旧旧层不该一直盖着）', () => {
    const player = mounted()
    player.play(tapped)
    videos().forEach((v) => v.dispatchEvent(new Event('loadeddata')))
    const move = { pool: 'move', name: 'walk' } as const
    player.play(move)
    videos().forEach((v) => v.dispatchEvent(new Event('loadeddata')))

    // 第二次交接把 tapped 顶上退场位，同时必须把上一轮的退场标记从新前台身上清掉
    expect(stage.querySelectorAll('video.is-out')).toHaveLength(1)
    expect(stage.querySelectorAll('video.is-front')).toHaveLength(1)
    expect(of(tapped).classList.contains('is-out')).toBe(true)
    expect(of(move).classList.contains('is-front')).toBe(true)

    // 第一条淡出的定时器还在跑，它不能把第二次交接的 is-out 提前摘掉
    vi.advanceTimersByTime(CLIP_FADE_MS - 1)
    expect(of(tapped).classList.contains('is-out')).toBe(true)
    vi.advanceTimersByTime(2)
    expect(of(tapped).classList.contains('is-out')).toBe(false)
  })

  it('前台永远恰好一个，退场层最多一个', () => {
    const player = mounted()
    player.play(tapped)
    videos().forEach((v) => v.dispatchEvent(new Event('loadeddata')))
    expect(stage.querySelectorAll('video.is-front')).toHaveLength(1)
    expect(stage.querySelectorAll('video.is-out')).toHaveLength(1)
  })
})
