/**
 * 宠物说什么、主人怎么回。纯逻辑，不碰 DOM、不碰时钟——时钟与随机都由调用方注入，
 * 所以「冷却」「概率」「组内选句」都能在单测里钉死。
 *
 * 台词放代码而不是皮肤 manifest：说话方式是产品人格，换皮不该换掉它。
 * 以后真要皮肤覆盖，在这里加一个可选的注入点就够了，v1 不做。
 *
 * 每句都配一条主人的短回复（照 qqpet 的 Line={tolk, submitText}）：气泡里那颗按钮
 * 就是这句回复，点下去气泡收掉。回复要放进 80px 宽的按钮，所以按宽度而不是字数卡。
 */

import { IDLE_LONG_MS, TALK_COOLDOWN_MS, TALK_IDLE_PROB, TALK_MAX_CHARS } from './config.js'
import { labelWidth } from './text.js'

export type TalkReason = 'idle' | 'feed' | 'game' | 'status' | 'drag'

/** 宠物说一句，按钮上是主人那句短回应。 */
export type Line = { say: string; reply: string }

export type TalkCtx = {
  /** 现在（同一时间基准由调用方给）。 */
  now: number
  /** 距上次交互过了多久。 */
  idleMs: number
  /** 上次开口是什么时候。 */
  lastTalkAt: number
}

/** 按钮宽 80px、字号 12px → 约 5 个汉字。留一点余量取 5。 */
export const REPLY_MAX_WIDTH = 5

export const TALK_LINES: Record<TalkReason, Line[]> = {
  idle: [
    { say: '无聊到数地板纹路了', reply: '别数我陪你' },
    { say: '你回来陪我玩嘛', reply: '来了来了' },
    { say: '一个人待着好安静', reply: '我在呢' },
    { say: '要不要一起干点啥', reply: '好啊' },
  ],
  feed: [
    { say: '哇，是吃的！', reply: '吃吧吃吧' },
    { say: '这个我喜欢', reply: '多给点' },
    { say: '谢谢投喂', reply: '不客气' },
    { say: '肚子正咕咕叫呢', reply: '快吃吧' },
  ],
  game: [
    { say: '玩什么？我准备好了', reply: '随便你挑' },
    { say: '来呀来呀', reply: '来' },
    { say: '我手气一向不错', reply: '那就试试' },
  ],
  status: [
    { say: '我精神好得很', reply: '那就好' },
    { say: '有点想睡觉', reply: '睡吧' },
    { say: '今天状态满分', reply: '真棒' },
  ],
  drag: [
    { say: '呀——要去哪', reply: '换个地方待' },
    { say: '轻一点啦', reply: '知道了' },
    { say: '被拎着走好丢人', reply: '不丢人' },
  ],
}

/** 折叠换行、去首尾空白，超长按码点截断加省略号。空的一律变空串。 */
export function clamp(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const chars = [...flat]
  if (chars.length <= TALK_MAX_CHARS) return flat
  return chars.slice(0, TALK_MAX_CHARS).join('') + '…'
}

/**
 * 该不该开口、说什么。返回 null 就是这句不说。
 *
 * 概率只作用于 idle：用户做了动作（喂、拖、点）就该有回应，掷骰子决定「要不要理你」
 * 会把反馈丢掉。冷却对两者都生效，否则连点按钮会一句话接一句话刷屏。
 *
 * rng 的调用顺序是契约：idle 先掷概率再抽句子，其余 reason 只抽句子。
 */
export function pickTalk(reason: TalkReason, ctx: TalkCtx, rng: () => number): Line | null {
  if (ctx.now - ctx.lastTalkAt < TALK_COOLDOWN_MS) return null
  if (reason === 'idle') {
    if (ctx.idleMs <= IDLE_LONG_MS) return null
    if (rng() >= TALK_IDLE_PROB) return null
  }
  const lines = TALK_LINES[reason]
  return lines[Math.floor(rng() * lines.length) % lines.length] ?? null
}

/** 回复放得下那颗按钮吗（装配层不需要问，测试与内容校准入用）。 */
export const replyFits = (line: Line): boolean => labelWidth(line.reply) <= REPLY_MAX_WIDTH

/**
 * 台词表摊平成一条有序流：面板「说话」按钮按顺序逐条放，走完绕回。
 * 顺序就是 `TALK_LINES` 里 reason 的书写顺序（idle → feed → game → status → drag），
 * 再按各池里的行序——调试时要能预期「下一条是哪句」，所以这里刻意不用随机。
 */
export const TALK_FLOW: readonly Line[] = (Object.keys(TALK_LINES) as TalkReason[])
  .flatMap((r) => TALK_LINES[r])

/** 游标推进：-1 起步给第一条，走到末尾绕回 0。 */
export function nextTalkIndex(cur: number): number {
  return (cur + 1) % TALK_FLOW.length
}
