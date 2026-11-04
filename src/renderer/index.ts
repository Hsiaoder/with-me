import {
  BUBBLE_GAP,
  BUBBLE_H,
  BUBBLE_SHOW_MS,
  BUBBLE_W,
  GRAB_HEARTBEAT_MS,
  IDLE_LONG_MS,
  PANEL_GAP,
  PANEL_HIDE_MS,
  VIEW_HIDE_MS,
  STAGE_W_CSS,
  WALK_SPEED_PX_PER_SEC,
} from '../shared/config.js'
import { createPicker, nextClip, type NextClip, type PoolSource } from '../shared/behavior.js'
import { anyContains, bodyRect, bubbleAnchor, panelAnchor, rectContains, unionRect } from '../shared/geometry.js'
import { createHoverTimer } from '../shared/hover.js'
import { bodyInsetOf, createMotion, feetOffsetOf } from '../shared/motion.js'
import { bodyBoxOf, clipUrl, isLooping, isMirrorable, type SkinPayload } from '../shared/skin.js'
import { createRuleEngine } from '../shared/rules.js'
import { clamp, pickTalk, type TalkReason } from '../shared/talk.js'
import { DEFAULT_SETTINGS, type Settings } from '../shared/visibility.js'
import type { ClipRef, Point, Rect } from '../shared/types.js'
import { createBubble, type BubbleContent } from './bubble.js'
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
  /** 布局里某个元素现在的矩形。面板的位置由 placePanel 决定，问布局比让它自报准。 */
  const rectOf = (el: HTMLElement): Rect => {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  }
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
        // 只有交出决策权那一拍才是宠物自己闲逛，这时候才考虑开口
        if (nxt.ambient) maybeSayIdle()
      }
    })()
  }

  /** 点了这一格该播哪条。找不到素材就回落到 click，点了必须有反应。 */
  function requestClip(pool: string): boolean {
    const ref = picker.pickFrom(source, pool, current)
    if (!ref) return false
    current = ref
    startChain()
    return true
  }

  /**
   * 可见性设置的本地副本。开局由主进程把存档里的值推一次（onSettings），
   * 之后每次点选项先本地反馈、再上报——等主进程回灌会有肉眼可见的延迟。
   */
  let settings: Settings = { ...DEFAULT_SETTINGS }

  const panel = createPanel(root, defaultActions(), settings, {
    action: (a) => {
      lastInteractionAt = Date.now()
      rules.feed('interacted')
      requestClip(a.pool)
      sayFor(a.id === 'game' ? 'game' : 'status')
    },
    /**
     * 点了一格食物。播哪条动画由食物自己说了算；皮肤里没有那个池（自带的 block
     * 皮肤就没有 eat）就回落到 click 池——点了没反应比播错动画更糟。
     */
    pick: (f) => {
      lastInteractionAt = Date.now()
      rules.feed('interacted')
      if (!requestClip(f.anim?.pool ?? 'click')) requestClip('click')
      sayFor('feed')
    },
    setting: (patch) => {
      settings = { ...settings, ...patch }
      panel.setSettings(settings)
      window.petBridge?.setSettings(settings)
      // 选中态换了类，面板高度可能变，重新夹一次位置免得溢出屏幕
      if (panel.isOpen) placePanel()
    },
    view: (v) => {
      // 操作型视图（设置要连点两行开关、食物列表要拖横条逐个挑）用宽裕的收起延时，
      // 1500ms 不够操作完；回动作视图换回快档。顺带重挂自动收起的定时器。
      hover.setHideMs(v === 'actions' ? PANEL_HIDE_MS : VIEW_HIDE_MS)
      scheduleHover()
      if (panel.isOpen) placePanel()
    },
  })

  window.petBridge?.onSettings((s) => {
    settings = s
    panel.setSettings(s)
  })

  // ---- 气泡 ----
  const bubble = createBubble(root, {
    // 点完回应按钮气泡自己收了，但定时器还在装配层手里：不清掉它，下一次 say
    // 之前的空档里它会再 firing 一次（hide 是幂等的，但留着就是条没人认领的尾巴）。
    onReply: () => {
      if (bubbleDeadline !== null) clearTimeout(bubbleDeadline)
      bubbleDeadline = null
    },
  })
  /** 气泡自己的一次性定时器。不挂 rAF：覆盖层没焦点时 rAF 会被节流，定时器才准（心跳那条踩过）。 */
  let bubbleDeadline: ReturnType<typeof setTimeout> | null = null
  /** 气泡显示尺寸。来自 config，和 style.css 里那条 width/height 是同一个数（有测试钉住）。 */
  const BUBBLE_SIZE = { w: BUBBLE_W, h: BUBBLE_H }

  const screenRect = (): Rect => ({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight })

  const bubbleAnchorNow = (): Point =>
    bubbleAnchor(hitBox(), panel.isOpen ? rectOf(panel.el) : null, BUBBLE_SIZE, screenRect(), BUBBLE_GAP)

  function placeBubble(): void {
    bubble.place(bubbleAnchorNow())
  }

  /** 光标压在气泡上就算「还在读」。判据用坐标，不用 CSS :hover：穿透一开就收不到 mouseleave。 */
  function overBubble(p: Point): boolean {
    const r = bubble.rect()
    return r !== null && rectContains(r, p)
  }

  function armBubble(ms: number): void {
    if (bubbleDeadline !== null) clearTimeout(bubbleDeadline)
    bubbleDeadline = setTimeout(() => {
      if (bubble.isOpen && lastCursor !== null && overBubble(lastCursor)) armBubble(ms)
      else bubble.hide()
    }, ms)
  }

  /** 上次开口是什么时候。冷却的基准，六个 reason 都受它管。 */
  let lastTalkAt = 0
  /** 上次「用户动了」是什么时候。idle 那句要看它，规则层那把钟不对外露。 */
  let lastInteractionAt = Date.now()
  /** 随机源。e2e 换成定值，概率这条才测得准。 */
  let talkRng = Math.random

  /**
   * 开口说一句。文本在这里 clamp，调用方不必各自记得截断。
   * 空文本（clamp 之后变空串）直接不显示——挂一个空气泡比不说话更怪。
   * 传字符串就没有按钮；传 Line（台词表给的）会带上主人那句短回应。
   */
  function say(content: BubbleContent | string, ms: number = BUBBLE_SHOW_MS): boolean {
    const line = typeof content === 'string' ? { text: content } : content
    const clean = clamp(line.text)
    if (clean === '') return false
    bubble.show({ text: clean, reply: line.reply }, bubbleAnchorNow())
    lastTalkAt = Date.now()
    armBubble(ms)
    return bubble.isOpen
  }

  /**
   * 闲下来那一拍考虑开口。概率与冷却都在 `pickTalk` 里，这里只把运行时状态递进去。
   * 不新增计时器：这一拍本来就是「一条播完」的节奏，20s 的门槛由规则层决定。
   *
   * Line 是 {say, reply}，气泡要的是 {text, reply}——在这儿换名，别把两套叫法漏进组件里。
   */
  function maybeSayIdle(): void {
    const line = pickTalk('idle', { now: Date.now(), idleMs: Date.now() - lastInteractionAt, lastTalkAt }, talkRng)
    if (line !== null) say({ text: line.say, reply: line.reply })
  }

  /** 事件驱动的台词：用户做了动作就必说（只受冷却约束），不看概率。 */
  function sayFor(reason: TalkReason): void {
    const line = pickTalk(reason, { now: Date.now(), idleMs: 0, lastTalkAt }, talkRng)
    if (line !== null) say({ text: line.say, reply: line.reply })
  }

  /** 身体、面板、气泡、拖拽四者之一成立就要接住鼠标。 */
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
    if (bubble.isOpen) placeBubble()        // 气泡同理：话说到一半宠物走开了，气泡不能钉在原地
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

  /**
   * 光标形状的开关。每拍都调，但只在真的翻面时碰 DOM——
   * 33ms 一次的 classList 写入会不停触发样式重算，而这条挂在 body 上。
   */
  let overClassOn = false
  function setOverClass(on: boolean): void {
    if (on === overClassOn) return
    overClassOn = on
    document.body.classList.toggle('pet-over', on)
  }

  function handleCursor(p: Point): void {
    lastCursor = p
    const over = overBody(p)
    // 面板那块不自报矩形，直接问 DOM：命中的元素（或其祖先）带 data-hit 才算。
    // 收起的面板不在布局里，问不到，所以不存在「看不见却抢鼠标」的中间状态。
    const hit = document.elementFromPoint(p.x, p.y)
    /**
     * 悬停计时只认**面板**，不认任何 `data-hit`：气泡也带 data-hit（要抢鼠标、要手形），
     * 但「停在气泡上读那句话」不该把按钮面板叫出来——那是用户没做过的动作。
     * 抢鼠标与光标形状归 zone 管（下面的 unionRect），两件事分开。
     */
    const overPanel = hit !== null && hit.closest('.pet-panel') !== null
    const ev = hover.onPoint(p, over || dragging, overPanel)
    if (ev === 'open') placePanel()
    if (ev === 'close') panel.hide()
    /**
     * 交互区 = 身体框、开着的面板框、开着的气泡框三者的外接矩形。用外接矩形而不是并集，
     * 因为要的是**连续**：身体和面板之间那截空隙、四个按钮之间那 8px、面板与气泡之间
     * 那 12px，按各自矩形判都会落空，光标就会一路闪回桌面的样子。
     *
     * 空隙的点击归我们（按下不反应），这是连续的代价；但区域只在面板或气泡开着时
     * 才放大，而"算不算有人在使用"仍然只问 DOM 命中——停在看不见的空隙里不算活动，
     * 收起延时照旧跑，所以这段吞点击的时间有上界。
     */
    const zone = unionRect(hitBox(), panel.isOpen ? rectOf(panel.el) : null, bubble.rect())
    const inZone = rectContains(zone, p)
    setOverClass(inZone || dragging)
    wantGrab = inZone || dragging
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
    lastInteractionAt = Date.now()
    // 点身体在当前实现里走的就是这条路（pointerdown 立刻算拖起，pointerup 收尾），
    // 所以台词只有 drag——原来列过 click，但它没有任何触发点，留着就是死数据。
    sayFor('drag')
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
    /** 把气泡叫出来。ms 可缩短，免得 e2e 为了验收起要睡满 5 秒。 */
    say: (text: string, ms?: number): boolean => say(text, ms),
    /** 随机源换成定值：概率这条要在 e2e 里测准，不能靠真随机。 */
    setTalkRng: (v: number): number => {
      talkRng = () => v
      return v
    },
    /** 冷却时钟。e2e 传 0 表示「很久没说了」，传 Date.now() 还原。 */
    setLastTalk: (v: number): number => (lastTalkAt = v),
    /** 交互时钟。传 0 让 idle 的「闲够了」成立，传 Date.now() 还原。 */
    setLastInteraction: (v: number): number => (lastInteractionAt = v),
    /** 直接走一次「闲下来那一拍」的接缝，不改行为链的正常运行。 */
    tickAmbientForTalk: (): boolean => {
      maybeSayIdle()
      return bubble.isOpen
    },
    /** 立刻收掉气泡。e2e 用它收尾，免得残留的气泡影响后面几条检查的命中判定。 */
    hideBubble: (): boolean => {
      bubble.hide()
      if (bubbleDeadline !== null) clearTimeout(bubbleDeadline)
      return true
    },
    get bubbleOpen(): boolean {
      return bubble.isOpen
    },
    get bubbleText(): string {
      return bubble.el.querySelector('.pet-bubble-text')?.textContent ?? ''
    },
    /** 还有没有挂起的自动收起定时器。点完按钮该是 false，否则就是条没人认领的尾巴。 */
    get bubbleDeadlinePending(): boolean {
      return bubbleDeadline !== null
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
    /** 现在显示的是哪个视图。喂食/设置都改成切视图，光看 open 分不出是哪个。 */
    get panelView(): string {
      return panel.view
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
