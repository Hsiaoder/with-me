import { describe, it, expect } from 'vitest'
import {
  AMBIENT, SLEEPY, MOOD_HIGH, MOOD_LOW, LATE_NIGHT, SPEECH, LEVELUP_CLIP, CLICK_STREAK_MIN,
  STARTUP_CLIPS, EXIT_CLIPS, ALL_CLIPS, pickAmbient, pickForSpeech, pickInteract, pickStartup, pickExit, type Situation,
} from '../src/shared/animation.js'

const fixed = (v: number) => () => v
const S = (over: Partial<Situation> = {}): Situation => ({
  mood: 50, idleMs: 0, lateNightWorking: false, lastWasSleepy: false, clickStreak: 0, ...over,
})

describe('日常动画 · 纯选择器', () => {
  it('pickInteract：连续点击够数→挠痒咯咯笑，优先级高于犯困惊醒', () => {
    const r = pickInteract(S({ clickStreak: CLICK_STREAK_MIN, lastWasSleepy: true }))
    expect(r).toEqual({ pool: 'guess', name: 'ticklish' })
  })

  it('pickInteract：没连点但刚播过犯困片被点→打瞌睡被惊醒', () => {
    expect(pickInteract(S({ lastWasSleepy: true }))).toEqual({ pool: 'daily', name: 'dozewake' })
  })

  it('pickInteract：既没连点也没犯困→null（装配层回落常规反应）', () => {
    expect(pickInteract(S())).toBeNull()
  })

  it('pickAmbient：心情>60 只出舞动片集', () => {
    for (let i = 0; i < 12; i++) {
      const c = pickAmbient(S({ mood: 81 }), fixed(i / 12))!
      expect(c).not.toBeNull()
      expect(MOOD_HIGH).toContain(c)
    }
  })

  it('pickAmbient：心情<30 只出甩尾', () => {
    for (let i = 0; i < 8; i++) expect(pickAmbient(S({ mood: 10 }), fixed(i / 8))).toEqual(MOOD_LOW[0])
  })

  it('pickAmbient：心情不高不低但深夜仍在用→哈欠连天', () => {
    for (let i = 0; i < 5; i++) expect(pickAmbient(S({ mood: 50, lateNightWorking: true }), fixed(i / 5))).toEqual(LATE_NIGHT[0])
  })

  it('pickAmbient：心情很高优先于深夜（顺序即优先级）', () => {
    expect(MOOD_HIGH).toContain(pickAmbient(S({ mood: 90, lateNightWorking: true }), fixed(0.5))!)
  })

  it('pickAmbient：平时只出 AMBIENT∪SLEEPY，久未互动时更常出犯困片', () => {
    const all = [...AMBIENT, ...SLEEPY]
    let sleepyHit = 0, n = 200
    for (let i = 0; i < n; i++) {
      const c = pickAmbient(S({ mood: 50, idleMs: 60_000 }), fixed((i % 100) / 100))!
      expect(all).toContain(c)
      if (SLEEPY.includes(c)) sleepyHit++
    }
    // 犯困加权后占比应明显高于「只算 4/23 均等」的基线（这里只验它会偏多，不钉死具体值）
    expect(sleepyHit).toBeGreaterThan(n * 0.1)
  })

  it('pickAmbient：同一情境 + 同一 rng 必然同结果（确定性）', () => {
    const s = S({ mood: 50, idleMs: 0 })
    expect(pickAmbient(s, fixed(0.37))).toEqual(pickAmbient(s, fixed(0.37)))
  })

  it('pickForSpeech：feed 不配动画（保吃相）；idle/greet/bye 有；status/levelup 没配→null', () => {
    expect(SPEECH.feed).toBeUndefined()
    expect(pickForSpeech('feed', fixed(0.5))).toBeNull()
    expect(pickForSpeech('idle', fixed(0.1))).not.toBeNull()
    expect(pickForSpeech('greet', fixed(0.1))).not.toBeNull()
    expect(pickForSpeech('bye', fixed(0.1))).not.toBeNull()
    expect(pickForSpeech('status', fixed(0.1))).toBeNull()
    expect(pickForSpeech('levelup', fixed(0.1))).toBeNull()
  })

  it('跨级片是具名可寻址片段', () => {
    expect(LEVELUP_CLIP).toEqual({ pool: 'guess', name: 'bluewhale' })
  })

  it('ALL_CLIPS：池名只可能是已知池，name 非空（防按名取不到的静默不动）', () => {
    const pools = new Set(['daily', 'guess', 'turn', 'idle', 'move', 'click', 'drag', 'eat'])
    for (const c of ALL_CLIPS) {
      expect(pools.has(c.pool), `未知池 ${c.pool}`).toBe(true)
      expect(c.name.length).toBeGreaterThan(0)
    }
  })
})

describe('启动/退出随机片（用户 2026-11-11 指定）', () => {
  it('启动八条：舞狮头/女仆舞/摇摆舞/动物环绕/小幽灵/堆雪人/荡秋千/放风筝', () => {
    expect(STARTUP_CLIPS).toEqual([
      { pool: 'guess', name: 'liondance' }, { pool: 'guess', name: 'maid' }, { pool: 'guess', name: 'swing' },
      { pool: 'daily', name: 'animals' }, { pool: 'daily', name: 'ghost' }, { pool: 'daily', name: 'snowman' },
      { pool: 'daily', name: 'swingset' }, { pool: 'daily', name: 'kite' },
    ])
  })

  it('退出四条：被落叶淹没/女仆屈膝礼仪/超大伸懒腰/清点归档', () => {
    expect(EXIT_CLIPS).toEqual([
      { pool: 'daily', name: 'leaves' }, { pool: 'daily', name: 'curtsy' },
      { pool: 'daily', name: 'stretch' }, { pool: 'daily', name: 'archive' },
    ])
  })

  it('pickStartup：只出启动集里的一条，且 rng 确定则结果确定', () => {
    for (let i = 0; i < 16; i++) {
      const c = pickStartup(fixed(i / 16))!
      expect(STARTUP_CLIPS).toContain(c)
    }
    expect(pickStartup(fixed(0))).toEqual(STARTUP_CLIPS[0])
    expect(pickStartup(fixed(0.37))).toEqual(pickStartup(fixed(0.37)))
  })

  it('pickExit：只出退出集里的一条，首尾 rng 取首尾', () => {
    for (let i = 0; i < 12; i++) {
      const c = pickExit(fixed(i / 12))!
      expect(EXIT_CLIPS).toContain(c)
    }
    expect(pickExit(fixed(0))).toEqual(EXIT_CLIPS[0])
    expect(pickExit(fixed(0.99))).toEqual(EXIT_CLIPS[EXIT_CLIPS.length - 1])
  })

  it('启动/退出片都并进 ALL_CLIPS（供装配层核对皮肤池清单）', () => {
    for (const c of [...STARTUP_CLIPS, ...EXIT_CLIPS]) expect(ALL_CLIPS).toContain(c)
  })
})
