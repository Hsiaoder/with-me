/**
 * 一次性素材手术：把 Kenney button_rectangle_line 的外层装饰裁掉，只留蓝色内框。
 *
 * 原图 192×64 从外到内四层：2px 灰外框（圆角，带 AA）→ 2px 白内高光 → 2px 留白 →
 * 2px 蓝色内框（直角，bbox 实测 6..185 × 6..57），中间是 218,220,231 的纯色填充。
 * 用户要「去掉最外层灰框，只保留蓝色框」，那就从 (6,6) 起裁 180×52：
 * 蓝线正好落在新图的 0..1 与 178..179 / 0..1 与 50..51，中间全是纯色，
 * 于是 CSS 可以用回最朴素的 slice 2。
 *
 * 跑法：node spike/plate-crop.mjs → src/renderer/icons/button_rectangle_line_blue.png
 * 依赖仓库外的素材目录（E:/ai-pet/ui），不在就直接报错，不静默出空图。
 */
import { existsSync } from 'node:fs'
import { execFileSync } from 'child_process'
import { createRequire } from 'node:module'

const FF = createRequire(import.meta.url)('ffmpeg-static')
const SRC = 'E:/ai-pet/ui/kenney_ui-pack/PNG/Blue/Default/button_rectangle_line.png'
const OUT = 'src/renderer/icons/button_rectangle_line_blue.png'
if (!existsSync(SRC)) throw new Error(`素材不在：${SRC}`)

execFileSync(FF, ['-v', 'error', '-y', '-i', SRC, '-vf', 'crop=180:52:6:6', OUT])

// 自检：裁完的四边必须正好是 2px 蓝线，中间必须全是填充，否则 slice 2 会切进杂色。
const raw = execFileSync(FF, ['-v', 'error', '-i', OUT, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 26 })
const W = 180
const H = 52
const at = (x, y) => {
  const i = (y * W + x) * 4
  return [raw[i], raw[i + 1], raw[i + 2], raw[i + 3]]
}
const BLUE = (c) => c[2] > 200 && c[0] < 120 && c[3] > 200
const FILL = (c) => Math.abs(c[0] - 218) < 26 && Math.abs(c[1] - 220) < 26 && Math.abs(c[2] - 231) < 26
const midY = H >> 1
const midX = W >> 1
const edge = (label, line) => {
  const n = line.filter(BLUE).length
  if (n !== 2) throw new Error(`${label} 边上的蓝线是 ${n}px，不是 2px：${line.map((c) => (BLUE(c) ? 'B' : FILL(c) ? '.' : '?')).join('')}`)
  console.log(`${label}: 蓝线 2px ✓`)
}
edge('上', Array.from({ length: 6 }, (_, k) => at(midX, k)))
edge('下', Array.from({ length: 6 }, (_, k) => at(midX, H - 1 - k)))
edge('左', Array.from({ length: 6 }, (_, k) => at(k, midY)))
edge('右', Array.from({ length: 6 }, (_, k) => at(W - 1 - k, midY)))
let bad = 0
for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) if (!FILL(at(x, y))) bad++
if (bad > 0) throw new Error(`中间区有 ${bad} 个非填充像素，slice 2 会把它们拉进面板`)
console.log(`中间 ${W - 4}×${H - 4} 全是纯色填充 ✓ → ${OUT}`)
