import {
  DEBUG_HOTKEY,
  IDLE_LONG_MS,
  STAGE_H_CSS,
  STAGE_W_CSS,
  WALK_SPEED_PX_PER_SEC,
} from '../shared/config.js'
import { createPicker, type PoolSource } from '../shared/behavior.js'
import { anyContains, bodyRect } from '../shared/geometry.js'
import { createHoverTimer } from '../shared/hover.js'
import { createMotion, feetOffsetOf } from '../shared/motion.js'
import { bodyBoxOf, clipUrl, isLooping, isMirrorable, type SkinPayload } from '../shared/skin.js'
import { createRuleEngine } from '../shared/rules.js'
import type { ClipRef, Point, Rect } from '../shared/types.js'
import { createSprite } from './sprite.js'
import { createVideoPlayer } from './player/video-backend.js'

/**
 * 渲染层装配：把播放器、行为链、悬停、拖拽接成一只真的会动的宠物。
 *
 * 两条容易搞错的地方：
 * ① 舞台位置来自 `motion.pos()`（舞台左上角），**不是** bodyRect 的返回值。
 *    把身体框当舞台位置会让角色整体偏移一个 bodyBox 的距离。
 * ② 位移只发生在 `move` 池。走路动画本身不平移，平移靠这里挪舞台。
 */

const root = document.getElementById('root')
if (!root) throw new Error('页面缺少 #root，装配无法开始')

function bootstrap(skin: SkinPayload): void {
  const manifest = skin.manifest
  const sprite = createSprite(root!)
  const player = createVideoPlayer({
    stage: sprite.stage,
    urlFor: (ref) => clipUrl(ref.pool, ref.name),
  })

  const source: PoolSource = manifest.weights
    ? { pools: skin.pools, weights: manifest.weights }
    : { pools: skin.pools }
  const picker = createPicker(Math.random)
  const rules = createRuleEngine(Date.now, IDLE_LONG_MS)
  const hover = createHoverTimer(Date.now)
  const motion = createMotion({
    bounds: { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight },
    speedPxPerSec: WALK_SPEED_PX_PER_SEC,
    feetOffsetCss: feetOffsetOf(manifest.canvas.feetY, manifest.canvas.h),
    start: { x: (window.innerWidth - STAGE_W_CSS) / 2, y: 0 },
  })
  motion.snapToBottom()

  let current: ClipRef = picker.pickFrom(source, 'idle', null) ?? { pool: 'idle', name: '' }
  let dragging = false
  let dragOffset: Point = { x: 0, y: 0 }
  let outlineOn = false
  /** 行为链的令牌：换目标时递增，旧链在 await 醒来后自己退出，保证同时只有一条链在播。 */
  let chainToken = 0

  const stagePos = (): Point => motion.pos()
  const hitBox = (): Rect => bodyRect({ bodyBox: bodyBoxOf(manifest, current.name) }, stagePos())
  const overBody = (p: Point): boolean => anyContains([hitBox()], p)

  function startChain(): void {
    const myToken = ++chainToken
    void (async (): Promise<void> => {
      while (myToken === chainToken) {
        const ref = current
        const r = await player.play(ref)
        if (myToken !== chainToken) return          // 已有新目标接管
        if (r === 'cancelled') {
          // 素材坏了或被协议挡下。停住并留痕，不许空转把 CPU 吃满
          console.error('[pet] 行为链停住：播放未开始', ref)
          return
        }
        const pool = rules.feed('tick')
        if (pool === ref.pool && isLooping(manifest, ref.pool, ref.name)) {
          // 循环 = 再点一次同一条。播放器不碰 video.loop，所以这里立刻把这条塞进后台槽，
          // 下一轮 play 直接拿到已解码的首帧，接缝看不出来。
          player.prepare(ref)
        } else {
          const next = picker.pickFrom(source, pool, ref)
          if (next) current = next
        }
      }
    })()
  }

  function requestClip(pool: string): void {
    const ref = picker.pickFrom(source, pool, current)
    if (!ref) return
    current = ref
    startChain()
  }

  function paint(): void {
    const pos = stagePos()
    sprite.moveTo(pos.x, pos.y)
    const walking = current.pool === 'move'
    sprite.setFlip(motion.facing() === 'left' && walking && isMirrorable(manifest, current.name))
    if (outlineOn) sprite.showOutline(hitBox())
  }

  let lastFrame = Date.now()
  const frame = (): void => {
    const now = Date.now()
    if (current.pool === 'move' && !dragging) motion.step(now - lastFrame)
    lastFrame = now
    paint()
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  // 不需要额外的「定时问一次规则层」：播放器从不设置 video.loop，每条动画都会真的播完，
  // 行为链在每次播完时已经问过规则层了（最快 4 秒一拍，足够接住 idleLongMs）。
  // 早先版本在这里挂了个 setInterval，实测有两个害处：它会把一次性反应动画掐断，
  // 还会跟行为链抢同一条规则状态机，让 __testPlay 手工点歌被覆盖掉。

  window.petBridge?.onCursor((p) => {
    const over = overBody(p)
    if (hover.onPoint(p, over || dragging, false) === 'open') requestClip('click')
    window.petBridge?.requestGrab(over || dragging || hover.isOpen)
  })

  // 穿透关掉时页面才收得到指针事件，所以这里的 down 一定发生在身体上
  window.addEventListener('pointerdown', (e) => {
    const p = { x: e.clientX, y: e.clientY }
    if (!overBody(p)) return
    dragging = true
    const pos = stagePos()
    dragOffset = { x: p.x - pos.x, y: p.y - pos.y }
    hover.reset()
  })
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return
    motion.setPosition({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y })
  })
  window.addEventListener('pointerup', () => {
    if (!dragging) return
    dragging = false
    motion.snapToBottom()
    rules.feed('dragged')
    requestClip('drag')
  })

  /** 人工排查与 e2e 用的钩子；Task 13 把它换成 F9 全局快捷键。 */
  const debug = {
    outline(on: boolean): boolean {
      outlineOn = on
      if (!on) sprite.showOutline(null)
      return outlineOn
    },
    get hitBox(): Rect {
      return hitBox()
    },
    get current(): ClipRef {
      return current
    },
  }
  Object.defineProperty(window, '__petDebug', { value: debug, configurable: true })
  Object.defineProperty(window, '__testPlay', {
    value: (pool: string, name: string): Promise<string> => {
      chainToken++          // 手工点歌接管行为链：旧链醒来后自己退出，不会再抢回播放权
      current = { pool, name }
      return player.play({ pool, name })
    },
    configurable: true,
  })

  startChain()
}

window.petBridge?.onSkin((payload) => {
  // 能跑但有情况（旧档回退、指定皮肤找不到）也要大声，只是不拦停
  for (const w of payload.warnings) console.warn('[pet]', w)
  if ('errors' in payload) {
    // 皮肤不合法就摊在屏幕上显示，不静默换默认皮肤（皮肤契约第 6 节）
    createSprite(root).showError([...payload.warnings, ...payload.errors])
    return
  }
  bootstrap(payload)
})

if (!window.petBridge) {
  createSprite(root).showError([
    'preload 没挂上：window.petBridge 不存在。',
    `检查 dist/preload/index.cjs 是否存在，以及 ${DEBUG_HOTKEY} 调试开关是否被误关。`,
  ])
}
