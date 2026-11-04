// 一次性排查：把气泡底图按 16×16 打成字符图，并量出身子/尾巴的行界与最大完整白色矩形。
// 用法：node spike/emote-geometry.mjs [png路径]
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const FF = require('ffmpeg-static')
const file = process.argv[2] ?? 'src/renderer/emotes/bubble.png'

const raw = execFileSync(FF, ['-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 24 })
const N = Math.round(Math.sqrt(raw.length / 4))
const px = (x, y) => {
  const i = (y * N + x) * 4
  return [raw[i], raw[i + 1], raw[i + 2], raw[i + 3]]
}
const kind = (x, y) => {
  const [r, g, b, a] = px(x, y)
  if (a < 128) return '.'
  if (r === 255 && g === 255 && b === 255) return 'W'
  if (b > r) return 'B'
  return 'g'
}

console.log(`${file}  ${N}x${N}   . 透明  W 纯白  B 彩色描边  g 其他`)
for (let y = 0; y < N; y++) console.log(String(y).padStart(2) + ' ' + [...Array(N).keys()].map((x) => kind(x, y)).join(''))

// 逐行白色区间，找出身子与尾巴的分界（尾巴是底部突然变窄的那几行）
const runs = []
for (let y = 0; y < N; y++) {
  const xs = [...Array(N).keys()].filter((x) => kind(x, y) === 'W')
  runs.push(xs.length ? [xs[0], xs[xs.length - 1], xs.length] : [-1, -1, 0])
}
console.log('行  白色左右界  个数')
runs.forEach(([l, r, n], y) => console.log(`${String(y).padStart(2)}  ${l}..${r}  ${n}`))

// 最大完整白色矩形（暴力枚举）
let best = { w: 0, h: 0, x: 0, y: 0 }
for (let y0 = 0; y0 < N; y0++) {
  for (let x0 = 0; x0 < N; x0++) {
    for (let y1 = y0; y1 < N; y1++) {
      for (let x1 = x0; x1 < N; x1++) {
        let ok = true
        for (let y = y0; y <= y1 && ok; y++) for (let x = x0; x <= x1; x++) if (kind(x, y) !== 'W') { ok = false; break }
        if (ok && (y1 - y0 + 1) * (x1 - x0 + 1) > best.w * best.h) best = { w: x1 - x0 + 1, h: y1 - y0 + 1, x: x0, y: y0 }
      }
    }
  }
}
console.log(`最大完整白色矩形 ${best.w}x${best.h} 位于 (${best.x},${best.y})`)
