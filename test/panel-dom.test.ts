// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { createPanel, defaultActions } from '../src/renderer/panel.js'
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/visibility.js'
import { FOODS, PANEL_BUTTONS, REQUIRED_POOLS } from '../src/shared/config.js'

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
  const panel = createPanel(root, defaultActions(), { ...DEFAULT_SETTINGS }, { action: onClick, setting: vi.fn(), view: vi.fn(), pick: vi.fn() })
  return { panel, root, onClick }
}

afterEach(() => { document.body.replaceChildren() })

describe('defaultActions', () => {
  it('四个按钮：喂食/小游戏/状态/设置，顺序即 PANEL_BUTTONS', () => {
    expect(defaultActions().map((a) => a.id)).toEqual(['feed', 'game', 'status', 'settings'])
    expect(defaultActions().map((a) => a.label)).toEqual(['喂食', '小游戏', '状态', '设置'])
  })

  it('每个按钮都带一个 icons/ 下的 SVG', () => {
    for (const a of defaultActions()) {
      expect(a.icon, `${a.id} 没有图标`).toMatch(/^icons\/[a-z-]+\.svg$/)
    }
  })

  it('带反应池的按钮只能用皮肤契约保证存在的池', () => {
    // 反应来自 click 池，而 click 是 REQUIRED_POOLS 之一，任何合法皮肤都有它。
    // 喂食与设置都不带 pool——它们切视图，不点歌。
    const withPool = defaultActions().filter((a) => a.pool !== undefined)
    expect(withPool).toHaveLength(2)
    for (const a of withPool) expect(REQUIRED_POOLS).toContain(a.pool)
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
    // 用小游戏而不是喂食：喂食现在切视图，不带 pool 了（食物视图那条路另有测试）
    panel.el.querySelector<HTMLButtonElement>('button[data-id="game"]')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick.mock.calls[0]![0]).toMatchObject({ id: 'game', pool: 'click' })
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
    // 四个按钮全部来自 PANEL_BUTTONS，面板自己不再额外加东西
    expect(root.querySelectorAll('button')).toHaveLength(PANEL_BUTTONS.length)
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
    const panel = createPanel(root, defaultActions(), settings, { action, setting: set, view, pick: vi.fn() })
    panel.show({ x: 0, y: 0 })
    return { panel, root, action, set, view }
  }

  it('动作视图是四枚图标：图在按钮里，文字退成 title 与 aria-label', () => {
    const { panel } = mountWithSettings()
    const buttons = [...panel.el.querySelectorAll('button')]
    expect(buttons.map((b) => b.querySelector('img')?.getAttribute('src'))).toEqual([
      'icons/rice.svg', 'icons/activity.svg', 'icons/status.svg', 'icons/settings.svg',
    ])
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['喂食', '小游戏', '状态', '设置'])
    expect(buttons.map((b) => b.getAttribute('title'))).toEqual(['喂食', '小游戏', '状态', '设置'])
    expect(panel.view).toBe('actions')
  })

  it('点设置切成两行开关，并通知调用方换收起延时', () => {
    const { panel, view } = mountWithSettings()
    panel.el.querySelector<HTMLButtonElement>('button[data-id="settings"]')!.click()
    expect(panel.view).toBe('settings')
    expect(view).toHaveBeenCalledWith('settings')
    const rows = panel.el.querySelectorAll('.pet-setting')
    expect(rows).toHaveLength(2)
    expect([...rows[0]!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['陪我', '隐藏'])
  })

  it('点「隐藏」只报被点的那一项，不整包覆盖', () => {
    const { panel, set } = mountWithSettings()
    panel.el.querySelector<HTMLButtonElement>('button[data-id="settings"]')!.click()
    panel.el.querySelector<HTMLButtonElement>('button[data-key="onFullscreen"][data-value="hide"]')!.click()
    expect(set).toHaveBeenCalledWith({ onFullscreen: 'hide' })
  })

  it('选中态跟着 setSettings 重绘，当前项标出来', () => {
    const { panel } = mountWithSettings()
    panel.el.querySelector<HTMLButtonElement>('button[data-id="settings"]')!.click()
    const on = () => [...panel.el.querySelectorAll('.pet-setting')]
      .map((r) => r.querySelector('button.on')?.getAttribute('data-value'))
    expect(on()).toEqual(['show', 'show'])
    panel.setSettings({ onFullscreen: 'hide', onPresentation: 'show' })
    expect(on()).toEqual(['hide', 'show'])
  })

  it('返回切回动作视图，延时通知回一次', () => {
    const { panel, view } = mountWithSettings()
    panel.el.querySelector<HTMLButtonElement>('button[data-id="settings"]')!.click()
    panel.el.querySelector<HTMLButtonElement>('button[data-view="actions"]')!.click()
    expect(panel.view).toBe('actions')
    expect(view).toHaveBeenLastCalledWith('actions')
    expect(panel.el.querySelectorAll('.pet-setting')).toHaveLength(0)
  })

  it('收起面板就回到动作视图，并通知调用方换回延时', () => {
    const { panel, view } = mountWithSettings()
    panel.el.querySelector<HTMLButtonElement>('button[data-id="settings"]')!.click()
    view.mockClear()
    panel.hide()
    expect(panel.view).toBe('actions')
    expect(view).toHaveBeenCalledWith('actions')
  })

  it('切视图不重新挂载面板：根节点还在原位，data-hit 不丢', () => {
    const { panel, root } = mountWithSettings()
    const el = panel.el
    panel.el.querySelector<HTMLButtonElement>('button[data-id="settings"]')!.click()
    expect(panel.el).toBe(el)
    expect(root.lastElementChild).toBe(el)
    expect(el.dataset.hit).toBe('')
  })
})

/**
 * jsdom 没有 PointerEvent 构造函数，但事件监听只认 type 字符串，
 * 所以用 MouseEvent 发 'pointerdown'/'pointermove'，处理器里读的 clientX 一样拿得到。
 * 真实指针拖拽由 e2e 在 Chromium 里验。
 */
const pointer = (type: string, x: number): MouseEvent =>
  new MouseEvent(type, { clientX: x, bubbles: true })

describe('食物视图', () => {
  const mountFoods = () => {
    const pick = vi.fn()
    const root = document.createElement('div')
    document.body.replaceChildren(root)
    const panel = createPanel(root, defaultActions(), { ...DEFAULT_SETTINGS },
      { action: vi.fn(), setting: vi.fn(), view: vi.fn(), pick })
    panel.show({ x: 0, y: 0 })
    panel.setView('foods')
    return { panel, pick }
  }

  it('切到 foods 后是底板态：整块吃命中，格子数等于 FOODS 长度', () => {
    const { panel } = mountFoods()
    expect(panel.view).toBe('foods')
    expect(panel.el.classList.contains('is-plate')).toBe(true)
    expect(panel.el.querySelectorAll('.pet-food').length).toBe(FOODS.length)
  })

  it('点一格把整个 food 报给 pick，并且不切视图', () => {
    const { panel, pick } = mountFoods()
    ;(panel.el.querySelector('.pet-food') as HTMLElement).click()
    expect(pick).toHaveBeenCalledTimes(1)
    expect(pick.mock.calls[0]![0].id).toBe('rice')
    expect(panel.view).toBe('foods')
  })

  it('点 ‹ › 改变滚动，内容条跟着平移，且不会滚出边界', () => {
    const { panel } = mountFoods()
    const strip = () => (panel.el.querySelector('.pet-food-strip') as HTMLElement).style.transform
    const next = panel.el.querySelector('.pet-page[data-page="next"]') as HTMLElement
    const prev = panel.el.querySelector('.pet-page[data-page="prev"]') as HTMLElement
    expect(strip()).toBe('translateX(0px)')
    next.click(); expect(strip()).toBe('translateX(-240px)')
    for (let i = 0; i < 10; i++) next.click()
    expect(strip()).toBe('translateX(-480px)')      // 最大滚动 716−236
    for (let i = 0; i < 10; i++) prev.click()
    expect(strip()).toBe('translateX(0px)')
  })

  it('到底时 next 置灰、到顶时 prev 置灰', () => {
    const { panel } = mountFoods()
    const next = panel.el.querySelector('.pet-page[data-page="next"]') as HTMLButtonElement
    const prev = panel.el.querySelector('.pet-page[data-page="prev"]') as HTMLButtonElement
    expect(prev.disabled).toBe(true)
    expect(next.disabled).toBe(false)
    for (let i = 0; i < 5; i++) next.click()
    expect(next.disabled).toBe(true)
    expect(prev.disabled).toBe(false)
  })

  it('横条滑块按 thumbGeometry 摆，拖它等于改滚动位置', () => {
    const { panel } = mountFoods()
    const thumb = panel.el.querySelector('.pet-thumb') as HTMLElement
    expect(thumb).not.toBeNull()
    expect(thumb.style.width).not.toBe('')
    thumb.dispatchEvent(pointer('pointerdown', 40))
    window.dispatchEvent(pointer('pointermove', 140))
    window.dispatchEvent(pointer('pointerup', 140))
    const moved = (panel.el.querySelector('.pet-food-strip') as HTMLElement).style.transform
    expect(moved).not.toBe('translateX(0px)')
    expect(moved).not.toBe('translateX(-240px)')     // 拖 100px 不该等于按一次翻页
  })

  it('收起再打开时滚动复位，不会停在用户上次看一半的地方', () => {
    const { panel } = mountFoods()
    ;(panel.el.querySelector('.pet-page[data-page="next"]') as HTMLElement).click()
    panel.hide()
    panel.show({ x: 0, y: 0 })
    panel.setView('foods')
    expect((panel.el.querySelector('.pet-food-strip') as HTMLElement).style.transform).toBe('translateX(0px)')
  })

  it('喂食按钮切视图而不是直接播动画，带反应池的只剩小游戏和状态', () => {
    const withPool = defaultActions().filter((a) => a.pool !== undefined)
    expect(withPool.map((a) => a.id)).toEqual(['game', 'status'])
    expect(defaultActions().find((a) => a.id === 'feed')?.view).toBe('foods')
  })

  it('点喂食走 view 回调，不走 action 回调', () => {
    const action = vi.fn()
    const view = vi.fn()
    const root = document.createElement('div')
    document.body.replaceChildren(root)
    const panel = createPanel(root, defaultActions(), { ...DEFAULT_SETTINGS }, { action, setting: vi.fn(), view, pick: vi.fn() })
    panel.show({ x: 0, y: 0 })
    ;(panel.el.querySelector('button[data-id="feed"]') as HTMLElement).click()
    expect(action).not.toHaveBeenCalled()
    expect(view).toHaveBeenCalledWith('foods')
  })
})
