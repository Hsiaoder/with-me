import { describe, it, expect } from 'vitest'
import { FLY, launchFlight, readout, stepFlight, throwVelocity } from '../src/shared/game.js'

const HOME = 800
const PET_H = 124

describe('鲸鲸会飞 · 纯物理', () => {
  it('throwVelocity：拖太慢不算抛，够快才给初速（×POWER 并夹上限）', () => {
    expect(throwVelocity(-100)).toBeNull()                       // 合速不到 MIN
    expect(throwVelocity(0)).toBeNull()
    expect(throwVelocity(-FLY.MIN / FLY.POWER)).toBeCloseTo(-FLY.MIN, 6)  // 刚好过线（向上）
    // 超过「上限对应的原始速」才该被夹：raw×POWER 越过 THROW_CAP 才封顶，用常量推、别写死 5000。
    const overCap = FLY.THROW_CAP / FLY.POWER + 500
    expect(throwVelocity(-overCap)).toBe(-FLY.THROW_CAP)           // 向上猛抛，夹到上限
    // 向下甩不算真抛（否则往下抛会进 flight 又立刻落地，白记一次有效飞行 + 奖励）。
    expect(throwVelocity(overCap)).toBeNull()                     // 往下快甩 → null
    expect(throwVelocity(FLY.MIN / FLY.POWER)).toBeNull()          // 往下刚好线 → 仍 null
  })

  it('一次上抛：先减速到顶点，再加速下落，回到 homeY 判落地', () => {
    const f = launchFlight(-1200, HOME)
    let landed = false
    let steps = 0
    for (; steps < 2000 && !landed; steps++) {
      const r = stepFlight(f, 1 / 60, HOME, PET_H)
      landed = r.landed
    }
    expect(landed, '始终没落地').toBe(true)
    expect(f.minY).toBeLessThan(HOME)                            // 真的升上去过
    expect(f.maxM).toBeGreaterThan(0)
    // 顶点速度≈0 之后才转下落：最高点应在起点上方
    expect(f.y).toBeGreaterThanOrEqual(HOME - 1)                 // 落地回到地面附近
  })

  it('飞出屏幕顶：hidden 为真但飞行继续算，高度值还能往上加（不反弹、不卡住）', () => {
    const f = launchFlight(-FLY.THROW_CAP, HOME)                 // 猛抛，肯定出顶
    let sawHidden = false
    let minY = f.minY
    for (let i = 0; i < 400; i++) {
      const r = stepFlight(f, 1 / 60, HOME, PET_H)
      if (r.hidden) sawHidden = true
      if (r.landed) break
      minY = Math.min(minY, f.y)
    }
    expect(sawHidden, '猛抛却没触发飞出顶的 hidden').toBe(true)
    expect(minY).toBeLessThan(0 - PET_H)                         // 真的算到屏幕顶以上去了
    expect(readout(f, HOME).maxM).toBeGreaterThan((HOME) / FLY.PX_PER_M)
  })

  it('下落封顶：vy 不会超过 FALL_CAP（慢落，非自由落体）', () => {
    const f = launchFlight(-300, HOME)
    for (let i = 0; i < 600; i++) {
      stepFlight(f, 1 / 60, HOME, PET_H)
      if (f.vy > 0) expect(f.vy).toBeLessThanOrEqual(FLY.FALL_CAP + 1)
      if (f.y >= HOME && f.vy > 0) break
    }
  })

  it('readout：实时高度按当前 y 算（飞出顶也继续加），速度向上为正', () => {
    const f = launchFlight(-1000, HOME)
    f.y = HOME - 400                                             // 在 400px 高
    const r = readout(f, HOME)
    expect(r.heightM).toBeCloseTo(400 / FLY.PX_PER_M, 6)
    expect(r.speedMps).toBeGreaterThan(0)                        // 还在上升（vy<0）
  })

  /**
   * 用户的真实诉求：甩得越快飞得越高，不能「怎么甩都一个数」。
   * 以前上限 1600 太低，快甩全顶格 → 高度全钉在 ~64m。抬到 3200 后，几个没顶格的初速应给出
   * 明显拉开、且单调递增的高度。这里直接量「几个不同初速各自能飞多高」。
   */
  it('不同初速飞出不同高度：越快越高（没顶到上限时不能被夹成同一个数）', () => {
    const peakMeters = (v: number): number => {
      const f = launchFlight(v, HOME)
      for (let i = 0; i < 2000; i++) {
        const r = stepFlight(f, 1 / 60, HOME, PET_H)
        if (r.landed) break
      }
      return f.maxM
    }
    const slow = peakMeters(-FLY.THROW_CAP * 0.3)
    const mid = peakMeters(-FLY.THROW_CAP * 0.6)
    const fast = peakMeters(-FLY.THROW_CAP * 0.95)
    expect(mid, '中速该比慢速高').toBeGreaterThan(slow * 1.5)
    expect(fast, '快速该比中速高').toBeGreaterThan(mid * 1.5)
  })

  it('readout：落地那一下冲过地面也不闪负数（用户看到的 -1 就是这个）', () => {
    const f = launchFlight(-300, HOME)
    f.y = HOME + 30                                              // 一步冲过 homeY 几像素
    expect(readout(f, HOME).heightM).toBe(0)
  })

  /**
   * 质量模型（用户 2026-11-08 要）：同一份甩速，体重越重 → 初速越小 → 飞得越低。
   * 关键是「固定能量」而非「固定速度」——否则 `h=v²/2g` 里质量约掉，胖瘦抛一样高。
   */
  it('体重进初速：越重越慢、飞得越低（按 √(M_REF/m) 缩放）', () => {
    const raw = -2000                                            // 同一次快甩（选它让最瘦那档也别顶到上限）
    const light = throwVelocity(raw, 20)!
    const ref = throwVelocity(raw, FLY.M_REF)!
    const heavy = throwVelocity(raw, 80)!
    expect(Math.abs(light)).toBeGreaterThan(Math.abs(ref))
    expect(Math.abs(ref)).toBeGreaterThan(Math.abs(heavy))
    expect(Math.abs(light) / Math.abs(ref)).toBeCloseTo(Math.sqrt(FLY.M_REF / 20), 6)
    const peak = (v: number): number => {
      const f = launchFlight(v, HOME)
      for (let i = 0; i < 3000; i++) { if (stepFlight(f, 1 / 60, HOME, PET_H).landed) break }
      return f.maxM
    }
    expect(peak(light), '瘦的该比胖的飞得高').toBeGreaterThan(peak(heavy))
  })

  it('体重喂到很低时用 M_MIN 兜底 + 上限夹住，不会炸到无穷高', () => {
    const v = throwVelocity(-6000, 0)                            // 体重 0
    expect(v).not.toBeNull()
    expect(Math.abs(v!)).toBeLessThanOrEqual(FLY.THROW_CAP)
  })

  /**
   * 用户 2026-11-08 拍板：高度只算「这一抛」离松手点多高，拖到屏幕顶再甩不该白送十几米。
   * 同一个初速，从地面松手 和 从半空（模拟拖到顶）松手，`最高` 必须一样——成绩只反映甩得多猛。
   */
  it('高度按松手点算：拖到高处再甩，不会把拖拽抬升也算进成绩', () => {
    const peak = (v: number, startY: number): number => {
      const f = launchFlight(v, startY)
      for (let i = 0; i < 3000; i++) { if (stepFlight(f, 1 / 60, HOME, PET_H).landed) break }
      return f.maxM
    }
    const fromGround = peak(-1500, HOME)
    const fromHigh = peak(-1500, HOME - 500)                     // 先拖高 500px 再同样力度甩
    expect(fromHigh).toBeCloseTo(fromGround, 6)                  // 一样高：拖拽抬升不计
  })

  it('屏外快落：还在屏幕顶外时下落能超过 FALL_CAP，露进屏幕就夹回轻柔下落', () => {
    // 整块在屏外（y+petH<0）正在下落：用大重力+高上限，vy 应能超过屏内上限 FALL_CAP。
    const off = { y: -5000, vy: 3000, minY: -5000, startY: 0, maxM: 0 }
    stepFlight(off, 1 / 60, HOME, PET_H)
    expect(off.vy).toBeGreaterThan(FLY.FALL_CAP)
    expect(off.vy).toBeLessThanOrEqual(FLY.FALL_CAP_OFF)
    // 已露进屏幕（y+petH>=0）正在下落：立刻夹回 FALL_CAP，轻柔落地。
    const on = { y: 100, vy: 4000, minY: -5000, startY: 0, maxM: 0 }
    stepFlight(on, 1 / 60, HOME, PET_H)
    expect(on.vy).toBeLessThanOrEqual(FLY.FALL_CAP)
  })
})
