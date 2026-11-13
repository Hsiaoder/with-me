import { describe, it, expect } from 'vitest'
import { clamp, nextTalkIndex, pickLine, pickTalk, REPLY_MAX_WIDTH, replyFits, TALK_FLOW, TALK_LINES, type TalkReason } from '../src/shared/talk.js'
import { labelWidth } from '../src/shared/text.js'
import { IDLE_LONG_MS, TALK_COOLDOWN_MS, TALK_IDLE_GAP_MS, TALK_MAX_CHARS } from '../src/shared/config.js'

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
// 从台词表本身推，而不是手抄一份：上一版这里写死四个 reason，hungry/blue 早就加进表里了却没进这份清单，
// 「冷却期内各组一律闭嘴」那几条就悄悄少验了两组。
// 清单里**没有 'drag'** 是有意的：拖拽时不弹气泡（用户 2026-11-05 拍的板），台词表那一档一起删了。
const REASONS = Object.keys(TALK_LINES) as TalkReason[]

describe('台词表', () => {
  it('reason 就是表里这些：drag 不许被加回来，comfort/timeGreet 是迁移新增的', () => {
    expect(REASONS.slice().sort()).toEqual(
      ['blue', 'bye', 'comfort', 'feed', 'game', 'greet', 'hungry', 'idle', 'levelup', 'puzzle', 'status', 'thanks', 'timeGreet', 'unlock'],
    )
  })

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

  it('自己搭话走长间隔，事件台词走短冷却：两条账不能混', () => {
    // 同一句「10 秒前刚说过」：事件台词放行，自己搭话闭嘴。
    const tenSecondsAgo = ctx({ lastTalkAt: 100000 - 10000 })
    expect(pickTalk('feed', tenSecondsAgo, seq(0, 0)), '事件台词被长间隔挡住了').not.toBeNull()
    expect(pickTalk('idle', tenSecondsAgo, seq(0, 0), TALK_IDLE_GAP_MS), '自己搭话没用长间隔').toBeNull()
    // 间隔走够了就照常放行（概率仍得掷中）。
    const gapPassed = ctx({ lastTalkAt: 100000 - TALK_IDLE_GAP_MS })
    expect(pickTalk('idle', gapPassed, seq(0.1, 0), TALK_IDLE_GAP_MS)).not.toBeNull()
  })

  it('搭话间隔按 qqpet 的均值定，不是三十秒一句（用户 2026-11-13 报太快）', () => {
    // qqpet：20–60 秒一拍、每拍约 1/3 开口 → 平均 1.5–2 分钟；下限给到 1 分钟。
    expect(TALK_IDLE_GAP_MS).toBeGreaterThanOrEqual(60000)
    expect(TALK_IDLE_GAP_MS).toBeGreaterThan(TALK_COOLDOWN_MS * 5)
  })

  it('事件驱动的台词必说，不看概率', () => {
    expect(pickTalk('feed', ctx(), seq(0.99, 0))).not.toBeNull()
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

describe('调试台词流（面板「说话」按钮按顺序放）', () => {
  const total = Object.values(TALK_LINES).reduce((n, l) => n + l.length, 0)

  it('摊平覆盖每条台词、不重不漏，顺序就是 reason 表的顺序', () => {
    // 钉「覆盖全部 + 表序」而不是钉死条数——加一句台词/一档 reason 不该把这条弄红。
    expect(TALK_FLOW.length).toBe(total)
    expect(new Set(TALK_FLOW.map((l) => l.say)).size).toBe(total)
    expect(TALK_FLOW[0]).toEqual(TALK_LINES.idle[0])
    // 流的末尾跟着 TALK_LINES 里最后一个 reason（不写死是谁，跟着表尾走）。
    const lastReason = (Object.keys(TALK_LINES) as TalkReason[]).at(-1) as TalkReason
    expect(TALK_FLOW.at(-1)).toEqual(TALK_LINES[lastReason].at(-1))
  })

  it('pickLine 绕开冷却：跨级那句不被刚才那句喂食挡掉', () => {
    /**
     * 喂食的台词在点击那一刻说完，快照随后才到（IPC 往返），
     * 所以「喂一口正好跨级」时 `pickTalk` 的 25 秒冷却必然挡住跨级那句。
     * 跨级是几十口才一次的事，比「这是吃的」重要——它该盖掉前一句，
     * 而气泡本来就是「覆盖而不是叠加」，盖掉不需要新机制。
     */
    const justSaid = ctx({ lastTalkAt: 100000 - 1, idleMs: 0 })
    expect(pickTalk('levelup', justSaid, seq(0, 0)), '冷却还该管住普通事件台词').toBeNull()
    const line = pickLine('levelup', seq(0.5))
    expect(line, 'pickLine 该照抽不误').not.toBeNull()
    expect(TALK_LINES.levelup).toContain(line)
  })

  it('每条都装得进气泡：正文不超上限，回复放得下那颗按钮', () => {
    for (const line of TALK_FLOW) {
      expect(line.say, `正文需要截断才放得下：${line.say}`).toBe(clamp(line.say))
      expect([...clamp(line.say)].length).toBeLessThanOrEqual(TALK_MAX_CHARS)
      expect(replyFits(line), `回复太宽放不下：${line.reply}`).toBe(true)
    }
  })

  it('游标从 -1 起步走第一条，走完绕回 0', () => {
    expect(nextTalkIndex(-1)).toBe(0)
    expect(nextTalkIndex(0)).toBe(1)
    expect(nextTalkIndex(TALK_FLOW.length - 1)).toBe(0)
  })
})
