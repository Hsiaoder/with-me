/**
 * 调试副板。一颗「调试」按钮切到 debug 视图后由 panel 挂载这块。
 *
 * 它是个**测试台**，不是给玩家的功能：把「会自动触发的条件 / 动画 / 台词 / 游戏食物」摊成可点的清单，
 * 点一下就走真实链路（选择器 / requestClip / say / 喂食 / 开局），外加等级与四条数值的滑条直接改真存档。
 * 数据全部来自 shared 的现成表（animation/talk/food/games/stats），这里不另抄一份，免得和真行为跑偏。
 *
 * 纯 DOM 构造器：不碰 Electron、不读时钟，回调与快照都由装配层注入，所以能在 jsdom 里单测。
 */
import { FOODS, type Food } from '../shared/food.js'
import { GAMES, type Game } from '../shared/games.js'
import { TALK_LINES, type TalkReason } from '../shared/talk.js'
import {
  MAX_LEVEL,
  STAT_KEYS,
  STAT_LABELS,
  STAT_MAX,
  levelOf,
  type Stats,
} from '../shared/stats.js'
import {
  CLICK_STREAK_MIN,
  LEVELUP_CLIP,
  pickAmbient,
  pickInteract,
  type ClipRef,
  type Situation,
} from '../shared/animation.js'
import { IDLE_LONG_MS } from '../shared/config.js'

/** 装配层提供的真实链路入口。调试板只调这些，不自己播/说/写存档。 */
export interface DebugApi {
  playClip(pool: string, name: string): void
  /** 说某档的第 index 句（绕冷却），并配该档动画。 */
  sayLine(reason: TalkReason, index: number): void
  feed(food: Food): void
  startGame(game: Game): void
  setLevel(level: number): void
  setStat(key: keyof Stats, value: number): void
  /** 调气泡正文字号（px），纯显示调试，不改存档。 */
  setBubbleFontSize(px: number): void
}

export interface DebugContext {
  api: DebugApi
  /** 当前皮肤实际有哪些池、每池哪些 clip（动画全集按集合就照它列）。 */
  pools: Record<string, string[]>
}

export type DebugSnapshot = { stats: Stats; exp: number } | null

/** 会自动说的 11 档（puzzle/unlock/thanks 未接触发点，不进台词全表）。 */
const FIRES_REASONS: readonly TalkReason[] = ['idle', 'hungry', 'blue', 'feed', 'game', 'status', 'levelup', 'greet', 'bye', 'comfort', 'timeGreet']
const REASON_LABEL: Record<string, string> = {
  idle: '闲', hungry: '饿', blue: '蔫', feed: '喂食', game: '开局',
  status: '状态', levelup: '升级', greet: '上线', bye: '退出', comfort: '贴心', timeGreet: '时段',
}

const TABS = ['条件触发', '动画全集', '台词全表', '游戏食物'] as const

const baseSit = (over: Partial<Situation> = {}): Situation => ({
  mood: 50, idleMs: 0, lateNightWorking: false, lastWasSleepy: false, clickStreak: 0, music: false, ...over,
})

function el(tag: string, cls: string, text?: string): HTMLElement {
  const n = document.createElement(tag)
  n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = cls
  b.textContent = label
  b.type = 'button'
  b.addEventListener('click', onClick)
  return b
}

export function createDebugPlate(
  ctx: DebugContext,
  snapshot: () => DebugSnapshot,
): { el: HTMLElement; refresh(): void } {
  const { api } = ctx
  const root = el('div', 'pet-debug')

  // ---- 标签条 ----
  const tabBar = el('div', 'pet-debug-tabs')
  const body = el('div', 'pet-debug-body')
  let tab = 0
  const tabBtns = TABS.map((label, i) => {
    const b = button(label, 'pet-debug-tab', () => { tab = i; renderBody(); syncTabs() })
    b.dataset.tab = String(i)
    tabBar.append(b)
    return b
  })
  function syncTabs(): void {
    tabBtns.forEach((b, i) => b.classList.toggle('on', i === tab))
  }

  const play = (ref: ClipRef | null): void => { if (ref) api.playClip(ref.pool, ref.name) }

  // ---- 各 tab 内容 ----
  function renderConditions(host: HTMLElement): void {
    const rows: { label: string; run: () => void }[] = [
      { label: '挂机随机池', run: () => play(pickAmbient(baseSit(), Math.random)) },
      { label: '心情 > 60 → 舞动', run: () => play(pickAmbient(baseSit({ mood: 70 }), Math.random)) },
      { label: '心情 < 30 → 甩尾', run: () => play(pickAmbient(baseSit({ mood: 10 }), Math.random)) },
      { label: '深夜(0–5点)还在用 → 哈欠', run: () => play(pickAmbient(baseSit({ lateNightWorking: true }), Math.random)) },
      { label: `久未互动 > ${IDLE_LONG_MS / 1000}s → 犯困加权`, run: () => play(pickAmbient(baseSit({ idleMs: IDLE_LONG_MS + 5000 }), Math.random)) },
      { label: '有播放器在放 → 音乐片段加权', run: () => play(pickAmbient(baseSit({ music: true }), Math.random)) },
      { label: `连点 ≥ ${CLICK_STREAK_MIN} → 挠痒`, run: () => play(pickInteract(baseSit({ clickStreak: CLICK_STREAK_MIN }))) },
      { label: '瞌睡后被点 → 惊醒', run: () => play(pickInteract(baseSit({ lastWasSleepy: true }))) },
      { label: '跨级 → 蓝鲸现世', run: () => play(LEVELUP_CLIP) },
    ]
    for (const r of rows) {
      const row = el('div', 'pet-debug-row')
      row.append(el('span', 'pet-debug-rowlabel', r.label))
      row.append(button('▶ 演示', 'pet-debug-demo', r.run))
      host.append(row)
    }
    const hint = el('p', 'pet-debug-hint', '演示按该条件跑真选择器并播它选中的那条；要验证自然链路，用下方滑条把真实状态改成满足条件。')
    host.append(hint)
  }

  function renderPools(host: HTMLElement): void {
    const entries = Object.entries(ctx.pools).filter(([, list]) => list.length > 0)
    if (entries.length === 0) { host.append(el('p', 'pet-debug-hint', '当前皮肤没有可用动画池。')); return }
    for (const [pool, list] of entries) {
      const sec = el('div', 'pet-debug-section')
      sec.append(el('div', 'pet-debug-sechead', `${pool}（${list.length}）`))
      const grid = el('div', 'pet-debug-grid')
      for (const name of list) {
        grid.append(button(name, 'pet-debug-item', () => api.playClip(pool, name)))
      }
      sec.append(grid)
      host.append(sec)
    }
  }

  function renderLines(host: HTMLElement): void {
    for (const reason of FIRES_REASONS) {
      const lines = TALK_LINES[reason]
      const sec = el('div', 'pet-debug-section')
      sec.append(el('div', 'pet-debug-sechead', `${REASON_LABEL[reason] ?? reason}（${lines.length}）`))
      lines.forEach((line, i) => {
        const b = button(line.say, 'pet-debug-line', () => api.sayLine(reason, i))
        b.title = `回应：${line.reply}`
        sec.append(b)
      })
      host.append(sec)
    }
  }

  function renderGamesFoods(host: HTMLElement): void {
    const gsec = el('div', 'pet-debug-section')
    gsec.append(el('div', 'pet-debug-sechead', `小游戏（${GAMES.length}）`))
    const ggrid = el('div', 'pet-debug-grid')
    for (const g of GAMES) ggrid.append(button(g.name, 'pet-debug-item', () => api.startGame(g)))
    gsec.append(ggrid)
    host.append(gsec)

    const fsec = el('div', 'pet-debug-section')
    fsec.append(el('div', 'pet-debug-sechead', `食物（${FOODS.length}）`))
    const fgrid = el('div', 'pet-debug-grid')
    for (const f of FOODS) fgrid.append(button(f.name, 'pet-debug-item', () => api.feed(f)))
    fsec.append(fgrid)
    host.append(fsec)
  }

  function renderBody(): void {
    body.replaceChildren()
    if (tab === 0) renderConditions(body)
    else if (tab === 1) renderPools(body)
    else if (tab === 2) renderLines(body)
    else renderGamesFoods(body)
  }

  // ---- 常驻数值区：等级 + 四条数值滑条（改真存档）----
  const values = el('div', 'pet-debug-values')
  const levelNum = el('span', 'pet-debug-num')
  const levelRange = document.createElement('input')
  levelRange.type = 'range'
  levelRange.min = '1'
  levelRange.max = String(MAX_LEVEL)
  levelRange.step = '1'
  levelRange.className = 'pet-debug-range'
  levelRange.setAttribute('aria-label', '设置等级')
  levelRange.addEventListener('input', () => {
    const lv = Number(levelRange.value)
    levelNum.textContent = `Lv.${lv}`
    api.setLevel(lv)
  })
  const levelRow = el('div', 'pet-debug-value-row')
  levelRow.append(el('span', 'pet-debug-valuelabel', '等级'), levelRange, levelNum)
  values.append(levelRow)

  const statRefs: { key: keyof Stats; range: HTMLInputElement; num: HTMLElement }[] = []
  for (const key of STAT_KEYS) {
    const num = el('span', 'pet-debug-num')
    const range = document.createElement('input')
    range.type = 'range'
    range.min = '0'
    range.max = String(STAT_MAX)
    range.step = '1'
    range.className = 'pet-debug-range'
    range.dataset.stat = key
    range.setAttribute('aria-label', STAT_LABELS[key])
    range.addEventListener('input', () => {
      const v = Number(range.value)
      num.textContent = String(v)
      api.setStat(key, v)
    })
    const row = el('div', 'pet-debug-value-row')
    row.append(el('span', 'pet-debug-valuelabel', STAT_LABELS[key]), range, num)
    values.append(row)
    statRefs.push({ key, range, num })
  }

  // 气泡字号（纯显示调试，不改存档）：实时调气泡正文字号，方便对比不同字号的排版。
  const fontNum = el('span', 'pet-debug-num', '14px')
  const fontRange = document.createElement('input')
  fontRange.type = 'range'
  fontRange.min = '9'
  fontRange.max = '24'
  fontRange.step = '1'
  fontRange.value = '14'
  fontRange.className = 'pet-debug-range'
  fontRange.dataset.fontsize = 'bubble'
  fontRange.setAttribute('aria-label', '气泡字号')
  fontRange.addEventListener('input', () => {
    const v = Number(fontRange.value)
    fontNum.textContent = `${v}px`
    api.setBubbleFontSize(v)
  })
  const fontRow = el('div', 'pet-debug-value-row')
  fontRow.append(el('span', 'pet-debug-valuelabel', '气泡字号'), fontRange, fontNum)
  values.append(fontRow)

  function refresh(): void {
    const s = snapshot()
    if (s === null) return
    const lv = levelOf(s.exp)
    levelRange.value = String(lv)
    levelNum.textContent = `Lv.${lv}`
    for (const ref of statRefs) {
      const v = Math.round(s.stats[ref.key])
      ref.range.value = String(v)
      ref.num.textContent = String(v)
    }
  }

  root.append(tabBar, body, values)
  renderBody()
  syncTabs()
  refresh()
  return { el: root, refresh }
}