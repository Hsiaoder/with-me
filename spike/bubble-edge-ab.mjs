/**
 * 一次性 A/B：同一枚气泡，左边是「32×32 位图放大 5 倍」，右边是「按同一套轮廓画的 SVG」。
 * 数的是左边缘那一列上「蓝线摊开在几个像素里」——位图放大是二次采样，一条 1px 的线会被抹成
 * 一条带渐变的软边；矢量只在该抗锯齿的那 1 个像素上抗锯齿。
 * 跑法：node spike/bubble-edge-ab.mjs → spike/out/bubble-edge-ab.png + 控制台两行读数
 * 前置：spike/out/bubble-old.png 是上一版位图，用 git 从改动前抠出来：
 *       `git show HEAD:src/renderer/emotes/bubble.png > spike/out/bubble-old.png`
 * 像素一律用 ffmpeg 解码整帧来读：app:// 页面里 file:/// 的图取不到（drawImage 会 EncodingError）。
 */
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'child_process'
import { createRequire } from 'node:module'

const FF = createRequire(import.meta.url)('ffmpeg-static')
const OLD = 'spike/out/bubble-old.png'
if (!existsSync(OLD)) {
  throw new Error(`缺上一版位图：${OLD}（先跑 git show HEAD:src/renderer/emotes/bubble.png > ${OLD}）`)
}

const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env: { ...process.env } })
const page = await app.firstWindow()

const cell = (src, label) => `<figure style="margin:0;text-align:center">
  <img src="${src}" style="display:block;width:160px;height:160px"><figcaption>${label}</figcaption>
</figure>`
await page.setContent(`<body style="margin:0;display:flex;gap:20px;background:#fff">
  ${cell('app://assets/renderer/emotes/bubble.svg', 'SVG 同轮廓')}
  ${cell('data:image/png;base64,' + readFileSync(OLD).toString('base64'), 'PNG 32×32 放大 5 倍')}
</body>`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)

const shot = join('spike', 'out', 'bubble-edge-ab.png')
mkdirSync('spike/out', { recursive: true })
await page.screenshot({ path: shot })

const rects = await page.evaluate(() =>
  [...document.querySelectorAll('img')].map((i) => {
    const r = i.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  }))
const innerW = await page.evaluate(() => window.innerWidth)

const head = readFileSync(shot)
const W = head.readUInt32BE(16)
const scale = W / innerW
const raw = execFileSync(FF, ['-v', 'error', '-i', shot, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 26 })

/** 沿左边缘中线取一列，往后数 24 个设备像素：描边实色 = 不透明且不是纯白；半透明 = 0<alpha<255。 */
for (const [label, r] of [['SVG ', rects[0]], ['PNG ', rects[1]]]) {
  const x0 = Math.round(r.x * scale)
  const y = Math.round((r.y + r.h / 2) * scale)
  const seen = []
  for (let k = 0; k < 24; k++) {
    const i = (y * W + x0 + k) * 4
    seen.push([raw[i], raw[i + 1], raw[i + 2], raw[i + 3]])
  }
  const ink = seen.filter(([rr, gg, bb, aa]) => aa > 200 && !(rr > 250 && gg > 250 && bb > 250)).length
  const ramp = seen.filter(([, , , aa]) => aa > 0 && aa < 200).length
  console.log(`${label}：描边实色 ${ink} 个设备像素，半透明过渡 ${ramp} 个`)
  console.log('   ' + seen.slice(0, 14).map(([rr, gg, bb, aa]) => `${rr}/${gg}/${bb}/${aa}`).join(' '))
}
await app.close()
