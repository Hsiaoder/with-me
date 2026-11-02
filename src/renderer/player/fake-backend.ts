import type { ClipPlayer, ClipRef, PlayResult } from './clip-player.js'

/**
 * 测试替身：play 不自动结束，由 advance() 模拟播完、cancel() 模拟被打断。
 * 这样「四铁律」里跟时序有关的部分能在纯 Node 环境里被钉住，不用起浏览器。
 *
 * 不区分 once 与否：两种都要等 advance 或 cancel，这正是把时序交给测试的手法。
 */
export type FakePlayer = ClipPlayer & {
  /** 模拟当前这条播完。 */
  advance(): void
  readonly calls: ClipRef[]
  readonly prepared: ClipRef[]
}

export function createFakePlayer(): FakePlayer {
  let current: ClipRef | null = null
  let generation = 0
  let pending: ((r: PlayResult) => void) | null = null
  const calls: ClipRef[] = []
  const prepared: ClipRef[] = []

  const isSame = (a: ClipRef | null, b: ClipRef) => !!a && a.pool === b.pool && a.name === b.name
  const settle = (r: PlayResult): void => {
    const done = pending
    pending = null
    done?.(r)
  }

  return {
    calls,
    prepared,
    get current() {
      return current
    },
    get generation() {
      return generation
    },
    prepare(ref) {
      // 契约要求重复 prepare 无副作用，所以这里去重，而不是照单全记
      if (isSame(prepared.at(-1) ?? null, ref)) return
      prepared.push(ref)
    },
    play(ref) {
      generation++
      current = ref
      calls.push(ref)
      settle('cancelled')   // 上一次未结束的播放作废
      return new Promise<PlayResult>((resolve) => {
        pending = resolve
      })
    },
    advance() {
      settle('ended')
    },
    cancel() {
      generation++
      settle('cancelled')
    },
    destroy() {
      generation++
      settle('cancelled')
      current = null
    },
  }
}
