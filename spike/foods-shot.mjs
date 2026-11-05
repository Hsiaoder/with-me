/**
 * 一次性截图探针：把食物列表叫出来，数底板四边在屏幕上占几个像素。
 * 「看着对不算对」——border-image 拉伸后边框会不会变粗/不等厚，只能数屏幕像素。
 * 跑法：node spike/foods-shot.mjs → spike/out/foods-shot.png + foods-corner.png
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

const ud = mkdtempSync(join(tmpdir(), 'foods-shot-'))
mkdirSync(join(ud, 'skins'), { recursive: true })
cpSync(SKIN_SRC, join(ud, 'skins', 'dshtry'), { recursive: true })
writeFileSync(join(ud, 'save.json'), JSON.stringify({ version: 2, skin: 'dshtry' }), 'utf8')

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, PET_USER_DATA: ud, PET_FREEZE_CURSOR: '1' },
})

const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) })
/**
 * A 套「品牌蓝白」的色名表：R=环 #6990A7，S=下边底影 #3E718C，
 * f=素材面色 #EBF5FB（留白带），P=板心 #DDEEF8（CSS 填的，和 f 差一档亮度，
 * 两条都要——它们本来就该是两个来源），w=白高光，B=青内框。
 */
const colorName = (r, g, bl, a) => {
  if (a < 40) return '.'
  const d = (x, y) => Math.abs(x - y)
  if (d(r, 62) < 18 && d(g, 113) < 18 && d(bl, 140) < 18) return 'S'
  if (d(r, 105) < 18 && d(g, 144) < 18 && d(bl, 167) < 18) return 'R'
  if (bl > 200 && r < 120) return 'B'
  if (r > 240 && g > 240 && bl > 240) return 'w'
  if (d(r, 235) < 8 && d(g, 245) < 8 && d(bl, 251) < 8) return 'f'
  if (d(r, 221) < 8 && d(g, 238) < 8 && d(bl, 248) < 8) return 'P'
  return '?'
}
const runs = (line) => {
  const out = []
  let prev = null
  let n = 0
  for (const c of line) {
    if (c === prev) n++
    else { if (prev) out.push(`${prev}x${n}`); prev = c; n = 1 }
  }
  out.push(`${prev}x${n}`)
  return out.join(' ')
}

try {
  const page = await app.firstWindow()
  await page.waitForTimeout(1600)

  const hitBody = async () => {
    const h = await page.evaluate(() => window.__petDebug.hitBox)
    await page.evaluate((p) => {
      const fire = (t) => window.dispatchEvent(new PointerEvent(t, { clientX: p.x, clientY: p.y, bubbles: true }))
      fire('pointerdown')
      fire('pointerup')
    }, { x: h.x + h.w / 2, y: h.y + h.h / 2 })
    await page.waitForTimeout(150)
  }

  await hitBody()
  mkdirSync(join('spike', 'out'), { recursive: true })
  // 先截一张动作视图：圆底（button_round_depth_line）和五枚图标是不是真的画出来了，只能看像素
  const shot = async (name) => {
    const buf = Buffer.from(
      await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0]
        return w.capturePage().then((img) => img.toPNG().toString('base64'))
      }),
      'base64',
    )
    writeFileSync(join('spike', 'out', name), buf)
    return buf
  }
  await shot('actions-shot.png')
  // 圆底单独裁一张放大 3 倍：五枚的重染是否一致、图标有没有戳出青圈，只有看像素才说得清
  const aRect = await page.evaluate(() => {
    const a = document.querySelector('.pet-actions').getBoundingClientRect()
    return { x: a.x, y: a.y, w: a.width, h: a.height, s: window.devicePixelRatio }
  })
  execFileSync(FF, [
    '-v', 'error', '-y',
    '-i', join('spike', 'out', 'actions-shot.png'),
    '-vf', `crop=${Math.round(aRect.w * aRect.s) + 24}:${Math.round(aRect.h * aRect.s) + 24}:${Math.max(0, Math.round(aRect.x * aRect.s) - 12)}:${Math.max(0, Math.round(aRect.y * aRect.s) - 12)},scale=iw*3:ih*3:flags=neighbor`,
    join('spike', 'out', 'actions-crop.png'),
  ])
  await page.click('.pet-panel button[data-id="feed"]')
  await page.waitForSelector('.pet-panel .pet-food')
  await page.waitForTimeout(400)

  const geo = await page.evaluate(() => {
    const p = document.querySelector('.pet-plate').getBoundingClientRect()
    const cs = getComputedStyle(document.querySelector('.pet-plate'))
    return {
      panel: { x: p.x, y: p.y, w: p.width, h: p.height },
      inner: { w: window.innerWidth, h: window.innerHeight },
      border: cs.borderTopWidth,
      slice: cs.borderImageSlice,
      source: cs.borderImageSource,
    }
  })
  console.log(JSON.stringify(geo))

  mkdirSync(join('spike', 'out'), { recursive: true })
  const png = await shot('foods-shot.png')
  const { w: imgW, h: imgH } = pngSize(png)
  const scale = imgW / geo.inner.w
  console.log(`截图 ${imgW}x${imgH}，scale=${scale.toFixed(3)}，面板 CSS ${geo.panel.w.toFixed(0)}x${geo.panel.h.toFixed(0)}`)

  const raw = execFileSync(FF, ['-v', 'error', '-i', join('spike', 'out', 'foods-shot.png'), '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 })
  const at = (x, y) => {
    const i = (y * imgW + x) * 4
    return colorName(raw[i], raw[i + 1], raw[i + 2], raw[i + 3])
  }
  const P = {
    x: Math.round(geo.panel.x * scale),
    y: Math.round(geo.panel.y * scale),
    w: Math.round(geo.panel.w * scale),
    h: Math.round(geo.panel.h * scale),
  }
  // 三条扫描线：左边框（取面板纵向中段）、上边框、下边框。底板贴在桌面上，
  // 桌面本身可能是蓝的，所以只看从面板外沿往内的前 20 个像素。
  for (const [label, line] of [
    ['左边', Array.from({ length: 22 }, (_, k) => at(P.x + k, P.y + Math.round(P.h / 2)))],
    ['上边', Array.from({ length: 22 }, (_, k) => at(P.x + Math.round(P.w / 2), P.y + k))],
    ['下边', Array.from({ length: 22 }, (_, k) => at(P.x + Math.round(P.w / 2), P.y + P.h - 1 - k))],
  ]) {
    console.log(`${label}（设备px）: ${runs(line)}`)
  }

  // 左上角放大 8 倍，肉眼确认四层框的圆角没有被拉歪
  const corner = execFileSync(FF, [
    '-v', 'error', '-y',
    '-i', join('spike', 'out', 'foods-shot.png'),
    '-vf', `crop=40:40:${P.x}:${P.y},scale=320:320:flags=neighbor`,
    join('spike', 'out', 'foods-corner.png'),
  ])
  console.log('已存：spike/out/foods-shot.png + foods-corner.png', String(corner || ''))
} finally {
  await app.close()
  rmSync(ud, { recursive: true, force: true, maxRetries: 8, maxRetryTime: 2000 })
}
