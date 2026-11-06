/**
 * 手解 PNG（不依赖图像库）：仓库开发依赖里没有图像库，而这张图是探针自己截出来的，
 * 不值得为它拉一个 sharp/pngjs。支持 depth=8 的 colorType 6/2、五种 filter。
 * `spike/cloud-png-measure.mjs` 第一次用这套解法，这里抽出来共用。
 */
import zlib from 'node:zlib'

/** @returns {{W:number,H:number,ch:number,px:Buffer}} px = 行主序、每像素 ch 通道 */
export function decodePng(buf) {
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
  if (depth !== 8) throw new Error(`不支持位深 ${depth}`)
  const ch = color === 6 ? 4 : color === 2 ? 3 : -1
  if (ch < 0) throw new Error(`不支持 colorType ${color}`)
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
  return { W, H, ch, px }
}
