/**
 * 鼠标穿透租约。渲染层每次想要鼠标就 renew 一次；超过 timeoutMs 没 renew
 * 就视为渲染层卡死，主进程无条件把穿透放开。少了这条兜底，一次逻辑卡死
 * 就是整块屏幕鼠标失灵。
 */

export type LeaseOptions = { timeoutMs: number; now: () => number }

export interface Lease {
  /** true = 接住鼠标（穿透关闭） */
  readonly interactive: boolean
  /** @returns true 表示状态变了，调用方要把它执行到真实窗口上 */
  tick(want: boolean): boolean
  /** @returns true 表示超时释放发生了状态变化 */
  sweep(): boolean
}

export function createLease(opts: LeaseOptions): Lease {
  let held = false
  let lastRenew = 0
  return {
    get interactive() {
      return held
    },
    tick(want: boolean) {
      const before = held
      if (want) {
        held = true
        lastRenew = opts.now()
      } else {
        held = false
      }
      return held !== before
    },
    sweep() {
      const before = held
      if (held && opts.now() - lastRenew > opts.timeoutMs) held = false
      return held !== before
    },
  }
}
