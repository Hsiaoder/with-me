/**
 * 「日常动画怎么选」的纯逻辑（零 import DOM/时钟；条件与概率都吃调用方传入的情境快照 + rng）。
 *
 * 取代旧的「规则层给池名 → 皮肤池权重里随机挑一条」日常动画模型，改成按**条件 + 说话档**选**具名 dsh 片段**：
 *  - 挂机随机池 AMBIENT（+ 久未互动时加权 SLEEPY 犯困片）
 *  - 心情高/低、深夜仍在用 → 各选各的一组
 *  - 交互事件（连续点击、刚犯困被点）→ pickInteract
 *  - 说话档 → SPEECH 配一段动画（feed 不在此表，喂那一口播吃相是铁律）
 *  - 游戏入口片 GAME_INTRO；跨级片 LEVELUP_CLIP
 *
 * clip 一律用 `{pool,name}` 寻址（和食物 anim、pickNamed 同一条按名播放路）：
 * 复用的片段沿用其原池（guess/core/turn），新增片段统一进 `daily` 池（见 spike/dsh-asar-extract.mjs）。
 * 名字（ascii slug）必须与提取脚本、皮肤 manifest 三处一致，否则按名取不到、静默不动。
 * 规格来自 docs/动画.txt。
 */
import { IDLE_LONG_MS } from './config.js'
import { BAND_HIGH_ABOVE, BLUE_BELOW } from './stats.js'
import type { TalkReason } from './talk.js'

export type ClipRef = { pool: string; name: string }

/** 装配层每拍算好递进来的情境：动画选择只看这些，不自己读时钟/存档。 */
export type Situation = {
  mood: number
  idleMs: number
  lateNightWorking: boolean
  lastWasSleepy: boolean
  clickStreak: number
}

const d = (name: string): ClipRef => ({ pool: 'daily', name })        // 新增日常片段都在 daily 池
const g = (name: string): ClipRef => ({ pool: 'guess', name })         // 复用猜动作已切的具名片段
const core = (pool: string, name: string): ClipRef => ({ pool, name }) // 复用核心池已切的

/** 1. 挂机随机池（`动画.txt` 那 23 条里除去归到「犯困/条件」的，剩下的常驻随机）。 */
export const AMBIENT: readonly ClipRef[] = [
  d('toycar'), d('horse'), d('swingset'), g('juggling'), g('balloon'), g('spinningtop'), d('gift'),
  g('liondance'), g('fireworks'), g('swing'), g('flowers'), d('mirror'), d('spin'), core('turn', 'look'),
  d('code'), d('cat'), d('shuttlecock'), d('purseempty'), d('busytype'),
]

/** 久无人理时并入挂机并加权的「犯困」片。 */
export const SLEEPY: readonly ClipRef[] = [d('siesta'), d('yawn'), d('squat'), g('tsundere')]

/** 心情高（>BAND_HIGH_ABOVE）时倾向播的舞动片。 */
export const MOOD_HIGH: readonly ClipRef[] = [g('maid'), g('otaku'), d('hum'), g('swing')]

/** 心情很低（<BLUE_BELOW）时播。 */
export const MOOD_LOW: readonly ClipRef[] = [d('tailslap')]

/** 过凌晨仍在用 → 哈欠连天。 */
export const LATE_NIGHT: readonly ClipRef[] = [d('yawn')]

/** 交互：连续点击够多 → 挠痒咯咯笑；刚播过犯困片被点 → 打瞌睡被惊醒。 */
const REACT_CLICKSTREAK: ClipRef = g('ticklish')
const REACT_SLEEPY_WAKE: ClipRef = d('dozewake')

/** 说话档 → 配一段动画。feed 不列（保吃相）。未列的档不配。 */
export const SPEECH: Readonly<Partial<Record<TalkReason, readonly ClipRef[]>>> = {
  idle: [d('musedaze'), d('musescreen'), d('musewipe'), d('desktap'), d('stretch')],
  hungry: [d('whateat'), core('turn', 'look')],
  blue: [d('squat'), d('siesta'), d('stretch')],
  game: [g('swing')],
  greet: [g('flowers'), d('butterfly'), d('animals'), d('ghost'), g('liondance')],
  bye: [d('curtsy')],
}

/** 游戏入口片（开局各播一次；玩法动画不动）。 */
export const GAME_INTRO: Record<'fly' | 'guess' | 'bubble', ClipRef> = {
  fly: d('jumpcatch'),
  guess: d('spin'),
  bubble: g('balloon'),
}

/** 跨级时播的片（播完那一拍再冒「等级+1」）。 */
export const LEVELUP_CLIP: ClipRef = g('bluewhale')

/**
 * 启动随机片（用户 2026-11-11 指定八条）：开机问候时随机播一条，配一句随机问候语音。
 * 舞狮头/女仆舞/摇摆舞复用 guess 池已切的名片；动物环绕/小幽灵/荡秋千在 daily；
 * 堆雪人/放风筝是这一轮新切进 daily 的（见 spike/dsh-asar-extract.mjs）。
 */
export const STARTUP_CLIPS: readonly ClipRef[] = [
  g('liondance'), g('maid'), g('swing'), d('animals'), d('ghost'), d('snowman'), d('swingset'), d('kite'),
]

/** 退出随机片（用户指定四条）：被落叶淹没/女仆屈膝礼仪/超大伸懒腰/清点归档。演完这条 + 再见语音才真正退。 */
export const EXIT_CLIPS: readonly ClipRef[] = [
  d('leaves'), d('curtsy'), d('stretch'), d('archive'),
]

/** 连点到这个数就判定「连续点击」。 */
export const CLICK_STREAK_MIN = 3

/** 把 AMBIENT(+犯困加权) 摊成带权重的候选：久未互动时 SLEEPY 权重抬高。 */
function ambientCandidates(idleMs: number): { clip: ClipRef; weight: number }[] {
  const sleepyWeight = idleMs > IDLE_LONG_MS ? 3 : 1
  return [...AMBIENT.map((clip) => ({ clip, weight: 1 })), ...SLEEPY.map((clip) => ({ clip, weight: sleepyWeight }))]
}

/** 等/加权随机抽一条（rng 注入；越界夹到末条，空表返回 null）。 */
function weightedPick(items: readonly { clip: ClipRef; weight: number }[], rng: () => number): ClipRef | null {
  const total = items.reduce((n, it) => n + it.weight, 0)
  if (total <= 0) return null
  let roll = rng() * total
  for (const it of items) {
    roll -= it.weight
    if (roll < 0) return it.clip
  }
  return items[items.length - 1]?.clip ?? null
}

/**
 * 交互事件该播什么：连续点击够数 → 挠痒；刚播过犯困片被点 → 惊醒；其余返回 null（装配层回落到常规反应）。
 */
export function pickInteract(s: Situation): ClipRef | null {
  if (s.clickStreak >= CLICK_STREAK_MIN) return REACT_CLICKSTREAK
  if (s.lastWasSleepy) return REACT_SLEEPY_WAKE
  return null
}

/**
 * 无交互那一拍该播什么。优先级：心情很高跳舞 > 心情很低甩尾 > 深夜哈欠 > 加权挂机（久未互动时犯困片更常出）。
 * 各档都从对应集合随机一条，rng 注入。
 */
export function pickAmbient(s: Situation, rng: () => number): ClipRef | null {
  if (s.mood > BAND_HIGH_ABOVE) return flatPick(MOOD_HIGH, rng)
  if (s.mood < BLUE_BELOW) return flatPick(MOOD_LOW, rng)
  if (s.lateNightWorking) return flatPick(LATE_NIGHT, rng)
  return weightedPick(ambientCandidates(s.idleMs), rng)
}

/** 说话这条该配什么动画；该档没配（如 feed）返回 null。 */
export function pickForSpeech(reason: TalkReason, rng: () => number): ClipRef | null {
  return flatPick(SPEECH[reason] ?? [], rng)
}

/** 开机随机一条启动片（rng 注入）。 */
export function pickStartup(rng: () => number): ClipRef | null {
  return flatPick(STARTUP_CLIPS, rng)
}

/** 退出随机一条收尾片（rng 注入）。 */
export function pickExit(rng: () => number): ClipRef | null {
  return flatPick(EXIT_CLIPS, rng)
}

function flatPick(list: readonly ClipRef[], rng: () => number): ClipRef | null {
  if (list.length === 0) return null
  const i = Math.min(list.length - 1, Math.floor(rng() * list.length))
  return list[i] ?? null
}

/** 本模块用到的全部具名片段（供单测/装配层核对「候选名都在皮肤池清单里」）。 */
export const ALL_CLIPS: readonly ClipRef[] = [
  ...AMBIENT, ...SLEEPY, ...MOOD_HIGH, ...MOOD_LOW, ...LATE_NIGHT,
  REACT_CLICKSTREAK, REACT_SLEEPY_WAKE, LEVELUP_CLIP, GAME_INTRO.fly, GAME_INTRO.guess, GAME_INTRO.bubble,
  ...STARTUP_CLIPS, ...EXIT_CLIPS,
  ...Object.values(SPEECH).flatMap((v) => v ?? []),
]
