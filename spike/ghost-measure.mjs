/**
 * 一次性：量「打断正在播的那条、切到另一条」时，叠化那 0.18 秒里屏幕上有多像两个轮廓。
 *
 * 交叉淡入的前提是**退场那张正好停在标准正面姿势**（素材合同：末帧回到首帧）。
 * 可拖拽/点击是半路打断，退场帧停在动作中间，进场帧是正面起步——
 * 两个不重合的轮廓各半透明地叠 0.18 秒，观感就是「闪一下」。
 * 占位皮肤所有素材长得一样，所以这条前提从来没被真素材考过。
 *
 * 跑法：node spike/ghost-measure.mjs <皮肤目录>
 */
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const FFMPEG = execFileSync('node', ['-e', 'process.stdout.write(require("ffmpeg-static"))']).toString()
const SK = process.argv[2]
if (!SK) { console.log('用法：node spike/ghost-measure.mjs <皮肤目录>'); process.exit(1) }
const W = 640, H = 360, SZ = W * H * 4

function frames(file) {
  const raw = execFileSync(FFMPEG, ['-loglevel', 'error', '-c:v', 'libvpx-vp9', '-i', file,
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 30 })
  const n = Math.floor(raw.length / SZ)
  return Array.from({ length: n }, (_, i) => raw.subarray(i * SZ, (i + 1) * SZ))
}

function mismatch(a, b) {
  let both = 0, onlyA = 0, onlyB = 0
  for (let i = 0; i < a.length; i += 4) {
    const A = a[i + 3] > 128, B = b[i + 3] > 128
    if (A && B) both++
    else if (A) onlyA++
    else if (B) onlyB++
  }
  return (onlyA + onlyB) / Math.max(1, both + onlyA + onlyB)
}

const clips = {}
for (const pool of readdirSync(join(SK, 'animation')))
  for (const f of readdirSync(join(SK, 'animation', pool)))
    clips[`${pool}/${f.replace('.webm', '')}`] = frames(join(SK, 'animation', pool, f))

/** 探针实测到的那一次：拖拽松手时 wave 冻在 1.23 秒（第 24fps×1.23≈29 帧），grab 从 0 起步。 */
const cases = [
  ['click/wave', 29, 'drag/grab', 0],
  ['idle/breath', 60, 'drag/grab', 0],
  ['click/wave', 100, 'idle/breath', 0],
  ['turn/look', 96, 'idle/breath', 0],
  // 对照组：合同成立的自然收尾（末帧 ↔ 首帧），这条本来就该看不见
  ['idle/breath', 240, 'idle/breath', 0],
  ['move/float', 240, 'idle/breath', 0],
]

for (const [outName, outFrame, inName, inFrame] of cases) {
  const m = mismatch(clips[outName][outFrame], clips[inName][inFrame])
  console.log(`退场 ${outName}@第${outFrame}帧 → 进场 ${inName}@第${inFrame}帧：轮廓不重合 ${(m * 100).toFixed(1)}%`)
}
