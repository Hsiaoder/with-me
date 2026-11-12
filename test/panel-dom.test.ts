// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { createPanel, defaultActions } from '../src/renderer/panel.js'
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/visibility.js'
import { PANEL_BUTTONS, FOOD_CELL, FOOD_GAP, FOOD_VISIBLE } from '../src/shared/config.js'
import { pageStep } from '../src/shared/scroll.js'
import { FOODS, FOOD_TIERS, isUnlocked, unlockBadge, unlockHint } from '../src/shared/food.js'
import { EXP_GAIN, FOOD_EFFECT, LEVEL_CUM, LEVEL_STEPS, MAX_LEVEL, STAT_KEYS, STAT_LABELS } from '../src/shared/stats.js'
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
  const panel = createPanel(root, defaultActions(), { ...DEFAULT_SETTINGS }, { action: onClick, view: vi.fn(), pick: vi.fn(), game: vi.fn(), identity })
  return { panel, root, onClick, identity }
}

afterEach(() => { document.body.replaceChildren() })

describe('defaultActions', () => {
  it('四个按钮：喂食/小游戏/状态/调试，顺序即 PANEL_BUTTONS', () => {
    expect(defaultActions().map((a) => a.id)).toEqual(['feed', 'game', 'status', 'debug'])
    expect(defaultActions().map((a) => a.label)).toEqual(['喂食', '小游戏', '状态', '调试'])
  })

  it('每个按钮都带一张能进 dist 的图：icons/ 下的 SVG 或 emotes/ 下的 PNG', () => {
    // 两条白名单（protocol 的 MIME 表 + copy-static 的 STATIC_EXT）都只放 svg/png，
    // 路径写错就是 404、按钮变空片，所以这里按目录+后缀钉住。
    for (const a of defaultActions()) {
      expect(a.icon, `${a.id} 没有图标`).toMatch(/^(icons\/[a-z-]+\.svg|emotes\/[a-z0-9]+\.png)$/)
    }
  })

  it('默认五颗都切视图，没有带反应池的按钮（旧「说话」那颗已换成调试视图）', () => {
    // 反应池按钮的路径仍由 panel 支持（见下方「点按钮回调」用合成动作测），只是默认清单里不再有点歌的。
    const withPool = defaultActions().filter((a) => a.pool !== undefined)
    expect(withPool).toHaveLength(0)
    for (const a of defaultActions()) expect(a.view).toBeDefined()
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

  it('点带反应池的按钮回调带上被点的动作（默认清单已无此颗，用合成动作验路径）', () => {
    const onClick = vi.fn()
    const root = document.createElement('div')
    document.body.replaceChildren(root)
    const panel = createPanel(
      root,
      [{ id: 'poke', label: '戳', icon: 'icons/heart.svg', pool: 'click' }],
      { ...DEFAULT_SETTINGS },
      { action: onClick, view: vi.fn(), pick: vi.fn(), game: vi.fn(), identity: vi.fn() },
    )
    panel.show({ x: 0, y: 0 })
    panel.el.querySelector<HTMLButtonElement>('button[data-id="poke"]')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick.mock.calls[0]![0]).toMatchObject({ id: 'poke', pool: 'click' })
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

describe('动作视图', () => {
  const mountPanel = (settings: Settings = { ...DEFAULT_SETTINGS }) => {
    const root = document.createElement('div')
    document.body.replaceChildren(root)
    const action = vi.fn()
    const view = vi.fn()
    const panel = createPanel(root, defaultActions(), settings, { action, view, pick: vi.fn(), game: vi.fn(), identity: vi.fn() })
    panel.show({ x: 0, y: 0 })
    return { panel, root, action, view }
  }

  it('动作视图是四枚图标：图在按钮里，文字退成 title 与 aria-label', () => {
    const { panel } = mountPanel()
    const buttons = [...panel.el.querySelectorAll('button')]
    expect(buttons.map((b) => b.querySelector('img')?.getAttribute('src'))).toEqual([
      'icons/rice.svg', 'icons/game.svg', 'icons/heart.svg', 'icons/debug.svg',
    ])
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['喂食', '小游戏', '状态', '调试'])
    expect(buttons.map((b) => b.getAttribute('title'))).toEqual(['喂食', '小游戏', '状态', '调试'])
    expect(panel.view).toBe('actions')
  })

  it('开发者模式关着时调试按钮藏掉；开了立刻露面（默认不显示调试按钮）', () => {
    const { panel } = mountPanel()
    const debug = () => panel.el.querySelector<HTMLButtonElement>('button[data-id="debug"]')!
    expect(debug().hidden).toBe(true)
    panel.setSettings({ ...DEFAULT_SETTINGS, developerMode: true })
    expect(debug().hidden).toBe(false)
    panel.setSettings({ ...DEFAULT_SETTINGS, developerMode: false })
    expect(debug().hidden).toBe(true)
  })

  // jsdom 不做 CSS 层叠，量不到「hidden 属性到底有没有真的把按钮移出布局」。
  // 上一轮就栽在 `.pet-panel button{display:inline-flex}` 权重盖过 UA 的 [hidden]，
  // 属性设对了却还看得见。这条钉住作者必须显式补一条按钮级的 [hidden] 规则。
  it('style.css 给动作按钮显式写了 [hidden]{display:none}，别让 display 盖掉隐藏', () => {
    const css = readFileSync('src/renderer/style.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toMatch(/\.pet-panel button\[hidden\]\s*\{[^}]*display:\s*none/)
  })

  it('收起面板就回到动作视图，并通知调用方换回延时', () => {
    const { panel, view } = mountPanel()
    panel.setView('foods')
    view.mockClear()
    panel.hide()
    expect(panel.view).toBe('actions')
    expect(view).toHaveBeenCalledWith('actions')
  })

  it('切视图不重新挂载面板：根节点还在原位，data-hit 不丢', () => {
    const { panel, root } = mountPanel()
    const el = panel.el
    panel.setView('foods')
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
  /**
   * exp 决定哪几格锁着（2026-11-07 两档：开局4 + 等级 Lv.5 起每两级一格）。
   * 默认 Lv.1——**没推快照时面板也按 Lv.1 处理**，两种情况行为一致。
   */
  const mountFoods = (exp = 0) => {
    const pick = vi.fn()
    const root = document.createElement('div')
    document.body.replaceChildren(root)
    const panel = createPanel(root, defaultActions(), { ...DEFAULT_SETTINGS },
      { action: vi.fn(), view: vi.fn(), pick, game: vi.fn(), identity: vi.fn() })
    panel.show({ x: 0, y: 0 })
    panel.setStats({
      stats: { hunger: 50, mood: 50, weight: 50, bond: 50 },
      identity: { name: '小鲸', gender: 'female' },
      exp,
      startedAt: 1_000,
    })
    panel.setView('foods')
    return { panel, pick }
  }
  /** 全解锁：经验正好攒到最高等级档的门槛（从 FOOD_TIERS 推，不抄数字——加/改一格它自己跟着走）。 */
  const mountAll = () => mountFoods(LEVEL_CUM[Math.max(...FOOD_TIERS) - 1]!)

  it('切到 foods 后副板是那块可见底板：格子数等于 FOODS 长度', () => {
    const { panel } = mountFoods()
    expect(panel.view).toBe('foods')
    // 底板样式现在直接挂在 .pet-plate 上（is-plate 那层修饰没了）：
    // 根节点是整屏定位层，它要是还吃命中，按钮之间那些看不见的缝就会吞掉桌面的点击。
    expect(panel.el.querySelector('.pet-plate.is-foods')).not.toBeNull()
    expect(panel.el.className).toBe('pet-panel')
    expect(panel.el.querySelectorAll('.pet-food').length).toBe(FOODS.length)
  })

  it('格子里是图，名字退到 title 与读屏 label；锁着的格子把门槛一起说清', () => {
    const { panel } = mountAll()
    const cells = [...panel.el.querySelectorAll<HTMLButtonElement>('.pet-food')]
    expect(cells.length).toBe(FOODS.length)
    cells.forEach((cell, i) => {
      const f = FOODS[i]!
      expect(cell.getAttribute('aria-label'), `${f.id} 的读屏名丢了`).toBe(f.name)
      expect(cell.title, '已解锁格不再挂原生 title（收益改由悬浮卡显示）').toBe('')
      expect(cell.textContent, '格子里不该再有文字（图和字并排会挤）').toBe('')
      const img = cell.querySelector('img')
      expect(img, `${f.id} 格子里没有图`).not.toBeNull()
      expect(img!.getAttribute('src')).toBe(f.icon)
    })
    // Lv.1 时那些还没解锁的格子：title 要说「为什么点不动」，角标要把门槛写在格子上。
    // 条数与第一把锁都从 isUnlocked 推——抄死数字的话，改解锁节奏时这条会红在**期望值**上，而不是红在行为上。
    const low = mountFoods().panel
    const lockedCells = [...low.el.querySelectorAll<HTMLButtonElement>('.pet-food')]
    const locked = lockedCells.filter((c) => c.classList.contains('is-locked'))
    const expectLocked = FOODS.filter((f) => !isUnlocked(f, { level: 1 }))
    expect(locked).toHaveLength(expectLocked.length)
    const first = expectLocked[0]!
    expect(locked[0]!.title).toBe(unlockHint(first))
    expect(locked[0]!.getAttribute('aria-label')).toBe(unlockHint(first))
    expect(locked[0]!.textContent).toBe(unlockBadge(first))
    expect(locked[0]!.disabled).toBe(true)
    // 最后一格（火锅 Lv.27）锁得最死：角标写 Lv.27、title 说「Lv.27 解锁」
    const hotpotFood = FOODS.find((f) => f.id === 'hotpot')!
    const hotpotCell = lockedCells[FOODS.indexOf(hotpotFood)]!
    expect(hotpotCell.textContent).toBe('Lv.27')
    expect(hotpotCell.title).toBe('火锅（Lv.27 解锁）')
  })

  it('悬浮卡：鼠标停在格子上弹出名字与收益，数字从表里推', () => {
    const { panel } = mountAll()
    const cells = [...panel.el.querySelectorAll<HTMLElement>('.pet-food')]
    const rice = cells[FOODS.findIndex((f) => f.id === 'rice')]!
    rice.dispatchEvent(new MouseEvent('mouseenter'))
    const tip = panel.el.querySelector<HTMLElement>('.pet-food-tip')
    expect(tip, 'hover 没弹出悬浮卡').not.toBeNull()
    expect(tip!.hidden).toBe(false)
    const texts = [...tip!.querySelectorAll('span')].map((s) => s.textContent)
    expect(texts[0], '第一行该是食物名字').toBe('白饭')
    expect(texts).toContain(`饥饿 +${FOOD_EFFECT.rice!.hunger}`)
    expect(texts).toContain(`心情 +${FOOD_EFFECT.rice!.mood}`)
    expect(texts).toContain(`经验 +${EXP_GAIN.feed}`)
    expect(texts.join(' '), '卡片不该再写体重热量').not.toContain('体重')
    rice.dispatchEvent(new MouseEvent('mouseleave'))
    expect(panel.el.querySelector<HTMLElement>('.pet-food-tip')!.hidden, '移开鼠标卡片该收掉').toBe(true)
  })

  it('已解锁格不挂原生 title（悬浮卡顶替），未解锁格仍说清为什么点不动', () => {
    const { panel } = mountFoods()   // Lv.1
    const cells = [...panel.el.querySelectorAll<HTMLButtonElement>('.pet-food')]
    const token = cells[FOODS.findIndex((f) => f.id === 'token')]!
    expect(token.title, '已解锁格不该再有原生 title（会和悬浮卡重复）').toBe('')
    expect(token.getAttribute('aria-label')).toBe('代币')
    const hotpot = cells[FOODS.findIndex((f) => f.id === 'hotpot')]!
    expect(hotpot.title).toBe('火锅（Lv.27 解锁）')
  })

  it('点一格把整个 food 报给 pick，并且不切视图', () => {
    const { panel, pick } = mountFoods()
    ;(panel.el.querySelector('.pet-food') as HTMLElement).click()
    expect(pick).toHaveBeenCalledTimes(1)
    expect(pick.mock.calls[0]![0].id).toBe('token')
    expect(panel.view).toBe('foods')
  })

  /**
   * 按等级解锁（等级档那十二格）。面板这半边钉三件事：灰态与角标跟着等级翻、**不重建列表**、
   * 以及升级那一刻当场生效。「灰格子真不吃点击」是浏览器行为，由 e2e 在真 Chromium 里验。
   */
  it('Lv.1 只放开开局四格；攒到 Lv.5 当场多出晚餐', () => {
    const { panel } = mountFoods()
    const cells = () => [...panel.el.querySelectorAll<HTMLButtonElement>('.pet-food')]
    expect(cells().filter((c) => !c.disabled).map((c) => c.dataset.food))
      .toEqual(FOODS.filter((f) => isUnlocked(f, { level: 1 })).map((f) => f.id))
    const first = cells()[0]
    // 升级：主进程推一份 exp 更高的快照过来，面板只翻属性，不重建（滚动位置是用户的）
    panel.setStats({
      stats: { hunger: 50, mood: 50, weight: 50, bond: 50 },
      identity: { name: '小鲸', gender: 'female' },
      exp: LEVEL_CUM[4]!,   // Lv.5 的门槛：第一格等级解锁（晚餐）在这里开
      startedAt: 1_000,
    })
    const open = cells().filter((c) => !c.disabled).map((c) => c.dataset.food)
    expect(open).toEqual(FOODS.filter((f) => isUnlocked(f, { level: 5 })).map((f) => f.id))
    expect(open, 'Lv.5 该比 Lv.1 多一格').toHaveLength(5)
    expect(panel.el.querySelector('.pet-food')).toBe(first)
  })

  it('没推快照时按 Lv.1 处理：前四格能点，其余灰着——不是整列都能点', () => {
    // 这一条管的是「数据还没到」的默认方向。猜成「全开」会让用户点到一格喂出个不该有的东西，
    // 猜成「全关」会让刚开列表的人以为功能坏了；取 Lv.1 是因为它等于「按最保守的已知档位摆」。
    const pick = vi.fn()
    const root = document.createElement('div')
    document.body.replaceChildren(root)
    const panel = createPanel(root, defaultActions(), { ...DEFAULT_SETTINGS },
      { action: vi.fn(), view: vi.fn(), pick, game: vi.fn(), identity: vi.fn() })
    panel.show({ x: 0, y: 0 })
    panel.setView('foods')
    const cells = [...panel.el.querySelectorAll<HTMLButtonElement>('.pet-food')]
    expect(cells.filter((c) => !c.disabled)).toHaveLength(FOODS.filter((f) => isUnlocked(f, { level: 1 })).length)
  })

  /**
   * 吃饭期间整列点不动（用户拍的板）。这里只钉面板这一半：状态推过来时格子必须翻对、
   * 而且**不许重建列表**。「灰格子真的不吃点击」是浏览器行为，由 e2e 在真 Chromium 里验。
   */
  it('setEating(true) 把整列格子翻成 disabled，false 再翻回来', () => {
    const { panel } = mountAll()      // 全解锁，这样灰态只可能来自「正在吃饭」这一件事
    const cells = () => [...panel.el.querySelectorAll<HTMLButtonElement>('.pet-food')]
    expect(cells().every((c) => !c.disabled), '没吃饭时格子就该能点').toBe(true)
    panel.setEating(true)
    expect(cells().every((c) => c.disabled)).toBe(true)
    panel.setEating(false)
    expect(cells().every((c) => !c.disabled)).toBe(true)
  })

  it('吃饭与没解锁两件事取「或」：饭后只回到「按等级该灰的还灰着」', () => {
    const { panel } = mountFoods()    // Lv.1：除前四格外都锁着
    panel.setEating(true)
    const cells = [...panel.el.querySelectorAll<HTMLButtonElement>('.pet-food')]
    expect(cells.every((c) => c.disabled)).toBe(true)
    panel.setEating(false)
    // 灰态**不该整列解开**：按解锁规则该锁的那些还得锁着（清单从 isUnlocked 推，不抄 id——
    // 抄 id 的那版在解锁节奏改过之后，红在了期望值上而不是行为上）
    expect(cells.filter((c) => !c.disabled).map((c) => c.dataset.food))
      .toEqual(FOODS.filter((f) => isUnlocked(f, { level: 1 })).map((f) => f.id))
  })

  it('翻灰态不重建节点：滚动位置与用户手里的旧节点都得留着', () => {
    const { panel } = mountFoods()
    const before = panel.el.querySelector('.pet-food')
    const stripBefore = panel.el.querySelector('.pet-food-strip')
    panel.setEating(true)
    expect(panel.el.querySelector('.pet-food')).toBe(before)
    expect(panel.el.querySelector('.pet-food-strip')).toBe(stripBefore)
  })

  it('吃饭中途才把列表叫出来：格子直接以灰态建出来，不许先亮一下再暗', () => {
    const pick = vi.fn()
    const root = document.createElement('div')
    document.body.replaceChildren(root)
    const panel = createPanel(root, defaultActions(), { ...DEFAULT_SETTINGS },
      { action: vi.fn(), view: vi.fn(), pick, game: vi.fn(), identity: vi.fn() })
    panel.show({ x: 0, y: 0 })
    panel.setEating(true)
    panel.setView('foods')
    expect([...panel.el.querySelectorAll<HTMLButtonElement>('.pet-food')].every((c) => c.disabled)).toBe(true)
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

  /**
   * 滚动那几个数一律从 FOODS 与 config 推，不写字面量。
   * 上一版这里写着「6 格 308、最大 104、按一次就到头」，列表一扩到 12 格
   * 这两条就同时红了——而且红得毫无信息量（谁对谁错看不出来）。
   */
  const SCROLL = (() => {
    const view = FOOD_VISIBLE * FOOD_CELL + (FOOD_VISIBLE - 1) * FOOD_GAP
    const content = FOODS.length * FOOD_CELL + (FOODS.length - 1) * FOOD_GAP
    return { view, content, max: content - view, step: pageStep(FOOD_VISIBLE, FOOD_CELL, FOOD_GAP) }
  })()
  const clicksToEnd = Math.ceil(SCROLL.max / SCROLL.step)

  it('点 ‹ › 改变滚动，内容条跟着平移，且不会滚出边界', () => {
    const { panel } = mountFoods()
    const strip = () => (panel.el.querySelector('.pet-food-strip') as HTMLElement).style.transform
    const next = panel.el.querySelector('.pet-page[data-page="next"]') as HTMLElement
    const prev = panel.el.querySelector('.pet-page[data-page="prev"]') as HTMLElement
    expect(strip()).toBe('translateX(0px)')
    for (let i = 0; i < clicksToEnd; i++) next.click()
    expect(strip()).toBe(`translateX(${-SCROLL.max}px)`)
    next.click()
    expect(strip(), '到底了还能往下滚').toBe(`translateX(${-SCROLL.max}px)`)
    for (let i = 0; i < clicksToEnd + 1; i++) prev.click()
    expect(strip()).toBe('translateX(0px)')
  })

  it('到底时 next 置灰、到顶时 prev 置灰', () => {
    const { panel } = mountFoods()
    const next = panel.el.querySelector('.pet-page[data-page="next"]') as HTMLButtonElement
    const prev = panel.el.querySelector('.pet-page[data-page="prev"]') as HTMLButtonElement
    expect(prev.disabled).toBe(true)
    expect(next.disabled).toBe(false)
    for (let i = 0; i < clicksToEnd; i++) next.click()
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
    // 拖 20px 该停在**中间**，不是 0 也不是到底。
    // 内容比视口宽得多，轨道就短，所以位移要按「内容 : 轨道」的比例放大回去——
    // 1:1 的话拖到头只滚了一小截。这里要的是「比 20 大、但远没到底」，
    // 到底的话断言会退化成「等于 -max」，测不出比例换算。
    const num = (sel: string) => parseFloat((panel.el.querySelector(sel) as HTMLElement).style.transform.replace(/[^0-9.-]/g, ''))
    const moved = -num('.pet-food-strip')
    expect(moved, '拖了没滚').toBeGreaterThan(20)
    expect(moved, '拖 20px 就撞到头了').toBeLessThan(SCROLL.max)
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

  it('喂食/小游戏/状态/调试都切视图，不直接播动画；默认已无带反应池的按钮', () => {
    const withPool = defaultActions().filter((a) => a.pool !== undefined)
    expect(withPool.map((a) => a.id)).toEqual([])
    expect(defaultActions().find((a) => a.id === 'feed')?.view).toBe('foods')
    expect(defaultActions().find((a) => a.id === 'game')?.view).toBe('games')
    expect(defaultActions().find((a) => a.id === 'status')?.view).toBe('stats')
    expect(defaultActions().find((a) => a.id === 'debug')?.view).toBe('debug')
  })

  it('点喂食走 view 回调，不走 action 回调', () => {
    const action = vi.fn()
    const view = vi.fn()
    const root = document.createElement('div')
    document.body.replaceChildren(root)
    const panel = createPanel(root, defaultActions(), { ...DEFAULT_SETTINGS }, { action, view, pick: vi.fn(), game: vi.fn(), identity: vi.fn() })
    panel.show({ x: 0, y: 0 })
    ;(panel.el.querySelector('button[data-id="feed"]') as HTMLElement).click()
    expect(action).not.toHaveBeenCalled()
    expect(view).toHaveBeenCalledWith('foods')
  })

  it('点小游戏走 view 回调切到 games；列表里那一行「开始」回调 game', () => {
    const action = vi.fn()
    const view = vi.fn()
    const game = vi.fn()
    const root = document.createElement('div')
    document.body.replaceChildren(root)
    const panel = createPanel(root, defaultActions(), { ...DEFAULT_SETTINGS }, { action, view, pick: vi.fn(), game, identity: vi.fn() })
    panel.show({ x: 0, y: 0 })
    ;(panel.el.querySelector('button[data-id="game"]') as HTMLElement).click()
    expect(action).not.toHaveBeenCalled()
    expect(view).toHaveBeenCalledWith('games')
    // 切到 games 视图后，副板里应当出现「鲸鲸会飞」那一行和它的开始键。
    panel.setView('games')
    const start = panel.el.querySelector('button[data-id="start-fly"]') as HTMLButtonElement
    expect(start, '游戏列表里没有鲸鲸会飞的开始键').not.toBeNull()
    start.click()
    expect(game).toHaveBeenCalledTimes(1)
    expect(game.mock.calls[0]![0]).toMatchObject({ id: 'fly' })
  })
})

describe('状态视图', () => {
  const snap = (hunger = 82, exp = 0): StatsSnapshot => ({
    stats: { hunger, mood: 45, weight: 20, bond: 97 },
    identity: { name: '小鲸', gender: 'female' },
    exp,
    startedAt: 1_000,
  })
  const open = (s = snap()) => {
    const m = mount()
    m.panel.show({ x: 0, y: 0 })
    m.panel.setStats(s)
    m.panel.setView('stats')
    return m
  }

  it('四条读数按 STAT_KEYS 顺序：标签、数值、条宽各就各位；等级是单独一行', () => {
    const { panel } = open()
    const rows = [...panel.el.querySelectorAll<HTMLElement>('.pet-stat')]
    expect(rows.map((r) => r.dataset.key)).toEqual(['hunger', 'mood', 'weight', 'bond'])
    expect(rows.map((r) => r.querySelector('.pet-stat-label')?.textContent)).toEqual(['饥饿：', '心情：', '体重：', '亲密：'])
    expect(rows.map((r) => r.querySelector('.pet-stat-value')?.textContent)).toEqual(['82', '45', '20', '97'])
    expect(rows[1]?.querySelector('.pet-stat-bar > i')?.getAttribute('style')).toContain('width: 45%')
    // 等级不挂 .pet-stat：那个类专指「一条数值读数」，报警配色与上面这些数条数的地方都靠它
    const level = panel.el.querySelector<HTMLElement>('.pet-stat-line[data-key="level"]')
    expect(level, '等级行没画成一行读数').not.toBeNull()
    expect(level!.querySelector('.pet-stat-label')?.textContent).toBe('等级：')
    const kids = [...panel.el.querySelectorAll('.pet-plate.is-stats > *')]
    expect(kids.indexOf(level!)).toBeLessThan(kids.findIndex((n) => n.classList.contains('pet-stat')))
  })

  it('等级是算出来的：查表取整级，进度条挂在卡片最下面那一行', () => {
    const row = (exp: number) =>
      open(snap(82, exp)).panel.el.querySelector<HTMLElement>('.pet-stat-line[data-key="level"]')!
    expect(row(3.4).querySelector('.pet-stat-value')?.textContent).toBe('Lv.1')
    expect(row(3.4).querySelector('.pet-stat-bar'), '等级行自己不该带条（2026-11-05 的拍板）').toBeNull()
    // 经验是「怎么涨的」的唯一解释，悬停要读得出来
    expect(row(3.4).getAttribute('title')).toContain('累计经验 3.4')
    // 门槛从表里取，不抄数：Lv.2 是 LEVEL_CUM[1]，Lv.11 是 LEVEL_CUM[10]
    expect(row(LEVEL_CUM[1]! - 0.1).querySelector('.pet-stat-value')?.textContent).toBe('Lv.1')
    expect(row(LEVEL_CUM[1]!).querySelector('.pet-stat-value')?.textContent).toBe('Lv.2')
    expect(row(LEVEL_CUM[10]!).querySelector('.pet-stat-value')?.textContent).toBe('Lv.11')
    // 满级封顶：经验再涨等级也不动
    expect(row(LEVEL_CUM.at(-1)! + 500).querySelector('.pet-stat-value')?.textContent).toBe(`Lv.${MAX_LEVEL}`)
  })

  it('经验条紧跟等级那一行：标签「经验」，写的是本级已攒/所需（2026-11-07 带总额）', () => {
    /**
     * 用户 2026-11-07 多次调整这条：先要「显示还差多少」，后改标签与位置，
     * 最后要求读数带总额 → 现在写「本级已攒 / 本级所需」，和那条 bar 同一口径；
     * 悬停 title 已按用户要求撤掉（嫌罗嗦）。另一件要钉住的：它**不挂 .pet-stat**（那个类专指四条会报警的读数）。
     */
    const panel1 = open(snap(82, 0)).panel
    const kids = [...panel1.el.querySelectorAll('.pet-plate.is-stats > *')]
    const exp = panel1.el.querySelector<HTMLElement>('.pet-exp')!
    const level = panel1.el.querySelector<HTMLElement>('.pet-stat-line[data-key="level"]')!
    expect(kids.indexOf(exp), '经验条没紧跟在等级下面').toBe(kids.indexOf(level) + 1)
    expect(exp.classList.contains('pet-stat'), '经验条不该冒充一条数值读数').toBe(false)
    expect(exp.querySelector('.pet-stat-label')?.textContent).toBe('经验：')
    expect(exp.querySelector('.pet-exp-value')?.textContent).toBe('0')
    expect(exp.querySelector('.pet-exp-total')?.textContent).toBe(`/${LEVEL_STEPS[0]}`)
    expect(exp.querySelector('.pet-exp-bar > i')?.getAttribute('style')).toContain('width: 0%')
    // 攒到本级一半：条跟着走一半，写的已攒数也是门槛的一半
    const half = LEVEL_CUM[1]! + LEVEL_STEPS[1]! / 2
    const panel2 = open(snap(82, half)).panel
    const bar2 = panel2.el.querySelector<HTMLElement>('.pet-exp-bar > i')!
    expect(bar2.getAttribute('style')).toContain('width: 50%')
    expect(panel2.el.querySelector('.pet-exp-value')?.textContent).toBe(String(Math.floor(LEVEL_STEPS[1]! / 2)))
    expect(panel2.el.querySelector('.pet-exp-total')?.textContent).toBe(`/${LEVEL_STEPS[1]}`)
    // 满级：不写「还差 0」那种假读数，也不挂总额后缀
    const panel3 = open(snap(82, LEVEL_CUM.at(-1)!)).panel
    expect(panel3.el.querySelector('.pet-exp-value')?.textContent).toBe('满级')
    expect(panel3.el.querySelector('.pet-exp-total')?.textContent).toBe('')
    expect(panel3.el.querySelector('.pet-exp-bar > i')?.getAttribute('style')).toContain('width: 100%')
  })

  it('四条读数带 /100 总额后缀，数值本体仍是纯数字（右对齐与 e2e 解析靠它）', () => {
    const { panel } = open()
    for (const row of panel.el.querySelectorAll<HTMLElement>('.pet-stat')) {
      expect(row.querySelector('.pet-stat-total')?.textContent, `${row.dataset.key} 缺 /100 后缀`).toBe('/100')
      expect(row.querySelector('.pet-stat-value')?.textContent).toMatch(/^\d+$/)
    }
  })

  it('颜色分档 >60 蓝、>20 黄、否则红：读数一眼能分好坏（等级不参与报警）', () => {
    const { panel } = open()
    const bands = [...panel.el.querySelectorAll<HTMLElement>('.pet-stat-bar')].map((b) => b.className.replace('pet-stat-bar is-', ''))
    expect(bands).toEqual(['high', 'mid', 'low', 'high'])
  })

  it('昵称一行、性别一行：性别是枚可点的粉色符号', () => {
    const { panel } = open()
    const lines = [...panel.el.querySelectorAll<HTMLElement>('.pet-stat-line')]
    // 前几行是「身份」，最后两行是「此刻」，中间夹着等级——顺序也是这个次序
    expect(lines.map((l) => l.querySelector('.pet-stat-label')?.textContent))
      .toEqual(['昵称：', '性别：', '等级：', '状态：', '在线时间：'])
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

  it('冒号只在带标签的那几行上：标题行走的是另一套，飘字芯片也不跟着变脏', () => {
    /**
     * 用户 2026-11-06 要「每个状态的名字后面加个中文冒号」。冒号是在 `makeLabel` 里统一加的，
     * 所以这里验的是**每一行带标签的都加上**（漏一行就是那行读起来像标题而不是像一行读数），
     * 以及 `STAT_LABELS` 那份清单**没被改**——飘字芯片共用它，「饥饿：+12」不是人话。
     * 条数不写死：数的是**有 `.pet-stat-label` 的那些行**（标题行没有标签，它走 .pet-plate-title）。
     */
    const { panel } = open()
    const labels = [...panel.el.querySelectorAll<HTMLElement>('.pet-stat-label')].map((n) => n.textContent ?? '')
    const tagged = [...panel.el.querySelectorAll('.pet-plate.is-stats > *')].filter((n) => n.querySelector('.pet-stat-label'))
    expect(labels).toHaveLength(tagged.length)
    expect(tagged.length, '该有十个带标签的行（身份 3 + 读数 4 + 此刻 2 + 经验 1）').toBe(10)
    for (const t of labels) expect(t.endsWith('：'), `「${t}」没带中文冒号`).toBe(true)
    for (const key of STAT_KEYS) expect(STAT_LABELS[key].endsWith('：'), `STAT_LABELS 被冒号污染了`).toBe(false)
  })

  it('标签都是两个字：同一栏里长短不齐，值那一列就跟着歪', () => {
    // 用户 2026-11-07：「经验值改为经验，亲密度改为亲密，都要两个字的」。
    // 「在线时间」是例外（它是时长不是属性，缩成两个字就读不出来了），所以这里只查读数与经验。
    for (const key of STAT_KEYS) expect(STAT_LABELS[key], `${key} 的标签不是两个字`).toHaveLength(2)
    const { panel } = open()
    const labels = [...panel.el.querySelectorAll<HTMLElement>('.pet-stat-label')].map((n) => n.textContent ?? '')
    for (const t of labels.filter((t) => !t.startsWith('在线'))) {
      expect(t, `「${t}」不是「两个字 + 冒号」`).toHaveLength(3)
    }
  })

  it('档案卡片有标题行：只有「宠物档案」，右上角不再有 ×（用户 2026-11-09 去掉）', () => {
    /**
     * 用户 2026-11-07 要过横线 + 标题「宠物档案」+ 右边的 ×；2026-11-09 又把 × 去掉。
     * 收起面板靠「再点一次状态键」/「离开满延时自动收」，不再有面板上的关闭按钮。
     */
    const { panel } = open()
    const head = panel.el.querySelector<HTMLElement>('.pet-plate-head')!
    expect(head, '标题行没画出来').not.toBeNull()
    expect(head.querySelector('.pet-plate-title')?.textContent).toBe('宠物档案')
    // 它是卡片的第一行：横线在它下沿，读起来才是「标题 —— 内容」而不是又一行读数
    const kids = [...panel.el.querySelectorAll('.pet-plate.is-stats > *')]
    expect(kids[0], '标题行不是第一行').toBe(head)
    // 右上角那颗 × 已去掉：标题行里不该再有关闭按钮
    expect(head.querySelector('.pet-plate-close'), '× 没去掉').toBeNull()
  })

  it('昵称 / 性别 / 等级三行的值紧跟冒号；读数与「此刻」那几行仍右对齐', () => {
    /**
     * 用户 2026-11-06 点名这三行。分开是因为两种行的读法不同：
     * 那三行读起来是一句话（「昵称：小鲸」），值贴到右沿就把句子拆成两头；
     * 四条数值要**横向比大小**，右沿才比得出来。
     * 所以这条钉的是「只有这三行紧」——哪天有人统一对齐，这里会红。
     */
    const { panel } = open()
    const lines = [...panel.el.querySelectorAll<HTMLElement>('.pet-stat-line')]
    const tight = lines.filter((l) => l.classList.contains('is-tight'))
    expect(tight.map((l) => l.querySelector('.pet-stat-label')?.textContent))
      .toEqual(['昵称：', '性别：', '等级：'])
    expect(lines.filter((l) => !l.classList.contains('is-tight')).map((l) => l.querySelector('.pet-stat-label')?.textContent))
      .toEqual(['状态：', '在线时间：'])
  })

  /**
   * 「状态」「在线时间」两行。
   * 用户 2026-11-06 参考的是 qqpet 的宠物档案；那张卡第三行是「成长进度」，
   * 我们没有自动成长那条系统，照抄就是假数据，所以这两行读的是**真的现在**：
   * 当前动画池的人话 + 本次进程陪了多久。数值快照一分钟才推一把，喂不了这两行。
   */
  it('「此刻」两行走 setRuntime：没推过给省略号，不编一个 0 秒', () => {
    const { panel } = open()
    const activity = panel.el.querySelector('.pet-stats-activity')!
    const online = panel.el.querySelector('.pet-stats-online')!
    expect(activity.textContent).toBe('…')
    expect(online.textContent).toBe('…')
    panel.setRuntime({ activity: '正在吃饭', online: '2分5秒' })
    expect(activity.textContent).toBe('正在吃饭')
    expect(online.textContent).toBe('2分5秒')
  })

  it('setRuntime 只改这两处的文字，不重绘整块副板', () => {
    /**
     * 这条钉的是「一秒一跳」的实现方式。重建副板会把出场的 `display:none → 出现`
     * 那一次状态变化每秒重放一遍（按钮条跨视图复用那条踩过同一个坑），
     * 状态栏会一直闪。所以这里要的不是「文字对了」，而是**同一批节点还在树里**。
     */
    const { panel } = open()
    const plate = panel.el.querySelector('.pet-plate.is-stats')!
    const activity = plate.querySelector('.pet-stats-activity')!
    panel.setRuntime({ activity: '正在散步', online: '3分0秒' })
    expect(activity.textContent).toBe('正在散步')
    expect(activity.isConnected, '值节点被换掉了，说明整块重绘了').toBe(true)
    expect(panel.el.querySelector('.pet-plate.is-stats')).toBe(plate)
  })

  it('重绘副板时带上最后一次推的「此刻」：不是回到省略号', () => {
    const m = open()
    m.panel.setRuntime({ activity: '正在休息', online: '1分20秒' })
    // 数值快照每 tick 推一次，会重绘整块副板——那两行不能因此丢掉已经知道的值
    m.panel.setStats(snap(10))
    expect(m.panel.el.querySelector('.pet-stats-activity')?.textContent).toBe('正在休息')
    expect(m.panel.el.querySelector('.pet-stats-online')?.textContent).toBe('1分20秒')
  })

  it('视图切走再切回来也还在：runtime 存在面板里，不跟着副板一起丢', () => {
    const m = open()
    m.panel.setRuntime({ activity: '正在张望', online: '9分9秒' })
    m.panel.setView('foods')
    m.panel.setView('stats')
    expect(m.panel.el.querySelector('.pet-stats-activity')?.textContent).toBe('正在张望')
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
    const panel = createPanel(root, defaultActions(), { ...DEFAULT_SETTINGS }, { action, view, pick: vi.fn(), game: vi.fn(), identity: vi.fn() })
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
  const openView = (v: 'foods' | 'stats') => {
    const m = mount()
    m.panel.show({ x: 0, y: 0 })
    if (v === 'stats') m.panel.setStats({ stats: { hunger: 82, mood: 45, weight: 20, bond: 97 }, identity: { name: '小鲸', gender: 'female' }, exp: 0, startedAt: 1_000 })
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

  it('食物视图：四颗按钮还在，列表在另一块里', () => {
    const { panel } = openView('foods')
    expect(actionBtns(panel)).toHaveLength(PANEL_BUTTONS.length)
    const plate = panel.el.querySelector('.pet-plate')!
    expect(plate.querySelector('.pet-food')).not.toBeNull()
    // 列表不能是按钮条的子节点：两块的锚点不同，嵌在一起就没法各摆各的
    expect(plate.closest('.pet-actions')).toBeNull()
  })

  it('状态视图：四颗按钮还在，读数在副板里', () => {
    const { panel } = openView('stats')
    expect(actionBtns(panel)).toHaveLength(PANEL_BUTTONS.length)
    const plate = panel.el.querySelector('.pet-plate')!
    // 等级不是 .pet-stat（那是「一条数值读数」），所以这里是四条
    expect(plate.querySelectorAll('.pet-stat')).toHaveLength(4)
  })

  /**
   * 出场动画的前提，比动画本身更要紧：按钮条必须是**同一批节点**跨视图活着。
   * 每次换视图都重建的话，「从 display:none 出来才跑一次」的 @starting-style 会变成
   * 「每次 render 都跑」——数值快照每 60 秒推一次，四颗就会在列表开着时重新弹一遍。
   */
  it('换视图不重建按钮条：节点是同一个', () => {
    const { panel } = mount()
    panel.show({ x: 0, y: 0 })
    const before = panel.el.querySelector('.pet-actions')
    panel.setView('foods')
    expect(panel.el.querySelector('.pet-actions')).toBe(before)
    panel.setView('stats')
    expect(panel.el.querySelector('.pet-actions')).toBe(before)
  })

  it('高亮跟着当前视图走（复用节点后必须单独同步，不能再靠重建带上）', () => {
    const { panel } = mount()
    panel.show({ x: 0, y: 0 })
    const on = () => panel.el.querySelector('button.on')?.getAttribute('data-id')
    expect(on()).toBeUndefined()
    panel.setView('foods')
    expect(on()).toBe('feed')
    panel.setView('stats')
    expect(on()).toBe('status')
    panel.setView('actions')
    expect(on()).toBeUndefined()
  })

  it('错峰档位 --i：从左数 0、1、2…（出场按左→右依次弹）', () => {
    const { panel } = mount()
    panel.show({ x: 0, y: 0 })
    const i = [...panel.el.querySelectorAll<HTMLElement>('.pet-actions button[data-id]')]
      .map((b) => b.style.getPropertyValue('--i'))
    expect(i).toEqual(['0', '1', '2', '3'])
  })

  it('主块永远是按钮条；副板单独量（不再顶替主块）', () => {
    const actions = mount()
    actions.panel.show({ x: 0, y: 0 })
    expect(actions.panel.primaryEl()?.classList.contains('pet-actions')).toBe(true)
    const stats = openView('stats')
    expect(stats.panel.primaryEl()?.classList.contains('pet-actions')).toBe(true)
    expect(stats.panel.plateSize()).not.toBeNull()
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
