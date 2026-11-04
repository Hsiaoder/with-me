// 一次性排查：把 Vector 气泡的描边削薄——只保留最外圈 d 层，其余非白像素全部刷成白色，
// 白色内腔随之变大。用法：node spike/emote-thin.mjs <输入png> <输出png> [保留层数=1]
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const FF = require('ffmpeg-static')
const src = process.argv[2]
const dst = process.argv[3]
const KEEP = Number(process.argv[4] ?? 1)
if (!src || !dst) throw new Error('用法：node spike/emote-thin.mjs <输入png> <输出png> [保留层数]')

const ihdr = readFileSync(src).subarray(16, 24)
const W = ihdr.readUInt32BE(0)
const H = ihdr.readUInt32BE(4)
const raw = Buffer.from(
  execFileSync(FF, ['-loglevel', 'error', '-i', src, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 24 }),
)
console.log(`${src} ${W}x${H}`)

const idx = (x, y) => y * W + x
const opaque = (x, y) => x >= 0 && y >= 0 && x < W && y < H && raw[idx(x, y) * 4 + 3] >= 128
const isWhite = (x, y) => {
  const i = idx(x, y) * 4
  return raw[i] === 255 && raw[i + 1] === 255 && raw[i + 2] === 255 && raw[i + 3] === 255
}

// 到「外面」的层数：贴透明/出界的是 1，往里逐层 +1（4 邻域 BFS，像素图够用）。
const dist = new Int32Array(W * H).fill(0)
const queue = []
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (!opaque(x, y)) continue
    if (!opaque(x - 1, y) || !opaque(x + 1, y) || !opaque(x, y - 1) || !opaque(x, y + 1)) {
      dist[idx(x, y)] = 1
      queue.push(idx(x, y))
    }
  }
}
for (let head = 0; head < queue.length; head++) {
  const p = queue[head]
  const x = p % W
  const y = (p / W) | 0
  for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
    if (!opaque(nx, ny)) continue
    const q = idx(nx, ny)
    if (dist[q] === 0) {
      dist[q] = dist[p] + 1
      queue.push(q)
    }
  }
}

// 保留最外 KEEP 层当描边，更里的非白像素刷白。
let thinned = 0
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const p = idx(x, y)
    if (!opaque(x, y) || isWhite(x, y)) continue
    if (dist[p] > KEEP) {
      raw[p * 4] = raw[p * 4 + 1] = raw[p * 4 + 2] = raw[p * 4 + 3] = 255
      thinned++
    }
  }
}
console.log(`刷白 ${thinned} 个像素（描边保留最外 ${KEEP} 层）`)

const dir = mkdtempSync(join(tmpdir(), 'emote-thin-'))
const rawPath = join(dir, 'rgba.raw')
writeFileSync(rawPath, raw)
execFileSync(FF, ['-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', rawPath, dst])
console.log(`已写：${dst}`)
