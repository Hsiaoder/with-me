// 一次性量图脚本（不依赖图像库）：手解 PNG → 报底/内/墨三处颜色 + 水印框 + 双线间距。
// 用法：node spike/cloud-png-measure.mjs "<png 路径>"
import { readFileSync } from 'node:fs'
import zlib from 'node:zlib'

const path = process.argv[2]
const buf = readFileSync(path)
let off = 8
let W = 0, H = 0, depth = 0, color = 0
const idat = []
while (off < buf.length) {
  const len = buf.readUInt32BE(off)
  const type = buf.toString('ascii', off + 4, off + 8)
  const data = buf.subarray(off + 8, off + 8 + len)
  if (type === 'IHDR') {
    W = data.readUInt32BE(0); H = data.readUInt32BE(4)
    depth = data[8]; color = data[9]
  } else if (type === 'IDAT') idat.push(data)
  off += 12 + len
}
if (depth !== 8) { console.error(`不支持位深 ${depth}`); process.exit(1) }
const ch = color === 6 ? 4 : color === 2 ? 3 : -1
if (ch < 0) { console.error(`不支持 colorType ${color}`); process.exit(1) }
const raw = zlib.inflateSync(Buffer.concat(idat))
const stride = W * ch
const px = Buffer.alloc(H * stride)
let pos = 0
for (let y = 0; y < H; y++) {
  const filter = raw[pos++]
  const line = raw.subarray(pos, pos + stride); pos += stride
  const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride)
  const cur = px.subarray(y * stride, y * stride + stride)
  for (let i = 0; i < stride; i++) {
    const a = i >= ch ? cur[i - ch] : 0
    const b = prev[i]
    const c = y > 0 && i >= ch ? prev[i - ch] : 0
    let v = line[i]
    if (filter === 1) v += a
    else if (filter === 2) v += b
    else if (filter === 3) v += (a + b) >> 1
    else if (filter === 4) {
      const p = a + b - c
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
      v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
    }
    cur[i] = v & 255
  }
}
const at = (x, y) => {
  const i = y * stride + x * ch
  return `rgb(${px[i]},${px[i + 1]},${px[i + 2]})`
}
const hex = (s) => '#' + s.slice(4, -1).split(',').map((v) => Number(v).toString(16).padStart(2, '0')).join('')
console.log(`${W}×${H} depth=${depth} colorType=${color}`)
for (const [name, x, y] of [
  ['左上角', 2, 2], ['右上角', W - 3, 2], ['左下角', 2, H - 3], ['右下角', W - 3, H - 3],
  ['正中心', W >> 1, H >> 1], ['中心偏上(云内)', W >> 1, Math.round(H * 0.35)],
  ['中心偏左(云内)', Math.round(W * 0.3), H >> 1],
]) console.log(`${name}: ${hex(at(x, y))}`)

const inkAt = (x, y) => {
  const i = y * stride + x * ch
  return !(px[i] >= 242 && px[i + 1] >= 242 && px[i + 2] >= 238)
}
// 水印：右下角那块
let box = { x0: W, y0: H, x1: -1, y1: -1 }
for (let y = Math.floor(H * 0.85); y < H; y++) {
  for (let x = Math.floor(W * 0.8); x < W; x++) {
    if (inkAt(x, y)) {
      box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y)
      box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y)
    }
  }
}
console.log(box.x1 < 0 ? '右下角无墨迹' : `右下角墨迹框: ${box.x0},${box.y0} .. ${box.x1},${box.y1}`)
// 主体墨迹 bbox（排掉右下角那块）
const inWatermark = (x, y) => box.x1 >= 0 && x >= box.x0 && y >= box.y0
let b = { x0: W, y0: H, x1: -1, y1: -1 }, n = 0
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (inWatermark(x, y)) continue
    if (inkAt(x, y)) {
      b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y)
      b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y); n++
    }
  }
}
console.log(`主体墨迹 bbox: ${b.x0},${b.y0} .. ${b.x1},${b.y1}  墨迹像素 ${n}`)
// 沿水平中线往右数墨迹段：双线之间的那道空档能直接读出来
const mid = Math.round(H * 0.5)
let runs = []
let start = -1
for (let x = 0; x < W; x++) {
  const v = inkAt(x, mid)
  if (v && start < 0) start = x
  if (!v && start >= 0) { runs.push([start, x - 1]); start = -1 }
}
if (start >= 0) runs.push([start, W - 1])
console.log(`y=${mid} 水平墨迹段: ${runs.map(([s, e]) => `${s}-${e}(宽${e - s + 1})`).join(' ')}`)
