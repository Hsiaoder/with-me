import { PANEL_LABELS, PANEL_POOLS } from '../shared/config.js'
import type { Point } from '../shared/types.js'

/**
 * 悬停面板：一排按钮，点哪个就切到哪个动作池。
 *
 * 命中判定**不由面板上报矩形**：根节点挂一个 `data-hit`，渲染层拿推进来的
 * 光标坐标问 DOM（`elementFromPoint(...).closest('[data-hit]')`）就够了。
 * 这样"能不能接住这点鼠标"由真实布局回答，收起（`display:none`）的元素
 * 天然问不到——不会出现透明度 0 却照样吃点击、照样改光标形状那种鬼东西。
 */

export type PanelAction = { id: string; label: string; pool: string }

export interface Panel {
  readonly el: HTMLElement
  readonly isOpen: boolean
  show(at: Point): void
  hide(): void
  /** 面板自身尺寸，只有打开时量得到（收起时不在布局里）。夹回屏幕内要用。 */
  size(): { w: number; h: number } | null
}

/** 按钮来自 config 的 PANEL_POOLS，顺序即显示顺序；标签也在 config，不在这儿写死。 */
export function defaultActions(): PanelAction[] {
  return PANEL_POOLS.map((pool) => ({ id: pool, label: PANEL_LABELS[pool] ?? pool, pool }))
}

export function createPanel(root: HTMLElement, actions: PanelAction[], onClick: (a: PanelAction) => void): Panel {
  const el = document.createElement('div')
  el.className = 'pet-panel'
  el.setAttribute('role', 'toolbar')
  // 命中权威就靠这个属性：它的存在表示「这块像素归桌宠」，子元素自动跟着算。
  el.dataset.hit = ''
  el.hidden = true
  for (const a of actions) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = a.label
    b.dataset.pool = a.pool
    b.addEventListener('click', () => onClick(a))
    el.append(b)
  }
  root.append(el)

  let at: Point | null = null

  return {
    el,
    get isOpen() {
      return at !== null
    },
    show(p) {
      at = p
      el.hidden = false
      el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`
    },
    hide() {
      at = null
      el.hidden = true
    },
    size() {
      if (!at) return null
      // 只有打开后才量得到：收起时不在布局里，offsetWidth 是 0，所以别在收起状态调它
      return { w: el.offsetWidth, h: el.offsetHeight }
    },
  }
}
