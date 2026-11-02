import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // 纯逻辑单测应当秒级完成；超过这个时间说明有人在测试里碰了真实窗口或网络
    testTimeout: 5000,
  },
})
