/**
 * 「鲸鲸会飞」渲染层控制器。游戏激活时**接管宠物位置与指针**：
 * index.ts 的常规拖拽/点击处理在 `game.active()` 时全部提前 return，避免两套指针逻辑打架，
 * 也让现有那批拖拽 e2e（都在非游戏态跑）不受影响。
 *
 * 物理走 `shared/game.ts` 的纯函数；驱动用 setInterval(~33ms)+真实 dt，不用 rAF——
 * 这扇覆盖层对 rAF 节流有前科（见 index.ts 心跳那条注释），定时器是这里已验证可靠的节拍。
 */
import { launchFlight, readout, stepFlight, throwVelocity, type Flight } from '../shared/game.js'
import { rectContains } from '../shared/geometry.js'
import type { Rect } from '../shared/types.js'

export type FlyGameDeps = {
  root: HTMLElement
  getPos: () => { x: number; y: number }
  setPos: (x: number, y: number) => void
  petSize: () => { w: number; h: number }
  /** 当前体重（0–100 的读数）：这一甩的能量按它折算初速，越重飞得越低。 */
  weight: () => number
  playClip: () => void
  reward: () => void
  onExit: () => void
  clock?: () => number
}

const TICK_MS = 33
const GROUND_MARGIN = 24

export function createFlyGame(deps: FlyGameDeps) {
  const clock = deps.clock ?? (() => performance.now())
  let state: 'off' | 'idle' | 'held' | 'fly' = 'off'
  let flight: Flight | null = null
  let played = false
  let x = 0
  let dragging = false
  let grabX = 0
  let grabY = 0
  let samples: { t: number; y: number }[] = []
  let timer: ReturnType<typeof setInterval> | null = null
  let hud: HTMLElement | null = null
  let hEl: HTMLElement | null = null
  let maxEl: HTMLElement | null = null
  let spEl: HTMLElement | null = null

  const homeY = (): number => innerHeight - deps.petSize().h - GROUND_MARGIN

  function buildHud(): void {
    hud = document.createElement('div')
    hud.className = 'pet-fly-hud'
    hud.dataset.hit = ''
    const big = document.createElement('div')
    big.className = 'pet-fly-hud-big'
    hEl = document.createElement('span')
    hEl.textContent = '0'
    big.append(hEl, document.createTextNode(' m'))
    const row = document.createElement('div')
    row.className = 'pet-fly-hud-row'
    maxEl = document.createElement('b')
    maxEl.textContent = '0'
    spEl = document.createElement('b')
    spEl.textContent = '0'
    row.append(
      Object.assign(document.createElement('span'), { textContent: '最高 ' }), maxEl,
      Object.assign(document.createElement('span'), { textContent: ' m 速度 ' }), spEl,
      Object.assign(document.createElement('span'), { textContent: ' m/s' }),
    )
    const exit = document.createElement('button')
    exit.className = 'pet-fly-exit'
    exit.type = 'button'
    exit.dataset.id = 'fly-exit'
    exit.textContent = '退出游戏'
    exit.addEventListener('click', () => stop())
    hud.append(big, row, exit)
    deps.root.append(hud)
  }

  function updateHud(): void {
    if (!flight || !hEl || !maxEl || !spEl) return
    const r = readout(flight, homeY())
    hEl.textContent = String(Math.round(r.heightM))
    maxEl.textContent = String(Math.round(r.maxM))
    spEl.textContent = String(Math.round(r.speedMps))
  }

  const overPet = (px: number, py: number): boolean => {
    const p = deps.getPos()
    const s = deps.petSize()
    return px >= p.x && px <= p.x + s.w && py >= p.y && py <= p.y + s.h
  }

  function hudRect(): Rect | null {
    if (!hud) return null
    const r = hud.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  }

  function onDown(e: PointerEvent): void {
    if (state === 'off') return
    if (e.button !== 0) return
    const px = e.clientX, py = e.clientY
    const hudBox = hudRect()
    if (hudBox && rectContains(hudBox, { x: px, y: py })) return
    if (!overPet(px, py)) return
    const p = deps.getPos()
    grabX = px - p.x
    grabY = py - p.y
    dragging = true
    state = 'held'
    flight = null
    samples = [{ t: clock(), y: py }]
  }
  function onMove(e: PointerEvent): void {
    if (!dragging) return
    const px = e.clientX, py = e.clientY
    x = px - grabX
    const y = py - grabY
    deps.setPos(x, y)
    const now = clock()
    samples.push({ t: now, y: py })
    while (samples.length > 2 && now - samples[0]!.t > 90) samples.shift()
  }
  function onUp(): void {
    if (!dragging) return
    dragging = false
    const a = samples[0]!, b = samples[samples.length - 1]!
    const dt = (b.t - a.t) / 1000
    const raw = dt > 0 ? (b.y - a.y) / dt : 0
    const v = throwVelocity(raw, deps.weight())     // 同一份甩速，体重越重折出的初速越小、飞得越低
    if (v === null) { settle(); return }
    flight = launchFlight(v, deps.getPos().y)
    state = 'fly'
    played = true            // 真的抛出去过一次，退出时才结算这一局的账
    deps.playClip()
  }

  function settle(): void {
    // 没抛起来：落回地面，回到可再抓的待机。
    flight = null
    state = 'idle'
    deps.setPos(x, homeY())
  }

  function tick(): void {
    if (state !== 'fly' || !flight) return
    const now = clock()
    const dt = Math.min(0.05, (now - lastTick) / 1000)
    lastTick = now
    const r = stepFlight(flight, dt, homeY(), deps.petSize().h)
    deps.setPos(x, flight.y)
    updateHud()
    if (r.landed) settle()          // 落地只是落回地面；这一局的账在退出时统一结算（见 stop）
  }
  let lastTick = clock()

  function start(): void {
    if (state !== 'off') return
    state = 'idle'
    x = Math.round((innerWidth - deps.petSize().w) / 2)
    deps.setPos(x, homeY())
    buildHud()
    addEventListener('pointerdown', onDown)
    addEventListener('pointermove', onMove)
    addEventListener('pointerup', onUp)
    lastTick = clock()
    timer = setInterval(tick, TICK_MS)
  }

  function stop(): void {
    if (state === 'off') return
    state = 'off'
    if (timer !== null) { clearInterval(timer); timer = null }
    removeEventListener('pointerdown', onDown)
    removeEventListener('pointermove', onMove)
    removeEventListener('pointerup', onUp)
    hud?.remove()
    hud = null
    hEl = maxEl = spEl = null
    flight = null
    dragging = false
    deps.setPos(x, homeY())   // 退出时把宠物放回地面，别留在半空
    deps.onExit()
    // 「玩完之后」才结算：抛过一次才算真玩了，给一次 game 事件（涨心情/亲密、掉饱食/体重）。
    // 放在 onExit 之后，让宠物先回到普通态，飘字才贴在落回地面的身子上、而不是半空。
    if (played) deps.reward()
    played = false
  }

  return {
    active: () => state !== 'off',
    start,
    stop,
    hudRect,
  }
}
