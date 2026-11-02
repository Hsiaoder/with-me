import { describe, it, expect } from 'vitest'
import { createLease } from '../src/shared/lease.js'
import { LEASE_TIMEOUT_MS } from '../src/shared/config.js'

/**
 * 租约是「整块屏幕点不动」的唯一兜底：渲染层一旦卡死不再续期，
 * 主进程必须自己把穿透放开。这几条测试钉的就是这条保命路径。
 */
function lease(timeoutMs = LEASE_TIMEOUT_MS) {
  let t = 0
  return { l: createLease({ timeoutMs, now: () => t }), set: (v: number) => { t = v } }
}

describe('穿透租约', () => {
  it('want=true 进入接住状态，重复续期不改变状态', () => {
    const { l, set } = lease()
    set(0)
    expect(l.tick(true)).toBe(true)
    expect(l.interactive).toBe(true)
    set(100)
    expect(l.tick(true)).toBe(false)
    expect(l.interactive).toBe(true)
  })

  it('want=false 立刻放开', () => {
    const { l } = lease()
    l.tick(true)
    expect(l.tick(false)).toBe(true)
    expect(l.interactive).toBe(false)
  })

  it('渲染层卡死不再续期，超过 timeout 由 sweep 强制放开', () => {
    const { l, set } = lease()
    l.tick(true)
    set(LEASE_TIMEOUT_MS - 100)
    expect(l.sweep()).toBe(false)
    set(LEASE_TIMEOUT_MS + 1)
    expect(l.sweep()).toBe(true)
    expect(l.interactive).toBe(false)
  })

  it('持续续期会让租约一直有效', () => {
    const { l, set } = lease()
    l.tick(true)
    for (const t of [100, 200, 300, 400, 450]) {
      set(t)
      expect(l.tick(true)).toBe(false)
      expect(l.sweep()).toBe(false)
      expect(l.interactive).toBe(true)
    }
  })

  it('超时后再来请求可以重新接住', () => {
    const { l, set } = lease()
    l.tick(true)
    set(LEASE_TIMEOUT_MS + 100)
    l.sweep()
    expect(l.tick(true)).toBe(true)
    expect(l.interactive).toBe(true)
  })

  it('没接住鼠标时 sweep 什么都不做', () => {
    const { l, set } = lease()
    set(9999)
    expect(l.sweep()).toBe(false)
    expect(l.interactive).toBe(false)
  })
})
