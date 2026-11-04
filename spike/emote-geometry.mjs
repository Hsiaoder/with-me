// 一次性排查：把气泡底图按原始像素打成字符图，量出身子/尾巴行界、最大完整白色矩形、
// 以及描边有多厚（中间那一行/列从外沿往里数几个非白像素）。
// 用法：node spike/emote-geometry.mjs [png路径]
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const FF = require('ffmpeg-static')
const file = process.argv[2] ?? 'src/renderer/emotes/bubble.png'

// 尺寸直接读 PNG IHDR（第 16..24 字节），别再用 sqrt——Vector 那批是 32×38，不是方的。
const ihdr = readFileSync(file).subarray(16, 24)
const N = ihdr.readUInt32BE(0)
const M = ihdr.readUInt32BE(4)

const raw = execFileSync(FF, ['-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 24 })
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

console.log(`${file}  ${N}x${M}   . 透明  W 纯白  B 彩色描边  g 其他`)
for (let y = 0; y < M; y++) console.log(String(y).padStart(2) + ' ' + [...Array(N).keys()].map((x) => kind(x, y)).join(''))

// 逐行白色区间，找出身子与尾巴的分界（尾巴是底部突然变窄的那几行）
const runs = []
for (let y = 0; y < M; y++) {
  const xs = [...Array(N).keys()].filter((x) => kind(x, y) === 'W')
  runs.push(xs.length ? [xs[0], xs[xs.length - 1], xs.length] : [-1, -1, 0])
}
console.log('行  白色左右界  个数')
runs.forEach(([l, r, n], y) => console.log(`${String(y).padStart(2)}  ${l}..${r}  ${n}`))

// 最大完整白色矩形（暴力枚举，注意宽 N 高 M 不一定相等）
let best = { w: 0, h: 0, x: 0, y: 0 }
const isW = (x, y) => kind(x, y) === 'W'
for (let y0 = 0; y0 < M; y0++) {
  for (let x0 = 0; x0 < N; x0++) {
    for (let y1 = y0; y1 < M; y1++) {
      for (let x1 = x0; x1 < N; x1++) {
        let ok = true
        for (let y = y0; y <= y1 && ok; y++) for (let x = x0; x <= x1; x++) if (!isW(x, y)) { ok = false; break }
        if (ok && (y1 - y0 + 1) * (x1 - x0 + 1) > best.w * best.h) best = { w: x1 - x0 + 1, h: y1 - y0 + 1, x: x0, y: y0 }
      }
    }
  }
}
console.log(`最大完整白色矩形 ${best.w}x${best.h} 位于 (${best.x},${best.y})`)

// 描边厚度：中间那一行/那一列，从外沿往里数「不透明但非白」的像素个数。
const midY = Math.floor(M / 2)
const midX = Math.floor(N / 2)
const band = (start, step, stop, at) => {
  let n = 0
  for (let i = start; i !== stop; i += step) {
    const k = at(i)
    if (k === '.') break        // 走到透明就是出界了
    if (k === 'W') break        // 走到白色就是进内腔了
    n++
  }
  return n
}
console.log(`描边厚度：中行 y=${midY} 左 ${band(0, 1, N, (x) => kind(x, midY))} 右 ${band(N - 1, -1, -1, (x) => kind(x, midY))}` +
  `，中列 x=${midX} 上 ${band(0, 1, M, (y) => kind(midX, y))}`)

// 调色板
const pal = new Map()
for (let y = 0; y < M; y++) for (let x = 0; x < N; x++) {
  const k = px(x, y).join(',')
  pal.set(k, (pal.get(k) || 0) + 1)
}
console.log('调色板：' + [...pal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}×${v}`).join('  '))
