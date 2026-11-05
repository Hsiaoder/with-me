// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { createPanel, defaultActions } from '../src/renderer/panel.js'
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/visibility.js'
import { PANEL_BUTTONS, REQUIRED_POOLS } from '../src/shared/config.js'
import { FOODS } from '../src/shared/food.js'
import type { StatsSnapshot } from '../src/shared/save.js'

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
  const identity = vi.fn()
  const panel = createPanel(root, defaultActions(), { ...DEFAULT_SETTINGS }, { action: onClick, setting: vi.fn(), view: vi.fn(), pick: vi.fn(), identity })
  return { panel, root, onClick, identity }
}

afterEach(() => { document.body.replaceChildren() })

describe('defaultActions', () => {
  it('五个按钮：喂食/小游戏/状态/设置/说话，顺序即 PANEL_BUTTONS', () => {
    expect(defaultActions().map((a) => a.id)).toEqual(['feed', 'game', 'status', 'settings', 'talk'])
    expect(defaultActions().map((a) => a.label)).toEqual(['喂食', '小游戏', '状态', '设置', '说话'])
  })

  it('每个按钮都带一张能进 dist 的图：icons/ 下的 SVG 或 emotes/ 下的 PNG', () => {
    // 两条白名单（protocol 的 MIME 表 + copy-static 的 STATIC_EXT）都只放 svg/png，
    // 路径写错就是 404、按钮变空片，所以这里按目录+后缀钉住。
    for (const a of defaultActions()) {
      expect(a.icon, `${a.id} 没有图标`).toMatch(/^(icons\/[a-z-]+\.svg|emotes\/[a-z0-9]+\.png)$/)
    }
  })

  it('带反应池的按钮只能用皮肤契约保证存在的池', () => {
    // 反应来自 click 池，而 click 是 REQUIRED_POOLS 之一，任何合法皮肤都有它。
    // 喂食、状态、设置都不带 pool——它们切视图，不点歌。
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

  it('show 把位置写进主块的 transform，而不是 left/top（避免每帧触发布局）', () => {
    const { panel } = mount()
    panel.show({ x: 33.6, y: 77.2 })
    // 写在主块上而不是根节点：根节点是铺满覆盖层的定位层，转它等于转整块屏幕
    expect(panel.primaryEl()?.style.transform).toBe('translate(34px, 77px)')
    expect(panel.el.style.transform).toBe('')
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
    const panel = createPanel(root, defaultActions(), settings, { action, setting: set, view, pick: vi.fn(), identity: vi.fn() })
    panel.show({ x: 0, y: 0 })
    return { panel, root, action, set, view }
  }

  it('动作视图是五枚图标：图在按钮里，文字退成 title 与 aria-label', () => {
    const { panel } = mountWithSettings()
    const buttons = [...panel.el.querySelectorAll('button')]
    expect(buttons.map((b) => b.querySelector('img')?.getAttribute('src'))).toEqual([
      'icons/rice.svg', 'icons/game.svg', 'icons/heart.svg', 'icons/settings.svg', 'emotes/dots3.png',
    ])
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['喂食', '小游戏', '状态', '设置', '说话'])
    expect(buttons.map((b) => b.getAttribute('title'))).toEqual(['喂食', '小游戏', '状态', '设置', '说话'])
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
      { action: vi.fn(), setting: vi.fn(), view: vi.fn(), pick, identity: vi.fn() })
    panel.show({ x: 0, y: 0 })
    panel.setView('foods')
    return { panel, pick }
  }

  it('切到 foods 后副板是那块可见底板：格子数等于 FOODS 长度', () => {
    const { panel } = mountFoods()
    expect(panel.view).toBe('foods')
    // 底板样式现在直接挂在 .pet-plate 上（is-plate 那层修饰没了）：
    // 根节点是整屏定位层，它要是还吃命中，按钮之间那些看不见的缝就会吞掉桌面的点击。
    expect(panel.el.querySelector('.pet-plate.is-foods')).not.toBeNull()
    expect(panel.el.className).toBe('pet-panel')
    expect(panel.el.querySelectorAll('.pet-food').length).toBe(FOODS.length)
  })

  it('点一格把整个 food 报给 pick，并且不切视图', () => {
    const { panel, pick } = mountFoods()
    ;(panel.el.querySelector('.pet-food') as HTMLElement).click()
    expect(pick).toHaveBeenCalledTimes(1)
    expect(pick.mock.calls[0]![0].id).toBe('token')
    expect(panel.view).toBe('foods')
  })

  it('翻页键是 Kenney 箭头图，label 说清方向（图不带字时读屏只剩这一句）', () => {
    const { panel } = mountFoods()
    const one = (dir: string) => panel.el.querySelector(`.pet-page[data-page="${dir}"]`) as HTMLButtonElement
    expect(['prev', 'next'].map((d) => one(d).querySelector('img')?.getAttribute('src'))).toEqual([
      'icons/arrow_basic_w_small.svg', 'icons/arrow_basic_e_small.svg',
    ])
    expect(['prev', 'next'].map((d) => one(d).getAttribute('aria-label'))).toEqual(['上一页', '下一页'])
    expect(['prev', 'next'].map((d) => one(d).getAttribute('title'))).toEqual(['上一页', '下一页'])
    // 图挂了不能留空白按钮：按钮里不再塞文字，但 label 还在
    expect(['prev', 'next'].map((d) => one(d).textContent)).toEqual(['', ''])
  })

  it('点 ‹ › 改变滚动，内容条跟着平移，且不会滚出边界', () => {
    const { panel } = mountFoods()
    const strip = () => (panel.el.querySelector('.pet-food-strip') as HTMLElement).style.transform
    const next = panel.el.querySelector('.pet-page[data-page="next"]') as HTMLElement
    const prev = panel.el.querySelector('.pet-page[data-page="prev"]') as HTMLElement
    expect(strip()).toBe('translateX(0px)')
    // 6 格 48 + 5 缝 4 = 308，视口 204 → 最大滚动只有 104，比一整屏步进 208 还小，
    // 所以按一次就到头。数字要按 FOODS 实际长度算，不能照 12 格的老期望写。
    next.click(); expect(strip()).toBe('translateX(-104px)')
    next.click(); expect(strip()).toBe('translateX(-104px)')
    for (let i = 0; i < 4; i++) prev.click()
    expect(strip()).toBe('translateX(0px)')
  })

  it('到底时 next 置灰、到顶时 prev 置灰', () => {
    const { panel } = mountFoods()
    const next = panel.el.querySelector('.pet-page[data-page="next"]') as HTMLButtonElement
    const prev = panel.el.querySelector('.pet-page[data-page="prev"]') as HTMLButtonElement
    expect(prev.disabled).toBe(true)
    expect(next.disabled).toBe(false)
    next.click()
    expect(next.disabled).toBe(true)
    expect(prev.disabled).toBe(false)
  })

  it('横条滑块按 thumbGeometry 摆，拖它等于改滚动位置', () => {
    const { panel } = mountFoods()
    const thumb = panel.el.querySelector('.pet-thumb') as HTMLElement
    expect(thumb).not.toBeNull()
    expect(thumb.style.width).not.toBe('')
    thumb.dispatchEvent(pointer('pointerdown', 40))
    window.dispatchEvent(pointer('pointermove', 60))
    window.dispatchEvent(pointer('pointerup', 60))
    // 拖 20px 该停在**中间**，不是 0 也不是到底。6 格只有 120px 可滚，
    // 拖 100px 会直接撞到头，那条断言就退化成「不等于步进」，测不出比例换算。
    // 内容条往左走（负数），滑块往右走（正数），所以各取各的号，别用一个 negate 糊过去
    const num = (sel: string) => parseFloat((panel.el.querySelector(sel) as HTMLElement).style.transform.replace(/[^0-9.-]/g, ''))
    expect(num('.pet-food-strip')).toBeLessThan(0)
    expect(num('.pet-food-strip')).toBeGreaterThan(-120)
    expect(num('.pet-thumb')).toBeGreaterThan(0)
  })

  it('横条是视口同一列的下面一行，不是副板的兄弟节点', () => {
    // 副板是横排 flex：横条直接挂在副板上会并排站到右边去（截图量出来过）。
    // 用户要的是「矩形下面有横条」，所以它必须和视口同列。
    const { panel } = mountFoods()
    const main = panel.el.querySelector('.pet-food-main')
    expect(main?.parentElement?.className).toBe('pet-foods')
    expect(panel.el.querySelector('.pet-scroll')?.parentElement).toBe(main)
    expect(panel.el.querySelector('.pet-food-viewport')?.parentElement).toBe(main)
    // 列表整块挂在副板里，而不是直接挂在根节点：根节点是整屏定位层，两块各自摆位
    expect(panel.el.querySelector('.pet-foods')?.parentElement?.parentElement).toBe(panel.el)
  })

  it('收起再打开时滚动复位，不会停在用户上次看一半的地方', () => {
    const { panel } = mountFoods()
    ;(panel.el.querySelector('.pet-page[data-page="next"]') as HTMLElement).click()
    panel.hide()
    panel.show({ x: 0, y: 0 })
    panel.setView('foods')
    expect((panel.el.querySelector('.pet-food-strip') as HTMLElement).style.transform).toBe('translateX(0px)')
  })

  it('喂食与状态都切视图，不直接播动画；带反应池的只剩小游戏和说话', () => {
    const withPool = defaultActions().filter((a) => a.pool !== undefined)
    expect(withPool.map((a) => a.id)).toEqual(['game', 'talk'])
    expect(defaultActions().find((a) => a.id === 'feed')?.view).toBe('foods')
    expect(defaultActions().find((a) => a.id === 'status')?.view).toBe('stats')
  })

  it('点喂食走 view 回调，不走 action 回调', () => {
    const action = vi.fn()
    const view = vi.fn()
    const root = document.createElement('div')
    document.body.replaceChildren(root)
    const panel = createPanel(root, defaultActions(), { ...DEFAULT_SETTINGS }, { action, setting: vi.fn(), view, pick: vi.fn(), identity: vi.fn() })
    panel.show({ x: 0, y: 0 })
    ;(panel.el.querySelector('button[data-id="feed"]') as HTMLElement).click()
    expect(action).not.toHaveBeenCalled()
    expect(view).toHaveBeenCalledWith('foods')
  })
})

describe('状态视图', () => {
  const snap = (hunger = 82, exp = 0): StatsSnapshot => ({
    stats: { hunger, mood: 45, weight: 20, bond: 97 },
    identity: { name: '小鲸', gender: 'female' },
    exp,
  })
  const open = (s = snap()) => {
    const m = mount()
    m.panel.show({ x: 0, y: 0 })
    m.panel.setStats(s)
    m.panel.setView('stats')
    return m
  }

  it('等级行排在四条读数上面，四条按 STAT_KEYS 顺序：标签、数值、条宽各就各位', () => {
    const { panel } = open()
    const rows = [...panel.el.querySelectorAll<HTMLElement>('.pet-stat')]
    expect(rows.map((r) => r.dataset.key)).toEqual(['level', 'hunger', 'mood', 'weight', 'bond'])
    expect(rows.slice(1).map((r) => r.querySelector('.pet-stat-label')?.textContent)).toEqual(['饥饿', '心情', '体重', '亲密度'])
    expect(rows.slice(1).map((r) => r.querySelector('.pet-stat-value')?.textContent)).toEqual(['82', '45', '20', '97'])
    expect(rows[2]?.querySelector('.pet-stat-bar > i')?.getAttribute('style')).toContain('width: 45%')
  })

  it('等级是算出来的：Lv 看整级、条看本级攒了多少，满 10 进一级并把条归零', () => {
    const row = (exp: number) =>
      open(snap(82, exp)).panel.el.querySelector<HTMLElement>('.pet-stat[data-key="level"]')!
    expect(row(3.4).querySelector('.pet-stat-value')?.textContent).toBe('Lv.1')
    expect(row(3.4).querySelector('.pet-stat-bar > i')?.getAttribute('style')).toContain('width: 34%')
    // 经验是「怎么涨的」的唯一解释，悬停要读得出来
    expect(row(3.4).getAttribute('title')).toContain('累计经验 3.4')
    expect(row(10).querySelector('.pet-stat-value')?.textContent).toBe('Lv.2')
    expect(row(10).querySelector('.pet-stat-bar > i')?.getAttribute('style')).toContain('width: 0%')
  })

  it('颜色分档 >60 蓝、>20 黄、否则红：读数一眼能分好坏（等级不参与报警）', () => {
    const { panel } = open()
    const bands = [...panel.el.querySelectorAll<HTMLElement>('.pet-stat-bar')].map((b) => b.className.replace('pet-stat-bar is-', ''))
    expect(bands).toEqual(['level', 'high', 'mid', 'low', 'high'])
  })

  it('姓名一行、性别一行：性别是枚可点的粉色符号', () => {
    const { panel } = open()
    const lines = [...panel.el.querySelectorAll<HTMLElement>('.pet-stat-line')]
    expect(lines.map((l) => l.querySelector('.pet-stat-label')?.textContent)).toEqual(['姓名', '性别'])
    expect(lines[0]?.querySelector('.pet-stats-name')?.textContent).toBe('小鲸')
    const g = panel.el.querySelector<HTMLButtonElement>('.pet-gender')!
    expect(g.textContent).toBe('♀')
    expect(g.dataset.gender).toBe('female')
    expect(g.className).toContain('is-female')
    // 符号不带文字，读屏只能靠 label；label 还得说清点下去会发生什么
    expect(g.getAttribute('aria-label')).toContain('雌')
    expect(g.getAttribute('aria-label')).toContain('换成雄')
    expect(g.getAttribute('title')).toBe(g.getAttribute('aria-label'))
  })

  it('状态栏没有返回按钮：收起靠再点一次状态键', () => {
    const { panel } = open()
    expect(panel.el.querySelector('button[data-view="actions"]')).toBeNull()
  })

  it('点性别只上报另一档，不顺手播一条动画', () => {
    const { panel, identity, onClick } = open()
    panel.el.querySelector<HTMLButtonElement>('.pet-gender')?.click()
    expect(identity).toHaveBeenCalledWith({ gender: 'male' })
    expect(onClick).not.toHaveBeenCalled()
  })

  it('快照还没到时不画四条 0：那是编出来的「宠物饿坏了」', () => {
    const m = mount()
    m.panel.show({ x: 0, y: 0 })
    m.panel.setView('stats')
    expect(m.panel.el.querySelector('.pet-stats-name')?.textContent).toBe('…')
    expect(m.panel.el.querySelectorAll('.pet-stat')).toHaveLength(0)
    // 性别也一样：没快照就猜一个符号，等于编造存档里没有的东西
    expect(m.panel.el.querySelector('.pet-gender')).toBeNull()
    expect(m.panel.el.querySelectorAll('.pet-stat-line')).toHaveLength(1)
  })

  it('setStats 在状态视图里立刻重绘；在别的视图只存不画', () => {
    const m = open()
    m.panel.setStats(snap(10))
    expect(m.panel.el.querySelector('.pet-stat[data-key="hunger"] .pet-stat-value')?.textContent).toBe('10')
    const other = mount()
    other.panel.show({ x: 0, y: 0 })
    other.panel.setStats(snap())
    expect(other.panel.el.querySelectorAll('.pet-stat')).toHaveLength(0)
  })

  it('点状态按钮切到 stats 视图，不走 action 回调', () => {
    const action = vi.fn()
    const view = vi.fn()
    const root = document.createElement('div')
    document.body.replaceChildren(root)
    const panel = createPanel(root, defaultActions(), { ...DEFAULT_SETTINGS }, { action, setting: vi.fn(), view, pick: vi.fn(), identity: vi.fn() })
    panel.show({ x: 0, y: 0 })
    panel.el.querySelector<HTMLButtonElement>('button[data-id="status"]')?.click()
    expect(action).not.toHaveBeenCalled()
    expect(view).toHaveBeenCalledWith('stats')
  })
})

/**
 * 面板从「一个盒子换内容」改成「按钮条常驻 + 副板另算一块」。
 * 用户要的：点喂食/状态时按钮不许消失，列表挂在按钮下面、读数挂在宠物右侧。
 * 两块各自定位，所以命中区、光标、夹屏幕都得分别问，不能再拿根节点当矩形。
 */
describe('两块结构：按钮条常驻，副板另算一块', () => {
  const openView = (v: 'foods' | 'stats' | 'settings') => {
    const m = mount()
    m.panel.show({ x: 0, y: 0 })
    if (v === 'stats') m.panel.setStats({ stats: { hunger: 82, mood: 45, weight: 20, bond: 97 }, identity: { name: '小鲸', gender: 'female' }, exp: 0 })
    m.panel.setView(v)
    return m
  }
  const actionBtns = (panel: ReturnType<typeof mount>['panel']) =>
    [...panel.el.querySelectorAll('.pet-actions button[data-id]')]

  it('动作视图：只有按钮条，副板不在布局里', () => {
    const { panel } = mount()
    panel.show({ x: 0, y: 0 })
    expect(actionBtns(panel)).toHaveLength(PANEL_BUTTONS.length)
    expect(panel.el.querySelector('.pet-plate')).toBeNull()
    expect(panel.plateSize()).toBeNull()
  })

  it('食物视图：五颗按钮还在，列表在另一块里', () => {
    const { panel } = openView('foods')
    expect(actionBtns(panel)).toHaveLength(PANEL_BUTTONS.length)
    const plate = panel.el.querySelector('.pet-plate')!
    expect(plate.querySelector('.pet-food')).not.toBeNull()
    // 列表不能是按钮条的子节点：两块的锚点不同，嵌在一起就没法各摆各的
    expect(plate.closest('.pet-actions')).toBeNull()
  })

  it('状态视图：五颗按钮还在，读数在副板里', () => {
    const { panel } = openView('stats')
    expect(actionBtns(panel)).toHaveLength(PANEL_BUTTONS.length)
    const plate = panel.el.querySelector('.pet-plate')!
    expect(plate.querySelectorAll('.pet-stat')).toHaveLength(5)
  })

  it('设置视图保持原样：整块替换，按钮条不在布局里', () => {
    const { panel } = openView('settings')
    expect(actionBtns(panel)).toHaveLength(0)
    expect(panel.el.querySelector('.pet-plate .pet-setting')).not.toBeNull()
  })

  it('主块尺寸跟着视图走：设置视图量到的是设置板，不是按钮条', () => {
    const actions = mount()
    actions.panel.show({ x: 0, y: 0 })
    expect(actions.panel.primaryEl()?.classList.contains('pet-actions')).toBe(true)
    const settings = openView('settings')
    expect(settings.panel.primaryEl()?.classList.contains('pet-plate')).toBe(true)
  })

  it('再点一次喂食把副板收回：回动作视图，副板移出布局', () => {
    const { panel } = openView('foods')
    ;(panel.el.querySelector('.pet-actions button[data-id="feed"]') as HTMLElement).click()
    expect(panel.view).toBe('actions')
    expect(panel.el.querySelector('.pet-plate')).toBeNull()
    expect(panel.plateSize()).toBeNull()
  })

  it('showPlate 只挪副板：主块的位置不受影响', () => {
    const { panel } = openView('foods')
    panel.show({ x: 10, y: 20 })
    panel.showPlate({ x: 300, y: 400 })
    const plate = panel.el.querySelector('.pet-plate') as HTMLElement
    expect(plate.style.transform).toBe('translate(300px, 400px)')
    expect((panel.el.querySelector('.pet-actions') as HTMLElement).style.transform).toBe('translate(10px, 20px)')
  })

  it('副板仍然吃命中：它是 data-hit 根节点的后代，closest 爬得到', () => {
    const { panel } = openView('foods')
    const plate = panel.el.querySelector('.pet-plate') as HTMLElement
    expect(plate.closest('[data-hit]')).toBe(panel.el)
  })
})
