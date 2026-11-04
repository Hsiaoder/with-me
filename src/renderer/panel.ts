import { FOOD_CELL, FOOD_GAP, FOODS, FOOD_VISIBLE, PANEL_BUTTONS, type Food, type PanelButton } from '../shared/config.js'
import { clampScroll, pageStep, thumbGeometry } from '../shared/scroll.js'
import type { Settings, Visibility } from '../shared/visibility.js'
import type { Point } from '../shared/types.js'

/**
 * 悬停面板：三个视图共用同一个容器。
 *
 * 命中判定**不由面板上报矩形**：根节点挂一个 `data-hit`，渲染层拿推进来的
 * 光标坐标问 DOM（`elementFromPoint(...).closest('[data-hit]')`）就够了。
 * 这样"能不能接住这点鼠标"由真实布局回答，收起（`display:none`）的元素
 * 天然问不到——不会出现透明度 0 却照样吃点击、照样改光标形状那种鬼东西。
 *
 * 切视图只换容器里的子节点，不重建容器：重建会让 `data-hit` 和位置一起丢，
 * 而面板正开着的时候切视图是常态。
 */

/** 按钮的形状完全由 config 的 PANEL_BUTTONS 决定，这里不复制一份。 */
export type PanelAction = PanelButton
export type PanelView = 'actions' | 'settings' | 'foods'

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
  /** 视图换了。调用方据此换收起延时（操作型视图要更宽裕的时间）。 */
  view(v: PanelView): void
}

export interface Panel {
  readonly el: HTMLElement
  readonly isOpen: boolean
  readonly view: PanelView
  show(at: Point): void
  hide(): void
  /** 切视图。用户路径是靠点按钮，这个口子给装配层与测试直接用。 */
  setView(v: PanelView): void
  /** 面板自身尺寸，只有打开时量得到（收起时不在布局里）。夹回屏幕内要用。 */
  size(): { w: number; h: number } | null
  /** 选中态变了（本地立刻反馈，或主进程回灌）时重绘。 */
  setSettings(s: Settings): void
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

/** 图标按钮：图是主角，文字退成 title/aria-label。图挂了也不留空白——它带 label。 */
function iconBtn(a: PanelButton): HTMLButtonElement {
  const b = btn(a.label, { id: a.id }, false)
  const img = document.createElement('img')
  img.className = 'pet-icon'
  img.src = a.icon
  img.alt = ''
  img.draggable = false
  b.textContent = ''
  b.append(img)
  return b
}

export function createPanel(
  root: HTMLElement,
  actions: PanelAction[],
  settings: Settings,
  handlers: PanelHandlers,
): Panel {
  const el = document.createElement('div')
  el.className = 'pet-panel'
  el.setAttribute('role', 'toolbar')
  // 命中权威就靠这个属性：它的存在表示「这块像素归桌宠」，子元素自动跟着算。
  el.dataset.hit = ''
  el.hidden = true
  root.append(el)

  let at: Point | null = null
  let current: PanelView = 'actions'
  let values = settings

  // 滚动状态只属于食物视图，就住在这里：一个数，其余全是纯函数算出来的（shared/scroll.ts）。
  const VIEW_W = FOOD_VISIBLE * FOOD_CELL + (FOOD_VISIBLE - 1) * FOOD_GAP
  const CONTENT_W = FOODS.length * FOOD_CELL + (FOODS.length - 1) * FOOD_GAP
  const STEP = pageStep(FOOD_VISIBLE, FOOD_CELL, FOOD_GAP)
  let scrollX = 0
  /** 食物视图的节点引用。每次 renderFoods 重新赋值，syncScroll 只改这几个节点，不重建列表。 */
  let foodRefs: { strip: HTMLElement; prev: HTMLButtonElement; next: HTMLButtonElement; thumb: HTMLElement | null } | null = null

  /** 换视图/收起都要复位：下次进来从头看，不该停在用户上次看一半的位置。 */
  function resetScroll(): void {
    scrollX = 0
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
    // 内容高度没变，但夹取结果可能贴着屏幕边，位置仍按当前锚点重贴一次
    if (at !== null) el.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`
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

  function renderFoods(): void {
    const row = document.createElement('div')
    row.className = 'pet-foods'

    const prev = btn('‹', { page: 'prev' }, false)
    const next = btn('›', { page: 'next' }, false)
    prev.classList.add('pet-page')
    next.classList.add('pet-page')
    prev.addEventListener('click', () => setScroll(scrollX - STEP))
    next.addEventListener('click', () => setScroll(scrollX + STEP))

    const viewport = document.createElement('div')
    viewport.className = 'pet-food-viewport'
    const strip = document.createElement('div')
    strip.className = 'pet-food-strip'
    for (const f of FOODS) {
      const cell = btn(f.name, { food: f.id }, false)
      cell.classList.add('pet-food')
      cell.addEventListener('click', () => handlers.pick(f))
      strip.append(cell)
    }
    viewport.append(strip)
    row.append(prev, viewport, next)
    el.append(row)

    // 横条在长方形下面，是自绘控件不是浏览器滚动条：透明覆盖层里要的是「能画成什么样都行」。
    // 一条都放得下时不画——没有可滚的东西却摆一根轨道，是在骗用户还能拖。
    let thumb: HTMLElement | null = null
    const t = thumbGeometry(scrollX, CONTENT_W, VIEW_W)
    if (t !== null) {
      const track = document.createElement('div')
      track.className = 'pet-scroll'
      thumb = document.createElement('div')
      thumb.className = 'pet-thumb'
      thumb.addEventListener('pointerdown', startDrag)
      track.append(thumb)
      el.append(track)
    }

    foodRefs = { strip, prev, next, thumb }
    syncScroll()
  }

  function render(): void {
    el.replaceChildren()
    foodRefs = null                 // 旧节点已经不在了，别让 syncScroll 去摸它们
    el.classList.toggle('is-settings', current === 'settings')
    el.classList.toggle('is-foods', current === 'foods')
    // 操作型视图是一整块可见面板：底板、命中、光标都跟着，文字浮在桌面上读不成句。
    // 动作视图仍然只有按钮吃命中——那里的空隙看不见，不该吞桌面的点击。
    el.classList.toggle('is-plate', current !== 'actions')
    if (current === 'foods') {
      renderFoods()
      return
    }
    if (current === 'settings') {
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
        el.append(line)
      }
      const back = btn('返回', { view: 'actions' }, false)
      back.addEventListener('click', () => switchTo('actions'))
      el.append(back)
      return
    }

    for (const a of actions) {
      const b = iconBtn(a)
      b.addEventListener('click', () => {
        // 带 view 的按钮是切视图（设置），带 pool 的才是点歌；两者都由 config 说清楚
        if (a.view) {
          switchTo(a.view)
          return
        }
        const pool = a.pool
        if (pool !== undefined) handlers.action({ ...a, pool })
      })
      el.append(b)
    }
  }

  function switchTo(v: PanelView): void {
    if (v === current) return
    current = v
    resetScroll()          // 进列表从头看，离开列表没什么好保留的
    render()
    // 位置要立刻重算：视图换了尺寸就变，锚在旧矩形上会飘
    if (at !== null) el.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`
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
      el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`
    },
    hide() {
      at = null
      el.hidden = true
      resetScroll()
      // 收起来就回到动作视图：下次悬停看到的是按钮而不是设置页或列表，
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
      return { w: el.offsetWidth, h: el.offsetHeight }
    },
    setSettings(s) {
      values = s
      if (current === 'settings') render()
    },
  }
}
