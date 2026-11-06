/**
 * A 套配色落地：把圆底（SVG）与底板（PNG）从 Kenney 原色重染成品牌蓝白。
 *
 * ⚠️ 2026-11-06 之后这个脚本**不再是产品链路**：它写的两枚素材都已退役
 * （圆底换成手绘的 `icons/whale_round.svg`，食物底板改成 CSS 卡片）。
 * 再跑一次会把 `button_round_depth_line.svg` 写回仓库，而 `test/palette.test.ts`
 * 现在钉的正是「这枚不许还在」。留着是因为它的**重染算法**仍然通用
 * （按明度认锚点插值，别处换 Kenney 素材还用得上）——要用就改输出路径。
 *
 * 为什么不是「精确值替换」：底板 31 个颜色里只有 5 个是主色，其余 26 个是抗锯齿过渡色
 * （149,149,162,159 / 202,202,209 / 115,115,134,239 这种）。按值替换会把它们原样留下，
 * 新环和新面之间就夹了一圈灰紫 fringe，2× 远程桌面上看得清清楚楚。
 *
 * 做法：把中性偏紫的那一族按明度认锚点（底影 116 / 环 150 / 面 218 / 白 255），
 * 算出每个像素落在哪两个锚点之间、插值到多少，再把同样的插值比例套到目标色上。
 * 这样过渡色的相对关系保住了，边缘不会硬。青色（内圈）与纯透明一律不碰。
 *
 * 跑法：node spike/palette-recolor.mjs
 * 源文件读仓库外的 Kenney 原图，保证可重复；不在就直接报错。
 *
 * 现状（2026-11-06）：**底板那张 PNG 已退出产品**——食物列表改用和状态读数同一张 CSS 卡片，
 * 文件也从仓库删了（problem/03 §3.12）。再跑这个脚本会把它写回来，写回来就等于把已删的素材
 * 重新塞进 dist。所以这里只跑圆底那半段；「按明度分段重映射渐变带」的做法留着，下次遇到别的
 * 位图素材照抄，别再 PLATE_OUT 上按回车。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'child_process'
import { createRequire } from 'node:module'
import { contrast, oklchToHex, rgbToOklch } from './color-math.mjs'

const FF = createRequire(import.meta.url)('ffmpeg-static')
const PACK = 'E:/ai-pet/ui/kenney_ui-pack'
const DISC_SRC = `${PACK}/Vector/Blue/button_round_depth_line.svg`
const PLATE_SRC = `${PACK}/PNG/Blue/Default/button_rectangle_depth_line.png`
const DISC_OUT = 'src/renderer/icons/button_round_depth_line.svg'
const PLATE_OUT = 'src/renderer/icons/button_rectangle_depth_line.png'
for (const p of [DISC_SRC, PLATE_SRC]) if (!existsSync(p)) throw new Error(`Kenney 原图不在：${p}（换机先确认素材目录）`)

/** A 套：色相 H=232 的一条 OKLCH 阶梯，环的 L 是 solveRing 解出来的（对所有邻色刚好 3:1） */
const A = {
  高光: '#FFFFFF',
  面: '#EBF5FB',
  内圈: '#36BDF7',
  环: '#6990A7',
  底影: '#3E718C',
}

// ---------- 圆底 SVG：五层各有明确 fill，直接换值 ----------
const SVG_MAP = { '#9696A3': A.环, '#747487': A.底影, '#DADCE7': A.面, '#36BDF7': A.内圈, '#FFFFFF': A.高光 }
let svg = readFileSync(DISC_SRC, 'utf8')
const svgHits = {}
for (const [from, to] of Object.entries(SVG_MAP)) {
  const variants = [from, from.toLowerCase()]
  let n = 0
  for (const v of variants) {
    const needle = `fill="${v}"`
    n += svg.split(needle).length - 1
    svg = svg.split(needle).join(`fill="${to}"`)
  }
  svgHits[from] = n
}
writeFileSync(DISC_OUT, svg)
console.log('圆底 SVG 换色：', JSON.stringify(svgHits))

// ---------- 底板 PNG：按明度锚点做色阶重映射 ----------
/**
 * 锚点的标尺用**三通道均值**，不是 r 通道：素材这几个「灰」其实都偏紫
 * （环是 150,150,163；底影是 116,116,135），拿 r 当标尺会让每个像素都落在两个锚点中间，
 * 于是连纯色本身也被混了一档——第一版环出来是 115,152,172 而不是目标 105,144,167，
 * 就是这个错。用均值以后，纯色正好压在锚点上（t=0 或 1），只有抗锯齿的过渡色才插值。
 */
const ANCHORS = [
  { v: (116 + 116 + 135) / 3, to: A.底影 },
  { v: (150 + 150 + 163) / 3, to: A.环 },
  { v: (218 + 220 + 231) / 3, to: A.面 },
  { v: 255, to: A.高光 },
]
const head = readFileSync(PLATE_SRC)
const W = head.readUInt32BE(16)
const H = head.readUInt32BE(20)
const raw = execFileSync(FF, ['-v', 'error', '-i', PLATE_SRC, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 26 })
const out = Buffer.from(raw)
const hexToRgb = (h) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16))
const targets = ANCHORS.map((a) => ({ v: a.v, rgb: hexToRgb(a.to) }))
let remapped = 0
let skipped = 0
for (let p = 0; p < out.length; p += 4) {
  const [r, g, b, alpha] = [out[p], out[p + 1], out[p + 2], out[p + 3]]
  if (alpha === 0) continue
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  // 青色内圈是高饱和的（b - r 差 200），中性族是 b 略高于 r。用彩度分开，别把蓝线也染了
  if (max - min > 60) { skipped++; continue }
  const key = (r + g + b) / 3
  // 找 key 落在哪两个锚点之间；两端之外就贴到最近的那个锚点
  let lo = targets[0]
  let hi = targets[targets.length - 1]
  if (key <= lo.v) hi = lo
  else if (key >= hi.v) lo = hi
  else {
    for (let i = 0; i < targets.length - 1; i++) {
      if (key >= targets[i].v && key <= targets[i + 1].v) { lo = targets[i]; hi = targets[i + 1]; break }
    }
  }
  const span = hi.v - lo.v
  const t = span <= 1e-9 ? 0 : (key - lo.v) / span
  out[p] = Math.round(lo.rgb[0] + (hi.rgb[0] - lo.rgb[0]) * t)
  out[p + 1] = Math.round(lo.rgb[1] + (hi.rgb[1] - lo.rgb[1]) * t)
  out[p + 2] = Math.round(lo.rgb[2] + (hi.rgb[2] - lo.rgb[2]) * t)
  remapped++
}
execFileSync(FF, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', 'pipe:0', PLATE_OUT], {
  input: out,
  maxBuffer: 1 << 26,
})
console.log(`底板 PNG 重映射 ${remapped} 个像素（跳过青色/透明 ${skipped}）`)

// ---------- 自检：新色必须真的在里面，旧的灰紫必须一个都不剩 ----------
const check = execFileSync(FF, ['-v', 'error', '-i', PLATE_OUT, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 26 })
const seen = new Map()
for (let i = 0; i < check.length; i += 4) {
  if (check[i + 3] === 0) continue
  const k = `${check[i]},${check[i + 1]},${check[i + 2]},${check[i + 3]}`
  seen.set(k, (seen.get(k) || 0) + 1)
}
const stale = [...seen.keys()].filter((k) => {
  const [r, g, b] = k.split(',').map(Number)
  return Math.abs(r - 150) < 12 && Math.abs(b - 163) < 12 && b > r && g < 170 && Math.max(r, g, b) - Math.min(r, g, b) < 20
})
console.log(`底板色数 ${seen.size}；残留的旧灰紫：${stale.length ? stale.slice(0, 4).join(' ') : '无'}`)

// ---------- 把门槛再算一遍：改完要还能过 3:1 ----------
const pairs = [
  ['环 / 面', A.环, A.面],
  ['环 / 浅桌面', A.环, '#EEF1F5'],
  ['白高光 / 深桌面', A.高光, '#22262C'],
  ['图标墨 / 面', '#182125', A.面],
]
for (const [label, a, b] of pairs) console.log(`  ${label.padEnd(16)} ${contrast(a, b).toFixed(2)}:1`)
console.log(`  面 L=${(rgbToOklch(A.面).L * 100).toFixed(1)} 环 L=${(rgbToOklch(A.环).L * 100).toFixed(1)} 底影 L=${(rgbToOklch(A.底影).L * 100).toFixed(1)}`)
