/**
 * 从 `src/shared/bubble-shape.ts` 那一份图元清单生成云朵气泡底图。
 *
 * 为什么生成而不是手写：形状合同要同时被 config 的几何和测试用，手写 SVG 就等于
 * 让「素材里的形状」和「代码算的内腔」各活各的——上一版换形状时那三处数字全靠手重算。
 * 现在改形状只改清单，然后 `node tools/make-bubble-svg.mjs`。
 *
 * 跑法：node tools/make-bubble-svg.mjs [--check]
 *   --check 只比对已提交的素材与生成结果是否一致，不写文件（测试里用）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CLOUD } from '../src/shared/bubble-shape.ts'

const OUT = join('src', 'renderer', 'emotes', 'bubble.svg')
const RING_FILL = '#92c7e3'
const CAVITY_FILL = '#ffffff'

/** 外扩 t：圆就是半径加 t，圆角矩形是四边各外扩、圆角再加 t（Minkowski 膨胀对这两类都是闭式）。 */
function expand(shape, t) {
  return {
    circles: [...shape.bumps, ...shape.foots, ...shape.tail].map((c) => ({ ...c, r: c.r + t })),
    rect: {
      x: shape.body.x - t,
      y: shape.body.y - t,
      w: shape.body.w + t * 2,
      h: shape.body.h + t * 2,
      r: shape.body.r + t,
    },
  }
}

function render(shape) {
  const ring = expand(shape, shape.ring)
  const inner = expand(shape, 0)
  const layer = (g, fill) =>
    `  <g fill="${fill}">\n` +
    `    <rect x="${g.rect.x}" y="${g.rect.y}" width="${g.rect.w}" height="${g.rect.h}" rx="${g.rect.r}" />\n` +
    g.circles.map((c) => `    <circle cx="${c.x}" cy="${c.y}" r="${c.r}" />`).join('\n') +
    '\n  </g>'
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${shape.vb.w} ${shape.vb.h}">\n` +
    '  <!-- 生成物：别手改。改形状去改 src/shared/bubble-shape.ts 那份图元清单，' +
    '再跑 node tools/make-bubble-svg.mjs -->\n' +
    `  ${layer(ring, RING_FILL).trimStart()}\n` +
    `  ${layer(inner, CAVITY_FILL).trimStart()}\n` +
    '</svg>\n'
  )
}

const svg = render(CLOUD)
if (process.argv.includes('--check')) {
  const current = readFileSync(OUT, 'utf8')
  if (current !== svg) {
    console.error('bubble.svg 与图元清单不一致，跑：node tools/make-bubble-svg.mjs')
    process.exit(1)
  }
  console.log('bubble.svg 与清单一致')
} else {
  writeFileSync(OUT, svg, 'utf8')
  console.log(`写出 ${OUT}（${CLOUD.vb.w}×${CLOUD.vb.h} 单位，环厚 ${CLOUD.ring}）`)
}
