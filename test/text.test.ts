import { describe, expect, it } from 'vitest'
import { fitsLabel, formatOnline } from '../src/shared/text.js'

/**
 * 「在线时间」那一句。状态栏按秒跳，跳的就是这个函数的输出，所以边界都得钉住。
 *
 * 显示规则是「最多两档」：`3天2小时5分30秒` 在 150px 的卡上放不下，
 * 而且第三档往后没有信息量。秒只在还没满一分钟时露脸——那是用户刚启动、
 * 想确认「它真的在跑」的时候。
 */
describe('formatOnline', () => {
  it('一分钟以内只报秒', () => {
    expect(formatOnline(0)).toBe('0秒')
    expect(formatOnline(999)).toBe('0秒')
    expect(formatOnline(5_000)).toBe('5秒')
    expect(formatOnline(59_999)).toBe('59秒')
  })

  it('满了分钟就报「分秒」，秒跟着跳——这是最常看到的一档', () => {
    expect(formatOnline(60_000)).toBe('1分0秒')
    expect(formatOnline(125_000)).toBe('2分5秒')
    expect(formatOnline(3_599_000)).toBe('59分59秒')
  })

  it('进了小时就换档：分钟当第二档，秒不再占地方', () => {
    expect(formatOnline(3_600_000)).toBe('1小时0分')
    expect(formatOnline(7_500_000)).toBe('2小时5分')
  })

  it('过夜了报「天小时」，不到整天的小时不丢', () => {
    expect(formatOnline(86_400_000)).toBe('1天0小时')
    expect(formatOnline(86_400_000 + 2 * 3_600_000)).toBe('1天2小时')
  })

  it('负数按时钟回拨处理，不写出「-5秒」', () => {
    expect(formatOnline(-5_000)).toBe('0秒')
  })

  it('每一档都放得下状态栏的值栏', () => {
    // 上限不是拍的，是从 style.css 那几个数算出来的：
    // 卡宽 150 − 内边距 6×2 − 描边 1×2 − 标签「在线时间」48 − 标签与值之间 4 = 84px，
    // 字号 12px → 84/12 = 7 个汉字宽。超过就会把右列顶歪（值栏是所有行对齐的那一栏）。
    const VALUE_MAX = (150 - 6 * 2 - 1 * 2 - 48 - 4) / 12
    for (const ms of [59_999, 3_599_000, 86_399_000, 86_400_000 * 40]) {
      const text = formatOnline(ms)
      expect(fitsLabel(text, VALUE_MAX), `${text} 顶爆值栏`).toBe(true)
    }
  })
})
