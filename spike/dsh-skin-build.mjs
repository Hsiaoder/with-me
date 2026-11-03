/**
 * 一次性：把 dsh-pet 的三段黑底素材抠成带 alpha 的 VP9，装成一个能装载的皮肤包看效果。
 *
 * 全部产物落在 %TEMP%，不进仓库——这批是腾讯 QQ 宠形象系的素材，
 * 我们要上直播带打赏，把别人的画进仓库是另一码事（见记忆 project-dafeiyu-license）。
 * 跑法：node spike/dsh-skin-build.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const FFMPEG = execFileSync('node', ['-e', 'process.stdout.write(require("ffmpeg-static"))']).toString()
const W = 640, H = 360
const SRC = 'E:/localwork/pet-animations/animations/'
const SIM = '0.12'      // 比 0.18 小：只吃真黑，尽量不啃轮廓
const BLEND = '0.04'
const KEY = `colorkey=color=0x000000:similarity=${SIM}:blend=${BLEND}`

/** 皮肤落在临时 userData 里：主进程按 save.skin 去 userData/skins 找。 */
const userData = join(mkdtempSync(join(tmpdir(), 'dsh-user-')), 'pet')
const skinDir = join(userData, 'skins', 'dshtry')

/** 抠像后取 alpha 包围盒：bodyBox 要按素材实际占位来定，不能猜。 */
function alphaBox(file, at) {
  const raw = join(tmpdir(), 'dsh-abox.raw')
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-ss', String(at), '-i', file,
    '-vf', `${KEY},format=rgba`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', raw], { stdio: 'pipe' })
  const b = readFileSync(raw)
  let x0 = W, y0 = H, x1 = 0, y1 = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (b[(y * W + x) * 4 + 3] > 128) {
        if (x < x0) x0 = x; if (x > x1) x1 = x
        if (y < y0) y0 = y; if (y > y1) y1 = y
      }
    }
  }
  return { x0, y0, x1, y1 }
}

/** 编码：VP9 + yuva420p，且必须显式 libvpx-vp9，否则静默丢 alpha。 */
function encode(file, dest) {
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', file,
    '-vf', `${KEY},format=yuva420p`,
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-crf', '30', '-b:v', '0',
    '-auto-alt-ref', '0', '-row-mt', '1', '-an', dest], { stdio: 'pipe' })
}

const picks = [
  { pool: 'idle', name: 'maid-dance', src: 'random/优雅女仆舞.webm' },
  { pool: 'click', name: 'wave', src: 'click/点击回应-元气挥手.webm' },
  { pool: 'move', name: 'steps', src: 'move/漂浮踏步.webm' },
]
// 契约要求五个必需池一个都不能少，这批素材里没有"被抓"的动作，
// 先用别的段占位（只为看效果，不是成品皮肤）
const fill = { turn: 'maid-dance', drag: 'wave' }

const boxes = []
for (const p of picks) {
  const dir = join(skinDir, 'animation', p.pool)
  mkdirSync(dir, { recursive: true })
  const src = SRC + p.src
  const dest = join(dir, p.name + '.webm')
  const t = existsSync(src) ? src : null
  if (!t) { console.log(`跳过（找不到源）：${src}`); continue }
  encode(t, dest)
  const box = alphaBox(t, 3)
  boxes.push(box)
  const kb = (readFileSync(dest).length / 1024).toFixed(0)
  console.log(`${p.pool}/${p.name}  ← ${p.src}   ${kb} KB   包围盒 x${box.x0}-${box.x1} y${box.y0}-${box.y1}`)
}
for (const [pool, name] of Object.entries(fill)) {
  const from = picks.find((p) => p.name === name)
  if (!from) continue
  const dir = join(skinDir, 'animation', pool)
  mkdirSync(dir, { recursive: true })
  copyFileSync(join(skinDir, 'animation', from.pool, name + '.webm'), join(dir, name + '.webm'))
  console.log(`${pool}/${name}  ← 占位复用（素材里没有这一类动作）`)
}

// 包围盒取并集，再留 4px 余量并夹进画布
const u = boxes.reduce((a, b) => ({
  x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
}), { x0: W, y0: H, x1: 0, y1: 0 })
const pad = 4
const bodyBox = {
  x: Math.max(0, u.x0 - pad), y: Math.max(0, u.y0 - pad),
  w: Math.min(W - Math.max(0, u.x0 - pad), (u.x1 + pad) - (u.x0 - pad)),
  h: Math.min(H - Math.max(0, u.y0 - pad), (u.y1 + pad) - (u.y0 - pad)),
}
const pools = {}
for (const p of picks) (pools[p.pool] ??= []).push(p.name)
for (const [pool, name] of Object.entries(fill)) (pools[pool] ??= []).push(name)
const animationMeta = {}
for (const p of picks) animationMeta[p.name] = { loop: false, mirrorable: p.pool === 'turn' }

writeFileSync(join(skinDir, 'manifest.json'), JSON.stringify({
  formatVersion: 1,
  name: 'DSH 试穿（占位，不入库）',
  author: '导入自 dsh-pet 素材，仅本地看效果',
  canvas: { w: W, h: H, feetY: Math.min(H - 1, u.y1) },
  bodyBox, pools, animationMeta, hotspots: {},
}, null, 2), 'utf8')
writeFileSync(join(userData, 'save.json'), JSON.stringify({
  version: 1, skin: 'dshtry', stats: { hunger: 80, mind: 80, clean: 80, mood: 80 }, lastSeenAt: Date.now(),
}, null, 2), 'utf8')

console.log(`\nbodyBox = ${JSON.stringify(bodyBox)}`)
console.log(`feetY = ${Math.min(H - 1, u.y1)}`)
console.log(`皮肤目录：${skinDir}`)
console.log(`userData：${userData}`)
console.log(`启动看效果：PET_USER_DATA="${userData}" npx electron .`)
