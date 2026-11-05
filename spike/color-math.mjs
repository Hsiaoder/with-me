/**
 * 配色算式：把「看着暗」变成可比的数，并且按 OKLCH 建阶梯而不是 eyeball hex。
 * 既是可直接跑的报告，也可被别的探针 import（solveRing / ladder / contrast / fmt）。
 *
 * 为什么用 OKLCH 而不是 HSL：HSL 的 L 是几何平均，同样 L=70 的青蓝和黄色在人眼里差一大截；
 * OKLCH 的 L 就是感知明度，「暗不暗」这件事可以直接拿它排序。
 *
 * 三样一起看：
 * - WCAG 2 对比度：规范硬门槛（正文 4.5:1、UI 组件 3:1）；
 * - OKLCH L：人眼真正在用的明度轴；
 * - OKLCH C：彩度。灰蓝和奶油白可能 L 一样，观感完全不同。
 *
 * 用法：node spike/color-math.mjs
 */

const hexToRgb = (h) => {
  const s = h.replace('#', '')
  const n = s.length === 3 ? s.split('').map((c) => c + c).join('') : s
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16))
}
const toLin = (v) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const toSrgb = (v) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
  return Math.round(Math.max(0, Math.min(1, c)) * 255)
}
const relLum = (h) => {
  const [r, g, b] = hexToRgb(h).map(toLin)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

function rgbToOklch(hexStr) {
  const [r, g, b] = hexToRgb(hexStr).map(toLin)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { L, C: Math.hypot(A, B), H: (Math.atan2(B, A) * 180) / Math.PI }
}

function oklchToHex(L, C, H) {
  const h = (H * Math.PI) / 180
  const A = C * Math.cos(h)
  const B = C * Math.sin(h)
  const l = (L + 0.3963377794 * A + 0.2158037602 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  const r = toSrgb(4.0767416627 * l - 3.3077115913 * m + 0.2309697419 * s)
  const g = toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
  const bl = toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  return `#${[r, g, bl].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

const fmt = (h) => {
  const { L, C, H } = rgbToOklch(h)
  return `${h}  L=${(L * 100).toFixed(1)} C=${C.toFixed(3)} H=${((H + 360) % 360).toFixed(0)}`
}

/** 一条阶梯：色相固定，明度从亮到暗，彩度按「中间最浓、两端趋灰」的常识给。 */
function ladder(H, steps) {
  const out = {}
  for (const [role, L, C] of steps) out[role] = oklchToHex(L / 100, C, H)
  return out
}

// 现有那枚青内圈 #36BDF7 的色相，就是产品的品牌色相
const BRAND_H = rgbToOklch('#36BDF7').H

const STEPS = [
  ['高光', 100.0, 0.0],
  ['面', 96.5, 0.014],
  ['板心', 94.0, 0.022],
  ['内圈', 75.3, 0.139],
  ['环', 64.0, 0.055],
  ['底影', 53.0, 0.07],
  ['图标墨', 24.0, 0.015],
]

const CANDIDATES = {
  'A 品牌蓝白（H=232，跟青内圈同色系）': ladder(BRAND_H, STEPS),
  'B 奶油暖白（H=80，跟角色的暖肤色走）': ladder(80, STEPS.map(([r, L, C]) => [r, L, r === '内圈' ? C : C * 1.1])),
  'C 冷白高对比（H=250，彩度压到最低）': ladder(250, STEPS.map(([r, L, C]) => [r, L, r === '内圈' ? C : C * 0.55])),
}

/**
 * 解环的明度：找**对所有邻色都还能满足 3:1 的最亮** L（越亮越不像边框，所以取上界）。
 *
 * 邻色里最难的是**最暗**的那个，不是最亮的：对比 = (亮+0.05)/(暗+0.05)，邻色越暗比值越小。
 * 所以拿 min(面, 白高光, 浅桌面) 反解，一次满足三个。
 * 第一版这里写成 max，解出来的环对白色刚好 3:1、对浅壁纸却只剩 2.65:1——
 * 而那恰好就是现在这版的毛病：环既压不住面也压不住桌面，整枚币看着就是一坨灰。
 *
 * 别把「深色桌面」列进约束：圆底边缘是**白高光 + 灰环两层配合**，
 * 浅壁纸靠灰环压住、深壁纸靠白高光压住（白高光对 #22262C 是 15.2:1）。
 * 要求环单独赢过深色桌面会把它解成近黑，按钮变成「黑圈 + 白饼」，那是错的模型。
 */
function solveRing(faceHex, H, C, need = 3.0) {
  const adj = Math.min(relLum(faceHex), relLum('#FFFFFF'), relLum('#EEF1F5'))
  const maxLum = (adj + 0.05) / need - 0.05
  let lo = 0
  let hi = 100
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    // 亮度随 L 单调上升：mid 还够暗就往上试，太亮就往下收
    if (relLum(oklchToHex(mid / 100, C, H)) <= maxLum) lo = mid
    else hi = mid
  }
  return lo
}

/** 底影跟着环走：比环暗 11 个 L 单位（现状的环→底影正好差 11.1，厚度感就靠这个跨度） */
const SHADOW_STEP = 11

for (const [name, s] of Object.entries(CANDIDATES)) {
  const H = rgbToOklch(s.面).H
  const ringL = solveRing(s.面, H, rgbToOklch(s.环).C)
  s.环 = oklchToHex(ringL / 100, rgbToOklch(s.环).C, H)
  s.底影 = oklchToHex((ringL - SHADOW_STEP) / 100, rgbToOklch(s.底影).C, H)
  s.图标墨 = oklchToHex(0.24, rgbToOklch(s.图标墨).C, H)
}

const 现状 = {
  高光: '#FFFFFF', 面: '#DADCE7', 板心: '#DCEAF5', 内圈: '#36BDF7', 环: '#9696A3', 底影: '#747487', 图标墨: '#1B1B1B',
}

function report(name, s) {
  console.log(`\n=== ${name}`)
  for (const k of ['高光', '面', '板心', '内圈', '环', '底影', '图标墨']) console.log(`  ${k.padEnd(4)} ${fmt(s[k])}`)
  const pairs = [
    ['图标墨 / 面（AA 4.5）', s.图标墨, s.面, 4.5],
    ['环 / 面（UI 3.0）', s.环, s.面, 3.0],
    ['环 / 浅桌面 #EEF1F5（3.0）', s.环, '#EEF1F5', 3.0],
    ['白高光 / 深桌面 #22262C（3.0）', s.高光, '#22262C', 3.0],
    ['底影 / 环（厚度，装饰无门槛）', s.底影, s.环, 0],
    ['面 / 板心（按钮与板分离）', s.面, s.板心, 0],
  ]
  for (const [label, a, b, need] of pairs) {
    const c = contrast(a, b)
    const verdict = need === 0 ? '' : c >= need ? `✓ 门槛 ${need}` : `✗ 差 ${(need - c).toFixed(2)}（门槛 ${need}）`
    console.log(`  ${label.padEnd(30)} ${c.toFixed(2)}:1 ${verdict}`)
  }
  console.log(`  面的明度 L = ${(rgbToOklch(s.面).L * 100).toFixed(1)}，彩度 C = ${rgbToOklch(s.面).C.toFixed(3)}`)
}

function main() {
  report('现状', 现状)
  for (const [n, s] of Object.entries(CANDIDATES)) {
    report(n, s)
    console.log(`  环解出来的 L = ${(rgbToOklch(s.环).L * 100).toFixed(1)}（初版 64.0，为的是同时压过面、白高光与浅桌面）`)
  }

  console.log('\n=== 一句话读数')
  console.log(`现状的面 L=${(rgbToOklch(现状.面).L * 100).toFixed(1)}（这就是「暗」的来源之一），环 L=${(rgbToOklch(现状.环).L * 100).toFixed(1)}，底影 L=${(rgbToOklch(现状.底影).L * 100).toFixed(1)}`)
  console.log('环不能提亮：它是对比唯一的来源，桌面深浅都靠它勾边。要动的是「面」往上提，环按约束解出来。')
}

export { CANDIDATES, BRAND_H, contrast, fmt, hexToRgb, ladder, oklchToHex, rgbToOklch, relLum, solveRing, 现状 }

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('spike/color-math.mjs')) main()
