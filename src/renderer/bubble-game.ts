/**
 * 「点破泡泡」渲染层控制器。和飞/猜动作同一套游戏态接口 `{active,start,stop,hudRect}`。
 * 限时内泡泡从底部冒出往上飘，点中一个就破、计数 +1，时间到（或提前退出）按破掉数结算。
 *
 * 泡泡是 DOM 里一个个内嵌 SVG（圆/椭圆 + 高光），不用图片素材；纯参数在 `shared/bubble.ts`。
 * 驱动用 setInterval(~33ms)+真实 dt（这扇覆盖层对 rAF 节流有前科，定时器是已验证可靠的节拍）：
 * 同一个节拍里上浮泡泡、按 SPAWN_MS 冒新泡泡、走倒计时。
 *
 * `hudRect()` 返回**整屏**：限时点击游戏，整段时间鼠标都该被游戏接住（点哪都不穿到桌面）。
 */
import { BUBBLE_GAME_SECONDS, BUBBLE_LANES, BUBBLE_SPAWN_MS, bubbleSpeedFactor, makeBubble, type Bubble } from '../shared/bubble.js'
import type { Rect } from '../shared/types.js'

export type BubbleGameDeps = {
  root: HTMLElement
  /** 退出/时间到时按破掉数结算（count 在 stats 封顶）。 */
  reward: (count: number) => void
  onExit: () => void
  rng?: () => number
  clock?: () => number
}

const TICK_MS = 33
const POP_MS = 180
const SVG_NS = 'http://www.w3.org/2000/svg'

type LiveBubble = { el: HTMLButtonElement; x: number; y: number; size: number; speed: number; wobble: number; popped: boolean }

export function createBubbleGame(deps: BubbleGameDeps) {
  const rng = deps.rng ?? Math.random
  const clock = deps.clock ?? (() => performance.now())
  let state: 'off' | 'playing' = 'off'
  let popped = 0
  let elapsed = 0
  let spawnAcc = 0
  let spawnLane = 0
  let lastTick = 0
  let timer: ReturnType<typeof setInterval> | null = null
  let layer: HTMLElement | null = null
  let hud: HTMLElement | null = null
  let timeEl: HTMLElement | null = null
  let countEl: HTMLElement | null = null
  const bubbles: LiveBubble[] = []

  function hudRect(): Rect | null {
    if (state === 'off') return null
    return { x: 0, y: 0, w: innerWidth, h: innerHeight }
  }

  function bubbleSvg(b: Bubble): string {
    const r = b.size / 2
    const fill = `hsla(${b.hue}, 72%, 72%, 0.5)`
    const stroke = `hsla(${b.hue}, 70%, 52%, 0.85)`
    // 正圆（用户 2026-11-08 要「都做成正圆形，颜色和大小不一样」）：只变 size/hue，不变形状。
    return `<svg xmlns="${SVG_NS}" viewBox="0 0 ${b.size} ${b.size}" width="${b.size}" height="${b.size}">`
      + `<circle cx="${r}" cy="${r}" r="${r - 1.5}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`
      + `<ellipse cx="${r * 0.62}" cy="${r * 0.58}" rx="${r * 0.3}" ry="${r * 0.18}" fill="rgba(255,255,255,0.85)" transform="rotate(-35 ${r * 0.62} ${r * 0.58})"/>`
      + `</svg>`
  }

  function spawn(): void {
    if (!layer) return
    const b = makeBubble(rng, innerWidth, spawnLane, BUBBLE_LANES)
    spawnLane = (spawnLane + 1) % BUBBLE_LANES
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'pet-pop'
    el.dataset.id = 'bubble'
    el.setAttribute('aria-label', '泡泡')
    el.style.width = `${b.size}px`
    el.style.height = `${b.size}px`
    el.innerHTML = bubbleSvg(b)
    const live: LiveBubble = { el, x: b.x, y: innerHeight + b.size, size: b.size, speed: b.speed, wobble: b.wobble, popped: false }
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      pop(live)
    })
    layer.append(el)
    bubbles.push(live)
    place(live)
  }

  function place(b: LiveBubble): void {
    const sway = Math.sin(elapsed * 2 + b.wobble) * 12
    b.el.style.transform = `translate(${Math.round(b.x + sway)}px, ${Math.round(b.y)}px)`
  }

  function pop(b: LiveBubble): void {
    if (state !== 'playing' || b.popped) return
    b.popped = true
    popped++
    if (countEl) countEl.textContent = String(popped)
    b.el.classList.add('is-pop')
    b.el.disabled = true
    setTimeout(() => removeBubble(b), POP_MS)
  }

  function removeBubble(b: LiveBubble): void {
    b.el.remove()
    const i = bubbles.indexOf(b)
    if (i >= 0) bubbles.splice(i, 1)
  }

  function buildUi(): void {
    layer = document.createElement('div')
    layer.className = 'pet-pop-layer'
    deps.root.append(layer)
    hud = document.createElement('div')
    hud.className = 'pet-pop-hud'
    hud.dataset.hit = ''
    const row = document.createElement('div')
    row.className = 'pet-pop-row'
    timeEl = document.createElement('b')
    timeEl.textContent = String(BUBBLE_GAME_SECONDS)
    countEl = document.createElement('b')
    countEl.textContent = '0'
    row.append(
      Object.assign(document.createElement('span'), { textContent: '倒计时 ' }), timeEl,
      Object.assign(document.createElement('span'), { textContent: ' s 破掉 ' }), countEl,
    )
    const exit = document.createElement('button')
    exit.className = 'pet-pop-exit'
    exit.type = 'button'
    exit.dataset.id = 'bubble-exit'
    exit.textContent = '退出游戏'
    exit.addEventListener('click', () => stop())
    hud.append(row, exit)
    deps.root.append(hud)
  }

  function tick(): void {
    if (state !== 'playing') return
    const now = clock()
    const dt = Math.min(0.05, (now - lastTick) / 1000)
    lastTick = now
    elapsed += dt
    const remaining = Math.max(0, BUBBLE_GAME_SECONDS - elapsed)
    if (timeEl) timeEl.textContent = String(Math.ceil(remaining))
    spawnAcc += dt * 1000
    while (spawnAcc >= BUBBLE_SPAWN_MS) { spawn(); spawnAcc -= BUBBLE_SPAWN_MS }
    const speedMul = bubbleSpeedFactor(elapsed)   // 前 3 秒匀速，之后越来越快（作用于场上所有泡泡）
    for (const b of [...bubbles]) {
      if (b.popped) continue
      b.y -= b.speed * speedMul * dt
      if (b.y + b.size < 0) { removeBubble(b); continue }   // 飘出顶 = missed
      place(b)
    }
    if (remaining <= 0) stop()
  }

  function start(): void {
    if (state !== 'off') return
    state = 'playing'
    popped = 0
    elapsed = 0
    spawnLane = 0
    spawnAcc = BUBBLE_SPAWN_MS    // 开局立刻先冒一个，别让用户干等
    buildUi()
    spawn()
    lastTick = clock()
    timer = setInterval(tick, TICK_MS)
  }

  function stop(): void {
    if (state === 'off') return
    state = 'off'
    if (timer !== null) { clearInterval(timer); timer = null }
    for (const b of [...bubbles]) removeBubble(b)
    layer?.remove()
    hud?.remove()
    layer = hud = null
    timeEl = countEl = null
    deps.onExit()
    if (popped > 0) deps.reward(popped)
    popped = 0
  }

  return {
    active: () => state !== 'off',
    start,
    stop,
    hudRect,
    /** 已破掉几个（e2e 验「点破计数」）。 */
    poppedCount: () => popped,
  }
}
