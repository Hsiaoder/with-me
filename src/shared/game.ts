/**
 * 「鲸鲸会飞」的纯物理。零 import（e2e 与探针直接 import shared 里的东西，Node 的类型剥离
 * 不会把 `./x.js` 指回 `.ts`——见 config.ts 顶部那条约束）。
 *
 * 参数照 qqpet 丢丢乐（读思路不搬代码，它是 GPL-3.0）：拖拽末速 ×POWER 当初速，
 * 合速不到 MIN 不算真抛；G=500 的飘重力；下落封顶 FALL_CAP（慢落，非自由落体）。
 * 玩法差异：qqpet 是四边反弹，我们是**抛到顶边消失**——飞出屏幕顶不反弹、继续算，
 * 高度实时值一路加，落回来才显示、才算落地。
 */

export const FLY = {
  // 重力调大（500→800）：配合下面的高上限，让猛抛也别在天上飘太久（空气时间 ≈ 2v/G）。
  G: 800,
  // 拖拽末速 → 初速的系数。0.6 而不是 0.8：把常见甩速落到「没顶到上限」的中段，甩多快都能看出来。
  POWER: 0.6,
  MIN: 280,
  // 上限从 1600 提到 3200：以前几乎每次快甩都顶到 1600，`v²/2G` 就把高度钉死在 ~70–85m——
  // 「怎么甩都一样高」就是这么来的。抬到 3200 后，快慢甩分别落在 ~20m 到 ~160m，能拉开。
  THROW_CAP: 3200,
  FALL_CAP: 900,
  /**
   * 屏外快落（用户 2026-11-08 嫌「等它掉回屏幕里太久」）：宠物整块还在屏幕顶外时，用更大的重力 +
   * 更高的下落上限，让它赶紧回到视野；一旦露进屏幕就切回 G/FALL_CAP 慢慢落。屏外那截路最长，
   * 若也按 900 封顶，从几千米外掉回来要等好几秒——把这段提速，进屏后依旧轻柔。
   */
  G_OFF: 3000,
  FALL_CAP_OFF: 4500,
  PX_PER_M: 40,
  /**
   * 质量模型（用户 2026-11-08 要「按动能算、质量=体重」）。关键：只测甩速然后 `h=v²/2g` 的话，
   * 质量会在 `½mv² = mgh` 里**约掉**，胖瘦抛一样高——体重就没意义了。要让它有意义，必须把这一甩
   * 当成给了宠物一份**固定的能量**（做功），而不是固定的速度：`v=√(2E/m)`、`h=E/(m·g)`，越重飞得越低。
   * `M_REF` 是标定用的参考体重：体重=它时初速就等于「按甩速算出来的值」（即今天这套手感数字）。
   * `M_MIN` 兜底：体重被喂到很低时别让 `√(M_REF/m)` 炸到无穷（上限也再拦一层）。
   */
  M_REF: 50,
  M_MIN: 5,
} as const

export type Flight = { y: number; vy: number; minY: number; startY: number; maxM: number }

/**
 * 松手那一刻的初速。把甩速 `vyRaw`（px/s，向上为负）先 ×POWER 折成「参考体重下的初速」，再按真实
 * 质量换算：一份固定能量喂给质量 m 的宠物，`v = 参考速 × √(M_REF/m)`——越重越慢、飞得越低。
 * 合速不到 MIN 返回 null（不算真抛）。`mass` 省略时按参考体重（= 不改变旧行为）。
 */
export function throwVelocity(vyRaw: number, mass: number = FLY.M_REF): number | null {
  const m = Math.max(FLY.M_MIN, mass)
  const scaled = vyRaw * FLY.POWER * Math.sqrt(FLY.M_REF / m)
  const v = Math.max(-FLY.THROW_CAP, Math.min(FLY.THROW_CAP, scaled))
  return Math.abs(v) < FLY.MIN ? null : v
}

export function launchFlight(vy0: number, startY: number): Flight {
  return { y: startY, vy: vy0, minY: startY, startY, maxM: 0 }
}

/**
 * 走一小步（dt 秒）。返回这一帧的两件事：精灵该不该藏（飞出顶）、落没落地（回到 homeY 且在下降）。
 * 直接改 f（f 是这次飞行的状态，调用方持有）。
 *
 * 高度按**松手点(startY)**算，不是按地面：`最高 = (松手点 − 最高点)/PX_PER_M` = 这一抛飞出去多高。
 * 用户 2026-11-08 拍板——拖到屏幕顶再松手，不该因为「松手点已经很高」白送十几米、把成绩顶成一个常数。
 * `homeY` 在这里只用来判落地，不参与高度。
 */
export function stepFlight(f: Flight, dt: number, homeY: number, petH: number): { hidden: boolean; landed: boolean } {
  // 整块还在屏外**且正在下落** → 快落（大重力+高上限）赶紧回视野；露进屏幕 → 切回轻柔下落。
  // 只在下降时提速：上升段仍用正常 G，否则屏外甩上去会被大重力提前刹住，顶点高度就不一致了。
  const off = f.vy > 0 && f.y + petH < 0
  const g = off ? FLY.G_OFF : FLY.G
  const cap = off ? FLY.FALL_CAP_OFF : FLY.FALL_CAP
  f.vy = Math.min(f.vy + g * dt, cap)
  f.y += f.vy * dt
  if (f.y < f.minY) f.minY = f.y
  const peak = (f.startY - f.minY) / FLY.PX_PER_M
  if (peak > f.maxM) f.maxM = peak
  return { hidden: f.y + petH < 0, landed: f.y >= homeY && f.vy > 0 }
}

/** 实时高度（米，相对**松手点**，飞出顶也继续加；回落穿过松手点不写负数）与速度（m/s，向上为正），HUD 用。 */
export function readout(f: Flight, homeY: number): { heightM: number; maxM: number; speedMps: number } {
  return {
    // 相对松手点：这一抛此刻飞出去多高。落回穿过松手点后为负 → 夹 0（和落地闪 -1 同理）。
    heightM: Math.max(0, (f.startY - f.y) / FLY.PX_PER_M),
    maxM: f.maxM,
    speedMps: -f.vy / FLY.PX_PER_M,
  }
}
