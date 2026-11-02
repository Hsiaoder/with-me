/**
 * 「播一段动画」的抽象。业务只说播哪个池的哪条，不知道底下是 video、图片序列还是别的。
 * 设计文档第 7 节。四条铁律由 test/clip-player.test.ts 与后端实现共同守住。
 */

export type ClipRef = { pool: string; name: string }
export type PlayResult = 'ended' | 'cancelled'

export interface ClipPlayer {
  /** 提前把素材加载到能立刻显示。重复 prepare 同一个 ref 不许有副作用。 */
  prepare(ref: ClipRef): void
  /**
   * 播这条动画。
   * @param opts.once true = 播完 resolve('ended')；false/缺省 = 循环，直到被 cancel
   */
  play(ref: ClipRef, opts?: { once?: boolean }): Promise<PlayResult>
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
