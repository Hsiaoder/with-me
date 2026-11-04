/**
 * 宠物说什么。纯逻辑，不碰 DOM、不碰时钟——时钟与随机都由调用方注入，
 * 所以「冷却」「概率」「组内选句」都能在单测里钉死。
 *
 * 台词放代码而不是皮肤 manifest：说话方式是产品人格，换皮不该换掉它。
 * 以后真要皮肤覆盖，在这里加一个可选的注入点就够了，v1 不做。
 */

import { IDLE_LONG_MS, TALK_COOLDOWN_MS, TALK_IDLE_PROB, TALK_MAX_CHARS } from './config.js'

export type TalkReason = 'idle' | 'feed' | 'game' | 'status' | 'drag' | 'click'

export type TalkCtx = {
  /** 现在（同一时间基准由调用方给）。 */
  now: number
  /** 距上次交互过了多久。 */
  idleMs: number
  /** 上次开口是什么时候。 */
  lastTalkAt: number
}

export const TALK_LINES: Record<TalkReason, string[]> = {
  idle: ['无聊到数地板纹路了', '你回来陪我玩嘛', '一个人待着好安静', '要不要一起干点啥'],
  feed: ['哇，是吃的！', '这个我喜欢', '谢谢投喂', '肚子正咕咕叫呢'],
  game: ['玩什么？我准备好了', '来呀来呀', '我手气一向不错'],
  status: ['我精神好得很', '有点想睡觉', '今天状态满分'],
  drag: ['呀——要去哪', '轻一点啦', '被拎着走好丢人'],
  click: ['嗯？', '叫我干嘛', '在呢在呢'],
}

/** 折叠换行、去首尾空白，超长按码点截断加省略号。空的一律变空串。 */
export function clamp(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const chars = [...flat]
  return chars.length > TALK_MAX_CHARS ? `${chars.slice(0, TALK_MAX_CHARS).join('')}…` : flat
}

/**
 * 该不该开口、说什么。返回 null 就是这句不说。
 *
 * 概率只作用于 idle：用户做了动作（喂、拖、点）就该有回应，掷骰子决定「要不要理你」
 * 会把反馈丢掉。冷却对两者都生效，否则连点按钮会一句话接一句话刷屏。
 *
 * rng 的调用顺序是契约：idle 先掷概率再抽句子，其余 reason 只抽句子。
 */
export function pickTalk(reason: TalkReason, ctx: TalkCtx, rng: () => number): string | null {
  if (ctx.now - ctx.lastTalkAt < TALK_COOLDOWN_MS) return null
  if (reason === 'idle') {
    if (ctx.idleMs <= IDLE_LONG_MS) return null
    if (rng() >= TALK_IDLE_PROB) return null
  }
  const lines = TALK_LINES[reason]
  return lines[Math.floor(rng() * lines.length) % lines.length] ?? null
}
