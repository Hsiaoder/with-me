/**
 * 一次性：按"跨帧并集"重算试穿皮肤的 bodyBox，只改 manifest，不重编码。
 * 上一版按 t=3 单帧量框，结果角色在别的帧里伸出手臂就出框了，
 * 体检把框外像素报成 alpha 残留（bgAlphaMax=255）——那是框错了，不是抠像脏。
 * 跑法：node spike/dsh-skin-rebox.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const FFMPEG = execFileSync('node', ['-e', 'process.stdout.write(require("ffmpeg-static"))']).toString()
const W = 640, H = 360
const SK = process.argv[2]
if (!SK) { console.log('用法：node spike/dsh-skin-rebox.mjs <皮肤目录>'); process.exit(1) }
const manifest = JSON.parse(readFileSync(join(SK, 'manifest.json'), 'utf8'))
const raw = join(process.env.TEMP, 'rebox.raw')

/** 抽 n 帧，返回 alpha>128 的并集包围盒。 */
function unionBox(file, frames) {
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error',
    '-c:v', 'libvpx-vp9',        // 必须显式指定解码器：ffmpeg 自带的 vp9 解码器会丢掉 alpha 块，
    '-i', file,                  // 那样整帧被当成不透明，量出来就是满屏假框
    '-vf', `select='eq(n\\,2)+eq(n\\,40)+eq(n\\,80)+eq(n\\,120)+eq(n\\,160)+eq(n\\,200)+eq(n\\,230)'`,
    '-fps_mode', 'passthrough',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', raw], { stdio: 'pipe' })
  const buf = readFileSync(raw)
  const size = W * H * 4
  const n = Math.floor(buf.length / size)
  let x0 = W, y0 = H, x1 = 0, y1 = 0
  for (let i = 0; i < n; i++) {
    const f = buf.subarray(i * size, (i + 1) * size)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (f[(y * W + x) * 4 + 3] > 128) {
          if (x < x0) x0 = x; if (x > x1) x1 = x
          if (y < y0) y0 = y; if (y > y1) y1 = y
        }
      }
    }
  }
  return { x0, y0, x1, y1, frames: n }
}

const boxes = []
const perClip = {}
for (const pool of Object.keys(manifest.pools)) {
  for (const name of manifest.pools[pool]) {
    if (perClip[name]) continue
    const b = unionBox(join(SK, 'animation', pool, name + '.webm'))
    perClip[name] = b
    boxes.push(b)
    console.log(`${pool}/${name}: x${b.x0}-${b.x1} y${b.y0}-${b.y1}（${b.frames} 帧并集）`)
  }
}
const u = boxes.reduce((a, b) => ({
  x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
}))
const pad = 6
const bodyBox = {
  x: Math.max(0, u.x0 - pad),
  y: Math.max(0, u.y0 - pad),
  w: Math.min(W, u.x1 + pad) - Math.max(0, u.x0 - pad),
  h: Math.min(H, u.y1 + pad) - Math.max(0, u.y0 - pad),
}
manifest.bodyBox = bodyBox
manifest.canvas.feetY = Math.min(H - 1, u.y1)
writeFileSync(join(SK, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
console.log(`\n新 bodyBox = ${JSON.stringify(bodyBox)}  feetY = ${manifest.canvas.feetY}`)
