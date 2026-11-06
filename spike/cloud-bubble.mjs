/**
 * 一次性探针（throwaway）：把云朵气泡摆进真窗口看一帧，并当场验内容块落不落在白腔里。
 *
 * 为什么要真窗口：轮廓在纸上算得，但「像不像一朵云」「尾巴会不会看着像掉了三颗珠子」
 * 只能看。内容块那条是纯数学（`fitsInsideCloud`），一起打出来是为了万一截图好看
 * 而数学不过时，能立刻看出是哪一个角越界。
 *
 * 跑法：node spike/cloud-bubble.mjs → spike/out/cloud-bubble.png
 */
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CLOUD, cloudScale, fitsInsideCloud, insideCloud } from '../src/shared/bubble-shape.ts'

const svg = readFileSync('src/renderer/emotes/bubble.svg', 'utf8')
const W = 208, H = 188
const k = cloudScale(CLOUD, W)
const box = { x: 29, y: 57, w: 150, h: 86 }        // 文字 60 + 缝 4 + 回应按钮 22
const u = { x: box.x / k, y: box.y / k, w: box.w / k, h: box.h / k }

console.log(`显示 ${W}×${H}（比例 ${k}），内容块 CSS ${JSON.stringify(box)}`)
for (const pad of [0, 6, 12, 18]) {
  console.log(`  离白边留 ${pad} 单位 → ${fitsInsideCloud(CLOUD, u, pad) ? '在腔内' : '越界'}`)
}
// 逐角 + 逐边中点，越界时才知道顶的是哪一处
const probe = [
  ['左上', u.x, u.y], ['右上', u.x + u.w, u.y],
  ['左下', u.x, u.y + u.h], ['右下', u.x + u.w, u.y + u.h],
  ['上中', u.x + u.w / 2, u.y], ['下中', u.x + u.w / 2, u.y + u.h],
  ['左中', u.x, u.y + u.h / 2], ['右中', u.x + u.w, u.y + u.h / 2],
]
for (const [name, x, y] of probe) {
  console.log(`  ${name} (${Math.round(x)},${Math.round(y)}) 在白色内腔里：${insideCloud(CLOUD, x, y)}`)
}
// 形状的包围盒（含环），确认没被画布裁掉
const grown = {
  ...CLOUD,
  body: {
    x: CLOUD.body.x - CLOUD.ring,
    y: CLOUD.body.y - CLOUD.ring,
    w: CLOUD.body.w + CLOUD.ring * 2,
    h: CLOUD.body.h + CLOUD.ring * 2,
    r: CLOUD.body.r + CLOUD.ring,
  },
  bumps: CLOUD.bumps.map((c) => ({ ...c, r: c.r + CLOUD.ring })),
  tail: CLOUD.tail.map((c) => ({ ...c, r: c.r + CLOUD.ring })),
}
let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
for (let y = 0; y < CLOUD.vb.h; y++) {
  for (let x = 0; x < CLOUD.vb.w; x++) {
    if (insideCloud(grown, x, y)) {
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
}
console.log(`含环的墨迹包围盒 ${JSON.stringify({ x0, y0, x1, y1 })}，画布 ${CLOUD.vb.w}×${CLOUD.vb.h}`)
console.log(`  → 显示坐标 CSS x ${(x0 * k).toFixed(1)}..${(x1 * k).toFixed(1)}、` +
  `y ${(y0 * k).toFixed(1)}..${(y1 * k).toFixed(1)}（离画布边：左 ${(x0 * k).toFixed(1)} 右 ${(W - x1 * k).toFixed(1)} 上 ${(y0 * k).toFixed(1)} 下 ${(H - y1 * k).toFixed(1)}）`)

const ud = mkdtempSync(join(tmpdir(), 'cloud-bubble-'))
const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, PET_USER_DATA: ud, PET_FREEZE_CURSOR: '1' },
})
const page = await app.firstWindow()
await page.waitForFunction(() => document.querySelectorAll('video').length === 2, null, { timeout: 30_000 })
await page.evaluate(({ markup, w, h, box }) => {
  const host = document.createElement('div')
  host.id = 'cloud-probe'
  host.style.cssText = `position:fixed;left:40px;top:40px;width:${w}px;height:${h}px;background:#8fb4d8`
  host.innerHTML = markup +
    `<div style="position:absolute;left:${box.x}px;top:${box.y}px;width:${box.w}px;height:60px;border:1px dashed #d0455a"></div>` +
    `<div style="position:absolute;left:${box.x}px;top:${box.y + 64}px;width:${box.w}px;height:22px;border:1px dashed #d0455a"></div>`
  document.body.append(host)
}, { markup: svg.replace('<svg ', `<svg width="${W}" height="${H}" style="position:absolute;inset:0" `), w: W, h: H, box })
mkdirSync(join('spike', 'out'), { recursive: true })
await page.screenshot({ path: join('spike', 'out', 'cloud-bubble.png'), clip: { x: 30, y: 30, width: W + 20, height: H + 20 } })
await app.close()
try { rmSync(ud, { recursive: true, force: true }) } catch { /* 句柄没放干净就算了 */ }
console.log('写出 spike/out/cloud-bubble.png（红虚线框 = 文字与回应按钮的位置）')
