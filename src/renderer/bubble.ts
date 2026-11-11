import { BUBBLE_IMAGE, BUBBLE_TEXT_WIDTH } from '../shared/config.js'
import { taperLines } from '../shared/text.js'
import type { Point, Rect } from '../shared/types.js'

/**
 * 头顶气泡：一块底图 + 一行文字 + 一颗回应按钮。
 *
 * 它和面板是**两个组件**，因为生命周期不同：面板由用户悬停驱动，气泡由行为链驱动，
 * 两套时钟塞进一个文件会互相顶掉（上一轮理清的 hideMs/view 就是代价）。
 *
 * 命中权威和面板同一套规矩：根节点挂 `data-hit`，由渲染层问 DOM 判定；收起时 `hidden`
 * 属性把它移出布局，问不到就是问不到——不存在「看不见却吃点击、却照样改光标」。
 */

/**
 * 气泡内容：宠物那句 + 按钮上主人那句短回应（不配就没有按钮）。
 * `reply` 显式带上 undefined：装配层从台词表递过来的就是 `string | undefined`，
 * 而 `exactOptionalPropertyTypes` 下 `{ reply: undefined }` 不满足光秃秃的 `reply?:`。
 */
export type BubbleContent = { text: string; reply?: string | undefined }

export interface BubbleHandlers {
  /** 点了那颗回应按钮。气泡自己收，但**定时器归装配层管**，所以要通知它。 */
  onReply(): void
}

export interface Bubble {
  readonly el: HTMLElement
  readonly isOpen: boolean
  /** 全空白的文本视为不显示。位置由调用方算好（bubbleAnchor）。 */
  show(content: BubbleContent, at: Point): void
  place(at: Point): void
  hide(): void
  /** 只在打开时有矩形；收起时返回 null，别拿 0×0 去参与区域计算。 */
  rect(): Rect | null
}

export function createBubble(root: HTMLElement, handlers: BubbleHandlers = { onReply() {} }): Bubble {
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

  const reply = document.createElement('button')
  reply.type = 'button'
  reply.className = 'pet-bubble-reply'
  reply.addEventListener('click', () => {
    hide()
    handlers.onReply()
  })

  el.append(bg, text, reply)
  root.append(el)

  let open = false

  const at = (p: Point): void => {
    el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`
  }

  function hide(): void {
    el.hidden = true
    // 顺手清字：`role="status"` 是活动区域，留着旧文本的话，下次说同一句时
    // 读屏看不到"内容变了"，就不会再念。
    text.textContent = ''
    open = false
  }

  return {
    el,
    get isOpen() {
      return open
    },
    show(content, p) {
      if (content.text.trim() === '') return
      // 短长排版：按当前字号算每行字数，拆成 短长/短长短 几行，各渲染成一个居中子 div。
      // 用子 div 而非插 \n：父节点 textContent 仍是原句（不带换行），读屏与文本断言不变。
      const fontSize = parseFloat(getComputedStyle(text).fontSize) || 14
      const perLine = Math.max(4, Math.floor(BUBBLE_TEXT_WIDTH / fontSize))
      text.replaceChildren(...taperLines(content.text, perLine).map((line) => {
        const d = document.createElement('div')
        d.textContent = line
        return d
      }))
      const r = (content.reply ?? '').trim()
      // 没配回复就藏掉按钮：一颗点不动的东西不该占着白色区的位置。
      // 用 hidden 而不是不创建，是为了让 CSS 的显隐规则只有一套。
      reply.hidden = r === ''
      reply.textContent = r
      reply.title = r
      reply.setAttribute('aria-label', r)
      at(p)
      el.hidden = false
      open = true
    },
    place(p) {
      if (open) at(p)
    },
    hide,
    rect() {
      if (!open) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    },
  }
}
