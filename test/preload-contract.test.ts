import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ALL_CHANNELS, IPC } from '../src/shared/ipc.js'

/**
 * preload 在沙箱里不能 import 业务模块，通道名只能内联字符串。
 * 这条测试就是那道防线：两边一旦跑偏，CI 立刻红，而不是等到鼠标点不动才发现。
 */
describe('preload 与消息表一致', () => {
  const src = readFileSync('src/preload/index.cjs', 'utf8')
  const inlined = [...src.matchAll(/'((?:pet:)[a-z-]+)'/g)].map((m) => m[1]).sort()

  it('preload 用到的每条通道都在消息表里', () => {
    expect(inlined.length).toBeGreaterThan(0)
    for (const ch of inlined) {
      expect(ALL_CHANNELS, `通道 ${ch} 未登记在 src/shared/ipc.ts`).toContain(ch)
    }
  })

  it('消息表里的每条通道都被 preload 暴露（没有只在一侧存在的通道）', () => {
    expect(inlined).toEqual([...ALL_CHANNELS].sort())
  })

  it('通道名唯一且都带 pet: 前缀', () => {
    expect(new Set(Object.values(IPC)).size).toBe(Object.keys(IPC).length)
    for (const ch of Object.values(IPC)) expect(ch.startsWith('pet:')).toBe(true)
  })
})
