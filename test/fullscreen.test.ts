import { describe, it, expect } from 'vitest'
import { mapNotificationState, shouldYieldLine } from '../src/main/fullscreen.js'

/**
 * SHQueryUserNotificationState 的取值：
 * 1 没有全屏占用 / 2 有全屏应用且忽略通知 / 3 有全屏应用且压制通知
 * 4 演示模式 / 5 有闹钟在跑。2..4 才是「别人占着整块屏幕」。
 */
describe('mapNotificationState', () => {
  it('2 全屏应用 / 3 压制通知 / 4 演示模式 → 让路', () => {
    for (const s of [2, 3, 4]) expect(mapNotificationState(s, false), `state=${s}`).toBe(true)
  })

  it('1 空闲与 5 闹钟 → 不让路', () => {
    expect(mapNotificationState(1, false)).toBe(false)
    expect(mapNotificationState(5, false)).toBe(false)
  })

  it('前台就是宠物自己时不让路', () => {
    for (const s of [2, 3, 4]) expect(mapNotificationState(s, true), `state=${s}`).toBe(false)
  })

  it('非法值不让路，不猜', () => {
    for (const s of [0, -1, 99, NaN]) expect(mapNotificationState(s, false), `state=${s}`).toBe(false)
  })
})

describe('shouldYieldLine', () => {
  it('子进程每行输出 1/0', () => {
    expect(shouldYieldLine('1')).toBe(true)
    expect(shouldYieldLine('0')).toBe(false)
  })

  it('空白与垃圾行保持上一次决定，不当成退出信号', () => {
    expect(shouldYieldLine('')).toBeNull()
    expect(shouldYieldLine('  ')).toBeNull()
    expect(shouldYieldLine('True')).toBeNull()
    expect(shouldYieldLine('1 ')).toBeNull()
  })
})
