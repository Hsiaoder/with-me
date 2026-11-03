// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { createPanel, defaultActions } from '../src/renderer/panel.js'
import { PANEL_BUTTONS, REQUIRED_POOLS } from '../src/shared/config.js'

/**
 * jsdom 没有排版引擎，offsetWidth/offsetHeight 恒为 0，而「打开后量自身尺寸用来
 * 夹回屏幕内」正是这里要测的东西。给它一个固定值，让断言能落在坐标换算上；
 * 真实尺寸、真实显隐（display:none 到底生不生效）由 e2e 在 Chromium 里验。
 */
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 240 })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 36 })
})

const mount = (onClick = vi.fn()) => {
  const root = document.createElement('div')
  document.body.replaceChildren(root)
  return { panel: createPanel(root, defaultActions(), onClick), root, onClick }
}

afterEach(() => { document.body.replaceChildren() })

describe('defaultActions', () => {
  it('三个功能按钮：喂食/小游戏/状态，顺序即 PANEL_BUTTONS', () => {
    expect(defaultActions().map((a) => a.id)).toEqual(['feed', 'game', 'status'])
    expect(defaultActions().map((a) => a.label)).toEqual(['喂食', '小游戏', '状态'])
  })
  it('按钮的反应池必须是皮肤契约里保证存在的池', () => {
    // 业务功能还没接，按钮只做「给个反应」。反应来自 click 池，
    // 而 click 是 REQUIRED_POOLS 之一，任何合法皮肤都有它。
    for (const a of defaultActions()) expect(REQUIRED_POOLS).toContain(a.pool)
  })
})

describe('createPanel', () => {
  it('未打开时 hidden，尺寸为 null', () => {
    const { panel } = mount()
    expect(panel.el.hidden).toBe(true)
    expect(panel.isOpen).toBe(false)
    expect(panel.size()).toBeNull()
  })

  it('根节点挂 data-hit：命中判定问 DOM 就够了，不需要面板自报矩形', () => {
    const { panel } = mount()
    expect(panel.el.dataset.hit).toBe('')
    // 按钮是根节点的子元素，closest('[data-hit]') 会一路爬上来命中
    const btn = panel.el.querySelector('button')
    expect(btn?.closest('[data-hit]')).toBe(panel.el)
  })

  it('show 后能拿到自身尺寸（夹回屏幕内要用），hide 后回到 null', () => {
    const { panel } = mount()
    panel.show({ x: 100, y: 200 })
    expect(panel.el.hidden).toBe(false)
    expect(panel.isOpen).toBe(true)
    expect(panel.size()).toEqual({ w: 240, h: 36 })
    panel.hide()
    expect(panel.size()).toBeNull()
    expect(panel.el.hidden).toBe(true)
  })

  it('show 把位置写进 transform，而不是 left/top（避免每帧触发布局）', () => {
    const { panel } = mount()
    panel.show({ x: 33.6, y: 77.2 })
    expect(panel.el.style.transform).toBe('translate(34px, 77px)')
  })

  it('点按钮回调带上被点的动作', () => {
    const { panel, onClick } = mount()
    panel.show({ x: 0, y: 0 })
    panel.el.querySelector<HTMLButtonElement>('button[data-id="feed"]')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick.mock.calls[0]![0]).toMatchObject({ id: 'feed', pool: 'click' })
  })

  it('面板自身必须可点：不能继承舞台那层 pointer-events:none', () => {
    const { panel, root } = mount()
    panel.show({ x: 0, y: 0 })
    const sprite = document.createElement('div')
    sprite.className = 'pet-sprite'
    root.append(sprite)
    // 面板不是 .pet-sprite 的后代，所以拿不到那条 pointer-events:none
    expect(panel.el.closest('.pet-sprite')).toBeNull()
    expect(getComputedStyle(panel.el).pointerEvents).not.toBe('none')
  })

  it('重复 show 只挪位置，不会长出第二个面板', () => {
    const { panel, root } = mount()
    panel.show({ x: 0, y: 0 })
    panel.show({ x: 10, y: 10 })
    expect(root.querySelectorAll('.pet-panel')).toHaveLength(1)
    expect(root.querySelectorAll('button')).toHaveLength(PANEL_BUTTONS.length)
  })
})
