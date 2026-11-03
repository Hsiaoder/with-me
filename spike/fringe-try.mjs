/**
 * 一次性：毛刺怎么消——同一段素材跑四种抠像参数，贴洋红底出图对比。
 *
 * 黑底素材的轮廓边缘是"角色色 × 黑"的中间色，colorkey 认不出那是背景，
 * 就留下一圈暗噪点当毛刺。常见解法是抠完再把 alpha 蒙版腐蚀 1 像素，
 * 整圈脏边直接削掉；代价是细发丝会变得更细。
 * 跑法：node spike/fringe-try.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const FFMPEG = execFileSync('node', ['-e', 'process.stdout.write(require("ffmpeg-static"))']).toString()
const SRC = 'E:/localwork/pet-animations/animations/random/优雅女仆舞.webm'
const outDir = process.env.TEMP || tmpdir()

const variants = [
  ['v1-现状-0.12-0.04', `[0:v]colorkey=color=0x000000:similarity=0.12:blend=0.04,format=rgba[fg]`],
  ['v2-大blend-0.12-0.14', `[0:v]colorkey=color=0x000000:similarity=0.12:blend=0.14,format=rgba[fg]`],
  ['v3-0.12加腐蚀1px', `[0:v]colorkey=color=0x000000:similarity=0.12:blend=0.04,format=rgba,split[b][m];[m]alphaextract,erosion[m2];[b][m2]alphamerge[fg]`],
  ['v4-0.20加腐蚀1px', `[0:v]colorkey=color=0x000000:similarity=0.20:blend=0.06,format=rgba,split[b][m];[m]alphaextract,erosion[m2];[b][m2]alphamerge[fg]`],
]

for (const [name, chain] of variants) {
  const png = join(outDir, `fringe-${name}.png`)
  try {
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-ss', '3', '-i', SRC,
      '-f', 'lavfi', '-i', 'color=c=0xFF00FF:s=640x360:r=1',
      '-filter_complex', `${chain};[1:v][fg]overlay=0:0:format=auto`,
      '-frames:v', '1', png], { stdio: 'pipe' })
    console.log(existsSync(png) ? `OK  ${name} → ${png}` : `缺图 ${name}`)
  } catch (e) {
    console.log(`失败 ${name}: ${String(e.stderr ?? e.message).split('\n').slice(-2).join(' ').slice(0, 140)}`)
  }
}
