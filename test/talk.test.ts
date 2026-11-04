import { describe, it, expect } from 'vitest'
import { clamp, pickTalk, REPLY_MAX_WIDTH, TALK_LINES, type TalkReason } from '../src/shared/talk.js'
import { labelWidth } from '../src/shared/text.js'
import { IDLE_LONG_MS, TALK_COOLDOWN_MS, TALK_MAX_CHARS } from '../src/shared/config.js'

/** rng 用队列桩：pickTalk 先掷概率（仅 idle）再抽句子，调用次数与顺序是契约的一部分。 */
const seq = (...xs: number[]) => {
  const q = [...xs]
  return () => (q.length > 1 ? (q.shift() as number) : (q[0] ?? 0))
}
const ctx = (over: Partial<{ now: number; idleMs: number; lastTalkAt: number }> = {}) => ({
  now: 100000,
  idleMs: IDLE_LONG_MS + 1,
  lastTalkAt: 0,
  ...over,
})
const REASONS: TalkReason[] = ['idle', 'feed', 'game', 'status', 'drag']

describe('台词表', () => {
  for (const r of REASONS) {
    it(`${r} 组有台词，每句都带一句主人的短回复`, () => {
      expect(TALK_LINES[r].length).toBeGreaterThan(0)
      for (const line of TALK_LINES[r]) {
        expect([...line.say].length).toBeLessThanOrEqual(TALK_MAX_CHARS)
        expect(line.reply.length).toBeGreaterThan(0)
      }
    })
  }

  it('回复放得进气泡里那颗按钮（按宽度算，不是字数）', () => {
    for (const r of REASONS) {
      for (const line of TALK_LINES[r]) {
        expect(labelWidth(line.reply), `${r}「${line.reply}」太宽`).toBeLessThanOrEqual(REPLY_MAX_WIDTH)
      }
    }
  })

  it('每组都不止一句，否则连着两次互动会听到同一句', () => {
    for (const r of REASONS) expect(TALK_LINES[r].length, r).toBeGreaterThan(1)
  })
})

describe('pickTalk', () => {
  it('冷却期内各组一律闭嘴', () => {
    for (const r of REASONS) {
      expect(pickTalk(r, ctx({ lastTalkAt: 100000 - TALK_COOLDOWN_MS + 1 }), seq(0, 0))).toBeNull()
    }
  })

  it('idle 要同时满足「闲够了」和「掷中概率」', () => {
    expect(pickTalk('idle', ctx({ idleMs: IDLE_LONG_MS }), seq(0, 0))).toBeNull()
    expect(pickTalk('idle', ctx(), seq(0.99, 0))).toBeNull()
    expect(pickTalk('idle', ctx(), seq(0.1, 0))).not.toBeNull()
  })

  it('事件驱动的台词必说，不看概率', () => {
    expect(pickTalk('feed', ctx(), seq(0.99, 0))).not.toBeNull()
    expect(pickTalk('drag', ctx(), seq(0.99, 0))).not.toBeNull()
  })

  it('rng 决定组内哪一句，且不会越界', () => {
    expect(pickTalk('feed', ctx(), seq(0, 0))).toEqual(TALK_LINES.feed[0])
    expect(TALK_LINES.feed).toContain(pickTalk('feed', ctx(), seq(0, 0.999)))
    expect(TALK_LINES.feed.length).toBeGreaterThan(1)
  })

  it('返回的是整条 Line，回复跟着台词一起走', () => {
    const line = pickTalk('game', ctx(), seq(0, 0))
    expect(line).toEqual(TALK_LINES.game[0])
    expect(typeof line!.say).toBe('string')
    expect(typeof line!.reply).toBe('string')
  })
})

describe('clamp', () => {
  it('不超限的原样返回（去首尾空白与换行）', () => {
    expect(clamp('  今天也想玩  ')).toBe('今天也想玩')
    expect(clamp('两\n行')).toBe('两 行')
  })

  it('超限截断加省略号，结果长度是上限 + 1 个字符', () => {
    const long = '一'.repeat(TALK_MAX_CHARS + 5)
    const out = clamp(long)
    expect([...out].length).toBe(TALK_MAX_CHARS + 1)
    expect(out.endsWith('…')).toBe(true)
  })

  it('空串与全空白返回空串——调用方据此决定干脆不显示', () => {
    expect(clamp('')).toBe('')
    expect(clamp('   \n  ')).toBe('')
  })

  it('按码点数算，不是 UTF-16 长度', () => {
    const emoji = '😀'.repeat(TALK_MAX_CHARS)
    expect(clamp(emoji)).toBe(emoji)
  })
})
