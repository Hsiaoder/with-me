/**
 * 一次性：黑幕抠像到底行不行——抠完贴洋红底出图，再数角色内部的空洞。
 *
 * 上一版量"身体框里多少近黑像素"是废的：框里本来就大半是背景。
 * 真正要问的是：抠完 alpha 之后，**被不透明像素左右夹住的透明像素**有多少——
 * 那些才是角色身上被抠穿的洞。图放 %TEMP%，眼睛判外观，数字判洞。
 * 跑法：node spike/blackkey-try.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const FFMPEG = execFileSync('node', ['-e', 'process.stdout.write(require("ffmpeg-static"))']).toString()
const W = 640, H = 360
const out = mkdtempSync(join(tmpdir(), 'blackkey-out-'))

/** 抠像 → 贴洋红底存 PNG；同时把带 alpha 的原始帧回传做统计。 */
function keyFrame(file, at, name) {
  const png = join(out, name + '.png')
  const raw = join(out, name + '.raw')
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-ss', String(at), '-i', file,
    '-f', 'lavfi', '-i', `color=c=0xFF00FF:s=${W}x${H}:r=1`,
    '-filter_complex', `[0:v]colorkey=color=0x000000:similarity=0.18:blend=0.05[fg];[1:v][fg]overlay=0:0:format=auto[png];[0:v]colorkey=color=0x000000:similarity=0.18:blend=0.05,format=rgba[out]`,
    '-map', '[png]', '-frames:v', '1', png,
    '-map', '[out]', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', raw], { stdio: 'pipe' })
  return { png, rgba: readFileSync(raw) }
}

/** 空洞率：每行找最左/最右不透明像素，中间夹着的透明像素就是被抠穿的洞。 */
function holes(rgba) {
  let inside = 0, opaque = 0
  for (let y = 0; y < H; y++) {
    let l = -1, r = -1
    for (let x = 0; x < W; x++) {
      const a = rgba[(y * W + x) * 4 + 3]
      if (a > 128) { if (l < 0) l = x; r = x; opaque++ }
    }
    if (l < 0) continue
    for (let x = l; x <= r; x++) if (rgba[(y * W + x) * 4 + 3] <= 128) inside++
  }
  return { inside, opaque, pct: opaque ? ((inside / (inside + opaque)) * 100).toFixed(1) : '0' }
}

const base = 'E:/localwork/pet-animations/animations/'
const picks = [
  ['idle-女仆舞', base + 'random/优雅女仆舞.webm', 3],
  ['click-元气挥手', base + 'click/点击回应-元气挥手.webm', 3],
  ['move-漂浮踏步', base + 'move/漂浮踏步.webm', 2],
]
for (const [name, file, at] of picks) {
  const { png, rgba } = keyFrame(file, at, name)
  const h = holes(rgba)
  console.log(`${name}: 内部空洞 ${h.inside} px / 不透明 ${h.opaque} px  →  洞占比 ${h.pct}%`)
  console.log(`  图：${png}`)
}
console.log(`\n输出目录：${out}`)
