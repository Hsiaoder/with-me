import { createLease, type Lease } from '../shared/lease.js'
import { LEASE_TIMEOUT_MS } from '../shared/config.js'
import type { Platform } from './platform.js'

export interface ClickThroughBridge {
  /** 渲染层的每次请求都过一次状态机，再由平台层执行。@returns 是否发生了状态变化 */
  request(grab: boolean): boolean
  /** 主进程侧周期性调用：租约断了就无条件恢复穿透，这是整块屏幕点不动的唯一兜底。 */
  sweep(): void
  state: Lease
}

/**
 * @param now 取当前毫秒的函数，由调用方注入，测试里才能不靠真实时间推进
 */
export function createClickThroughBridge(platform: Platform, now: () => number): ClickThroughBridge {
  const lease = createLease({ timeoutMs: LEASE_TIMEOUT_MS, now })
  const apply = (): void => platform.setInteractive(lease.interactive)
  return {
    request(grab) {
      const changed = lease.tick(grab)
      if (changed) apply()
      return changed
    },
    sweep() {
      if (lease.sweep()) apply()
    },
    state: lease,
  }
}
