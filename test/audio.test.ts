// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createVoicePlayer, voiceBubbleMs, type VoiceEntry } from '../src/renderer/audio.js'

/**
 * 语音播放器的契约。jsdom 没有真正的音频解码，所以用一颗假 `Audio` 记下 src 与 play/pause
 * 次数；「到底响不响、时长多少」由 e2e 在 Chromium 里验，这里只钉寻址与静音门控。
 */

const instances: FakeAudio[] = []
class FakeAudio {
  src: string
  played = 0
  paused = 0
  constructor(src: string) {
    this.src = src
    instances.push(this)
  }
  play(): Promise<void> {
    this.played++
    return Promise.resolve()
  }
  pause(): void {
    this.paused++
  }
}

const ENTRIES: VoiceEntry[] = [
  { text: '今天也想玩', file: 'voice/line-001.mp3' },
  { text: '主人，回来啦', file: 'voice/line-002.mp3' },
]

beforeEach(() => {
  instances.length = 0
  vi.stubGlobal('Audio', FakeAudio)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('语音播放器', () => {
  it('不静音且认得这句：返回 Audio，src 是 base+file，play 一次', () => {
    const p = createVoicePlayer(ENTRIES, () => false)
    const a = p.play('今天也想玩') as unknown as FakeAudio
    expect(a).toBeInstanceOf(FakeAudio)
    expect(a.src).toBe('voice/line-001.mp3')
    expect(a.played).toBe(1)
  })

  it('urlBase 拼在 file 前面', () => {
    const p = createVoicePlayer(ENTRIES, () => false, 'app://assets/renderer/')
    const a = p.play('主人，回来啦') as unknown as FakeAudio
    expect(a.src).toBe('app://assets/renderer/voice/line-002.mp3')
  })

  it('静音时不播：返回 null，一颗 Audio 都不造', () => {
    const p = createVoicePlayer(ENTRIES, () => true)
    expect(p.play('今天也想玩')).toBeNull()
    expect(instances.length).toBe(0)
  })

  it('查无此句安静不播：返回 null', () => {
    const p = createVoicePlayer(ENTRIES, () => false)
    expect(p.play('调试板临时塞的句子')).toBeNull()
    expect(instances.length).toBe(0)
  })

  it('静音是现问的：勾掉之后下一句立刻不播', () => {
    let muted = false
    const p = createVoicePlayer(ENTRIES, () => muted)
    expect(p.play('今天也想玩')).not.toBeNull()
    muted = true
    expect(p.play('主人，回来啦')).toBeNull()
    expect(instances.length).toBe(1)
  })

  it('播下一句先掐掉上一句', () => {
    const p = createVoicePlayer(ENTRIES, () => false)
    const first = p.play('今天也想玩') as unknown as FakeAudio
    p.play('主人，回来啦')
    expect(first.paused).toBe(1)
    expect(instances.length).toBe(2)
  })

  it('stop 掐掉当前这句；再 stop 不重复 pause', () => {
    const p = createVoicePlayer(ENTRIES, () => false)
    const a = p.play('今天也想玩') as unknown as FakeAudio
    p.stop()
    expect(a.paused).toBe(1)
    p.stop()
    expect(a.paused).toBe(1)
  })
})

describe('气泡停留时长（voiceBubbleMs）', () => {
  it('有时长：语音 + 1 秒', () => {
    expect(voiceBubbleMs(3, 5000)).toBe(4000)
  })

  it('再短也不短于 2.5 秒', () => {
    expect(voiceBubbleMs(0.5, 5000)).toBe(2500)
    expect(voiceBubbleMs(1, 5000)).toBe(2500)
  })

  it('量不到时长就用默认值：NaN / Infinity / 0 / 负数', () => {
    for (const d of [NaN, Infinity, 0, -1]) {
      expect(voiceBubbleMs(d, 5000)).toBe(5000)
    }
  })
})