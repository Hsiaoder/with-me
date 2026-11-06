/**
 * 一次性探针（throwaway）：把宠物当前这一帧截下来，按颜色聚类，连带每簇的**平均位置**一起打印
 * ——不然分不清哪簇是头发、哪簇是发箍。
 *
 * 为什么截图而不是在页面里 drawImage(video) 读像素：皮肤的 video 挂在 `app://skin` 主机下，
 * 和页面的 `app://assets` 不同源，canvas 会被判定污染（`getImageData` 直接 SecurityError，实测撞过）。
 * 截图走合成器，拿到的就是用户屏幕上真的那几颗像素。`omitBackground` 保住 alpha，
 * 才分得清「素材里的白」和「透明底被摊成的白」。
 *
 * 只取**色值**：dshtry 那套皮肤授权没谈拢、只在本地试穿，不进仓库也不打包；
 * 一个 hex 不是作品的一部分，逐帧抠图才是。
 *
 * 跑法：node spike/pet-palette.mjs → spike/out/pet-frame.png
 */
import { _electron as electron } from 'playwright'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodePng } from './png-decode.mjs'

const LIVE = 'C:/Users/11408/AppData/Local/Temp/dsh-asar-BHUAA9/pet'
const ud = mkdtempSync(join(tmpdir(), 'pet-palette-'))
writeFileSync(join(ud, 'save.json'), readFileSync(join(LIVE, 'save.json'), 'utf8'), 'utf8')
cpSync(join(LIVE, 'skins'), join(ud, 'skins'), { recursive: true })

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, PET_USER_DATA: ud.replace(/\\/g, '/'), PET_FREEZE_CURSOR: '1' },
})
const page = await app.firstWindow()
await page.waitForFunction(() => document.querySelectorAll('video').length === 2, null, { timeout: 30_000 })
await page.waitForTimeout(1500)
await page.evaluate(() => window.__petDebug.hidePanel?.())
await page.waitForTimeout(300)
const box = await page.evaluate(() => {
  const i = window.__petDebug.inkBox
  return { x: Math.round(i.x), y: Math.round(i.y), width: Math.round(i.w), height: Math.round(i.h) }
})
mkdirSync(join('spike', 'out'), { recursive: true })
const file = join('spike', 'out', 'pet-frame.png')
await page.screenshot({ path: file, clip: box, omitBackground: true })
await app.close()
try { rmSync(ud, { recursive: true, force: true }) } catch { /* 句柄没放干净就算了 */ }

const { W, H, ch, px } = decodePng(readFileSync(file))
const m = new Map()
let solid = 0
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W * ch + x * ch
    if (px[i + 3] < 200) continue
    solid++
    // 32 一档的粗量化：深蓝头发和它的阴影会并成一簇，够挑色了
    const k = `${px[i] >> 5},${px[i + 1] >> 5},${px[i + 2] >> 5}`
    const e = m.get(k) ?? { n: 0, r: 0, g: 0, b: 0, sx: 0, sy: 0 }
    e.n++; e.r += px[i]; e.g += px[i + 1]; e.b += px[i + 2]; e.sx += x; e.sy += y
    m.set(k, e)
  }
}
console.log(`${W}×${H}，实心像素 ${solid}（${((solid / (W * H)) * 100).toFixed(0)}% 覆盖率）`)
console.log('位置 = 归一化 y,x：0=头顶/左，1=脚底/右')
const rows = [...m.values()].sort((a, b) => b.n - a.n).slice(0, 16)
for (const e of rows) {
  const rgb = [e.r, e.g, e.b].map((v) => Math.round(v / e.n))
  const hex = `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`
  const cy = (e.sy / e.n / H).toFixed(2), cx = (e.sx / e.n / W).toFixed(2)
  console.log(`  ${hex}  占 ${(((e.n / solid) * 100).toFixed(1)).padStart(5)}%  平均在 y=${cy} x=${cx}`)
}
console.log('写出 spike/out/pet-frame.png')
