import {
  GRAB_HEARTBEAT_MS,
  IDLE_LONG_MS,
  PANEL_OFFSET_ABOVE,
  STAGE_H_CSS,
  STAGE_W_CSS,
  WALK_SPEED_PX_PER_SEC,
} from '../shared/config.js'
import { createPicker, type PoolSource } from '../shared/behavior.js'
import { anyContains, bodyRect, panelAnchor } from '../shared/geometry.js'
import { createHoverTimer } from '../shared/hover.js'
import { createMotion, feetOffsetOf } from '../shared/motion.js'
import { bodyBoxOf, clipUrl, isLooping, isMirrorable, type SkinPayload } from '../shared/skin.js'
import { createRuleEngine } from '../shared/rules.js'
import type { ClipRef, Point, Rect } from '../shared/types.js'
import { createPanel, defaultActions } from './panel.js'
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

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('页面缺少 #root，装配无法开始')
/** 收窄一次，免得每个用到的地方都要写非空断言。 */
const root: HTMLElement = rootEl

function bootstrap(skin: SkinPayload): void {
  const manifest = skin.manifest
  const sprite = createSprite(root)
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

  const panel = createPanel(root, defaultActions(), (a) => {
    rules.feed('interacted')
    requestClip(a.pool)
  })

  /** 身体、面板、拖拽三者之一成立就要接住鼠标。 */
  let wantGrab = false
  let lastGrabSent = 0
  /** 上一次真正发出去的值。null = 还没发过，所以首次一定会发。 */
  let lastSentGrab: boolean | null = null
  /** 发过多少次续期请求。心跳坏掉时这个数字会停住，e2e 就靠它判定。 */
  let grabSends = 0

  function placePanel(): void {
    const body = hitBox()
    const screen = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }
    // 先摆一次才量得出面板自身尺寸，再按尺寸夹回屏幕内。面板宽度由按钮数量决定，
    // 事先不知道，只能量一次。
    panel.show({ x: body.x, y: Math.max(0, body.y - PANEL_OFFSET_ABOVE) })
    const size = panel.rect()
    if (!size) return
    panel.show(panelAnchor(body, { w: size.w, h: size.h }, screen, PANEL_OFFSET_ABOVE))
  }

  /**
   * 心跳。租约 500ms 不续期就自动放开，而 requestGrab 原本只在**光标移动时**发——
   * 用户把手停在面板上不动，500ms 后鼠标被放开给桌面，下一次点击就穿到下面的窗口去了。
   *
   * 但也不能每帧都发：不接鼠标时那样会以 60 次/秒的频率刷 IPC。
   * 规则是「值变了立刻发，值没变但还想接住时按节拍发」。
   */
  function sendGrab(): void {
    const now = Date.now()
    const heartbeatDue = wantGrab && now - lastGrabSent >= GRAB_HEARTBEAT_MS
    if (wantGrab === lastSentGrab && !heartbeatDue) return
    lastSentGrab = wantGrab
    lastGrabSent = now
    grabSends++
    window.petBridge?.requestGrab(wantGrab)
  }

  function paint(): void {
    const pos = stagePos()
    sprite.moveTo(pos.x, pos.y)
    const walking = current.pool === 'move'
    sprite.setFlip(motion.facing() === 'left' && walking && isMirrorable(manifest, current.name))
    if (panel.isOpen) placePanel()          // 宠物走动时面板要跟着，不然飘在旧位置
    if (outlineOn) sprite.showOutline(hitBox())
  }

  let lastFrame = Date.now()
  const frame = (): void => {
    const now = Date.now()
    if (current.pool === 'move' && !dragging) motion.step(now - lastFrame)
    lastFrame = now
    paint()
    sendGrab()
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  // 不需要额外的「定时问一次规则层」：播放器从不设置 video.loop，每条动画都会真的播完，
  // 行为链在每次播完时已经问过规则层了（最快 4 秒一拍，足够接住 idleLongMs）。
  // 早先版本在这里挂了个 setInterval，实测有两个害处：它会把一次性反应动画掐断，
  // 还会跟行为链抢同一条规则状态机，让 __testPlay 手工点歌被覆盖掉。

  /**
   * 一次光标评估。真实路径是主进程轮询系统光标后推过来；
   * 抽成具名函数是为了 e2e 能直接喂坐标——Playwright 的 mouse.move 走 CDP，
   * 不会动到操作系统光标，喂不进这条链路。
   */
  function handleCursor(p: Point): void {
    const over = overBody(p)
    const pr = panel.rect()
    const overPanel = pr !== null && anyContains([pr], p)
    const ev = hover.onPoint(p, over || dragging, overPanel)
    if (ev === 'open') placePanel()
    if (ev === 'close') panel.hide()
    wantGrab = over || overPanel || dragging || panel.isOpen
    sendGrab()
  }

  window.petBridge?.onCursor(handleCursor)

  // 穿透关掉时页面才收得到指针事件，所以这里的 down 一定发生在身体上
  window.addEventListener('pointerdown', (e) => {
    const p = { x: e.clientX, y: e.clientY }
    if (!overBody(p)) return
    // 命中区可视化用 Ctrl+Shift+点 切换，而不是 F9：这扇窗故意 focusable:false，
    // 永远收不到键盘事件；改用全局快捷键又会把 F9 从所有应用手里抢走。
    if (e.ctrlKey && e.shiftKey) {
      outlineOn = !outlineOn
      sprite.showOutline(outlineOn ? hitBox() : null)
      return            // 调试点击不该同时开始拖拽
    }
    dragging = true
    const pos = stagePos()
    dragOffset = { x: p.x - pos.x, y: p.y - pos.y }
    hover.reset()
    panel.hide()        // 面板锚在旧位置，宠物一动就飘；拖完靠悬停重新叫出来
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
    /** 当前生效的皮肤名。换皮肤那条端到端验收靠它确认装载的是哪一份。 */
    skinName: manifest.name,
    /** 喂一个光标位置，走与真实推送完全相同的路径。 */
    cursor: (p: Point): boolean => { handleCursor(p); return true },
    /** 把宠物挪到指定舞台位置，用于验收贴边与面板夹取。 */
    moveTo: (p: Point): Point => motion.setPosition(p),
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
    get panelOpen(): boolean {
      return panel.isOpen
    },
    get grabRequested(): boolean {
      return wantGrab
    },
    get grabSends(): number {
      return grabSends
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
    '检查 dist/preload/index.cjs 是否存在，以及 BrowserWindow 的 preload 路径是否指向它。',
  ])
}
