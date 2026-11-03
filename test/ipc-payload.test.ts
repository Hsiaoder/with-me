import { describe, it, expect } from 'vitest'
import { toBool } from '../src/main/ipc.js'

/**
 * renderer → main 的布尔入参。整屏鼠标能不能被接走、窗口能不能聚焦，
 * 都由这两个值决定，所以畸形消息必须一律算「关」。
 */
describe('toBool', () => {
  it('只有真 true 才算开', () => {
    expect(toBool(true)).toBe(true)
  })

  it('字符串 "false" 不算开——Boolean() 会把它变成 true', () => {
    expect(Boolean('false')).toBe(true)      // 反面教材：这就是原来那行的行为
    expect(toBool('false')).toBe(false)
  })

  it('其余非布尔一律算关', () => {
    for (const v of [1, -1, [], {}, 'true', null, undefined, 0, '']) {
      expect(toBool(v)).toBe(false)
    }
  })
})
