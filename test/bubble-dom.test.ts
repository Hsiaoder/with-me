// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
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
    b.show({ text: '今天也想玩' }, { x: 40, y: 60 })
    expect(b.isOpen).toBe(true)
    expect(b.el.hidden).toBe(false)
    expect(b.el.querySelector('.pet-bubble-text')?.textContent).toBe('今天也想玩')
    expect(b.el.style.transform).toBe('translate(40px, 60px)')
    expect(b.el.dataset.hit).toBe('')
  })

  it('底图用 config 的路径，不在这儿写死', () => {
    const b = createBubble(root)
    b.show({ text: '嗯？' }, { x: 0, y: 0 })
    expect(b.el.querySelector('.pet-bubble-bg')?.getAttribute('src')).toBe(BUBBLE_IMAGE)
  })

  it('place 只挪位置不改文本；hide 收起并清掉命中', () => {
    const b = createBubble(root)
    b.show({ text: '在呢在呢' }, { x: 10, y: 10 })
    b.place({ x: 25, y: 35 })
    expect(b.el.style.transform).toBe('translate(25px, 35px)')
    expect(b.el.querySelector('.pet-bubble-text')?.textContent).toBe('在呢在呢')
    b.hide()
    expect(b.isOpen).toBe(false)
    expect(b.el.hidden).toBe(true)
  })

  it('收起之后 place 不该把它偷偷放回来', () => {
    const b = createBubble(root)
    b.show({ text: '叫我干嘛' }, { x: 1, y: 1 })
    b.hide()
    b.place({ x: 9, y: 9 })
    expect(b.isOpen).toBe(false)
    expect(b.el.hidden).toBe(true)
  })

  it('空文本不显示：等于没内容，别挂一个空气泡在屏幕上', () => {
    const b = createBubble(root)
    b.show({ text: '   ' }, { x: 0, y: 0 })
    expect(b.isOpen).toBe(false)
  })

  it('连着 show 两条是覆盖，不是叠两个气泡', () => {
    const b = createBubble(root)
    b.show({ text: '第一条' }, { x: 0, y: 0 })
    b.show({ text: '第二条' }, { x: 5, y: 5 })
    expect(root.querySelectorAll('.pet-bubble').length).toBe(1)
    expect(b.el.querySelector('.pet-bubble-text')?.textContent).toBe('第二条')
  })

  it('带回复就出按钮，文字是那句主人的短回应', () => {
    const b = createBubble(root)
    b.show({ text: '哇，是吃的！', reply: '吃吧吃吧' }, { x: 0, y: 0 })
    const btn = b.el.querySelector('.pet-bubble-reply') as HTMLButtonElement
    expect(btn.textContent).toBe('吃吧吃吧')
    expect(btn.getAttribute('aria-label')).toBe('吃吧吃吧')
  })

  it('点按钮：气泡收掉，并通知装配层（定时器归它管）', () => {
    const onReply = vi.fn()
    const b = createBubble(root, { onReply })
    b.show({ text: '叫我干嘛', reply: '在呢' }, { x: 0, y: 0 })
    ;(b.el.querySelector('.pet-bubble-reply') as HTMLButtonElement).click()
    expect(b.isOpen).toBe(false)
    expect(b.el.hidden).toBe(true)
    expect(onReply).toHaveBeenCalledTimes(1)
  })

  it('没配回复就不见按钮——空按钮点不动还占一格', () => {
    const b = createBubble(root)
    b.show({ text: '嗯？' }, { x: 0, y: 0 })
    const btn = b.el.querySelector('.pet-bubble-reply') as HTMLButtonElement
    // 实现选的是「常驻一个节点、用 hidden 收起」而不是不创建：显隐规则只有一套。
    // 按钮自己没声明 display，所以 UA 的 [hidden]{display:none} 生效（面板那条坑在这儿不存在）。
    expect(btn.hidden).toBe(true)
    expect(btn.textContent).toBe('')
    b.show({ text: '来呀来呀', reply: '来' }, { x: 0, y: 0 })
    expect(btn.hidden).toBe(false)
  })

  it('按钮点得到这件事交给 e2e 在 Chromium 里验', () => {
    // jsdom 没有排版也没有命中测试，读 CSS 文本猜「它是不是 auto」是自欺：
    // 选择器写错、被别的规则覆盖、z-index 压住，jsdom 一概看不见。
    // 这里只钉结构，真点得到由 e2e 那条「点按钮气泡收掉」负责。
    const b = createBubble(root)
    b.show({ text: '来呀来呀', reply: '来' }, { x: 0, y: 0 })
    expect(b.el.querySelector('.pet-bubble-reply')?.tagName).toBe('BUTTON')
  })
})
