/**
 * 一次性截图探针：把气泡叫出来，按屏幕像素看它的边缘到底糊不糊。
 * 「放大后边缘模糊」这种观感主张只能这么验：截一帧 → 按气泡矩形裁出来 → 邻居像素逐个读。
 * 跑法：node spike/bubble-shot.mjs → spike/out/bubble-shot.png（整窗）+ bubble-crop.png（气泡 2 倍放大）
 *       + 控制台打印描边过渡宽度（同一列上从桌面到纯白要跨几个像素）。
 */
import { _electron as electron } from 'playwright'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'child_process'
import { createRequire } from 'node:module'

const FF = createRequire(import.meta.url)('ffmpeg-static')
const SKIN_SRC = join(tmpdir(), 'dsh-asar-BHUAA9', 'pet', 'skins', 'dshtry')
if (!existsSync(SKIN_SRC)) throw new Error(`试穿皮肤不在：${SKIN_SRC}（先跑 node spike/dsh-asar-extract.mjs）`)

const ud = mkdtempSync(join(tmpdir(), 'bubble-shot-'))
mkdirSync(join(ud, 'skins'), { recursive: true })
cpSync(SKIN_SRC, join(ud, 'skins', 'dshtry'), { recursive: true })
writeFileSync(join(ud, 'save.json'), JSON.stringify({ version: 2, skin: 'dshtry' }), 'utf8')

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, PET_USER_DATA: ud, PET_FREEZE_CURSOR: '1' },
})

try {
  const page = await app.firstWindow()
  await page.waitForTimeout(1600)

  // 说话按钮绕开冷却与概率，点一次放一条台词（气泡 + 那颗回应按钮一起出来）
  await page.evaluate(() => {
    const h = window.__petDebug.hitBox
    const fire = (t) => window.dispatchEvent(new PointerEvent(t, { clientX: h.x + h.w / 2, clientY: h.y + h.h / 2, bubbles: true }))
    fire('pointerdown')
    fire('pointerup')
  })
  await page.waitForTimeout(200)
  await page.click('.pet-panel button[data-id="talk"]')
  await page.waitForSelector('.pet-bubble:not([hidden])')
  await page.waitForTimeout(400)

  const geo = await page.evaluate(() => {
    const b = document.querySelector('.pet-bubble').getBoundingClientRect()
    return { x: b.x, y: b.y, w: b.width, h: b.height, dpr: window.devicePixelRatio }
  })
  console.log(JSON.stringify(geo))

  mkdirSync(join('spike', 'out'), { recursive: true })
  const png = Buffer.from(
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      return w.capturePage().then((img) => img.toPNG().toString('base64'))
    }),
    'base64',
  )
  writeFileSync(join('spike', 'out', 'bubble-shot.png'), png)
  const imgW = png.readUInt32BE(16)
  const scale = imgW / 1600

  const P = {
    x: Math.round(geo.x * scale),
    y: Math.round(geo.y * scale),
    w: Math.round(geo.w * scale),
    h: Math.round(geo.h * scale),
  }
  execFileSync(FF, [
    '-v', 'error', '-y',
    '-i', join('spike', 'out', 'bubble-shot.png'),
    '-vf', `crop=${P.w}:${P.h}:${P.x}:${P.y},scale=iw*2:ih*2:flags=neighbor`,
    join('spike', 'out', 'bubble-crop.png'),
  ])

  // 过渡宽度：在主泡**最宽那一行**上，从方框左沿往里扫到第一个不透明列，
  // 数「桌面 → 描边」摊开在几个像素上。越小说明越硬：矢量应当是 1~2 个设备像素
  // （一次 alpha 覆盖），二次重采样的位图会摊到 3~5 个。
  // 两个坑：① 不能用「框里随便找一行」——这版尾巴在左下，底部那几行左沿是尾巴不是主泡，
  //   所以走主泡圆心那一行（正圆，框内 y=110，就是框的正中）；② 不能从框沿起算固定偏移——
  //   外沿圆离框沿还有 9 个 CSS 像素，那是形状不是模糊。所以先自己找那条边。
  const raw = execFileSync(FF, ['-v', 'error', '-i', join('spike', 'out', 'bubble-shot.png'), '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 })
  const alphaAt = (x, y) => raw[(y * imgW + x) * 4 + 3]
  const k = P.w / 220                                  // CSS 像素 → 设备像素（框宽 220 CSS）
  const midY = P.y + Math.round(110 * k)               // 正圆的圆心就在框正中
  let edge = -1
  for (let x = 0; x < P.w; x++) {
    if (alphaAt(P.x + x, midY) > 200) { edge = x; break }
  }
  // 预期位置：外沿圆 512−469.33 = 42.67 单位，换算 42.67 × (220/1024) CSS × 2 设备 ≈ 18 个设备像素。
  const want = Math.round(42.67 * (220 / 1024) * k)
  console.log(edge < 0 ? '✗ 中心行上没找到气泡左沿'
    : `主泡左沿：实测 x=${edge} 设备像素（预期 ≈${want}）；过渡 alpha：${Array.from({ length: 6 }, (_, i) => alphaAt(P.x + edge - 2 + i, midY)).join(' ')}`)
  console.log(`量到的气泡框：${JSON.stringify(geo)}（该是 220×220）`)
  console.log('已存：spike/out/bubble-shot.png + bubble-crop.png')
} finally {
  await app.close()
  rmSync(ud, { recursive: true, force: true, maxRetries: 8, maxRetryTime: 2000 })
}
