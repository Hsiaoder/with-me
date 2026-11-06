/**
 * 一次性探针（throwaway）：给云朵气泡解两个色——描边环 + 回应按钮面。
 *
 * 为什么是解出来的而不是挑 hex：这两个色各有一条硬门槛，而且门槛的**邻色不止一个**。
 * · 环：它是气泡和桌面之间唯一的边界。白色内腔、浅色壁纸、深色壁纸三面都要压得住，
 *   所以按「最暗的那个邻色」反解最亮的 L（对比 = 亮/暗，邻色越暗比值越小）。
 *   现状 #92c7e3 只对白色勉强够，对浅壁纸掉到 2.x——浅桌面上气泡边缘是化开的。
 * · 回应按钮：气泡里唯一能点的东西，现状 #a9d4ef 和环只差一档，读起来像「环的余料」。
 *   改成实色蓝 + 白字：文字 ≥4.5:1 反解出最亮的 L，它同时把按钮和环拉开两级。
 *
 * 跑法：node spike/bubble-color.mjs
 */
import { contrast, fmt, oklchToHex, relLum, rgbToOklch } from './color-math.mjs'

const BRAND_H = rgbToOklch('#36BDF7').H
const WHITE = '#ffffff'
const LIGHT_DESK = '#EEF1F5'
const DARK_DESK = '#22262C'
const INK = '#2b2f36'

/** 找满足「对最暗邻色 ≥ need」的最亮 L（二分，L 单调）。 */
function solveL(need, adjLum, C, H) {
  const maxLum = (adjLum + 0.05) / need - 0.05
  let lo = 0
  let hi = 100
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (relLum(oklchToHex(mid / 100, C, H)) <= maxLum) lo = mid
    else hi = mid
  }
  return lo
}

console.log('现状：')
console.log(`  环   ${fmt('#92c7e3')}`)
console.log(`  按钮 ${fmt('#a9d4ef')}  边 ${fmt('#6990a7')}  立体影 ${fmt('#3e718c')}`)
console.log(`  环/白内腔 ${contrast('#92c7e3', WHITE).toFixed(2)}  环/浅桌面 ${contrast('#92c7e3', LIGHT_DESK).toFixed(2)}  环/深桌面 ${contrast('#92c7e3', DARK_DESK).toFixed(2)}`)
console.log(`  按钮/白内腔 ${contrast('#a9d4ef', WHITE).toFixed(2)}  墨字/按钮 ${contrast(INK, '#a9d4ef').toFixed(2)}`)

console.log('\n---- 环：三面临色里最暗的是浅桌面，按它反解 ----')
const ringRows = []
for (const C of [0.08, 0.1, 0.12]) {
  const adj = Math.min(relLum(WHITE), relLum(LIGHT_DESK))
  const L = solveL(3.0, adj, C, BRAND_H)
  const hex = oklchToHex(L / 100, C, BRAND_H)
  ringRows.push({ C, L, hex })
  console.log(`  C=${C} → ${fmt(hex)}  白 ${contrast(hex, WHITE).toFixed(2)}  浅桌 ${contrast(hex, LIGHT_DESK).toFixed(2)}  深桌 ${contrast(hex, DARK_DESK).toFixed(2)}`)
}

console.log('\n---- 回应按钮：白字 ≥4.5，同时和环拉开 ----')
for (const C of [0.12, 0.14, 0.16]) {
  const L = solveL(4.5, relLum(WHITE), C, BRAND_H)
  const hex = oklchToHex(L / 100, C, BRAND_H)
  const edge = oklchToHex((L - 11) / 100, C, BRAND_H)
  console.log(`  C=${C} → 面 ${fmt(hex)}  边/影 ${fmt(edge)}`)
  console.log(`      白字/面 ${contrast(WHITE, hex).toFixed(2)}  面/白内腔 ${contrast(hex, WHITE).toFixed(2)}  面/深桌 ${contrast(hex, DARK_DESK).toFixed(2)}`)
}

console.log('\n---- 配对检查：环和按钮必须一眼分得开 ----')
for (const r of ringRows) {
  for (const C of [0.14]) {
    const L = solveL(4.5, relLum(WHITE), C, BRAND_H)
    const btn = oklchToHex(L / 100, C, BRAND_H)
    const dL = Math.abs(rgbToOklch(btn).L - rgbToOklch(r.hex).L) * 100
    console.log(`  环 C=${r.C}(${r.hex}) vs 按钮 ${btn}：ΔL=${dL.toFixed(1)} 对比 ${contrast(r.hex, btn).toFixed(2)}`)
  }
}
