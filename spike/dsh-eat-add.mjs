/**
 * 一次性（throwaway）：往**已经存在的**试穿皮肤里补 6 段吃相，只动 eat 池。
 *
 * 为什么不直接重跑 `dsh-asar-extract.mjs`：那个脚本会整份重写 manifest，
 * 而 `inkBox`（状态栏/飘字贴墨迹用的那个框，见 problem/05 §5.24）是后来手工量出来加进去的，
 * 重写一次就没了；它还会按全部片段的并集重算 bodyBox，把吃相的像素也算进锚点合同里。
 * 所以这里只加文件 + 往 pools.eat 追加名字，其余字段原样留着。
 *
 * 跑法：node spike/dsh-eat-add.mjs ["<userData 目录>"]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ASAR = 'E:/localwork/dsh-pet-0.3.8-win-x64/resources/app.asar'
const FFMPEG = execFileSync('node', ['-e', 'process.stdout.write(require("ffmpeg-static"))']).toString()
const W = 640, H = 360
const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3])
const userData = process.argv[2] ?? 'C:/Users/11408/AppData/Local/Temp/dsh-asar-BHUAA9/pet'
const skinDir = join(userData, 'skins', 'dshtry')

/**
 * id ← 素材原名。名字与 `src/shared/food.ts` 的 `anim.name` 一一对应，
 * 其中「面条←吃午餐」「油条←吃早餐」是用户拍的板（素材里没有吃面/吃油条那两条）。
 */
const ADD = [
  { name: 'lunch', src: 'assets/webm/吃午餐.webm' },
  { name: 'breakfast', src: 'assets/webm/吃早餐.webm' },
  { name: 'watermelon', src: 'assets/webm/吃西瓜.webm' },
  { name: 'snack', src: 'assets/webm/大口吃零食.webm' },
  { name: 'icecream', src: 'assets/webm/吃冰淇淋融化.webm' },
  { name: 'ricecake', src: 'assets/webm/吃年糕.webm' },
]

const fd = openSync(ASAR, 'r')
const head = Buffer.alloc(16)
readSync(fd, head, 0, 16, 0)
const headerSize = head.readUInt32LE(12)
const BASE = 16 + headerSize
const headerBuf = Buffer.alloc(headerSize)
readSync(fd, headerBuf, 0, headerSize, 16)
const tree = JSON.parse(headerBuf.toString('utf8').replace(/\0+$/, ''))
const entries = new Map()
;(function walk(node, dir) {
  for (const [k, v] of Object.entries(node.files ?? {})) {
    const p = dir ? `${dir}/${k}` : k
    if (v.files) walk(v, p)
    else entries.set(p, { size: Number(v.size), offset: Number(v.offset) })
  }
})(tree, '')

/** asar 的 offset 相对 data 段整体差 1 字节（未文档化的历史包袱），所以靠 EBML magic 校正而不是写死 +1。 */
function extract(path, dest) {
  const e = entries.get(path)
  if (!e) throw new Error(`asar 里没有 ${path}`)
  const buf = Buffer.alloc(e.size)
  readSync(fd, buf, 0, e.size, BASE + e.offset)
  const delta = buf.indexOf(EBML)
  if (delta < 0) {
    readSync(fd, buf, 0, e.size, BASE + e.offset + 1)
    if (buf.indexOf(EBML) !== 0) throw new Error(`${path} 找不到 EBML magic，切片错位`)
  } else if (delta !== 0) {
    readSync(fd, buf, 0, e.size, BASE + e.offset + delta)
    if (buf.indexOf(EBML) !== 0) throw new Error(`${path} EBML 位置对不上`)
  }
  writeFileSync(dest, buf)
  return buf.length
}

/** 跨 7 帧取 alpha>128 的并集框 + 透明底比例（体检残留用）。 */
function unionBox(file) {
  const raw = join(tmpdir(), 'eat-add-box.raw')
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-c:v', 'libvpx-vp9', '-i', file,
    '-vf', `select='eq(n\\,2)+eq(n\\,40)+eq(n\\,80)+eq(n\\,120)+eq(n\\,160)+eq(n\\,200)+eq(n\\,230)'`,
    '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgba', raw], { stdio: 'pipe' })
  const b = readFileSync(raw)
  const size = W * H * 4
  const n = Math.floor(b.length / size)
  let x0 = W, y0 = H, x1 = 0, y1 = 0, clear = 0
  for (let i = 0; i < n; i++) {
    const f = b.subarray(i * size, (i + 1) * size)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const a = f[(y * W + x) * 4 + 3]
      if (a < 5) clear++
      if (a > 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    }
  }
  return { x0, y0, x1, y1, frames: n, clearPct: (clear / (n * W * H) * 100).toFixed(1) }
}

const manifestPath = join(skinDir, 'manifest.json')
if (!existsSync(manifestPath)) throw new Error(`找不到皮肤：${manifestPath}`)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.pools.eat ??= []
manifest.animationMeta ??= {}

const dir = join(skinDir, 'animation', 'eat')
mkdirSync(dir, { recursive: true })
for (const a of ADD) {
  const dest = join(dir, `${a.name}.webm`)
  const bytes = extract(a.src, dest)
  const box = unionBox(dest)
  if (!manifest.pools.eat.includes(a.name)) manifest.pools.eat.push(a.name)
  manifest.animationMeta[a.name] = { loop: false, mirrorable: false }
  console.log(`eat/${a.name}  ← ${a.src.split('/').pop()}  ${(bytes / 1024).toFixed(0)} KB  ` +
    `框 x${box.x0}-${box.x1} y${box.y0}-${box.y1}  透明底 ${box.clearPct}%`)
  // 透明底比例要和老片同量级（82.8% 是原片的水位）；低很多就是切片错位或素材带底
  if (Number(box.clearPct) < 60) console.log(`  ⚠ ${a.name} 透明底只有 ${box.clearPct}%，先看是不是残留`)
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
console.log(`\npools.eat = ${JSON.stringify(manifest.pools.eat)}`)
console.log(`bodyBox / inkBox 没动：${JSON.stringify(manifest.bodyBox)} / ${JSON.stringify(manifest.inkBox)}`)
