// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { createPanel, defaultActions } from '../src/renderer/panel.js'
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/visibility.js'
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
  const panel = createPanel(root, defaultActions(), { ...DEFAULT_SETTINGS }, { action: onClick, setting: vi.fn(), view: vi.fn() })
  return { panel, root, onClick }
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
    // 三个动作按钮 + 一个固定的「设置」入口
    expect(root.querySelectorAll('button')).toHaveLength(PANEL_BUTTONS.length + 1)
  })
})

describe('设置视图', () => {
  /** 带设置的面板：动作视图多一个「设置」按钮，点它切到设置视图。 */
  const mountWithSettings = (settings: Settings = { ...DEFAULT_SETTINGS }) => {
    const root = document.createElement('div')
    document.body.replaceChildren(root)
    const action = vi.fn()
    const set = vi.fn()
    const view = vi.fn()
    const panel = createPanel(root, defaultActions(), settings, { action, setting: set, view })
    panel.show({ x: 0, y: 0 })
    return { panel, root, action, set, view }
  }

  it('动作视图多一个设置按钮，它不带 pool', () => {
    const { panel } = mountWithSettings()
    const labels = [...panel.el.querySelectorAll('button')].map((b) => b.textContent)
    expect(labels).toEqual(['喂食', '小游戏', '状态', '设置'])
    expect(panel.view).toBe('actions')
  })

  it('点设置切成两行开关，并通知调用方换收起延时', () => {
    const { panel, view } = mountWithSettings()
    panel.el.querySelector<HTMLButtonElement>('button[data-view="settings"]')!.click()
    expect(panel.view).toBe('settings')
    expect(view).toHaveBeenCalledWith('settings')
    const rows = panel.el.querySelectorAll('.pet-setting')
    expect(rows).toHaveLength(2)
    expect([...rows[0]!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['陪我', '隐藏'])
  })

  it('点「隐藏」只报被点的那一项，不整包覆盖', () => {
    const { panel, set } = mountWithSettings()
    panel.el.querySelector<HTMLButtonElement>('button[data-view="settings"]')!.click()
    panel.el.querySelector<HTMLButtonElement>('button[data-key="onFullscreen"][data-value="hide"]')!.click()
    expect(set).toHaveBeenCalledWith({ onFullscreen: 'hide' })
  })

  it('选中态跟着 setSettings 重绘，当前项标出来', () => {
    const { panel } = mountWithSettings()
    panel.el.querySelector<HTMLButtonElement>('button[data-view="settings"]')!.click()
    const on = () => [...panel.el.querySelectorAll('.pet-setting')]
      .map((r) => r.querySelector('button.on')?.getAttribute('data-value'))
    expect(on()).toEqual(['show', 'show'])
    panel.setSettings({ onFullscreen: 'hide', onPresentation: 'show' })
    expect(on()).toEqual(['hide', 'show'])
  })

  it('返回切回动作视图，延时通知回一次', () => {
    const { panel, view } = mountWithSettings()
    panel.el.querySelector<HTMLButtonElement>('button[data-view="settings"]')!.click()
    panel.el.querySelector<HTMLButtonElement>('button[data-view="actions"]')!.click()
    expect(panel.view).toBe('actions')
    expect(view).toHaveBeenLastCalledWith('actions')
    expect(panel.el.querySelectorAll('.pet-setting')).toHaveLength(0)
  })

  it('收起面板就回到动作视图，并通知调用方换回延时', () => {
    const { panel, view } = mountWithSettings()
    panel.el.querySelector<HTMLButtonElement>('button[data-view="settings"]')!.click()
    view.mockClear()
    panel.hide()
    expect(panel.view).toBe('actions')
    expect(view).toHaveBeenCalledWith('actions')
  })

  it('切视图不重新挂载面板：根节点还在原位，data-hit 不丢', () => {
    const { panel, root } = mountWithSettings()
    const el = panel.el
    panel.el.querySelector<HTMLButtonElement>('button[data-view="settings"]')!.click()
    expect(panel.el).toBe(el)
    expect(root.lastElementChild).toBe(el)
    expect(el.dataset.hit).toBe('')
  })
})
