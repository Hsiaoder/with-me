/**
 * 透明通道体检：只看 alpha，判断抠像有没有把背景擦干净。
 *
 * 抽帧检查而不是只看首帧。角色在动画里平移时，首帧常常刚好落在 bodyBox 内，
 * 后面的帧才越界，只查首帧会给假阴性（第一版占位皮肤就是这么漏过去的）。
 *
 * 库用法：import { analyzeAlpha, analyzeFile, listClips } from './alpha-report.mjs'
 * 命令行：npm run alpha:check                  体检占位皮肤的全部动画
 *        node tools/alpha-report.mjs <webm> ['{"x":..,"y":..,"w":..,"h":..}']
 *        残留超阈值时退出码 1。
 */
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ffmpegPath from 'ffmpeg-static'
import { CANVAS_W, CANVAS_H, DEFAULT_BODY_BOX, ANIMATION_EXT } from '../src/shared/config.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 背景区（身体矩形之外）的 alpha 高于此值即视为灰雾残留。 */
export const BG_ALPHA_WARN = 8

/** 抽帧步长。占位动画是 24fps/4s，步长 12 取到 8 帧，足够覆盖一次完整循环。 */
export const FRAME_STRIDE = 12

/** 列出皮肤目录下所有动画文件。 */
export function listClips(skinDir) {
  return readdirSync(join(skinDir, 'animation'), { recursive: true, withFileTypes: true })
    .filter((e) => e.name.endsWith(ANIMATION_EXT))
    .map((e) => join(e.parentPath, e.name))
}

/**
 * @param rgba 整帧 RGBA 字节
 * @param w 帧宽
 * @param h 帧高
 * @param body 身体矩形（像素坐标）；框内算身体，框外算背景
 * @returns {{bgSamples:number,bgAlphaMean:number,bgAlphaMax:number,haze:boolean}}
 */
export function analyzeAlpha(rgba, w, h, body) {
  let n = 0
  let sum = 0
  let max = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inBody = x >= body.x && x < body.x + body.w && y >= body.y && y < body.y + body.h
      if (inBody) continue
      const a = rgba[(y * w + x) * 4 + 3] ?? 0
      n++
      sum += a
      if (a > max) max = a
    }
  }
  return {
    bgSamples: n,
    bgAlphaMean: n === 0 ? 0 : sum / n,
    bgAlphaMax: max,
    haze: max > BG_ALPHA_WARN,
  }
}

/** 解码若干帧成 RGBA。必须显式 libvpx-vp9，否则 alpha 位流被丢，体检结果全是假阳性。 */
export function decodeFrames(file, stride = FRAME_STRIDE) {
  return execFileSync(ffmpegPath, [
    '-v', 'error', '-c:v', 'libvpx-vp9', '-i', file,
    '-vf', `select='not(mod(n\\,${stride}))'`,
    '-fps_mode', 'passthrough',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-',
  ], { maxBuffer: 96 * 1024 * 1024 })
}

/** 逐帧体检后取最差的一帧作为结论。 */
export function analyzeFile(file, body, stride = FRAME_STRIDE) {
  const raw = decodeFrames(file, stride)
  const frameSize = CANVAS_W * CANVAS_H * 4
  const count = Math.floor(raw.length / frameSize)
  if (count === 0) throw new Error(`${file}: 解码不出任何 ${CANVAS_W}x${CANVAS_H} 帧`)
  let worst = null
  for (let i = 0; i < count; i++) {
    const r = analyzeAlpha(raw.subarray(i * frameSize, (i + 1) * frameSize), CANVAS_W, CANVAS_H, body)
    if (worst === null || r.bgAlphaMax > worst.bgAlphaMax) worst = r
  }
  return { frames: count, ...worst }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const body = process.argv[3] ? JSON.parse(process.argv[3]) : DEFAULT_BODY_BOX
  const files = process.argv[2] ? [process.argv[2]] : listClips(join(ROOT, 'skins', 'block'))
  let hazy = 0
  for (const f of files) {
    const report = analyzeFile(f, body)
    console.log(f, JSON.stringify(report))
    if (report.haze) hazy++
  }
  if (hazy > 0) {
    console.error(`${hazy}/${files.length} 段动画的背景有 alpha 残留，调小 colorkey 容差后重跑 npm run skin:test`)
    process.exitCode = 1
  }
}
