// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createDebugPlate, type DebugApi, type DebugContext } from '../src/renderer/debug.js'
import { MOOD_HIGH, MOOD_LOW, LEVELUP_CLIP } from '../src/shared/animation.js'
import { TALK_LINES } from '../src/shared/talk.js'
import { FOODS } from '../src/shared/food.js'
import { GAMES } from '../src/shared/games.js'
import { INITIAL_STATS, LEVEL_CUM, STAT_KEYS, levelOf, type Stats } from '../src/shared/stats.js'

type Mock = ReturnType<typeof vi.fn>
const callsOf = (fn: unknown): unknown[][] => (fn as Mock).mock.calls

const makeApi = (): DebugApi => ({
  playClip: vi.fn(), sayLine: vi.fn(), feed: vi.fn(), startGame: vi.fn(), setLevel: vi.fn(), setStat: vi.fn(),
})

const POOLS = { daily: ['siesta', 'yawn'], eat: ['rice', 'hotpot'], guess: ['maid'], idle: ['patrol'] }
type Snap = { stats: Stats; exp: number }

const mount = (snap: Snap | null = { stats: { ...INITIAL_STATS }, exp: 0 }) => {
  const api = makeApi()
  const ctx: DebugContext = { api, pools: POOLS }
  const plate = createDebugPlate(ctx, () => snap)
  document.body.replaceChildren(plate.el)
  return { api, plate }
}

const tabBtn = (i: number) => document.querySelector<HTMLButtonElement>(`.pet-debug-tab[data-tab="${i}"]`)!
const fire = (node: HTMLElement) => node.dispatchEvent(new Event('input', { bubbles: true }))
const rowBy = (text: string) => [...document.querySelectorAll('.pet-debug-row')].find((r) => r.textContent?.includes(text))!
const demoOf = (text: string) => rowBy(text).querySelector<HTMLButtonElement>('.pet-debug-demo')!
const itemBy = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.pet-debug-item')].find((b) => b.textContent === label)!

afterEach(() => { document.body.replaceChildren() })

describe('调试板：四个一级标签', () => {
  it('默认在条件触发 tab，四颗标签齐全且第一颗高亮', () => {
    mount()
    expect([...document.querySelectorAll('.pet-debug-tab')].map((b) => b.textContent)).toEqual(['条件触发', '动画全集', '台词全表', '游戏食物'])
    expect(tabBtn(0).classList.contains('on')).toBe(true)
    expect(document.querySelectorAll('.pet-debug-demo').length).toBeGreaterThan(0)
  })

  it('点标签切换内容并迁移高亮', () => {
    mount()
    tabBtn(1).click()
    expect(tabBtn(1).classList.contains('on')).toBe(true)
    expect(tabBtn(0).classList.contains('on')).toBe(false)
    expect(document.querySelector('.pet-debug-sechead')?.textContent).toContain('daily')
  })
})

describe('条件触发总表：演示走真选择器', () => {
  it('心情>60 演示播的是 MOOD_HIGH 里的一条', () => {
    const { api } = mount()
    demoOf('心情 > 60').click()
    expect(api.playClip).toHaveBeenCalledTimes(1)
    const [pool, name] = callsOf(api.playClip)[0]!
    expect(MOOD_HIGH.some((c) => c.pool === pool && c.name === name)).toBe(true)
  })

  it('心情<30 演示播 MOOD_LOW；跨级演示播 LEVELUP_CLIP', () => {
    const { api } = mount()
    demoOf('心情 < 30').click()
    const [pool, name] = callsOf(api.playClip)[0]!
    expect(MOOD_LOW.some((c) => c.pool === pool && c.name === name)).toBe(true)
    demoOf('跨级').click()
    expect(api.playClip).toHaveBeenLastCalledWith(LEVELUP_CLIP.pool, LEVELUP_CLIP.name)
  })
})

describe('动画全集：按集合列出每个池的 clip', () => {
  it('每个非空池一个 section，点 clip 调 playClip(pool,name)', () => {
    const { api } = mount()
    tabBtn(1).click()
    const heads = [...document.querySelectorAll('.pet-debug-sechead')].map((h) => h.textContent)
    expect(heads.some((h) => h?.startsWith('daily'))).toBe(true)
    expect(heads.some((h) => h?.startsWith('eat'))).toBe(true)
    itemBy('rice').click()
    expect(api.playClip).toHaveBeenCalledWith('eat', 'rice')
  })
})

describe('台词全表：只列会自动说的 11 档', () => {
  it('不含未接的 puzzle/unlock/thanks；点一句调 sayLine(reason,index)', () => {
    const { api } = mount()
    tabBtn(2).click()
    const heads = [...document.querySelectorAll('.pet-debug-sechead')].map((h) => h.textContent ?? '')
    expect(heads.length).toBe(11)
    const firstIdle = TALK_LINES.idle[0]!.say
    const b = [...document.querySelectorAll<HTMLButtonElement>('.pet-debug-line')].find((x) => x.textContent === firstIdle)!
    b.click()
    expect(api.sayLine).toHaveBeenCalledWith('idle', 0)
  })
})

describe('游戏与食物', () => {
  it('点游戏调 startGame，点食物调 feed', () => {
    const { api } = mount()
    tabBtn(3).click()
    itemBy(GAMES[0]!.name).click()
    expect(api.startGame).toHaveBeenCalledWith(GAMES[0])
    itemBy(FOODS[0]!.name).click()
    expect(api.feed).toHaveBeenCalledWith(FOODS[0])
  })
})

describe('数值区：等级 + 四条滑条改真存档', () => {
  it('等级滑条初值来自 exp，拖动调 setLevel', () => {
    const { api } = mount({ stats: { ...INITIAL_STATS }, exp: LEVEL_CUM[9]! })
    const range = document.querySelector<HTMLInputElement>('.pet-debug-range[aria-label="设置等级"]')!
    expect(range.value).toBe('10')
    range.value = '25'
    fire(range)
    expect(api.setLevel).toHaveBeenCalledWith(25)
  })

  it('四条数值滑条各调 setStat(key,value)，初值来自快照', () => {
    const { api } = mount({ stats: { ...INITIAL_STATS, mood: 42 }, exp: 0 })
    expect(document.querySelector<HTMLInputElement>('.pet-debug-range[data-stat="mood"]')!.value).toBe('42')
    for (const key of STAT_KEYS) {
      const range = document.querySelector<HTMLInputElement>(`.pet-debug-range[data-stat="${key}"]`)!
      expect(range).not.toBeNull()
      range.value = '88'
      fire(range)
    }
    expect(api.setStat).toHaveBeenCalledTimes(4)
    expect(api.setStat).toHaveBeenCalledWith('mood', 88)
  })

  it('refresh 把外部快照同步到滑条与等级读数', () => {
    let snap: Snap | null = { stats: { ...INITIAL_STATS }, exp: 0 }
    const api = makeApi()
    const plate = createDebugPlate({ api, pools: POOLS }, () => snap)
    document.body.replaceChildren(plate.el)
    snap = { stats: { ...INITIAL_STATS, hunger: 15 }, exp: LEVEL_CUM[4]! }
    plate.refresh()
    expect(document.querySelector<HTMLInputElement>('.pet-debug-range[data-stat="hunger"]')!.value).toBe('15')
    expect(levelOf(LEVEL_CUM[4]!)).toBe(5)
    expect(document.querySelector<HTMLInputElement>('.pet-debug-range[aria-label="设置等级"]')!.value).toBe('5')
  })
})