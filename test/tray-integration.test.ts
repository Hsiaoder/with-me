import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSettingsHub, createTrayExit, TRAY_EXIT_FALLBACK_MS } from '../src/main/tray-integration.js'
import type { Settings } from '../src/shared/visibility.js'

afterEach(() => { vi.useRealTimers() })

describe('createSettingsHub', () => {
  it('一次 patch 只改请求的那项，并按固定顺序同步、落盘、广播、刷菜单', () => {
    let current: Settings = { onFullscreen: 'show', developerMode: false, muted: false }
    const calls: string[] = []
    const update = createSettingsHub({
      applySettings: (patch) => {
        calls.push('apply')
        current = { ...current, ...patch }
        return current
      },
      setVisibility: (s) => { calls.push(`visibility:${s.muted}`) },
      persist: () => { calls.push('persist') },
      broadcast: (s) => { calls.push(`broadcast:${s.muted}`) },
      refreshTray: () => { calls.push('tray') },
    })

    update({ muted: true })

    expect(current).toEqual({ onFullscreen: 'show', developerMode: false, muted: true })
    expect(calls).toEqual(['apply', 'visibility:true', 'persist', 'broadcast:true', 'tray'])
  })
})

describe('createTrayExit', () => {
  const harness = () => {
    const order: string[] = []
    const handles: unknown[] = []
    const exit = createTrayExit({
      reveal: () => { order.push('reveal') },
      sendQuitRequested: () => { order.push('send') },
      scheduleFallback: (run, ms) => {
        order.push(`timer:${ms}`)
        const h = setTimeout(run, ms)
        handles.push(h)
        return h
      },
      cancelFallback: (h) => { order.push('cancel'); clearTimeout(h as ReturnType<typeof setTimeout>) },
      quit: () => { order.push('quit') },
    })
    return { exit, order, handles }
  }

  it('先亮出宠物、再发请求、最后起 12 秒兜底', () => {
    vi.useFakeTimers()
    const { exit, order } = harness()

    exit.request()

    expect(order).toEqual(['reveal', 'send', `timer:${TRAY_EXIT_FALLBACK_MS}`])
  })

  it('重复点退出不会再发请求，也不会叠定时器', () => {
    vi.useFakeTimers()
    const { exit, order } = harness()

    exit.request()
    exit.request()

    expect(order).toEqual(['reveal', 'send', `timer:${TRAY_EXIT_FALLBACK_MS}`])
  })

  it('渲染层一直没回应时兜底会退出', () => {
    vi.useFakeTimers()
    const { exit, order } = harness()

    exit.request()
    vi.advanceTimersByTime(TRAY_EXIT_FALLBACK_MS - 1)
    expect(order).not.toContain('quit')
    vi.advanceTimersByTime(1)
    expect(order).toContain('quit')
  })

  it('正常退出时 cancel 会清掉兜底', () => {
    vi.useFakeTimers()
    const { exit, order } = harness()

    exit.request()
    exit.cancel()
    vi.advanceTimersByTime(TRAY_EXIT_FALLBACK_MS)

    expect(order).toContain('cancel')
    expect(order).not.toContain('quit')
  })
})
