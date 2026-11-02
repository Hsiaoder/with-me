/**
 * 「播一段动画」的抽象。业务只说播哪个池的哪条，不知道底下是 video、图片序列还是别的。
 * 设计文档第 7 节。四条铁律由 test/clip-player.test.ts 与后端实现共同守住。
 *
 * ClipRef 用 shared/types.ts 那一份：行为层（shared）和播放器（renderer）都要引用它，
 * 定义两份迟早分叉，而且 shared 反过来 import renderer 会破坏分层方向。
 */
import type { ClipRef } from '../../shared/types.js'

export type PlayResult = 'ended' | 'cancelled'

export interface ClipPlayer {
  /** 提前把素材加载到能立刻显示。重复 prepare 同一个 ref 不许有副作用。 */
  prepare(ref: ClipRef): void
  /**
   * 播这条动画，从头到尾。
   *
   * **播放器没有「循环」这个概念**：spike 实测 `<video loop>` 每次回到起点都要重新缓冲
   * （70 秒 17 次），所以这里永不设置 `video.loop`。要不要重复播同一条是**行为层**的决定
   * ——它决定后再调一次 play()，而不是让 video 自己绕回去。
   */
  play(ref: ClipRef): Promise<PlayResult>
  /** 作废进行中的 play，使其 resolve('cancelled')。 */
  cancel(): void
  /**
   * 最近一次 play 的 ref。播完或被 cancel 都**不**清空——行为层靠它排除「刚播过那条」，
   * 清空会让待机池连着重复两次。只有 destroy 会清。
   */
  readonly current: ClipRef | null
  /** 每次 play / cancel 递增。后端所有异步回调必须先核对它，过期就丢弃。 */
  readonly generation: number
  destroy(): void
}

export function sameClip(a: ClipRef | null, b: ClipRef): boolean {
  return !!a && a.pool === b.pool && a.name === b.name
}
