/**
 * 一次性：黑幕抠像可行吗？不猜，量两件事——
 *   ① 角落背景黑到什么程度（决定 colorkey 的 similarity 要多大才抠得干净）
 *   ② 身体区域内有多少"和背景一样黑"的像素（这些会被一起抠穿，角色身上出现洞）
 * 跑法：node spike/blackkey-measure.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const FFMPEG = process.env.FFMPEG_PATH || execFileSync('node', ['-e', 'process.stdout.write(require("ffmpeg-static"))']).toString()
const W = 640, H = 360
// 色块皮肤用的默认身体框；这里只当"大概哪里是角色"用
const BODY = { x0: 200, y0: 50, x1: 440, y1: 335 }
const CORNERS = [[0, 0], [W - 40, 0], [0, H - 40], [W - 40, H - 40]]
const tmp = mkdtempSync(join(tmpdir(), 'blackkey-'))

/** 抽 5 帧拼成一段 raw RGBA。 */
function grabFrames(file) {
  const out = join(tmp, 'f.raw')
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', file,
    '-vf', "select='eq(n\\,5)+eq(n\\,60)+eq(n\\,120)+eq(n\\,180)+eq(n\\,235)',scale=" + W + ':' + H,
    '-vsync', '0', '-f', 'rawvideo', '-pix_fmt', 'rgba', out], { stdio: 'pipe' })
  const buf = readFileSync(out)
  const size = W * H * 4
  const n = Math.floor(buf.length / size)
  const frames = []
  for (let i = 0; i < n; i++) frames.push(buf.subarray(i * size, (i + 1) * size))
  return frames
}

function lum(px, off) { return Math.max(px[off], px[off + 1], px[off + 2]) }

function report(label, file) {
  const frames = grabFrames(file)
  let darkBg = 0, allBg = 0, bodyNearBlack = 0, bodyPx = 0
  let worstBgLum = 0
  for (const f of frames) {
    for (const [cx, cy] of CORNERS) {
      for (let y = cy; y < cy + 40; y += 2) {
        for (let x = cx; x < cx + 40; x += 2) {
          allBg++
          const l = lum(f, (y * W + x) * 4)
          if (l <= 10) darkBg++
          if (l > worstBgLum) worstBgLum = l
        }
      }
    }
    for (let y = BODY.y0; y < BODY.y1; y += 2) {
      for (let x = BODY.x0; x < BODY.x1; x += 2) {
        bodyPx++
        if (lum(f, (y * W + x) * 4) <= 10) bodyNearBlack++
      }
    }
  }
  const pct = (a, b) => ((a / b) * 100).toFixed(1) + '%'
  console.log(`${label}`)
  console.log(`  背景角落 ${allBg} 采样：亮度<=10 的 ${pct(darkBg, allBg)}，最亮的一处亮度 ${worstBgLum}`)
  console.log(`  身体区域 ${bodyPx} 采样：亮度<=10 的 ${pct(bodyNearBlack, bodyPx)}  ← 这些会被一起抠穿`)
}

const base = 'E:/localwork/pet-animations/animations/'
report('random/优雅女仆舞', base + 'random/优雅女仆舞.webm')
report('click/点击回应-元气挥手', base + 'click/点击回应-元气挥手.webm')
report('move/漂浮踏步', base + 'move/漂浮踏步.webm')

rmSync(tmp, { recursive: true, force: true })
