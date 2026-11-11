import { FOOD_CELL, FOOD_GAP, FOOD_VISIBLE, GAME_CELL, GAME_GAP, PANEL_BUTTONS, type PanelButton } from '../shared/config.js'
import { FOODS, isUnlocked, unlockBadge, unlockHint, type Food } from '../shared/food.js'
import { GAMES, type Game } from '../shared/games.js'
import { clampScroll, pageStep, thumbGeometry } from '../shared/scroll.js'
import {
  EXP_GAIN,
  FOOD_EFFECT,
  IDLE_EXP_PER_MIN,
  LEVEL_CUM,
  LEVEL_STEPS,
  MAX_LEVEL,
  STAT_KEYS,
  STAT_LABELS,
  STAT_MAX,
  levelFraction,
  levelOf,
  statBand,
} from '../shared/stats.js'
import { GENDER_GLYPHS, GENDER_LABELS, type Gender, type StatsSnapshot, otherGender } from '../shared/save.js'
import type { Settings, Visibility } from '../shared/visibility.js'
import type { Point, Rect } from '../shared/types.js'
import { createDebugPlate, type DebugContext } from './debug.js'

/**
 * 悬停面板：一个定位层 + 两块各自摆位的内容。
 *
 * 根节点 `.pet-panel` 铺满覆盖层、不吃命中，只当 `data-hit` 的宿主；
 * 里面最多同时存在两块：
 * - `.pet-actions` 按钮条（动作/食物/状态视图都在，设置视图整块替换时才收起）
 * - `.pet-plate` 副板（食物列表、状态读数、设置行）
 * 两块各自有 transform，因为它们的锚点不同：按钮条贴宠物脚下，
 * 状态栏挂宠物右侧，食物列表挂在按钮条下面。合成一块就没法同时满足这三条。
 *
 * 命中判定**不由面板上报矩形**：根节点挂一个 `data-hit`，渲染层拿推进来的
 * 光标坐标问 DOM（`elementFromPoint(...).closest('[data-hit]')`）就够了。
 * 这样"能不能接住这点鼠标"由真实布局回答，收起（`hidden`）的元素
 * 天然问不到——不会出现透明度 0 却照样吃点击、照样改光标形状那种鬼东西。
 *
 * 切视图只换这两块的内容，不重建根节点：重建会让 `data-hit` 和位置一起丢，
 * 而面板正开着的时候切视图是常态。
 */

/** 按钮的形状完全由 config 的 PANEL_BUTTONS 决定，这里不复制一份。 */
export type PanelAction = PanelButton
export type PanelView = 'actions' | 'settings' | 'foods' | 'games' | 'stats' | 'debug'

/**
 * 状态栏底下那两行「此刻」的读数。
 *
 * 它们不走 `setStats`：数值快照一分钟才推一把，而「在干什么」「陪了多久」得一秒一跳，
 * 挂在同一条通道上要么让快照提频，要么让数字卡住，都不对。
 * 文字也由装配层拼好：面板只管摆，不懂动画池叫什么。
 */
export type PanelRuntime = { activity: string; online: string }

export interface PanelHandlers {
  /**
   * 按了动作视图里的某个按钮。带 `pool` 才回调——带 `view` 的那两颗（喂食、设置）
   * 由面板自己处理视图切换，不会走到这里。
   */
  action(a: PanelAction & { pool: string }): void
  /** 按了设置视图里的某个选项。只报被点的那一项，别整包覆盖。 */
  setting(patch: Partial<Settings>): void
  /** 点了食物列表里的某一格。播哪条动画、说什么话由装配层决定，面板只管「选了哪个」。 */
  pick(f: Food): void
  /** 点了游戏列表里某个「开始」。开哪个游戏、怎么接管整屏由装配层决定，面板只管「选了哪个」。 */
  game(g: Game): void
  /** 点了性别那一档。改名要键盘，这扇窗默认不收键盘，见装配层的说明。 */
  identity(patch: { name?: string; gender?: string }): void
  /** 视图换了。调用方据此换收起延时（操作型视图要更宽裕的时间）。 */
  view(v: PanelView): void
  /** 点了设置视图里的「退出桌宠」：装配层先说 bye 再让主进程退出。 */
  quit(): void
}

export interface Panel {
  readonly el: HTMLElement
  readonly isOpen: boolean
  readonly view: PanelView
  /** 摆主块（设置视图的主块就是那块板，其余视图是按钮条）。at 是覆盖层 CSS 坐标。 */
  show(at: Point): void
  /** 摆副板。只在有副板的视图里有意义；装配层按视图决定用哪条锚点。 */
  showPlate(at: Point): void
  hide(): void
  /** 切视图。用户路径是靠点按钮，这个口子给装配层与测试直接用。 */
  setView(v: PanelView): void
  /** 主块自身尺寸，只有打开时量得到（收起时不在布局里）。夹回屏幕内要用。 */
  size(): { w: number; h: number } | null
  /** 副板尺寸。没有副板（动作视图）或还没打开时是 null——装配层不该按它夹屏幕。 */
  plateSize(): { w: number; h: number } | null
  /**
   * 副板自己的矩形（没开或没有副板时 null）。
   * `rects()` 给的是两块的合集，分不出「挂在侧面那一条」和「长在下面那一条」，
   * 而飘字要判断的正是状态栏有没有占了左边（见 geometry.floatAnchor）。
   */
  plateRect(): Rect | null
  /** 现在代表主块的那个节点（测试与装配层用来确认「量的是哪一块」）。 */
  primaryEl(): HTMLElement | null
  /** 开着时占着屏幕的那几块的真实矩形（收起时是空数组）。
   *  气泡让路、光标连续区都要用它——根节点是整屏定位层，拿它当面板矩形会把全屏圈进来。 */
  rects(): Rect[]
  /** 选中态变了（本地立刻反馈，或主进程回灌）时重绘。 */
  setSettings(s: Settings): void
  /** 主进程推来的数值快照。开着状态视图时立刻重绘，没开就存着。 */
  setStats(s: StatsSnapshot): void
  /** 「此刻」两行：状态、在线时间。开着状态视图时只改这两处的文字，不重绘整块。 */
  setRuntime(r: PanelRuntime): void
  /**
   * 「正在吃饭」这个状态推给面板：食物列表整列置灰、点不动，饭后放开。
   * 就地翻 `disabled`，**不重建列表**——理由和 `syncScroll` 一样：重建会把滚动位置与
   * 用户手里的旧节点一起弄丢，而那正是这一列唯一还在动的东西。
   */
  setEating(on: boolean): void
}

/** 按钮来自 config 的 PANEL_BUTTONS，顺序即显示顺序；标签也在 config，不在这儿写死。 */
export function defaultActions(): PanelAction[] {
  return PANEL_BUTTONS.map((b) => ({ ...b }))
}

const OPTIONS: { value: Visibility; label: string }[] = [
  { value: 'show', label: '陪我' },
  { value: 'hide', label: '隐藏' },
]

const ROWS: { key: keyof Settings; label: string }[] = [
  { key: 'onFullscreen', label: '全屏时' },
  { key: 'onPresentation', label: '放映时' },
]

/**
 * 状态栏每个标签后面跟一个中文冒号（用户 2026-11-06 要）。
 * 只有状态栏加：设置视图那两行是「全屏时 [陪我][隐藏]」，是选项组不是「标签：值」的读法；
 * 飘字芯片也不加（「饥饿 +12」里冒号是多余的），所以冒号不进 `STAT_LABELS`。
 */
const LABEL_COLON = '：'

function btn(label: string, attrs: Record<string, string>, on: boolean): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  b.title = label
  b.setAttribute('aria-label', label)
  for (const [k, v] of Object.entries(attrs)) b.dataset[k] = v
  if (on) b.classList.add('on')
  return b
}

/** 图标按钮的公共形状：图是主角，文字退成 title/aria-label。图挂了也不留空白——它带 label。 */
function imgBtn(label: string, icon: string, attrs: Record<string, string>, cls: string): HTMLButtonElement {
  const b = btn(label, attrs, false)
  const img = document.createElement('img')
  img.className = cls
  img.src = icon
  img.alt = ''
  img.draggable = false
  b.textContent = ''
  b.append(img)
  return b
}

function iconBtn(a: PanelButton): HTMLButtonElement {
  return imgBtn(a.label, a.icon, { id: a.id }, 'pet-icon')
}

export function createPanel(
  root: HTMLElement,
  actions: PanelAction[],
  settings: Settings,
  handlers: PanelHandlers,
  debug?: DebugContext,
): Panel {
  const el = document.createElement('div')
  el.className = 'pet-panel'
  el.setAttribute('role', 'toolbar')
  // 命中权威就靠这个属性：它的存在表示「这块像素归桌宠」，子元素自动跟着算。
  el.dataset.hit = ''
  el.hidden = true
  root.append(el)

  let at: Point | null = null
  let plateAt: Point | null = null
  let current: PanelView = 'actions'
  let values = settings
  /** 主进程推来的数值快照。null = 还没推到（首帧），此时状态栏只显名字位、不编造读数。 */
  let snap: StatsSnapshot | null = null
  /** 「此刻」两行的内容。null = 装配层还没推过，行里给省略号而不是猜一个。 */
  let runtime: PanelRuntime | null = null
  /**
   * 那两行的值节点。`setRuntime` 一秒一跳，**只能就地改文字**：
   * 每次重绘整块副板会把出场动画（从 display:none 出来那一次状态变化）每秒重放一遍。
   * 和 `foodRefs` 同一个道理，所以也在 `render()` 开头清空——旧节点已经不在树里了。
   */
  let runtimeRefs: { activity: HTMLElement; online: HTMLElement } | null = null
  /** 两块内容节点。render 时重建，收起时都摘掉；null 表示这一视图里没有它。 */
  let actionsEl: HTMLElement | null = null
  let plateEl: HTMLElement | null = null
  /**
   * 调试副板**跨重绘复用**（和按钮条同一个理由）：它内部有 tab 状态和正在拖的滑条，
   * 数值快照推过来时只 refresh 读数、绝不重建，否则用户拖到一半的滑条/打开的 tab 会被冲掉。
   * 没传 debug 上下文（多数单测）时保持 null，debug 视图渲染成空板。
   */
  let debugHandle: { el: HTMLElement; refresh(): void } | null = null
  // 食物悬浮卡：附在整屏层 .pet-panel 上（不是副板里），免得被视口 overflow:hidden 裁掉。
  let tipEl: HTMLElement | null = null

  /** 摆一块。位置为 null 就不动——量不到尺寸时（还没进布局）别把 transform 写成 NaN。 */
  function place(node: HTMLElement | null, p: Point | null): void {
    if (node === null || p === null) return
    node.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`
  }

  /** 主块永远是按钮条：用户要「设置板弹出来时原按钮也不消失」（2026-11-11），所以没有任何视图整块替换它。 */
  function primary(): HTMLElement | null {
    return actionsEl
  }

  const hasPlate = (v: PanelView): boolean => v !== 'actions'
  /** 副板有没有自己的锚点：除动作视图外都有（食物/游戏挂按钮条外侧，状态/调试挂右侧，设置挂左侧）。 */
  const hasSecondAnchor = (v: PanelView): boolean => v !== 'actions'

  // 滚动状态只属于食物视图，就住在这里：一个数，其余全是纯函数算出来的（shared/scroll.ts）。
  const VIEW_W = FOOD_VISIBLE * FOOD_CELL + (FOOD_VISIBLE - 1) * FOOD_GAP
  const CONTENT_W = FOODS.length * FOOD_CELL + (FOODS.length - 1) * FOOD_GAP
  const STEP = pageStep(FOOD_VISIBLE, FOOD_CELL, FOOD_GAP)
  let scrollX = 0
  /** 食物视图的节点引用。每次 renderFoods 重新赋值，syncScroll 只改这几个节点，不重建列表。 */
  let foodRefs: { strip: HTMLElement; prev: HTMLButtonElement; next: HTMLButtonElement; thumb: HTMLElement | null; items: { cell: HTMLButtonElement; badge: HTMLElement; food: Food }[] } | null = null
  /**
   * 「正在吃饭」——装配层推过来的，面板自己不判断（判断要读行为链，那是两份账）。
   * 存在这里是因为**列表可能在吃饭中途才被叫出来**：那时候格子得直接以灰态建出来。
   */
  let eating = false

  /** 换视图/收起都要复位：下次进来从头看，不该停在用户上次看一半的位置。 */
  function resetScroll(): void {
    scrollX = 0
    gameScrollX = 0
  }

  // 游戏列表的滚动状态，和食物那套同构（同一套 shared/scroll 纯函数）。视口与食物同宽（4 格）；
  // 现在 3 个游戏装得下，箭头置灰、拖拽条不出现——和食物列表装得下时一致；以后游戏多了自然能滚。
  const GAME_VIEW_W = FOOD_VISIBLE * GAME_CELL + (FOOD_VISIBLE - 1) * GAME_GAP
  const GAME_CONTENT_W = GAMES.length * GAME_CELL + (GAMES.length - 1) * GAME_GAP
  const GAME_STEP = pageStep(FOOD_VISIBLE, GAME_CELL, GAME_GAP)
  let gameScrollX = 0
  let gameRefs: { strip: HTMLElement; prev: HTMLButtonElement; next: HTMLButtonElement; thumb: HTMLElement | null } | null = null

  function syncGameScroll(): void {
    if (gameRefs === null) return
    const { strip, prev, next, thumb } = gameRefs
    strip.style.transform = `translateX(${-gameScrollX}px)`
    prev.disabled = gameScrollX <= 0
    next.disabled = gameScrollX >= GAME_CONTENT_W - GAME_VIEW_W
    if (thumb !== null) {
      const t = thumbGeometry(gameScrollX, GAME_CONTENT_W, GAME_VIEW_W)
      if (t === null) return
      thumb.style.width = `${t.w}px`
      thumb.style.transform = `translateX(${t.x}px)`
    }
  }

  function setGameScroll(x: number): void {
    gameScrollX = clampScroll(x, GAME_CONTENT_W, GAME_VIEW_W)
    syncGameScroll()
    place(primary(), at)
    place(plateEl, plateAt)
  }

  function startGameDrag(e: MouseEvent): void {
    e.preventDefault()
    const fromX = e.clientX
    const fromScroll = gameScrollX
    const track = GAME_VIEW_W - (thumbGeometry(fromScroll, GAME_CONTENT_W, GAME_VIEW_W)?.w ?? GAME_VIEW_W)
    const ratio = track > 0 ? GAME_CONTENT_W / track : 1
    const move = (ev: MouseEvent): void => setGameScroll(fromScroll + (ev.clientX - fromX) * ratio)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /**
   * 就地同步滚动。拖动时每帧都会走这里，所以**不能重绘整块列表**：
   * 重建会把按钮上的 disabled 一起丢掉，用户手里的旧节点也就成了死节点。
   */
  function syncScroll(): void {
    if (foodRefs === null) return
    const { strip, prev, next, thumb } = foodRefs
    strip.style.transform = `translateX(${-scrollX}px)`
    prev.disabled = scrollX <= 0
    next.disabled = scrollX >= CONTENT_W - VIEW_W
    if (thumb !== null) {
      const t = thumbGeometry(scrollX, CONTENT_W, VIEW_W)
      if (t === null) return
      thumb.style.width = `${t.w}px`
      thumb.style.transform = `translateX(${t.x}px)`
    }
  }

  function setScroll(x: number): void {
    scrollX = clampScroll(x, CONTENT_W, VIEW_W)
    syncScroll()
    hideTip()   // 格子跟着滚走了，卡片停在原地会指错格子
    // 内容高度没变，但夹取结果可能贴着屏幕边，位置仍按当前锚点重贴一次
    place(primary(), at)
    place(plateEl, plateAt)
  }

  /**
   * 拖滑块。位移按「轨道 : 内容」的比例换算回去——滑块能走的距离比内容短得多，
   * 1:1 拖的话拖到头也只滚了一小截。
   */
  function startDrag(e: MouseEvent): void {
    e.preventDefault()
    const fromX = e.clientX
    const fromScroll = scrollX
    const track = VIEW_W - (thumbGeometry(fromScroll, CONTENT_W, VIEW_W)?.w ?? VIEW_W)
    const ratio = track > 0 ? CONTENT_W / track : 1
    const move = (ev: MouseEvent): void => setScroll(fromScroll + (ev.clientX - fromX) * ratio)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** 一行悬浮卡文字。 */
  function tipLine(text: string, cls: string): HTMLElement {
    const s = document.createElement('span')
    s.className = cls
    s.textContent = text
    return s
  }

  /**
   * 鼠标停在某格（或键盘聚焦）时，在格子旁边弹一张卡：名字 + 吃了有什么收益。
   * 数字从 FOOD_EFFECT（含该食物自己的心情）/ EXP_GAIN 现取，不写死——改数值表时卡片跟着走。
   * 卡片附在整屏层 `el` 上，坐标用 client 值（覆盖层就在 0,0），贴顶放不下就翻到格子下方。
   */
  function showTip(f: Food, cell: HTMLElement): void {
    if (tipEl === null) {
      tipEl = document.createElement('div')
      tipEl.className = 'pet-food-tip'
      el.append(tipEl)
    }
    const e = FOOD_EFFECT[f.id]!
    tipEl.replaceChildren(
      tipLine(f.name, 'pet-food-tip-name'),
      tipLine(`饥饿 +${e.hunger}`, 'pet-food-tip-stat'),
      tipLine(`心情 +${e.mood}`, 'pet-food-tip-stat'),
      tipLine(`经验 +${EXP_GAIN.feed}`, 'pet-food-tip-stat'),
    )
    tipEl.hidden = false
    placeTip(cell)
  }

  /** 把悬浮卡摆到格子旁边：水平居中夹回屏内，贴顶放不下就翻到格子下方。食物/游戏卡共用。 */
  function placeTip(cell: HTMLElement): void {
    if (tipEl === null) return
    const cr = cell.getBoundingClientRect()
    const tr = tipEl.getBoundingClientRect()
    const left = Math.max(4, Math.min(cr.left + cr.width / 2 - tr.width / 2, window.innerWidth - tr.width - 4))
    const top = cr.top - tr.height - 6 < 4 ? cr.bottom + 6 : cr.top - tr.height - 6
    tipEl.style.left = `${Math.round(left)}px`
    tipEl.style.top = `${Math.round(top)}px`
  }

  /** 游戏格悬停卡：名字 + 一句话玩法（和食物卡同一块 tipEl，视图切换时随 render 清掉）。 */
  function showGameTip(g: Game, cell: HTMLElement): void {
    if (tipEl === null) {
      tipEl = document.createElement('div')
      tipEl.className = 'pet-food-tip'
      el.append(tipEl)
    }
    tipEl.replaceChildren(
      tipLine(g.name, 'pet-food-tip-name'),
      tipLine(g.desc, 'pet-game-tip-desc'),
    )
    tipEl.hidden = false
    placeTip(cell)
  }

  function hideTip(): void {
    if (tipEl !== null) tipEl.hidden = true
  }

  function renderFoods(host: HTMLElement): void {
    const row = document.createElement('div')
    row.className = 'pet-foods'

    // 翻页键用 Kenney 的箭头图（以前是文字符号 ‹ ›，在板面上对比不够、也看不出能点）。
    // label 顺手写成「上一页/下一页」：图不带字时，title 与读屏兜底得能说清方向。
    const prev = imgBtn('上一页', 'icons/arrow_basic_w_small.svg', { page: 'prev' }, 'pet-arrow')
    const next = imgBtn('下一页', 'icons/arrow_basic_e_small.svg', { page: 'next' }, 'pet-arrow')
    prev.classList.add('pet-page')
    next.classList.add('pet-page')
    prev.addEventListener('click', () => setScroll(scrollX - STEP))
    next.addEventListener('click', () => setScroll(scrollX + STEP))

    const viewport = document.createElement('div')
    viewport.className = 'pet-food-viewport'
    const strip = document.createElement('div')
    strip.className = 'pet-food-strip'
    const items: { cell: HTMLButtonElement; badge: HTMLElement; food: Food }[] = []
    for (const f of FOODS) {
      // 格子里放图，名字退成 title/aria-label——和两个翻页键同一套约定（imgBtn）。
      // 以前这里是一格一个汉字名，六个格子看下来像一张菜单文字表；换成图之后「点哪格吃哪口」
      // 要一眼认出来，靠的是形状而不是识字。
      const cell = imgBtn(f.name, f.icon, { food: f.id }, 'pet-food-icon')
      cell.classList.add('pet-food')
      // 解锁角标那一枚。**每格都建一个**而不是只给没解锁的建：
      // 升级那一刻要能把字清空变回普通格子，留着节点比来回增删省事也不会晃眼。
      const badge = document.createElement('span')
      badge.className = 'pet-food-lock'
      cell.append(badge)
      cell.addEventListener('click', () => handlers.pick(f))
      cell.addEventListener('mouseenter', () => showTip(f, cell))
      cell.addEventListener('mouseleave', hideTip)
      cell.addEventListener('focus', () => showTip(f, cell))
      cell.addEventListener('blur', hideTip)
      strip.append(cell)
      items.push({ cell, badge, food: f })
    }
    viewport.append(strip)

    // 横条必须在矩形**下面**，所以「视口 + 横条」自己成一列，再夹进两个翻页键中间。
    // 直接把横条 append 到面板上会并排站到右边——面板是横排 flex，截图量出来过。
    // 这一列的宽度就是 VIEW_W，thumbGeometry 算的比例才对得上像素。
    const main = document.createElement('div')
    main.className = 'pet-food-main'
    main.append(viewport)

    let thumb: HTMLElement | null = null
    const t = thumbGeometry(scrollX, CONTENT_W, VIEW_W)
    if (t !== null) {
      // 一条都放得下时不画轨道：没有可滚的东西却摆一根横条，是在骗用户还能拖。
      const track = document.createElement('div')
      track.className = 'pet-scroll'
      thumb = document.createElement('div')
      thumb.className = 'pet-thumb'
      thumb.addEventListener('pointerdown', startDrag)
      track.append(thumb)
      main.append(track)
    }

    row.append(prev, main, next)
    host.append(row)

    foodRefs = { strip, prev, next, thumb, items }
    syncScroll()
    // 建完就同步一次：正在吃饭时把列表叫出来，格子该直接以灰态出现，不该先亮一下再暗
    syncCells()
  }

  /**
   * 就地翻格子的 `disabled`、角标与 title。列表不在布局里时（食物视图没开着）什么都不做——
   * 状态都存在 `eating` 与 `snap` 里，下一次 `renderFoods` 会带着它们建格子。
   *
   * 两件事会同时动这一列的灰态，所以合成一个函数：
   * ① **正在吃饭**（一口没吃完，整列点不动，用户拍的板）；
   * ② **还没解锁**（开局/等级两档，判据走 food.isUnlocked，别在这里再写一份比较）。
   * 判据分开算、`disabled` 取两者的或；解锁那一刻只翻这几个属性，**不重建列表**——
   * 重建会把用户的滚动位置与他手里的旧节点一起弄丢（和 `syncScroll` 同一条理由）。
   */
  function syncCells(): void {
    if (foodRefs === null) return
    const ctx = { level: levelNow() }
    for (const { cell, badge, food: f } of foodRefs.items) {
      const locked = !isUnlocked(f, ctx)
      cell.disabled = eating || locked
      cell.classList.toggle('is-locked', locked)
      badge.textContent = locked ? unlockBadge(f) : ''
      // 图不带字，读屏与悬停是唯一的说明。已解锁格**不再挂原生 title**（收益改由悬浮卡显示，
      // 原生 tooltip 会和卡片重复）；未解锁格仍留 title 说清「为什么点不动」。
      cell.setAttribute('aria-label', locked ? unlockHint(f) : f.name)
      cell.title = locked ? unlockHint(f) : ''
    }
  }

  /** 现在几级。快照还没到就当 Lv.1：列表要能点开，只是高级那几格先灰着。 */
  function levelNow(): number {
    return snap === null ? 1 : levelOf(snap.exp)
  }

  /**
   * 游戏列表：和食物列表同一套「一排方形格子、格子里是图标」的 UI。点一格 = 开那个游戏
   * （`handlers.game(g)`），不像食物那样带解锁/吃饭灰态——现在只有一个游戏，也还没做解锁。
   * 名字退成 title / aria-label，和食物格子、翻页箭头同一套约定（图不带字时的兜底说明）。
   */
  function renderGames(host: HTMLElement): void {
    const row = document.createElement('div')
    row.className = 'pet-games'

    // 翻页键和食物列表同一套（Kenney 箭头 + .pet-page），点一下翻一屏。
    const prev = imgBtn('上一页', 'icons/arrow_basic_w_small.svg', { page: 'prev' }, 'pet-arrow')
    const next = imgBtn('下一页', 'icons/arrow_basic_e_small.svg', { page: 'next' }, 'pet-arrow')
    prev.classList.add('pet-page')
    next.classList.add('pet-page')
    prev.addEventListener('click', () => setGameScroll(gameScrollX - GAME_STEP))
    next.addEventListener('click', () => setGameScroll(gameScrollX + GAME_STEP))

    const viewport = document.createElement('div')
    viewport.className = 'pet-game-viewport'
    const strip = document.createElement('div')
    strip.className = 'pet-game-strip'
    for (const g of GAMES) {
      const cell = imgBtn(g.name, g.icon, { id: `start-${g.id}`, game: g.id }, 'pet-game-icon')
      cell.classList.add('pet-game')
      cell.addEventListener('click', () => handlers.game(g))
      // 悬停/聚焦弹「名字 + 一句话玩法」卡（和食物格同一套）；原生 title 清掉免得和卡片重复。
      cell.title = ''
      cell.setAttribute('aria-label', `${g.name}：${g.desc}`)
      cell.addEventListener('mouseenter', () => showGameTip(g, cell))
      cell.addEventListener('mouseleave', hideTip)
      cell.addEventListener('focus', () => showGameTip(g, cell))
      cell.addEventListener('blur', hideTip)
      strip.append(cell)
    }
    viewport.append(strip)

    // 「视口 + 拖拽条」成一列夹在两个翻页键中间，和食物列表同构。
    const main = document.createElement('div')
    main.className = 'pet-game-main'
    main.append(viewport)

    let thumb: HTMLElement | null = null
    const t = thumbGeometry(gameScrollX, GAME_CONTENT_W, GAME_VIEW_W)
    if (t !== null) {
      // 装得下就不画轨道（3 个游戏 < 4 格时这里为 null）：没东西可滚却摆横条是骗用户还能拖。
      const track = document.createElement('div')
      track.className = 'pet-scroll'
      thumb = document.createElement('div')
      thumb.className = 'pet-thumb'
      thumb.addEventListener('pointerdown', startGameDrag)
      track.append(thumb)
      main.append(track)
    }

    row.append(prev, main, next)
    host.append(row)

    gameRefs = { strip, prev, next, thumb }
    syncGameScroll()
  }

  /**
   * 状态栏：昵称一行、性别一行，然后「等级 + 经验值」两行挨着，下面四条读数，最后「此刻」两行，
   * 没有返回按钮（收起靠再点一次状态键）。
   * 它是 qqpet 那种「一眼看到当前值」的面板，不是设置页——唯一还能就地改的是性别。
   */
  function renderStats(host: HTMLElement): void {
    // 卡片标题：一条横线 + 「宠物档案」。右上角那颗 × 已去掉（用户 2026-11-09）——
    // 收起靠「再点一次状态键」或「离开满 1500ms 自动收」，不必再造一枚关闭按钮。
    host.append(archiveHead())
    host.append(tight(plainLine('昵称', snap === null ? '…' : snap.identity.name, 'pet-stats-name')))
    // 性别要读得出是哪一档才画：没快照时给个空符号比猜一个诚实。
    if (snap !== null) host.append(tight(genderLine(snap.identity.gender)))

    // 快照还没到就到此为止：画四条 0 会让用户以为宠物饿坏了，那是编出来的恐慌。
    if (snap === null) return

    // 等级：**一行读数，不带进度条**（用户 2026-11-05 拍的板）。
    // 条画的是「到下一级攒了多少」，但那件事在状态栏里没有可操作的对象——
    // 饥饿/心情低了你能喂、能逗，等级攒到多少你什么都做不了，画条反而像「这项快满了」。
    // 经验怎么涨的挪到 title 里，想知道就悬停。
    const level = plainLine('等级', `Lv.${levelOf(snap.exp)}`, 'pet-stats-level')
    level.dataset.key = 'level'
    level.title = `累计经验 ${snap.exp.toFixed(1)}（只增不减）。在线挂机每分钟 ${IDLE_EXP_PER_MIN}，` +
      `喂食 ${EXP_GAIN.feed}、小游戏 ${EXP_GAIN.play}、点回应 ${EXP_GAIN.reply}`
    host.append(tight(level))

    // 经验条紧跟在等级下面（用户 2026-11-07 两次调整：先要「状态栏下面加一条，显示还差多少」，
    // 看过之后改成「标签叫经验值、位置放到等级下面」——「现在几级」和「到下一级还差多少」
    // 是同一件事的两半，隔在四条读数两头就读不连贯了）。
    // 等级行自己**仍然不带条**（11-05 那条拍板没变）：条是单独一行，不是挂在等级那一行右边。
    host.append(expLine())

    for (const key of STAT_KEYS) {
      const v = snap.stats[key]
      host.append(barLine(`is-${statBand(v)}`, key, STAT_LABELS[key], Math.round(v), String(Math.round(v)), String(STAT_MAX)))
    }

    // 「此刻」两行排在读数下面：上面四条是「攒了多少」，这两条是「现在」，
    // 混在一栏里读起来会变成「这栏有六条数值」。
    // 用户参考的是 qqpet 的宠物档案，但那里第三行是「成长进度」——我们没有自动成长，
    // 照抄就成了假数据，所以「状态」这一行读的是**当前动画池**（装配层查表推过来）。
    const act = plainLine('状态', runtime === null ? '…' : runtime.activity, 'pet-stats-activity')
    const on = plainLine('在线时间', runtime === null ? '…' : runtime.online, 'pet-stats-online')
    host.append(act, on)
    runtimeRefs = { activity: valueNode(act), online: valueNode(on) }
  }

  /**
   * 档案卡片的标题行：一行「宠物档案」，下沿一条横线（由 CSS 画）。
   * 只留标题——右上角那颗 × 已去掉（用户 2026-11-09），收起改由状态键切换 / 悬停延时负责。
   */
  function archiveHead(): HTMLElement {
    const head = document.createElement('div')
    head.className = 'pet-plate-head'
    const title = document.createElement('span')
    title.className = 'pet-plate-title'
    title.textContent = '宠物档案'
    head.append(title)
    return head
  }

  /**
   * 经验那一行：标签「经验」+ 本级比例条 + 还差多少。
   * 刻意不挂 `.pet-stat`：那个类专指「四条数值读数」，测试按它数条数、CSS 按它上色报警，
   * 而经验既不会掉、也不是能靠喂食当场救回来的东西——混进去就多出第五条假警报。
   * 调用方只在快照已到时会走到这里，所以里面的 `snap!` 不是将就。
   */
  function expLine(): HTMLElement {
    const exp = document.createElement('div')
    exp.className = 'pet-exp'
    exp.dataset.key = 'exp'
    const expBar = document.createElement('span')
    expBar.className = 'pet-exp-bar'
    const expFill = document.createElement('i')
    expFill.style.width = `${Math.round(levelFraction(snap!.exp) * 100)}%`
    expBar.append(expFill)
    const lv = levelOf(snap!.exp)
    const maxed = lv >= MAX_LEVEL
    const expOut = document.createElement('span')
    expOut.className = 'pet-stat-value pet-exp-value'
    // 2026-11-07 用户要求读数带总额：写「本级已攒 / 本级所需」（和那条 bar 同一口径）。
    // 满级不写假读数。
    const within = Math.floor(snap!.exp - LEVEL_CUM[lv - 1]!)
    expOut.textContent = maxed ? '满级' : String(within)
    const expTotal = document.createElement('span')
    expTotal.className = 'pet-stat-total pet-exp-total'
    expTotal.textContent = maxed ? '' : `/${LEVEL_STEPS[lv - 1]}`
    const expBox = document.createElement('span')
    expBox.className = 'pet-stat-out'
    expBox.append(expOut, expTotal)
    exp.append(makeLabel('经验'), expBar, expBox)
    // 不挂 title：用户 2026-11-07 嫌悬停那段「共需/还差/累计」太罗嗦，读数本身已带 /总额。
    return exp
  }

  /**
   * 把「标签 + 值」那一行改成**值紧跟冒号**（用户 2026-11-06 对昵称/性别/等级三行的要求）。
   *
   * 为什么只这三行：它们是「它是谁」——名字、性别、级别读起来是一句话，
   * 值贴到右沿就把这句话拆成两头，中间那段空白谁也没在读。
   * 而四条读数与「此刻」两行仍然右对齐：那一列的**数值是要横向比大小的**
   * （饥饿 16 对体重 68），右沿对齐才比得出来。
   * 所以这不是「统一一下」的事，是两种行各自的对齐法，别顺手把九行一起改。
   */
  function tight(line: HTMLElement): HTMLElement {
    line.classList.add('is-tight')
    return line
  }

  /** 取「标签 + 值」那一行的值节点（`plainLine` 固定把它放最后，这里只有一个用处，不值得为它改签名）。 */
  function valueNode(line: HTMLElement): HTMLElement {
    return line.lastElementChild as HTMLElement
  }

  /** 「标签 + 进度条 + 右端数值/总数」一行，四条读数共用。
   *  值与「/总数」包在一个无 gap 的 wrapper 里：行 gap 是 4px，直接并列会把「62 /100」拆开；
   *  数值本体仍是独立的 .pet-stat-value（e2e 按它 Number 解析），后缀单独 .pet-stat-total。 */
  function barLine(bandCls: string, key: string, labelText: string, pct: number, valueText: string, totalText: string): HTMLElement {
    const line = document.createElement('div')
    line.className = 'pet-stat'
    line.dataset.key = key
    const bar = document.createElement('span')
    bar.className = `pet-stat-bar ${bandCls}`
    const fill = document.createElement('i')
    fill.style.width = `${pct}%`
    bar.append(fill)
    const out = document.createElement('span')
    out.className = 'pet-stat-value'
    out.textContent = valueText
    const total = document.createElement('span')
    total.className = 'pet-stat-total'
    total.textContent = `/${totalText}`
    const box = document.createElement('span')
    box.className = 'pet-stat-out'
    box.append(out, total)
    line.append(makeLabel(labelText), bar, box)
    return line
  }

  /** 「标签 + 值」一行，和读数行同列：值右对齐到数字那一栏。 */
  function plainLine(label: string, value: string, valueCls: string): HTMLElement {
    const line = document.createElement('div')
    line.className = 'pet-stat-line'
    const v = document.createElement('span')
    v.className = `pet-stat-value ${valueCls}`
    v.textContent = value
    line.append(makeLabel(label), v)
    return line
  }

  /**
   * 状态栏行首那个标签。**中文冒号在这里统一加**，九个标签就不会有九个地方漏
   * ——也就不用把冒号写进 `STAT_LABELS`：那份清单飘字芯片也在用（「饥饿 +12」），
   * 芯片里冒号是多余的。
   */
  function makeLabel(text: string): HTMLSpanElement {
    const l = document.createElement('span')
    l.className = 'pet-stat-label'
    l.textContent = `${text}${LABEL_COLON}`
    return l
  }

  /**
   * 性别就一枚符号，点一下换到另一档。为什么还留着能点：改名要键盘输入而这扇窗不收键盘，
   * 换性别是存档里唯一还能就地改的东西，做成纯展示就没有入口了。
   * 符号自己说性别，颜色是第二道冗余表意（粉=雌、蓝=雄），所以不再做「选中/未选中」对比。
   */
  function genderLine(g: Gender): HTMLElement {
    const line = document.createElement('div')
    line.className = 'pet-stat-line'
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `pet-gender is-${g}`
    b.dataset.gender = g
    b.textContent = GENDER_GLYPHS[g]
    // 图/符号不带文字时，title 与 aria-label 是读屏和悬停唯一的说明
    const text = `${GENDER_LABELS[g]}（点一下换成${GENDER_LABELS[otherGender(g)]}）`
    b.title = text
    b.setAttribute('aria-label', text)
    b.addEventListener('click', () => handlers.identity({ gender: otherGender(g) }))
    line.append(makeLabel('性别'), b)
    return line
  }

  /** 按钮条。动作/食物/状态视图都挂着它——用户要的是「列表开着的时候按钮不许消失」。 */
  function renderActions(): HTMLElement {
    const row = document.createElement('div')
    row.className = 'pet-actions'
    actions.forEach((a, k) => {
      const b = iconBtn(a)
      // 错峰档位：`--i` = 从左数第几颗（0、1、2…），CSS 拿它乘间隔，就是 GSAP `stagger` 那件事。
      // 写在 style 而不是 :nth-child，是因为按钮数量由 config 决定，写死序号会骗人。
      b.style.setProperty('--i', String(k))
      b.addEventListener('click', () => {
        // 带 view 的按钮是切视图，带 pool 的才是点歌；两者都由 config 说清楚。
        // 再点一次同一个视图按钮 = 收回副板：不然列表开着时除了等自动收起没有别的关法。
        if (a.view) {
          switchTo(current === a.view ? 'actions' : a.view)
          return
        }
        const pool = a.pool
        if (pool !== undefined) handlers.action({ ...a, pool })
      })
      row.append(b)
    })
    return row
  }

  /** 布尔开关一行：标签 + [开][关] 两颗，和可见性那两行同一套形状（data-key/data-value/.on）。 */
  function boolRow(host: HTMLElement, key: 'developerMode' | 'muted', label: string): void {
    const line = document.createElement('div')
    line.className = 'pet-setting'
    const lab = document.createElement('span')
    lab.textContent = label
    line.append(lab)
    for (const o of [{ v: true, label: '开' }, { v: false, label: '关' }]) {
      const b = btn(o.label, { key, value: o.v ? 'on' : 'off' }, values[key] === o.v)
      b.addEventListener('click', () => handlers.setting({ [key]: o.v }))
      line.append(b)
    }
    host.append(line)
  }

  function renderSettings(host: HTMLElement): void {
    // 顺序按用户要的来：开发者模式 → 全屏/放映 → 静音 → 退出。
    boolRow(host, 'developerMode', '开发者模式')
    for (const row of ROWS) {
      const line = document.createElement('div')
      line.className = 'pet-setting'
      const label = document.createElement('span')
      label.textContent = row.label
      line.append(label)
      for (const o of OPTIONS) {
        const b = btn(o.label, { key: row.key, value: o.value }, values[row.key] === o.value)
        b.addEventListener('click', () => handlers.setting({ [row.key]: o.value }))
        line.append(b)
      }
      host.append(line)
    }
    boolRow(host, 'muted', '静音')
    const credit = document.createElement('div')
    credit.className = 'pet-credit'
    credit.textContent = '字体：思源黑体 / Fredoka（SIL OFL 1.1）'
    host.append(credit)
    // 退出桌宠：走装配层的 bye 流程（先说再见、再让主进程落盘退出），面板自己不关窗。
    const quit = btn('退出桌宠', { id: 'quit' }, false)
    quit.addEventListener('click', () => handlers.quit())
    host.append(quit)
    const back = btn('返回', { view: 'actions' }, false)
    back.addEventListener('click', () => switchTo('actions'))
    host.append(back)
  }

  /**
   * 重绘两块。**按钮条跨视图复用**，不跟着每次重建，两个原因：
   * ① 出场的错峰动画靠的是「从 display:none 出来」那一次状态变化，节点要是每次换视图都重建，
   *    数值快照每 60 秒推过来（`setStats` 会 render）就会把五颗重新弹一遍，列表开着时最明显；
   * ② 重建还会把监听器与焦点状态一起丢掉。
   * 副板（列表 / 读数 / 设置）内容随视图变，照旧整块换——它换一次就是「来了一张新卡片」，该弹。
   */
  /** 调试副板：构造一次后复用，每次进视图只重挂 + refresh 读数（不重建，保住 tab 与滑条状态）。 */
  function renderDebug(host: HTMLElement): void {
    if (debug === undefined) {
      const p = document.createElement('p')
      p.className = 'pet-debug-hint'
      p.textContent = '调试上下文未注入。'
      host.append(p)
      return
    }
    if (debugHandle === null) {
      debugHandle = createDebugPlate(debug, () => (snap === null ? null : { stats: snap.stats, exp: snap.exp }))
    }
    host.append(debugHandle.el)
    debugHandle.refresh()
  }

  function render(): void {
    if (plateEl !== null) {
      plateEl.remove()
      plateEl = null
    }
    foodRefs = null                 // 旧列表节点已经不在了，别让 syncScroll 去摸它们
    if (tipEl !== null) { tipEl.remove(); tipEl = null }   // 悬浮卡随列表一起退场
    runtimeRefs = null              // 同上：那两行的字要等下一次 renderStats 重新交出来
    // 按钮条常驻所有视图（含设置）：用户要「设置板出来时原按钮不消失」。跨视图复用，不重建。
    if (actionsEl === null) {
      actionsEl = renderActions()
      el.append(actionsEl)
    }
    if (hasPlate(current)) {
      plateEl = document.createElement('div')
      plateEl.className = 'pet-plate'
      plateEl.classList.add(`is-${current}`)
      if (current === 'foods') renderFoods(plateEl)
      else if (current === 'games') renderGames(plateEl)
      else if (current === 'stats') renderStats(plateEl)
      else if (current === 'debug') renderDebug(plateEl)
      else renderSettings(plateEl)
      el.append(plateEl)
    }
    // 按钮条跨视图复用之后，「哪一颗是当前视图」得单独同步——以前是重建时顺手带上的
    syncActive()
    // 调试按钮只在开发者模式开着时露面；开关换了就地翻 hidden，不重建按钮条。
    syncDebugGate()
    // 视图换了尺寸就变，锚在旧矩形上会飘：两块各按自己的锚点重贴
    place(primary(), at)
    place(plateEl, hasSecondAnchor(current) ? plateAt : null)
  }

  /** 带 view 的按钮里，当前视图那一颗高亮。 */
  function syncActive(): void {
    if (actionsEl === null) return
    for (const b of actionsEl.querySelectorAll<HTMLButtonElement>('button[data-id]')) {
      const view = actions.find((a) => a.id === b.dataset.id)?.view
      b.classList.toggle('on', view !== undefined && view === current)
    }
  }

  /** 开发者模式关着就把调试按钮藏掉（默认关）。按钮始终建在树里，只翻 hidden，开了立刻能显示。 */
  function syncDebugGate(): void {
    if (actionsEl === null) return
    const b = actionsEl.querySelector<HTMLButtonElement>('button[data-id="debug"]')
    if (b !== null) b.hidden = !values.developerMode
  }

  function switchTo(v: PanelView): void {
    if (v === current) return
    current = v
    resetScroll()          // 进列表从头看，离开列表没什么好保留的
    render()
    handlers.view(v)
  }

  render()

  return {
    el,
    get isOpen() {
      return at !== null
    },
    get view() {
      return current
    },
    show(p) {
      at = p
      el.hidden = false
      place(primary(), p)
      place(plateEl, hasSecondAnchor(current) ? plateAt : null)
    },
    showPlate(p) {
      plateAt = p
      place(plateEl, p)
    },
    hide() {
      at = null
      plateAt = null
      el.hidden = true
      resetScroll()
      // 收起来就回到动作视图：下次点开看到的是按钮而不是设置页或列表，
      // 不然用户会觉得自己上次离开时面板坏在了那里。
      if (current !== 'actions') {
        current = 'actions'
        render()
        handlers.view('actions')
      }
    },
    setView(v) {
      switchTo(v)
    },
    size() {
      if (!at) return null
      // 只有打开后才量得到：收起时不在布局里，offsetWidth 是 0，所以别在收起状态调它
      const node = primary()
      return node === null ? null : { w: node.offsetWidth, h: node.offsetHeight }
    },
    plateSize() {
      if (!at || plateEl === null || !hasSecondAnchor(current)) return null
      return { w: plateEl.offsetWidth, h: plateEl.offsetHeight }
    },
    plateRect() {
      // 只看「有没有副板且开着」，不套 hasSecondAnchor：设置视图的副板就是主块本身，
      // 它同样占着宠物旁边那块地方，飘字该躲的是它占的位置，不是它算不算"第二块"。
      if (at === null || plateEl === null) return null
      const r = plateEl.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    },
    primaryEl() {
      return primary()
    },
    rects() {
      if (at === null) return []
      const out: Rect[] = []
      for (const node of [actionsEl, plateEl]) {
        if (node === null) continue
        const r = node.getBoundingClientRect()
        out.push({ x: r.x, y: r.y, w: r.width, h: r.height })
      }
      return out
    },
    setSettings(s) {
      values = s
      // 设置视图开着就整块重绘（render 里会同步调试按钮）；没开着也要就地翻一下调试按钮的显隐，
      // 否则主进程回灌开发者模式时按钮条上的门控不更新。
      if (current === 'settings') render()
      else syncDebugGate()
    },
    setStats(s) {
      snap = s
      // 数值是主进程每 tick / 每次动作推过来的，状态栏开着就得跟着改；
      // 只在这里重绘，收起时不重绘——省掉一批没人看的 DOM 操作。
      if (current === 'stats') render()
      // 调试板开着：只把滑条/等级读数同步到新快照，**不重建**（用户可能正拖着滑条、开着某个 tab）。
      else if (current === 'debug') debugHandle?.refresh()
      // 列表开着时升级要当场解锁：只翻格子，不重建整块（滚动位置是用户的）。
      // 没开着时 foodRefs 是 null，这一句自己 no-op。
      else syncCells()
    },
    setRuntime(r) {
      runtime = r
      // 状态视图没开着就只存着，等 renderStats 建的时候带上——和 snap 一个待遇。
      if (runtimeRefs === null) return
      runtimeRefs.activity.textContent = r.activity
      runtimeRefs.online.textContent = r.online
    },
    setEating(on) {
      if (on === eating) return
      eating = on
      hideTip()
      syncCells()
    },
  }
}
