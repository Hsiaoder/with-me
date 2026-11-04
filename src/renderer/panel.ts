import { PANEL_BUTTONS, type PanelButton } from '../shared/config.js'
import type { Settings, Visibility } from '../shared/visibility.js'
import type { Point } from '../shared/types.js'

/**
 * 悬停面板：两个视图共用同一个容器。
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
export type PanelView = 'actions' | 'settings'

export interface PanelHandlers {
  /**
   * 按了动作视图里的某个按钮。带 `pool` 才回调——带 `view` 的那颗（设置）
   * 由面板自己处理视图切换，不会走到这里。
   */
  action(a: PanelAction & { pool: string }): void
  /** 按了设置视图里的某个选项。只报被点的那一项，别整包覆盖。 */
  setting(patch: Partial<Settings>): void
  /** 视图换了。调用方据此换收起延时（设置视图要更宽裕的时间）。 */
  view(v: PanelView): void
}

export interface Panel {
  readonly el: HTMLElement
  readonly isOpen: boolean
  readonly view: PanelView
  show(at: Point): void
  hide(): void
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

  function render(): void {
    el.replaceChildren()
    el.classList.toggle('is-settings', current === 'settings')
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
      // 收起来就回到动作视图：下次悬停看到的是按钮而不是设置页，
      // 不然用户会觉得自己上次离开时面板坏在了那里。
      if (current !== 'actions') {
        current = 'actions'
        render()
        handlers.view('actions')
      }
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
