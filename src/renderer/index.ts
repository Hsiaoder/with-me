import {
  ACTIVITY_FALLBACK,
  ACTIVITY_LABELS,
  BUBBLE_GAP,
  BUBBLE_H,
  BUBBLE_SHOW_MS,
  BUBBLE_W,
  DRAG_START_PX,
  FLOAT_CHIP,
  FLOAT_GAP,
  FLOAT_HEAD_OFFSET,
  GRAB_HEARTBEAT_MS,
  IDLE_LONG_MS,
  ONLINE_TICK_MS,
  PANEL_GAP,
  PANEL_HIDE_MS,
  PLATE_GAP,
  VIEW_HIDE_MS,
  STAGE_W_CSS,
  WALK_SPEED_PX_PER_SEC,
} from '../shared/config.js'
import { createPicker, nextClip, type NextClip, type PoolSource } from '../shared/behavior.js'
import { anyContains, bodyRect, bubbleAnchor, floatAnchor, inkRect, panelAnchor, rectContains, stackAnchor, statsAnchor, unionRect } from '../shared/geometry.js'
import { createHoverTimer } from '../shared/hover.js'
import { bodyInsetOf, createMotion, feetOffsetOf } from '../shared/motion.js'
import { bodyBoxOf, clipUrl, inkInsetsOf, isLooping, isMirrorable, type SkinPayload } from '../shared/skin.js'
import { createRuleEngine } from '../shared/rules.js'
import { clamp, greetLineForHour, pickLine, pickTalk, TALK_LINES, type TalkReason } from '../shared/talk.js'
import { gainsToFloat, isBlue, isHungry, levelOf, INITIAL_STATS, LEVEL_CUM, MAX_LEVEL, type FloatGain, type Stats } from '../shared/stats.js'
import type { Food } from '../shared/food.js'
import type { Game } from '../shared/games.js'
import type { DebugContext } from './debug.js'
import {
  LEVELUP_CLIP, SLEEPY, pickAmbient, pickForSpeech, pickInteract, type Situation,
} from '../shared/animation.js'
import { formatOnline } from '../shared/text.js'
import type { StatsSnapshot } from '../shared/save.js'
import { DEFAULT_SETTINGS, type Settings } from '../shared/visibility.js'
import type { ClipRef, Point, Rect } from '../shared/types.js'
import { createBubble, type BubbleContent } from './bubble.js'
import { createFloatLayer } from './float.js'
import { createPanel, defaultActions } from './panel.js'
import { createSprite } from './sprite.js'
import { createFlyGame } from './game.js'
import { createGuessGame } from './guess.js'
import { createBubbleGame } from './bubble-game.js'
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

  // 屏幕工作区在运行中会变（改分辨率 / 系统缩放 / 旋转 / 任务栏自动隐藏）。主进程已把覆盖层重摆，
  // 这里跟着把走动/拖拽的夹取边界按新视口重算并把宠物夹回可见区。面板与气泡不用管：
  // 它们每帧用 live 的 innerWidth/innerHeight 摆位，下一拍自然跟上。
  window.addEventListener('resize', () => {
    motion.setBounds({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight })
  })

  let current: ClipRef = picker.pickFrom(source, 'idle', null) ?? { pool: 'idle', name: '' }
  let dragging = false
  let dragOffset: Point = { x: 0, y: 0 }
  /** 按下点与「真的拖起来了」的判定结果：没过阈值的那次是「点」，不是拖。 */
  let pressPoint: Point = { x: 0, y: 0 }
  let dragStarted = false
  let outlineOn = false
  /** 行为链的令牌：换目标时递增，旧链在 await 醒来后自己退出，保证同时只有一条链在播。 */
  let chainToken = 0

  const stagePos = (): Point => motion.pos()
  const hitBox = (): Rect => bodyRect({ bodyBox: bodyBoxOf(manifest, current.name) }, stagePos())
  const overBody = (p: Point): boolean => anyContains([hitBox()], p)
  /**
   * 面板现在占的那几块的外接矩形，收起时是 null。
   * 不能拿根节点当面板矩形：它是铺满覆盖层的定位层，拿它判会让气泡以为
   * 全屏都是面板、让光标连续区直接圈进整块屏幕。
   */
  const panelBox = (): Rect | null => {
    const [first, ...rest] = panel.rects()
    if (first === undefined) return null
    return unionRect(first, ...rest)
  }

  /**
   * 气泡要让开的那块。**状态视图只让按钮条**：状态栏挂在宠物侧面，
   * 把它算进外接矩形会让矩形下沿低到身体中线以下，`bubbleAnchor` 就判不出
   * 「面板在头顶」，气泡落回身体正上方——正好压在常驻的按钮条上（截图量出来过）。
   * 食物列表反过来要算进去：它和按钮条在同一条中轴线上，是让路的下一格。
   */
  const bubblePanelBox = (): Rect | null => {
    if (panel.view !== 'stats') return panelBox()
    const primary = panel.primaryEl()
    if (primary === null) return null
    const r = primary.getBoundingClientRect()
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
        // 「猜动作」正在考某动作、还没被答：在它**真播完**这一拍无缝续挂同一条，别掉回 idle
        // （用户 2026-11-08 要「播完直接重复、不要 idle 那一下」）。续挂走的就是下面 loop 那条后台槽预热，接缝看不出。
        const gloop = guessGame.loopRef()
        if (gloop && gloop.pool === ref.pool && gloop.name === ref.name) {
          player.prepare(ref)
          continue
        }
        const nxt = nextClip({ rules, picker, source, loops: loopsOf, ref })
        if (nxt.kind === 'loop') {
          // 循环 = 再点一次同一条。播放器不碰 video.loop，所以这里立刻把这条塞进后台槽，
          // 下一轮 play 直接拿到已解码的首帧，接缝看不出来。
          player.prepare(nxt.ref)
        } else if (nxt.ambient) {
          // 日常动画机制（docs/动画.txt）：交出决策权那一拍按情境选具名片段；
          // 皮肤里没有这条（如占位皮肤没 daily 池）就回落到原来的池选，保证不会卡在同一条上。
          const daily = pickAmbient(situation(), talkRng)
          // 播成功时 requestClip 已换 current、syncEating/Runtime 并起了新链，本迭代随 chainToken 失效自然退出。
          if (daily && requestClip(daily.pool, daily.name)) {
            lastWasSleepy = SLEEPY.some((s) => s.pool === daily.pool && s.name === daily.name)
          } else {
            lastWasSleepy = false
            current = nxt.ref
            syncEating(); syncRuntime(); flushGains()
          }
        } else {
          current = nxt.ref
          syncEating()
          syncRuntime()
          // 这一拍是「刚才那条动画演完了，决策权交回来」——攒着的数字就在这一刻冒出来。
          flushGains()
        }
        // 只有交出决策权那一拍才是宠物自己闲逛，这时候才考虑开口
        if (nxt.ambient) maybeSayIdle()
      }
    })()
  }

  /**
   * 把「正在吃饭」推给面板：这一口没吃完，食物列表整列点不动（用户拍的板）。
   * 判据就是 `current.pool`，和 `requestClip` 那道「不许打断」的闸同一个来源——
   * 再立一个标志位就是两份账，迟早对不上。
   * 饭吃完那一拍由行为链自己交出决策权（`current` 换成 idle/turn）时解开。
   * **被拎起来不再算解开**（2026-11-06 改）：拖拽只挪位置，不吃相照样演完，
   * 所以嘴边那口还在，格子就该一直灰着。
   */
  function syncEating(): void {
    panel.setEating(current.pool === 'eat')
  }

  /**
   * 把「此刻」推给状态栏：状态 = 当前动画池的人话，在线时间 = 本次进程陪了多久。
   *
   * 为什么不并进数值快照那条通道：快照一分钟才推一把，而这两行要一跳一跳地动
   * （见 panel.ts 的 `PanelRuntime`）。在线时长的起点是主进程记的 `startedAt`，
   * 渲染层只拿它做一次减法——它自己不知道进程是什么时候起来的。
   * 快照还没到就什么都不推：面板那两行会保持省略号，编一个「0秒」不如说「还不知道」。
   */
  function syncRuntime(): void {
    if (snap === null) return
    panel.setRuntime({
      activity: ACTIVITY_LABELS[current.pool] ?? ACTIVITY_FALLBACK,
      online: formatOnline(Date.now() - snap.startedAt),
    })
  }

  /**
   * 播一条。给了名字就**必须播那条**（点哪格吃哪口），皮肤里没有这个名字返回 false，
   * 由调用方降级；没给名字就在池里随机挑一条（避开刚播过那条）。
   *
   * 「正在吃饭时不被打断」这道闸在这里，而且**没有例外**：吃饭期间任何动作都不换动画，
   * 包括拖拽。以前留了一条「拖拽算物理打断，可以顶掉吃相」，用户 2026-11-06 明确不要了：
   * 拎着走的时候它还在嚼，那才像一只被拿起来的小东西；换成「被拎起」的姿势反倒把一口饭切没了。
   * 拖拽本身仍然有反应——位置立刻跟着手走，菜单和气泡照旧收掉，只是动画不换。
   * 以前还留过一条「名字寻址的那一次（再喂一口就改口吃新的）」，2026-11-05 起界面上走不到了：
   * 吃饭期间整列格子是 `disabled`，点不动。留着那条例外等于留一条没人走的路径。
   * 台词、菜单、养成数值都在调用方那边照走，所以「不打断动画」不等于「没反应」。
   */
  function requestClip(pool: string, name?: string): boolean {
    if (current.pool === 'eat') return false
    const ref = name === undefined
      ? picker.pickFrom(source, pool, current)
      : picker.pickNamed(source, pool, name)
    if (!ref) return false
    current = ref
    syncEating()
    syncRuntime()
    startChain()
    return true
  }

  /**
   * **动作**发起的那一次播放。真起了动画就把飘字挂起来，等这条演完那一拍再冒
   * （见 `holdGainsForClip`）。
   * 只有会报养成数值的动作走这里——喂食、逗玩；点身体和拖拽不报数值，挂它没意义。
   */
  function requestActionClip(pool: string, name?: string): boolean {
    const ok = requestClip(pool, name)
    if (ok) holdGainsForClip = true
    return ok
  }

  /**
   * 可见性设置的本地副本。开局由主进程把存档里的值推一次（onSettings），
   * 之后每次点选项先本地反馈、再上报——等主进程回灌会有肉眼可见的延迟。
   */
  let settings: Settings = { ...DEFAULT_SETTINGS }

  // 「鲸鲸会飞」控制器：游戏激活时它接管宠物位置与指针，index 的常规拖拽/点击在下面全部让路。
  // 游戏整个活在**命中框(hitBox)坐标系**里：抓住的是看得见的身子，落点/高度也都按身子算。
  // 而 motion 吃的是舞台坐标（= hitBox 减掉 bodyBox 那截内缩偏移），所以 setPos 负责把
  // 「身子该去哪」换算回「舞台该去哪」——不换算的话一抓住宠物就会横跳 100px、命中判定还全落空。
  const flyGame = createFlyGame({
    root,
    getPos: () => { const b = hitBox(); return { x: b.x, y: b.y } },
    // setPos 负责把「身子该去哪」换算回「舞台该去哪」（减掉 bodyBox 那截内缩偏移）。
    // 走**不夹取**那条：这游戏要的就是把宠物抛出屏幕上沿并继续计数，普通拖拽才需要夹回来。
    setPos: (x, y) => { const s = stagePos(), b = hitBox(); motion.setPositionUnclamped({ x: x - (b.x - s.x), y: y - (b.y - s.y) }) },
    petSize: () => { const b = hitBox(); return { w: b.w, h: b.h } },
    // 质量 = 体重读数。快照还没到就当初始体重（50 = 参考质量，此时手感与不建模时一致）。
    weight: () => snap?.stats.weight ?? INITIAL_STATS.weight,
    playClip: () => requestClip('drag'),
    reward: () => { signedGainsOnce = true; window.petBridge?.statEvent({ kind: 'game' }) },
    onExit: () => requestClip('idle'),
  })

  // 「猜动作」控制器：不接管拖拽，只让宠物做动作 + 浮出选项按钮。退出按答对数结算（count 在 stats 封顶）。
  const guessGame = createGuessGame({
    root,
    playClip: (a) => requestClip(a.pool, a.name),
    reward: (count) => { signedGainsOnce = true; window.petBridge?.statEvent({ kind: 'game', count }) },
    onExit: () => requestClip('idle'),
  })

  // 「点破泡泡」控制器：限时点破上浮的泡泡，退出/时间到按破掉数结算。hudRect 返回整屏（限时点击游戏整屏接鼠标）。
  const bubbleGame = createBubbleGame({
    root,
    reward: (count) => { signedGainsOnce = true; window.petBridge?.statEvent({ kind: 'game', count }) },
    onExit: () => requestClip('idle'),
  })

  /** 当前激活的游戏（同一时刻只会有一个）；没有就是 null。所有「游戏态」闸门都问它。 */
  const activeGame = () => (flyGame.active() ? flyGame : guessGame.active() ? guessGame : bubbleGame.active() ? bubbleGame : null)

  /**
   * 喂一口：点哪格播哪条吃相（缺这一口回落 click，绝不播池里随便一条假装吃的是别的）+ 说一句 feed + 报养成数值。
   * 面板食物格与调试板共用。**选完不收面板**：手还停在这块区域上，收掉会让按钮消失、那块像素不再归宠物、
   * 光标当场变回系统箭头；收起交给「离开满延时」和「再点一次喂食/点宠物」。这一口没吃完时整列格子是灰的（syncEating）。
   */
  function doFeed(f: Food): void {
    // 吃饭闸门放在**逻辑层**而不只是 UI：正常食物列表吃饭时整列 disabled，但调试板的食物按钮直接调这里，
    // 绕过那层禁用。少了这道闸，吃着一口时再点第二口——requestClip 拒换动画（吃相没断），statEvent 却照报，
    // 于是两口数值都攒进 heldGains，等第一口演完一起冒出来「加两次」（真出过的 bug）。吃饭期间再喂一律拒。
    if (current.pool === 'eat') return
    lastInteractionAt = Date.now()
    rules.feed('interacted')
    if (f.anim !== undefined && !requestActionClip(f.anim.pool, f.anim.name)) requestActionClip('click')
    else if (f.anim === undefined) requestActionClip('click')
    sayFor('feed')
    window.petBridge?.statEvent({ kind: 'feed', food: f.id })
  }

  /** 开一局：进游戏态并收掉脚下按钮条（游戏态里弹不回来）。面板游戏格与调试板共用。 */
  function doStartGame(g: Game): void {
    lastInteractionAt = Date.now()
    rules.feed('interacted')
    if (g.id === 'fly') { flyGame.start(); closePanel() }
    else if (g.id === 'guess') { guessGame.start(); closePanel() }
    else if (g.id === 'bubble') { bubbleGame.start(); closePanel() }
  }

  /**
   * 调试板入口：动画/台词/喂食/开局全部接到现成链路；等级与数值走 debugStats 落盘。
   * 等级滑条给的是「第几级」，这里换算成该级的经验阈值（LEVEL_CUM[level-1]）再写——等级本身不入库。
   */
  const debugCtx: DebugContext = {
    pools: skin.pools,
    api: {
      playClip: (pool, name) => { requestClip(pool, name) },
      sayLine: (reason, index) => {
        const line = TALK_LINES[reason][index]
        if (!line) return
        say({ text: line.say, reply: line.reply })
        pairSpeech(reason)
        lastTalkAt = Date.now()
      },
      feed: doFeed,
      startGame: doStartGame,
      setLevel: (lv) => { window.petBridge?.debugStats({ exp: LEVEL_CUM[Math.max(1, Math.min(MAX_LEVEL, lv)) - 1] ?? 0 }) },
      setStat: (key, value) => { window.petBridge?.debugStats({ stats: { [key]: value } }) },
    },
  }

  const panel = createPanel(root, defaultActions(), settings, {
    action: (a) => {
      lastInteractionAt = Date.now()
      rules.feed('interacted')
      if (a.pool !== undefined) requestActionClip(a.pool)
      else requestClip(a.pool)
      sayFor('status')
    },
    /**
     * 点了游戏列表里的「开始」。面板只管报「选了哪个游戏」，怎么接管整屏是这里的事：
     * 开鲸鲸会飞 → 进游戏态 → **收掉脚下按钮条**（游戏态里 openPanel 也被闸门挡住，弹不回来）。
     * 这里不 sayFor：用户要的是「玩的时候别弹聊天气泡」，HUD 就是这次的反馈（见 say 里的游戏态闸门）。
     */
    game: (g) => doStartGame(g),
    /**
     * 点了一格食物：**点哪格就播哪条**（`f.anim.name`）。降级链是两级——
     * 皮肤里没有这一口（自带的 block 皮肤就只做 rice / hotpot 两口）就回落到 click 池。
     * 以前这里只递池名，于是「点火锅播到白饭的吃相」：名字在装载皮肤时就被丢掉了，
     * 池里有什么就随机播什么（见 problem/03 §3.13）。
     * 为什么宁可播 click 也不播「池里随便一条」：播错的那口会假装它吃的是别的，
     * 而点了没反应 / 反应不对，都比假装更值得防。
     */
    pick: (f) => doFeed(f),
    /**
     * 状态栏里点性别。本地不预置反馈：它要写进存档，回灌一下也就是一帧的事，
     * 而先改本地就会出现「主进程拒收但界面已经改了」的假成功。
     */
    identity: (patch) => {
      window.petBridge?.setIdentity(patch)
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
      if (panel.isOpen) {
        placePanel()
        // 副板一占位，气泡得跟着让：状态视图以前没有按钮条挡在中间，现在有了。
        if (bubble.isOpen) placeBubble()
      }
    },
    // 退出桌宠：先说一句再见 + 播女仆屈膝礼仪，停一会儿让气泡显示出来，再让主进程落盘退出。
    quit: () => {
      const line = pickLine('bye', talkRng)
      if (line !== null) { say({ text: line.say, reply: line.reply }); pairSpeech('bye') }
      setTimeout(() => window.petBridge?.quitApp(), 1500)
    },
  }, debugCtx)

  window.petBridge?.onSettings((s) => {
    settings = s
    panel.setSettings(s)
  })

  /** 主进程推来的数值快照。状态视图直接吃它，台词档也要看它。 */
  let snap: StatsSnapshot | null = null
  window.petBridge?.onStats((s) => {
    const prev = snap
    snap = s
    panel.setStats(s)
    // 第一份快照到了才推「此刻」：在那之前 `startedAt` 还没进过渲染层的账。
    syncRuntime()
    // 上一份快照是「刚才屏幕上是什么」，这一份是「现在是什么」——两者一差就是刚才发生了什么。
    // 反馈挂在这里而不是挂在喂食/逗玩/回应各调用点，是因为那四条路都会走到这一句，
    // 分开喊迟早漏一条（qqpet 就是五个调用点各喊一遍）。
    if (prev !== null) floatGains(prev, s)
    /**
     * 跨级那一刻说一句。判据是**前后两份快照的 Lv**而不是「刚才喂了没」：
     * 逗玩、回应、每日首开也都进经验，五条路都走到这一句，只在喂食那儿判迟早漏一条
     * （和上面 floatGains 挂在这里是同一个理由）。
     *
     * 这里用 `pickLine`（绕开冷却）而不是 `sayFor`：喂一口正好跨级时，喂食那句 1 毫秒前才说完，
     * 走冷却的话跨级这句永远说不出口——而它几十口才一次，比「这是吃的」重要，该盖掉前一句。
     */
    if (prev !== null && levelOf(s.exp) > levelOf(prev.exp)) {
      // 跨级先播一段蓝鲸现世（游戏态里别抢，否则把玩法动画顶掉），随后那句跨级台词盖过前一句。
      if (!activeGame()) requestClip(LEVELUP_CLIP.pool, LEVELUP_CLIP.name)
      const line = pickLine('levelup', talkRng)
      if (line !== null) say({ text: line.say, reply: line.reply })
    }
    // 上线问候：开机第一份快照到、且此刻没在放气泡/没进游戏，就说一次。
    // 按当前小时从时段问候表取一句（清晨/早上/中午…深夜各有话），比固定一句更有陪伴感。
    if (prev === null && !greeted) {
      greeted = true
      if (!activeGame() && !bubble.isOpen) {
        const line = greetLineForHour(new Date().getHours(), talkRng)
        say({ text: line.say, reply: line.reply }); pairSpeech('greet')
      }
    }
  })

  // ---- 气泡 ----
  const bubble = createBubble(root, {
    // 点完回应按钮气泡自己收了，但定时器还在装配层手里：不清掉它，下一次 say
    // 之前的空档里它会再 firing 一次（hide 是幂等的，但留着就是条没人认领的尾巴）。
    onReply: () => {
      if (bubbleDeadline !== null) clearTimeout(bubbleDeadline)
      bubbleDeadline = null
      // 「你理它了」是养成里最该有反馈的一次点击：它同时涨心情与亲密。
      window.petBridge?.statEvent({ kind: 'reply' })
      // bubble.ts 在回调之前已经把节点收掉了（hide() → handlers.onReply()），
      // 这里收尾交互区：光标常常就停在那颗回应按钮上。
      recomputeInteraction()
    },
  })
  /** 气泡自己的一次性定时器。不挂 rAF：覆盖层没焦点时 rAF 会被节流，定时器才准（心跳那条踩过）。 */
  let bubbleDeadline: ReturnType<typeof setTimeout> | null = null
  /** 气泡显示尺寸。来自 config，和 style.css 里那条 width/height 是同一个数（有测试钉住）。 */
  const BUBBLE_SIZE = { w: BUBBLE_W, h: BUBBLE_H }

  const screenRect = (): Rect => ({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight })

  const bubbleAnchorNow = (): Point =>
    bubbleAnchor(hitBox(), bubblePanelBox(), BUBBLE_SIZE, screenRect(), BUBBLE_GAP)

  function placeBubble(): void {
    bubble.place(bubbleAnchorNow())
    // 气泡挪位置 = 可见区域变了，光标没动也得重算捕获（recomputeInteraction 的注释里有这条链）
    recomputeInteraction()
  }

  /**
   * 立刻收掉气泡，并把那条一次性定时器一起撤掉。
   * 只调 `bubble.hide()` 会留一条没人认领的尾巴：定时器在下一次 say 之前的空档里还会
   * firing 一次（`onReply` 那条注释踩过同一个坑）。
   * 收起之后必须收尾交互区——气泡是 bubble.ts 自己摘掉的 DOM，不会有光标事件来纠正
   * `wantGrab`（problem/01 §1.15）。
   */
  function dismissBubble(): void {
    if (bubbleDeadline !== null) clearTimeout(bubbleDeadline)
    bubbleDeadline = null
    bubble.hide()
    recomputeInteraction()
  }

  // ---- 飘字（属性涨了多少）----
  /**
   * 飘字层**不参与交互区**：不挂 `data-hit`，`recomputeInteraction` 也不看它的矩形。
   * 一个点不着、只活一秒的东西要是把鼠标接住，就是 problem/01 §1.15 那个
   * 「看不见却吞点击」换了个形态重来一次。
   */
  const floats = createFloatLayer(root)

  /**
   * 墨迹内缩在装载时算一次就够（它是皮肤属性，不随帧变）。
   * dshtry 实测命中框比看得见的身子左右各宽 37~40 CSS px，
   * 所以按命中框摆的话「8px 间隙」在屏幕上是 45px——用户说的「离得远」就是这个。
   */
  const inkInsets = inkInsetsOf(manifest)

  const placeFloats = (): void =>
    floats.place(floatAnchor(
      inkRect(hitBox(), inkInsets), panel.plateRect(), FLOAT_CHIP, screenRect(), FLOAT_GAP, FLOAT_HEAD_OFFSET,
    ))

  /** 攒着等动画播完的那些字。 */
  let heldGains: FloatGain[] = []
  /**
   * 真值 = 刚才那个动作**自己起了动画**，这批数字该等它演完再冒。
   * 用户 2026-11-06 拍的板：点完喂食就冒数字，读起来像结算回执；等它把这一口咽下去
   * 再冒，才是「它吃了，所以涨了」。
   * 但只有真有自己的动画才等：点气泡回应、每天第一次开面板都没有动画可等，
   * 压着不放就变成「理了它却没反应」。
   */
  let holdGainsForClip = false
  /**
   * 下一次飘字要不要连「往下掉」的一起写出来。默认只飘涨的（自然衰减每分钟都动，飘负数会刷屏）。
   * 但小游戏落地是**一次明确动作**，饱食/体重是往下掉的——用户要「退出时看到心情和饱食的变化」，
   * 所以这条动作触发的这次广播走带符号。放一次即用完，不影响后面每一分钟的衰减 tick。
   */
  let signedGainsOnce = false

  function showGains(gains: FloatGain[]): void {
    floats.show(gains)
    placeFloats()
  }

  /**
   * 攒着的那批放出来。两个接缝会调它：行为链交回决策权那一拍（这条动画演完了）、
   * 以及松手落地那一拍（拖拽顶掉了**非吃饭**的动作动画，等不到它的尾巴了）。
   *
   * 但吃饭期间不调它：2026-11-06 起拖拽不许顶掉吃相，所以那口还在演，
   * 数字就该继续攒着等演完——落地就冒会违反「动画播完再展示」那条主规则，宁慢不抢。
   */
  function flushGains(): void {
    if (current.pool === 'eat') return
    holdGainsForClip = false
    if (heldGains.length === 0) return
    const gains = heldGains
    heldGains = []
    showGains(gains)
  }

  /** 两份快照之间涨了的那些写成「饥饿 +12」贴到宠物旁边；一条都不涨就什么都不做。 */
  function floatGains(prev: StatsSnapshot, next: StatsSnapshot): void {
    const signed = signedGainsOnce
    signedGainsOnce = false
    const gains = gainsToFloat(prev.stats, next.stats, signed)
    if (gains.length === 0) return
    if (holdGainsForClip) {
      heldGains.push(...gains)
      return
    }
    showGains(gains)
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
      else {
        bubble.hide()
        // 到点收起时光标常常还压在气泡上：不收尾就是「看不见却还吞点击」
        recomputeInteraction()
      }
    }, ms)
  }

  /** 上次开口是什么时候。冷却的基准，六个 reason 都受它管。 */
  let lastTalkAt = 0
  /** 上次「用户动了」是什么时候。idle 那句要看它，规则层那把钟不对外露。 */
  let lastInteractionAt = Date.now()
  /** 随机源。e2e 换成定值，概率这条才测得准。 */
  let talkRng = Math.random

  // ---- 日常动画选择器的情境输入 ----
  /** 上一条 ambient 是不是犯困片：决定「被点时是普通反应还是打瞌睡被惊醒」。 */
  let lastWasSleepy = false
  /** 开机问候只说一次（第一份快照到达那一拍判）。 */
  let greeted = false
  /** 连点计数与最近一次点击时刻；超过 CLICK_STREAK_MS 没再点就当清零。 */
  const CLICK_STREAK_MS = 1200
  let clickStreak = 0
  let lastClickAt = 0
  /** 装配层每次点身体时喂一下：够密的连点才会被 pickInteract 判成「连续点击」。 */
  function registerClick(): void {
    const now = Date.now()
    clickStreak = now - lastClickAt > CLICK_STREAK_MS ? 1 : clickStreak + 1
    lastClickAt = now
  }
  /** 把散在装配层的时间/数值拼成选择器要的情境快照。 */
  function situation(): Situation {
    const h = new Date().getHours()
    const idleMs = Date.now() - lastInteractionAt
    return {
      mood: snap?.stats.mood ?? INITIAL_STATS.mood,
      idleMs,
      lateNightWorking: h < 5 && idleMs < 60000,       // 过凌晨、且主人这阵子还在动
      lastWasSleepy,
      clickStreak: Date.now() - lastClickAt > CLICK_STREAK_MS ? 0 : clickStreak,
    }
  }

  /**
   * 开口说一句。文本在这里 clamp，调用方不必各自记得截断。
   * 空文本（clamp 之后变空串）直接不显示——挂一个空气泡比不说话更怪。
   * 传字符串就没有按钮；传 Line（台词表给的）会带上主人那句短回应。
   */
  function say(content: BubbleContent | string, ms: number = BUBBLE_SHOW_MS): boolean {
    // 游戏态不弹聊天气泡（用户 2026-11-07 要「开始后宠物不该弹气泡」）：把这一个总出口堵住，
    // 比在每个调用点各判一次强——idle / 事件 / 升级 / 调试台词全从这儿过，漏判的机会为零。
    if (activeGame()) return false
    const line = typeof content === 'string' ? { text: content } : content
    const clean = clamp(line.text)
    if (clean === '') return false
    bubble.show({ text: clean, reply: line.reply }, bubbleAnchorNow())
    lastTalkAt = Date.now()
    armBubble(ms)
    // 气泡出现也是「可见区域变大」，光标停在它该覆盖的位置时得立刻接住鼠标
    recomputeInteraction()
    return bubble.isOpen
  }

  /**
   * 说话配动画：这句是哪个 reason 说的，就顺手播它对应的一组日常片段里的一条（docs/动画.txt 的「其他状态」）。
   * feed 不在表里 → 不配（喂那一口的吃相由喂食流程自己播）；吃饭时 requestClip 也会拒换，双保险。
   */
  function pairSpeech(reason: TalkReason): void {
    const clip = pickForSpeech(reason, talkRng)
    if (clip) requestClip(clip.pool, clip.name)
  }

  /**
   * 闲下来那一拍考虑开口。概率与冷却都在 `pickTalk` 里，这里只把运行时状态递进去。
   * 不新增计时器：这一拍本来就是「一条播完」的节奏，20s 的门槛由规则层决定。
   *
   * Line 是 {say, reply}，气泡要的是 {text, reply}——在这儿换名，别把两套叫法漏进组件里。
   */
  function maybeSayIdle(): void {
    // 数值决定它这一拍说哪一档的话：饿了就讨食，蔫了就蔫着，否则闲时偶尔说句贴心话（comfort）、其余闲聊。
    // 各档共用同一道门（闲够 + 概率，见 talk.ts 的 SELF_TALK_REASONS），所以不会变成复读机，只是把内容换掉。
    const reason: TalkReason = snap !== null && isHungry(snap.stats)
      ? 'hungry'
      : snap !== null && isBlue(snap.stats)
        ? 'blue'
        : talkRng() < 0.25
          ? 'comfort'
          : 'idle'
    const line = pickTalk(reason, { now: Date.now(), idleMs: Date.now() - lastInteractionAt, lastTalkAt }, talkRng)
    if (line !== null) { say({ text: line.say, reply: line.reply }); pairSpeech(reason) }
  }

  /** 事件驱动的台词：用户做了动作就必说（只受冷却约束），不看概率。 */
  function sayFor(reason: TalkReason): void {
    const line = pickTalk(reason, { now: Date.now(), idleMs: 0, lastTalkAt }, talkRng)
    if (line !== null) { say({ text: line.say, reply: line.reply }); pairSpeech(reason) }
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
    // 先摆一次才量得出自身尺寸，再按尺寸夹回屏幕内。按钮条的宽度由数量决定，
    // 事先不知道，只能量一次。收起时它不在布局里，所以量这一步只在打开状态下有意义。
    panel.show({ x: body.x, y: body.y + body.h + PANEL_GAP })
    const size = panel.size()
    if (!size) return
    // 主块永远走同一条锚点：动作/食物/状态视图里它是按钮条（贴脚下，脚下没地方翻头顶），
    // 设置视图里它是那块板（整块替换按钮条，位置规则一样）。
    const at = panelAnchor(body, size, screen, PANEL_GAP)
    // 出场动画的方向：按钮条和副板都从「靠宠物那一侧」浮进来，翻到头顶时就得反过来。
    // 这个信息 CSS 只能从根节点拿，所以写在这里——它是唯一一处同时知道 side 和 DOM 的地方。
    panel.el.dataset.side = at.side
    panel.show(at)
    // 副板各走各的锚点，而且和主块在同一次同步任务里摆完——中间不是一帧，不会闪错位。
    const ps = panel.plateSize()
    if (ps === null) return
    if (panel.view === 'foods' || panel.view === 'games') {
      // 挂在按钮条**外侧**：主块在脚下时往下长，翻到头顶时往上长，中间那段留给宠物本体。
      // 游戏列表和食物列表同一种「长在按钮条外侧的一排选择」，共用这条锚点。
      panel.showPlate(stackAnchor({ x: at.x, y: at.y, w: size.w, h: size.h }, ps, screen, PLATE_GAP, at.side))
    } else if (panel.view === 'stats' || panel.view === 'debug') {
      // 读数竖挂宠物**右侧**：脚下那一横条已经是按钮条的地盘，挤在一起两边都读不到。
      // 调试板和状态栏同一种「竖在宠物旁边的高卡片」，共用这条侧挂锚点——否则调试副板没有自己的
      // 定位分支，会沿用上一个视图的旧 plateAt，跑到屏幕角落而不是宠物身边（真出过的 bug）。
      // 锚的是**看得见的身子**（`inkRect`），不是命中框：dshtry 的命中框比墨迹左右各宽 37~40px，
      // 按命中框摆的话 `PANEL_GAP=10` 在屏幕上会再多出那圈透明区域——用户说的「状态栏里角色太远了」
      // 以前就是 16 + 37 = 53px。
      // 按钮条和飘字那两条锚点照旧走命中框：它们要的是「脚下那一格」和「头顶那一片」，
      // 换墨迹会把已有的间距账（`FLOAT_HEAD_OFFSET` 按命中框顶沿量的）一起挪掉。
      // 纵向交给 statsAnchor 一条**规则**而不是一个抬升数：底沿必须让开按钮条，
      // 因为卡片比身体高，而「高多少」随皮肤变（dshtry 身子 165、block 只有 141）。
      // 只在按钮条摆在脚下时递它的顶沿过去；翻到头顶时那一横条不在下面，没有要让的东西。
      panel.showPlate(statsAnchor(
        inkRect(body, inkInsets),
        ps,
        screen,
        PANEL_GAP,
        at.side === 'below' ? at.y : null,
      ))
    }
  }

  /**
   * 面板由**点击**叫出来（2026-11-04 改：以前是停留 400ms 自动弹）。
   * 整屏覆盖层上「鼠标路过就出菜单」比在普通窗口里更烦人，而且它和
   * 「我要动手了才该有按钮」这个直觉本来就不一致。
   */
  function openPanel(): void {
    // 游戏态：脚下按钮条不出现（用户 2026-11-07 要「开始后按钮消失」）。点身体那一下已被
    // pointerdown 的 activeGame() 闸门挡在拖拽逻辑外，这里再堵一次，防住任何别的路径把菜单叫回来。
    if (activeGame()) return
    placePanel()
    // 面板一占位就把气泡重贴一次：按钮条现在常驻，气泡原来只躲身体，重贴后才会躲到按钮条外侧。
    // 话说到一半面板打开，气泡压在按钮上是这次改动带出来的新堆法。
    if (bubble.isOpen) placeBubble()
    hover.open()
    // 每次打开都报，主进程按「20 小时内只算一次」发亲密。
    // 渲染层不自己判日界：它没有存档里的 lastEventAt，判了就是两份状态。
    window.petBridge?.statEvent({ kind: 'daily-open' })
  }

  /**
   * 收起面板。必须连 hover.reset() 一起——状态机自己那份「开着」的标记不会因为
   * 你直接收面板而消失，不复位的话鼠标停在原地就再也弹不出来了（problem/05 §5.12）。
   */
  function closePanel(): void {
    hover.reset()
    panel.hide()
    if (hoverDeadline !== null) {
      clearTimeout(hoverDeadline)
      hoverDeadline = null
    }
    // 收起是「DOM 自己消失」，没有光标事件会来纠正 wantGrab（见 recomputeInteraction）
    recomputeInteraction()
  }

  /** 再点一次宠物就收：点击开的东西，得能用点击关。 */
  function togglePanel(): void {
    if (panel.isOpen) closePanel()
    else openPanel()
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
    // 飘字也跟着走：它只活一秒，但那一秒里宠物正在转身的话，字钉在原地就像从空气里冒出来的
    if (floats.count > 0) placeFloats()
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

  // 「在线时间」的节拍，同样只能挂在定时器上（理由和心跳那条一样：这扇窗没有焦点，rAF 会被节流）。
  // 面板没开着也照走：值是从 `startedAt` 现算的，不是累加的，所以状态栏一叫出来就是准的。
  setInterval(syncRuntime, ONLINE_TICK_MS)

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

  /**
   * 交互区、光标类、鼠标捕获的**唯一**重算入口。
   *
   * 以前只有 handleCursor 算这一份派生状态，于是「DOM 自己消失」这条路漏掉了：
   * 点完一格食物 → 列表收起、光标还停在原来那块格子上 → wantGrab 仍是 true，
   * 心跳每 250ms 继续给整屏续租，桌面点击被透明层吞掉，直到鼠标再动一下才纠正
   * （codex 复审 #3 P1）。所以凡是改变可见区域的路径——面板显隐、气泡显隐与摆位——
   * 都必须走这里，而不是各自顺手 set 一下 wantGrab。
   */
  function recomputeInteraction(): void {
    if (lastCursor === null) return
    /**
     * 交互区 = 身体框、开着的面板框、开着的气泡框三者的外接矩形。用外接矩形而不是并集，
     * 因为要的是**连续**：身体和面板之间那截空隙、四个按钮之间那 8px、面板与气泡之间
     * 那 12px，按各自矩形判都会落空，光标就会一路闪回桌面的样子。
     *
     * 空隙的点击归我们（按下不反应），这是连续的代价；但区域只在面板或气泡开着时
     * 才放大，而"算不算有人在使用"仍然只问 DOM 命中——停在看不见的空隙里不算活动，
     * 收起延时照旧跑，所以这段吞点击的时间有上界。
     */
    const zone = unionRect(hitBox(), panelBox(), bubble.rect(), activeGame()?.hudRect() ?? null)
    const inZone = rectContains(zone, lastCursor)
    setOverClass(inZone || dragging)
    wantGrab = inZone || dragging
    sendGrab()
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
     * 抢鼠标与光标形状归 zone 管（上面的 unionRect），两件事分开。
     */
    const overPanel = hit !== null && hit.closest('.pet-panel') !== null
    const ev = hover.onPoint(p, over || dragging, overPanel)
    if (ev === 'close') {
      // 到点了但这一口还没吃完：菜单留着，手也留着。饭后任意一次到点才真收。
      if (current.pool === 'eat') hover.postpone()
      else closePanel()
    }
    recomputeInteraction()
    scheduleHover()
  }

  window.petBridge?.onCursor(handleCursor)

  // 穿透关掉时页面才收得到指针事件，所以这里的 down 一定发生在身体上
  window.addEventListener('pointerdown', (e) => {
    if (activeGame()) return          // 游戏态：指针由游戏控制器接管，常规拖拽/点击让路
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
    dragStarted = false
    pressPoint = p
    const pos = stagePos()
    dragOffset = { x: p.x - pos.x, y: p.y - pos.y }
    // 这里不再收面板：按下可能就是「点一下叫出菜单」，收在 down 里会让 toggle 看不见状态。
    // 真的拖起来了再收（见下面 pointermove 的阈值分支）。
  })
  window.addEventListener('pointermove', (e) => {
    if (activeGame() || !dragging) return
    const p = { x: e.clientX, y: e.clientY }
    motion.setPosition({ x: p.x - dragOffset.x, y: p.y - dragOffset.y })
    // 动画挂在「真的拖起来」那一刻，不是挂在松手：原来 pointerup 才 requestClip('drag')，
    // 于是按住的全过程它一直在呼吸，松手反倒演「被拎着」——量过是 929ms 的整段延迟（problem/05 §5.11）。
    // 没越过阈值之前不动画，是为了不把「点一下」也判成拖拽（那条路以前是 click 没有触发点的根因）。
    if (dragStarted) return
    if (Math.hypot(p.x - pressPoint.x, p.y - pressPoint.y) < DRAG_START_PX) return
    dragStarted = true
    closePanel()          // 拖拽期间不挂菜单：它一路跟着宠物飘，也不是用户此刻要用的东西
    // 气泡同理，而且它比菜单更该走：话说到一半人被拎起来，那句还钉在原来的位置上飘着，
    // 读起来像 bug 而不是话（用户拍的板：拖拽时不弹气泡）。
    dismissBubble()
    // 飘字也一起清：刚喂下去那串「饥饿 +12」还挂在半空就被拎走，读起来像掉帧
    floats.clear()
    // 「被拎着」那一条**顶不掉吃相**（2026-11-06 改）：正在吃饭时 requestClip 一律拒换，
    // 于是拎着走的时候它还在嚼——用户明确要这个观感。
    // 拖拽本身仍然有反应：上面 motion.setPosition 已经跟着手走了，菜单和气泡也都收了。
    requestClip('drag')
    // 这里原来还有一句 sayFor('drag')——「被拎起来必回一句」和「拖拽时不弹气泡」是冲突的，
    // 用户 2026-11-05 选了后者，所以台词一起去掉，不留一条走不到的路径。
  })
  window.addEventListener('pointerup', () => {
    if (activeGame() || !dragging) return
    dragging = false
    lastInteractionAt = Date.now()
    // 停在松手的地方。这里原来调了 snapToBottom()，把高度强行拉回地面，
    // 于是把宠物拖到右上角松手后它会"跳回原位"。setPosition 已经把 y 夹在
    // 屏幕内了，不需要再吸附。（启动时落地仍由 bootstrap 里的 snapToBottom 负责）
    if (!dragStarted) {
      // 没过阈值就是「点了一下」：给它反应动画（点了必须有反应），并开关按钮面板。
      // **正在吃饭时不抢播**：反应会把嘴边那口饭换掉，用户看到的就是「一口没吃完就改动作」。
      // 面板照旧弹出——他要的是别打断动画，不是别理我；而且面板本身就是反馈。
      // 判据用 `current.pool` 而不是「播放中」标志：链子播完下一条会把 current 换成 idle，再自己加状态就是两本账。
      registerClick()
      if (current.pool !== 'eat') {
        // 日常动画机制：连续点击够数 / 刚犯困被点 走具名反应片，其余回落到原来的 click 池。
        const react = pickInteract(situation())
        if (react) requestClip(react.pool, react.name)
        else requestClip('click')
      }
      togglePanel()
      return
    }
    rules.feed('dragged')
    // 放下就回到环境链：grab 素材有 10 秒，不切回去它会继续演「被拎着」演到完。
    // 正在吃饭时这条也被拒掉——那口饭优先，环境链接管要等它演完。
    requestClip('idle')
    // 攒着的数字在落地这一拍放出来：这条动画被拖拽顶掉了，等不到它的尾巴。
    // 吃饭那种「顶不掉」的情况由 flushGains 自己判回去（那时该继续攒着）。
    flushGains()
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
    /**
     * 事件驱动那一档台词的接缝（和 `tickAmbientForTalk` 对称）：走真实 `sayFor` 通道，
     * 冷却与「不看概率」都由 pickTalk 判定，e2e 用它单独测台词契约——
     * 不借某个按钮的副作用（那颗按钮如今是切视图/开游戏，语义早变了）。
     */
    sayEvent: (reason: TalkReason): boolean => {
      sayFor(reason)
      return bubble.isOpen
    },
    /** 立刻收掉气泡。e2e 用它收尾，免得残留的气泡影响后面几条检查的命中判定。 */
    hideBubble: (): boolean => {
      dismissBubble()
      return true
    },
    /** 现在飘着的字（从上到下）。空数组就是这一层已经移出布局。 */
    get floatTexts(): string[] {
      return [...floats.el.querySelectorAll('.pet-float')].map((n) => n.textContent ?? '')
    },
    /** 飘字层的矩形；没字时是 null，别拿 0×0 去参与断言。 */
    get floatRect(): Rect | null {
      if (floats.count === 0) return null
      const r = floats.el.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    },
    /** 清掉所有飘字。e2e 用它收尾，免得上一条的残字混进下一条的断言。 */
    clearFloats: (): boolean => {
      floats.clear()
      // 攒着的那批也一起丢：只清屏上的话，下一条检查跑到一半，上一条的数字会突然冒出来
      heldGains = []
      holdGainsForClip = false
      return true
    },
    /**
     * 立刻收起面板。e2e 用它收尾：状态栏这类视图留在打开状态会把下一条
     * 检查的「点某个按钮」变成等一个不该存在的节点（30 秒超时）。
     */
    hidePanel: (): boolean => {
      closePanel()
      return true
    },
    /**
     * 换「离开多久收」的档位。e2e 要验吃饭期间不收、饭后又收得掉：一口饭 4 秒，
     * 按真实的 1500 / 5000ms 排例这条得睡十几秒。它走的是视图切换同一个
     * `hover.setHideMs` 口子，所以测到的就是运行链路那套计时，不是另造一套。
     */
    setPanelHideMs: (ms: number): number => {
      hover.setHideMs(ms)
      return ms
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
    /**
     * 看得见的身子，不是拿来点的命中框。状态栏和飘字这两处「贴着宠物摆」的量的是它。
     * e2e 拿这个做对照才问得出「卡片贴的是墨迹还是命中框」——注意它和卡片自己的矩形
     * 是两条路子（这里由 manifest 算，那里由布局量），两边对得上才算真的摆对了。
     */
    get inkBox(): Rect {
      return inkRect(hitBox(), inkInsets)
    },
    /**
     * 真的按在身体上没松手吗。e2e 用它自证前置：任何一条检查漏了 `pointerup`，
     * 下一次真实鼠标移动就会把宠物拖走，于是后面每条量到位置的都是随机数。
     */
    get dragging(): boolean {
      return dragging
    },
    get current(): ClipRef {
      return current
    },
    /** 主进程最近广播回来的数值。调试板滑条改完走 IPC→main 落盘→广播，e2e 读它验整条回路真的通了。 */
    get stats(): Stats | null {
      return snap?.stats ?? null
    },
    get panelOpen(): boolean {
      return panel.isOpen
    },
    /** 现在显示的是哪个视图。喂食/设置都改成切视图，光看 open 分不出是哪个。 */
    get panelView(): string {
      return panel.view
    },
    /** 「鲸鲸会飞」开着没。e2e 用它自证前置/收尾，别把游戏态漏给后面每条检查。 */
    get flyActive(): boolean {
      return flyGame.active()
    },
    /** 「猜动作」开着没。同上，e2e 自证前置/收尾用。 */
    get guessActive(): boolean {
      return guessGame.active()
    },
    /** 猜动作当前这轮真做的动作 name。e2e 用它点对的那颗，确定性验「点对加分」。 */
    get guessTarget(): string | null {
      return guessGame.targetName()
    },
    /** 强制收摊回普通态。e2e 的 finally 用它兜底：断言中途挂了也不会把整屏留在游戏态里。 */
    stopFly: (): boolean => {
      flyGame.stop()
      return !flyGame.active()
    },
    stopGuess: (): boolean => {
      guessGame.stop()
      return !guessGame.active()
    },
    /** 「点泡泡」开着没 / 已破几个 / 强制收摊。e2e 自证前置、验点破计数、finally 兜底用。 */
    get bubbleActive(): boolean {
      return bubbleGame.active()
    },
    get bubblePopped(): number {
      return bubbleGame.poppedCount()
    },
    stopBubble: (): boolean => {
      bubbleGame.stop()
      return !bubbleGame.active()
    },
    /**
     * 某一档台词的正文清单。e2e 拿它对照「这一刻气泡里说的是不是这一档」，
     * 而不是自己抄一份句子——抄一份就是第二本账，改台词时它会假装通过。
     * 为什么不从测试里直接 import `shared/talk.js`：talk.ts 自己 import 了 config，
     * 而 e2e 是直接载 .ts 源码的，Node 不把 `./config.js` 指回 .ts（见 config.ts 顶部那条）。
     */
    talkLines: (reason: TalkReason): string[] => TALK_LINES[reason].map((l) => l.say),
    get grabRequested(): boolean {
      return wantGrab
    },
    /**
     * 装配层最后一次收到的光标位置（null = 这次运行还没收到过任何鼠标事件）。
     * 名字不能叫 `cursor`——那个已经是「注入一个光标位置」的方法了。
     * e2e 拿它分清「鼠标没放开」的两种成因：zone 判错了，还是 `recomputeInteraction`
     * 在 lastCursor 为空时直接 return（那条早退是故意的：没有读数就不该改状态）。
     */
    get cursorSeen(): Point | null {
      return lastCursor
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
