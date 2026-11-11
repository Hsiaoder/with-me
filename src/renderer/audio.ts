/**
 * 台词语音：按**台词原文**查 manifest 拿到 mp3，用 `Audio` 播。
 *
 * 为什么按文本而不是按 reason/index 寻址：装配层 `say()` 拿到的就是一句干净文本，
 * 台词表保证每句唯一（`TALK_FLOW` 不去重就会撞），按文本查最省接线——不用把全局序号
 * 一路递到每个触发点。查不到（比如调试板临时塞的句子）就安静不播，气泡照旧。
 *
 * 静音是**全项目**的开关，由装配层把 `settings.muted` 用闭包递进来：这里每次 play 都现问，
 * 所以用户在设置里勾掉静音后，下一句立刻生效，不必重建播放器。
 */

export type VoiceEntry = { text: string; file: string }

export interface VoicePlayer {
  /** 播这句的语音；静音或查无此句返回 null。返回的 `Audio` 供装配层量时长、等播完。 */
  play(text: string): HTMLAudioElement | null
  /** 立刻掐掉当前这句（换气泡、退出收尾时用）。 */
  stop(): void
}

export function createVoicePlayer(
  entries: readonly VoiceEntry[],
  isMuted: () => boolean,
  urlBase = '',
): VoicePlayer {
  const byText = new Map(entries.map((e) => [e.text, e.file]))
  let current: HTMLAudioElement | null = null

  return {
    play(text) {
      if (isMuted()) return null
      const file = byText.get(text)
      if (!file) return null
      current?.pause()
      const a = new Audio(urlBase + file)
      current = a
      // jsdom 的 play() 返回 undefined，真浏览器返回 Promise； autoplay 被拒也不该炸装配层。
      const p = a.play() as Promise<void> | undefined
      if (p && typeof p.catch === 'function') p.catch(() => {})
      return a
    },
    stop() {
      current?.pause()
      current = null
    },
  }
}