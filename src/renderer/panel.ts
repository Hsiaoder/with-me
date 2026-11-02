import { PANEL_LABELS, PANEL_POOLS } from '../shared/config.js'
import type { Point, Rect } from '../shared/types.js'

/**
 * 悬停面板：一排按钮，点哪个就切到哪个动作池。
 *
 * 面板必须**上报自己的控件矩形**——整屏覆盖层默认是鼠标穿透的，只有身体框和
 * 面板框这两块需要临时接住鼠标，否则按钮点了也落在下面的窗口上。
 */

export type PanelAction = { id: string; label: string; pool: string }

export interface Panel {
  readonly el: HTMLElement
  readonly isOpen: boolean
  show(at: Point): void
  hide(): void
  /** 面板在屏幕上占的那一块；没打开时是 null，穿透判定据此决定要不要接住鼠标。 */
  rect(): Rect | null
}

/** 按钮来自 config 的 PANEL_POOLS，顺序即显示顺序；标签也在 config，不在这儿写死。 */
export function defaultActions(): PanelAction[] {
  return PANEL_POOLS.map((pool) => ({ id: pool, label: PANEL_LABELS[pool] ?? pool, pool }))
}

export function createPanel(root: HTMLElement, actions: PanelAction[], onClick: (a: PanelAction) => void): Panel {
  const el = document.createElement('div')
  el.className = 'pet-panel'
  el.setAttribute('role', 'toolbar')
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
    rect() {
      if (!at) return null
      // 只在打开后测量：hidden 时 display:none，量出来是 0
      return { x: at.x, y: at.y, w: el.offsetWidth, h: el.offsetHeight }
    },
  }
}
