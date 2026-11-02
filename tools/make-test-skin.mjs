/**
 * 生成占位皮肤「色块」：蓝幕 → 抠像 → 带 alpha 的 VP9 webm。
 * 跑一遍真实素材管线，验证设计文档第 6 节的三个坑（编码丢 alpha、蓝幕误伤角色、容差过宽）。
 *
 * 色块只在 bodyBox 内部做原地动作，不做位移。真实设计里「走路」是靠移动舞台位置实现的，
 * 动画自身平移只会让角色跑出命中框（第一版就是这么踩到的，见 tools/alpha-report.mjs 的多帧检查）。
 *
 * 用法：node tools/make-test-skin.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpegPath from 'ffmpeg-static'
import { CANVAS_W, CANVAS_H, FEET_Y, DEFAULT_BODY_BOX } from '../src/shared/config.ts'

const FPS = 24
const DUR = 4
const BLUE = '0x0000FF'
/** 蓝幕色，故意不用绿幕——角色身上有荧光绿发光件，绿幕会把它一起抠掉。 */
const GREEN = '0x2CE68A'

/** 浮动幅度。sin/cos 会往上下两个方向走，基准点和高度都要各让出一份，否则色块会顶出 bodyBox。 */
const BOB = 8
const BOX_W = DEFAULT_BODY_BOX.w - 40
const BASE_X = DEFAULT_BODY_BOX.x + (DEFAULT_BODY_BOX.w - BOX_W) / 2
const BASE_Y = DEFAULT_BODY_BOX.y + BOB
const BOX_H = FEET_Y - BASE_Y - BOB

/**
 * 池 / 名字 / 色块颜色 / 横向表达式 / 纵向表达式（overlay 的 eval=frame 支持 t）。
 * 周期必须整除 DUR，否则末帧回不到首帧那个姿势，接缝会跳（素材合同，见皮肤包契约 spec 第 4.1 节）。
 */
const CLIPS = [
  ['idle', 'patrol', GREEN, `${BASE_X}`, `${BASE_Y}+${BOB}*sin(2*PI*t/2)`],
  ['idle', 'patrol2', GREEN, `${BASE_X}`, `${BASE_Y}+${BOB}*cos(2*PI*t/4)`],
  ['turn', 'left', '0xE6A32C', `${BASE_X}+20*sin(2*PI*t/1)`, `${BASE_Y}`],
  ['move', 'step', GREEN, `${BASE_X}+20*sin(2*PI*t/2)`, `${BASE_Y}+${BOB}*sin(2*PI*t/0.5)`],
  ['click', 'tapped', '0xE6572C', `${BASE_X}`, `${BASE_Y}`],
  ['drag', 'pulled', '0xE62CA8', `${BASE_X}`, `${BASE_Y}+${BOB}*sin(2*PI*t/1)`],
]

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'skins', 'block')

for (const [pool, name, color, xExpr, yExpr] of CLIPS) {
  const dir = join(OUT_DIR, 'animation', pool)
  mkdirSync(dir, { recursive: true })
  const out = join(dir, `${name}.webm`)
  const filter =
    // 蓝底 + 会动的色块 → 抠掉蓝幕产生 alpha → 转 yuva420p 交给 VP9
    `[0:v][1:v]overlay=eval=frame:x='${xExpr}':y='${yExpr}'` +
    `,format=rgba,colorkey=${BLUE}:0.30:0.05,format=yuva420p`
  execFileSync(ffmpegPath, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=${BLUE}:s=${CANVAS_W}x${CANVAS_H}:d=${DUR}:r=${FPS}`,
    '-f', 'lavfi', '-i', `color=c=${color}:s=${BOX_W}x${BOX_H}:d=${DUR}:r=${FPS}`,
    '-filter_complex', filter,
    '-c:v', 'libvpx-vp9',   // 不显式指定编码器，ffmpeg 会挑一个把 alpha 静默丢掉
    '-pix_fmt', 'yuva420p',
    '-crf', '8', '-b:v', '0',
    '-auto-alt-ref', '0',   // alpha 模式下必须关，否则透明帧被参考帧污染
    '-row-mt', '1',
    '-an', out,
  ], { stdio: 'inherit' })
  console.log('ok', out)
}
