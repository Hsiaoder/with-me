// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { createBubble } from '../src/renderer/bubble.js'
import { BUBBLE_IMAGE } from '../src/shared/config.js'

/**
 * 气泡组件的 DOM 契约。jsdom 没有排版引擎，量不到真实矩形，所以 `rect()` 的尺寸
 * 与「收起后到底在不在布局里」由 e2e 在 Chromium 里验；这里只钉结构。
 */

let root: HTMLElement
beforeEach(() => {
  document.body.replaceChildren()
  root = document.createElement('div')
  document.body.append(root)
})

describe('气泡 DOM', () => {
  it('开局收起：hidden 属性 + 不在布局里', () => {
    const b = createBubble(root)
    expect(b.isOpen).toBe(false)
    expect(b.el.hidden).toBe(true)
    expect(b.rect()).toBeNull()
  })

  it('show 之后文本、位置、命中权威都到位', () => {
    const b = createBubble(root)
    b.show('今天也想玩', { x: 40, y: 60 })
    expect(b.isOpen).toBe(true)
    expect(b.el.hidden).toBe(false)
    expect(b.el.querySelector('.pet-bubble-text')?.textContent).toBe('今天也想玩')
    expect(b.el.style.transform).toBe('translate(40px, 60px)')
    expect(b.el.dataset.hit).toBe('')
  })

  it('底图用 config 的路径，不在这儿写死', () => {
    const b = createBubble(root)
    b.show('嗯？', { x: 0, y: 0 })
    expect(b.el.querySelector('.pet-bubble-bg')?.getAttribute('src')).toBe(BUBBLE_IMAGE)
  })

  it('place 只挪位置不改文本；hide 收起并清掉命中', () => {
    const b = createBubble(root)
    b.show('在呢在呢', { x: 10, y: 10 })
    b.place({ x: 25, y: 35 })
    expect(b.el.style.transform).toBe('translate(25px, 35px)')
    expect(b.el.querySelector('.pet-bubble-text')?.textContent).toBe('在呢在呢')
    b.hide()
    expect(b.isOpen).toBe(false)
    expect(b.el.hidden).toBe(true)
  })

  it('收起之后 place 不该把它偷偷放回来', () => {
    const b = createBubble(root)
    b.show('叫我干嘛', { x: 1, y: 1 })
    b.hide()
    b.place({ x: 9, y: 9 })
    expect(b.isOpen).toBe(false)
    expect(b.el.hidden).toBe(true)
  })

  it('空文本不显示：等于没内容，别挂一个空气泡在屏幕上', () => {
    const b = createBubble(root)
    b.show('   ', { x: 0, y: 0 })
    expect(b.isOpen).toBe(false)
  })

  it('连着 show 两条是覆盖，不是叠两个气泡', () => {
    const b = createBubble(root)
    b.show('第一条', { x: 0, y: 0 })
    b.show('第二条', { x: 5, y: 5 })
    expect(root.querySelectorAll('.pet-bubble').length).toBe(1)
    expect(b.el.querySelector('.pet-bubble-text')?.textContent).toBe('第二条')
  })
})
