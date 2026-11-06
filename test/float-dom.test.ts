// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createFloatLayer } from '../src/renderer/float.js'
import { FLOAT_MS } from '../src/shared/config.js'

/**
 * 飘字层的 DOM 契约。
 *
 * jsdom 不跑 CSS 动画，也永远不发 `animationend`——这正好把「清理到底归谁」这件事
 * 逼出来：如果哪天有人把移除改成等动画事件，下面每条按时序写的断言都会红。
 */

const texts = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('.pet-float')].map((n) => n.textContent ?? '')

let root: HTMLElement
beforeEach(() => {
  vi.useFakeTimers()
  document.body.replaceChildren()
  root = document.createElement('div')
  document.body.append(root)
})

describe('飘字层', () => {
  it('开局收起：hidden 属性在，层不在布局里', () => {
    const f = createFloatLayer(root)
    expect(f.count).toBe(0)
    expect(f.el.hidden).toBe(true)
    expect(f.el.isConnected).toBe(true)
  })

  it('不挂 data-hit、pointer-events 交给 CSS：它不许把鼠标接住', () => {
    const f = createFloatLayer(root)
    f.show(['饥饿 +12'])
    expect(f.el.hasAttribute('data-hit'), '挂上 data-hit 就会被算进交互区（problem/01 §1.15）').toBe(false)
    expect(f.el.getAttribute('aria-hidden')).toBe('true')
    expect(f.el.getAttribute('role'), '读屏该读状态栏，不是每喂一次念一遍数字').toBeNull()
  })

  it('show 按给的顺序贴上去，空数组什么都不做', () => {
    const f = createFloatLayer(root)
    f.show(['饥饿 +14', '体重 +0.4'])
    expect(f.el.hidden).toBe(false)
    expect(f.count).toBe(2)
    expect(texts(f.el)).toEqual(['饥饿 +14', '体重 +0.4'])
    f.show([])
    expect(f.count).toBe(2)
  })

  it('到期自己掉：最后一条掉光时整层移出布局', () => {
    const f = createFloatLayer(root)
    f.show(['饥饿 +14'])
    vi.advanceTimersByTime(FLOAT_MS - 1)
    expect(f.count).toBe(1)
    expect(f.el.hidden).toBe(false)
    vi.advanceTimersByTime(1)
    expect(f.count).toBe(0)
    expect(f.el.hidden).toBe(true)
    expect(texts(f.el)).toEqual([])
  })

  it('各条按自己出现的那一刻到期，不是一起掉', () => {
    const f = createFloatLayer(root)
    f.show(['第一条'])
    vi.advanceTimersByTime(FLOAT_MS / 2)
    f.show(['第二条'])
    vi.advanceTimersByTime(FLOAT_MS / 2)
    expect(texts(f.el)).toEqual(['第二条'])
    vi.advanceTimersByTime(FLOAT_MS / 2)
    expect(f.count).toBe(0)
  })

  it('place 只在有字时写位置；clear 撤掉旧定时器，不许回头删新贴的字', () => {
    const f = createFloatLayer(root)
    f.place({ x: 12.6, y: 40.2 })
    expect(f.el.style.transform, '没有字的时候不该把整层放回布局').toBe('')
    f.show(['饥饿 +14'])
    f.place({ x: 12.6, y: 40.2 })
    expect(f.el.style.transform).toBe('translate(13px, 40px)')

    f.clear()
    expect(f.count).toBe(0)
    f.show(['心情 +6'])
    vi.advanceTimersByTime(FLOAT_MS - 1)   // 旧定时器若没被撤，此刻会把这条也算掉
    expect(texts(f.el)).toEqual(['心情 +6'])
    vi.advanceTimersByTime(1)
    expect(f.count).toBe(0)
  })

  it('同一批里贴满再 clear：一层不留，位置也回不来', () => {
    const f = createFloatLayer(root)
    f.show(['饥饿 +14', '心情 +6', '体重 +0.4'])
    f.place({ x: 5, y: 5 })
    f.clear()
    expect(f.el.children.length).toBe(0)
    expect(f.el.hidden).toBe(true)
    f.place({ x: 9, y: 9 })
    expect(f.el.style.transform).toBe('translate(5px, 5px)')
  })
})
