import { BUBBLE_IMAGE } from '../shared/config.js'
import type { Point, Rect } from '../shared/types.js'

/**
 * 头顶气泡：一块底图 + 一行文字。
 *
 * 它和面板是**两个组件**，因为生命周期不同：面板由用户悬停驱动，气泡由行为链驱动，
 * 两套时钟塞进一个文件会互相顶掉（上一轮理清的 hideMs/view 就是代价）。
 *
 * 命中权威和面板同一套规矩：根节点挂 `data-hit`，由渲染层问 DOM 判定；收起时 `hidden`
 * 属性把它移出布局，问不到就是问不到——不存在「看不见却吃点击、却照样改光标」。
 */

export interface Bubble {
  readonly el: HTMLElement
  readonly isOpen: boolean
  /** 全空白的文本视为不显示。位置由调用方算好（bubbleAnchor）。 */
  show(text: string, at: Point): void
  place(at: Point): void
  hide(): void
  /** 只在打开时有矩形；收起时返回 null，别拿 0×0 去参与区域计算。 */
  rect(): Rect | null
}

export function createBubble(root: HTMLElement): Bubble {
  const el = document.createElement('div')
  el.className = 'pet-bubble'
  el.setAttribute('role', 'status')          // 文本换了读屏会念，符合「它在说话」
  el.dataset.hit = ''
  el.hidden = true

  const bg = document.createElement('img')
  bg.className = 'pet-bubble-bg'
  bg.src = BUBBLE_IMAGE
  bg.alt = ''
  bg.draggable = false

  const text = document.createElement('div')
  text.className = 'pet-bubble-text'

  el.append(bg, text)
  root.append(el)

  let open = false

  const at = (p: Point): void => {
    el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`
  }

  return {
    el,
    get isOpen() {
      return open
    },
    show(content, p) {
      if (content.trim() === '') return
      text.textContent = content
      at(p)
      el.hidden = false
      open = true
    },
    place(p) {
      if (open) at(p)
    },
    hide() {
      el.hidden = true
      open = false
    },
    rect() {
      if (!open) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    },
  }
}
