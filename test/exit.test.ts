import { describe, expect, it, vi } from 'vitest'
import { createExitSequencer } from '../src/renderer/exit.js'

describe('退出序列', () => {
  it('重复请求只启动一次收尾', () => {
    const start = vi.fn()
    const request = createExitSequencer(start)

    request()
    request()
    request()

    expect(start).toHaveBeenCalledOnce()
  })

  it('第一次请求会立刻启动收尾', () => {
    const start = vi.fn()
    createExitSequencer(start)()
    expect(start).toHaveBeenCalledOnce()
  })
})
