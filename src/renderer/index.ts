import {
  GRAB_HEARTBEAT_MS,
  IDLE_LONG_MS,
  PANEL_GAP,
  PANEL_HIDE_MS,
  SETTING_HIDE_MS,
  STAGE_W_CSS,
  WALK_SPEED_PX_PER_SEC,
} from '../shared/config.js'
import { createPicker, nextClip, type NextClip, type PoolSource } from '../shared/behavior.js'
import { anyContains, bodyRect, panelAnchor } from '../shared/geometry.js'
import { createHoverTimer } from '../shared/hover.js'
import { bodyInsetOf, createMotion, feetOffsetOf } from '../shared/motion.js'
import { bodyBoxOf, clipUrl, isLooping, isMirrorable, type SkinPayload } from '../shared/skin.js'
import { createRuleEngine } from '../shared/rules.js'
import { DEFAULT_SETTINGS, type Settings } from '../shared/visibility.js'
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

/** 页面装配。没有 destroy()：这扇窗只装配一次——主进程用 once('did-finish-load')
 * 推皮肤，页面既不 reload 也不热切换。等真出现第二个装配点再补 disposer，
 * 现在写出来就是个没有调用方的空壳（编码规则第 8 条）。 */
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
  // 时钟偏移只给测试钩子用：规格第 8 节把时钟定成注入项，为的就是能不改代码
  // 就把规则层拧到「久无人理」那一档去验接线。正式路径永远是 0。
  let clockOffset = 0
  const rules = createRuleEngine(() => Date.now() + clockOffset, IDLE_LONG_MS)
  const hover = createHoverTimer(Date.now)
  const motion = createMotion({
    bounds: { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight },
    speedPxPerSec: WALK_SPEED_PX_PER_SEC,
    feetOffsetCss: feetOffsetOf(manifest.canvas.feetY, manifest.canvas.h),
    // 夹取按角色实际占位算，不按舞台矩形——画布左右那截空白以前会把角色挡在屏幕边缘之外
    bodyInset: bodyInsetOf(manifest.bodyBox),
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
  const loopsOf = (r: ClipRef): boolean => isLooping(manifest, r.pool, r.name)

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
        const nxt = nextClip({ rules, picker, source, loops: loopsOf, ref })
        if (nxt.kind === 'loop') {
          // 循环 = 再点一次同一条。播放器不碰 video.loop，所以这里立刻把这条塞进后台槽，
          // 下一轮 play 直接拿到已解码的首帧，接缝看不出来。
          player.prepare(nxt.ref)
        } else {
          current = nxt.ref
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

  /**
   * 可见性设置的本地副本。开局由主进程把存档里的值推一次（onSettings），
   * 之后每次点选项先本地反馈、再上报——等主进程回灌会有肉眼可见的延迟。
   */
  let settings: Settings = { ...DEFAULT_SETTINGS }

  const panel = createPanel(root, defaultActions(), settings, {
    action: (a) => {
      rules.feed('interacted')
      requestClip(a.pool)
    },
    setting: (patch) => {
      settings = { ...settings, ...patch }
      panel.setSettings(settings)
      window.petBridge?.setSettings(settings)
      // 选中态换了类，面板高度可能变，重新夹一次位置免得溢出屏幕
      if (panel.isOpen) placePanel()
    },
    view: (v) => {
      // 设置视图要连点两行开关，1500ms 的收起延时不够用，换宽裕的值并重挂自动收起的定时器
      hover.setHideMs(v === 'settings' ? SETTING_HIDE_MS : PANEL_HIDE_MS)
      scheduleHover()
      if (panel.isOpen) placePanel()
    },
  })

  window.petBridge?.onSettings((s) => {
    settings = s
    panel.setSettings(s)
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
    // 事先不知道，只能量一次。收起时它不在布局里，所以量这一步只在打开状态下有意义。
    panel.show({ x: body.x, y: body.y + body.h + PANEL_GAP })
    const size = panel.size()
    if (!size) return
    panel.show(panelAnchor(body, size, screen, PANEL_GAP))
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
  let frameCount = 0
  const frame = (): void => {
    frameCount++
    const now = Date.now()
    if (current.pool === 'move' && !dragging) motion.step(now - lastFrame)
    lastFrame = now
    paint()
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  // 心跳必须是定时器，不能挂在 requestAnimationFrame 上：整屏覆盖层没有焦点时
  // Chromium 会把 rAF 节流到 1 帧/秒左右（实测 1.4 秒只跑了 2 帧），
  // 那样 250ms 的节拍根本兑现不了，租约照旧超时。
  setInterval(sendGrab, GRAB_HEARTBEAT_MS / 2)

  // 不需要额外的「定时问一次规则层」：播放器从不设置 video.loop，每条动画都会真的播完，
  // 行为链在每次播完时已经问过规则层了（最快 4 秒一拍，足够接住 idleLongMs）。
  // 早先版本在这里挂了个 setInterval，实测有两个害处：它会把一次性反应动画掐断，
  // 还会跟行为链抢同一条规则状态机，让 __testPlay 手工点歌被覆盖掉。

  /**
   * 一次光标评估。真实路径是主进程轮询系统光标后推过来；
   * 抽成具名函数是为了 e2e 能直接喂坐标——Playwright 的 mouse.move 走 CDP，
   * 不会动到操作系统光标，喂不进这条链路。
   */
  let lastCursor: Point | null = null
  let hoverDeadline: ReturnType<typeof setTimeout> | null = null

  /**
   * 主进程对相同坐标去重，所以手真的停在宠物上不动时不会再有第二次事件进来。
   * 悬停延时得自己催：还有挂起的转换就按剩余时间设一个定时器，到点用最后
   * 那个坐标重喂一次（顺便重算命中框——宠物在走动，是它走过来撞上的光标）。
   */
  function scheduleHover(): void {
    if (hoverDeadline !== null) clearTimeout(hoverDeadline)
    hoverDeadline = null
    if (lastCursor === null) return
    const left = hover.pendingMs(Date.now())
    if (left === null) return
    const p = lastCursor
    hoverDeadline = setTimeout(() => handleCursor(p), left)
  }

  function handleCursor(p: Point): void {
    lastCursor = p
    const over = overBody(p)
    // 面板那块不自报矩形，直接问 DOM：命中的元素（或其祖先）带 data-hit 才算。
    // 收起的面板不在布局里，问不到，所以不存在「看不见却抢鼠标」的中间状态。
    const hit = document.elementFromPoint(p.x, p.y)
    const overPanel = hit !== null && hit.closest('[data-hit]') !== null
    const ev = hover.onPoint(p, over || dragging, overPanel)
    if (ev === 'open') placePanel()
    if (ev === 'close') panel.hide()
    // 「面板还开着」不参与判定：穿透是整窗粒度，多扣一秒鼠标就多吞一秒全桌点击。
    // 面板的 400ms 收起延时只管可见性。光标要回来点按钮时，进到面板矩形里
    // 下一拍（≤33ms）就把鼠标接住，人手从移到位到按下远不止这点时间。
    wantGrab = over || overPanel || dragging
    sendGrab()
    scheduleHover()
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
    // 拖拽期间不该弹面板：挂在途中的悬停定时器要一起撤掉，否则它会在按住的时候到点
    if (hoverDeadline !== null) {
      clearTimeout(hoverDeadline)
      hoverDeadline = null
    }
    panel.hide()        // 面板锚在旧位置，宠物一动就飘；拖完靠悬停重新叫出来
  })
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return
    motion.setPosition({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y })
  })
  window.addEventListener('pointerup', () => {
    if (!dragging) return
    dragging = false
    // 停在松手的地方。这里原来调了 snapToBottom()，把高度强行拉回地面，
    // 于是把宠物拖到右上角松手后它会"跳回原位"。setPosition 已经把 y 夹在
    // 屏幕内了，不需要再吸附。（启动时落地仍由 bootstrap 里的 snapToBottom 负责）
    rules.feed('dragged')
    requestClip('drag')
  })

  /** 人工排查与 e2e 用的钩子；Task 13 把它换成 F9 全局快捷键。 */
  const debug = {
    /** 当前生效的皮肤名。换皮肤那条端到端验收靠它确认装载的是哪一份。 */
    skinName: manifest.name,
    /** rAF 跑了多少帧。覆盖层没焦点时 Chromium 会节流渲染，走路就会一卡一卡——用它测出来。 */
    get frames(): number {
      return frameCount
    },
    /** 喂一个光标位置，走与真实推送完全相同的路径。 */
    cursor: (p: Point): boolean => { handleCursor(p); return true },
    /** 把宠物挪到指定舞台位置，用于验收贴边与面板夹取。 */
    moveTo: (p: Point): Point => motion.setPosition(p),
    /**
     * 用给定随机数走一遍真实的「播完下一条播什么」接缝：规则层、皮肤权重、
     * manifest 的循环性全用运行时那一份，只是把时钟临时拧过 IDLE_LONG_MS、
     * 随机数换成可控值，叫完就把偏移还原，不打扰正在跑的行为链。
     *
     * 存在的理由：pickAmbient 曾经单测全绿却没人调用（复审 #2 的 P1-2）。
     * 接线必须由运行链路自己证明，不能只看零件。
     */
    ambientNext(rng: number): NextClip {
      const saved = clockOffset
      clockOffset = IDLE_LONG_MS * 2
      try {
        // 刚被点完/拖完那一拍是「归位」，规则层必定回 idle。这条钩子要验的是交出
        // 决策权之后的接缝，所以先把那一拍让掉——正式链路下一拍本来也会这么走。
        if (rules.state !== 'active') rules.feed('tick')
        return nextClip({ rules, picker: createPicker(() => rng), source, loops: loopsOf, ref: current })
      } finally {
        clockOffset = saved
      }
    },
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
