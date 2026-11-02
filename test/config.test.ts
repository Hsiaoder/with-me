import { describe, it, expect } from 'vitest'
import {
  CANVAS_W, CANVAS_H, FEET_Y, STAGE_W_CSS, STAGE_H_CSS,
  DEFAULT_BODY_BOX, REQUIRED_POOLS, HOVER_DWELL_MS, HOVER_RELEASE_MS, LEASE_TIMEOUT_MS,
  GRAB_HEARTBEAT_MS,
} from '../src/shared/config.js'

describe('素材合同', () => {
  it('画布是 16:9', () => {
    expect(CANVAS_W / CANVAS_H).toBeCloseTo(16 / 9, 6)
  })
  it('舞台高度由宽度按 16:9 推导，不是第二个写死的数字', () => {
    expect(STAGE_H_CSS).toBeCloseTo((STAGE_W_CSS * 9) / 16, 6)
  })
  it('脚底基准线在画布内，且给底部留出落地余量', () => {
    expect(FEET_Y).toBeGreaterThan(0)
    expect(FEET_Y).toBeLessThan(CANVAS_H)
    expect(CANVAS_H - FEET_Y).toBeLessThan(CANVAS_H * 0.2)
  })
  it('默认身体框不越界', () => {
    expect(DEFAULT_BODY_BOX.x + DEFAULT_BODY_BOX.w).toBeLessThanOrEqual(CANVAS_W)
    expect(DEFAULT_BODY_BOX.y + DEFAULT_BODY_BOX.h).toBeLessThanOrEqual(CANVAS_H)
  })
})

describe('悬停与租约的时间关系', () => {
  it('租约超时必须大于光标间隔，否则正常续期也会被误判成卡死', () => {
    expect(LEASE_TIMEOUT_MS).toBeGreaterThan(33)
    // 心跳必须明显早于超时，否则手停在面板上不动时租约会先过期、鼠标被放开给桌面
    expect(GRAB_HEARTBEAT_MS).toBeLessThan(LEASE_TIMEOUT_MS)
    expect(LEASE_TIMEOUT_MS - GRAB_HEARTBEAT_MS).toBeGreaterThanOrEqual(GRAB_HEARTBEAT_MS)
  })
  it('停留与释放的窗口同量级，但都不小于 2 个光标间隔', () => {
    expect(HOVER_DWELL_MS).toBeGreaterThan(33 * 2)
    expect(HOVER_RELEASE_MS).toBeGreaterThan(33 * 2)
  })
})

describe('皮肤必需池', () => {
  it('面板按钮覆盖的池都在必需池里（点了要有动画可播）', () => {
    for (const pool of ['idle', 'move', 'turn', 'click', 'drag']) {
      expect(REQUIRED_POOLS).toContain(pool)
    }
  })
})
