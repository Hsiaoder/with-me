/**
 * 一次性量距离：飘字胶囊离宠物**看得见的身子**有多远。
 *
 * 为什么要量：`FLOAT_GAP` 是相对 `hitBox` 的，而 hitBox 来自 manifest 的 bodyBox。
 * bodyBox 是「点哪儿算点到它」的命中框，本来就该比画得下的姿势宽；鲸鱼的墨迹
 * 在 bodyBox 里还留着一圈空——那圈空是**看不见的距离**，加在 8px 上就是用户说的「离得远」。
 *
 * 视频画布是 app://skin（和页面的 app://assets 不同源），drawImage 之后 getImageData
 * 会被判 tainted，所以这里把 webm 读成 blob: URL 再解码——同源就能读像素。
 * 跑法：node spike/float-gap.mjs
 */
import { _electron as electron } from 'playwright'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SKIN = 'C:/Users/11408/AppData/Local/Temp/dsh-asar-BHUAA9/pet/skins/dshtry'
const manifest = JSON.parse(readFileSync(join(SKIN, 'manifest.json'), 'utf8'))
const CLIPS = ['animation/idle/breath.webm', 'animation/eat/rice.webm', 'animation/eat/hotpot.webm']

const userData = mkdtempSync(join(tmpdir(), 'pet-gap-probe-'))
const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, PET_USER_DATA: userData, PET_FREEZE_CURSOR: '1' },
})
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => document.querySelectorAll('video').length === 2, null, { timeout: 30_000 })
  for (const rel of CLIPS) {
    const b64 = readFileSync(join(SKIN, rel)).toString('base64')
    const got = await page.evaluate(async (data) => {
      const v = document.createElement('video')
      v.src = 'data:video/webm;base64,' + data
      v.muted = true
      await new Promise((r) => { v.onloadeddata = r; v.onerror = r })
      v.currentTime = Math.min(0.4, (v.duration || 1) / 2)
      await new Promise((r) => { v.onseeked = r })
      const c = new OffscreenCanvas(v.videoWidth, v.videoHeight)
      const g = c.getContext('2d', { willReadFrequently: true })
      g.drawImage(v, 0, 0)
      const d = g.getImageData(0, 0, c.width, c.height).data
      let minx = c.width, maxx = -1, miny = c.height, maxy = -1
      for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
        if (d[(y * c.width + x) * 4 + 3] > 24) {
          if (x < minx) minx = x; if (x > maxx) maxx = x
          if (y < miny) miny = y; if (y > maxy) maxy = y
        }
      }
      return { cw: c.width, ch: c.height, minx, maxx, miny, maxy }
    }, b64)
    const sx = 320 / manifest.canvas.w
    const sy = 180 / manifest.canvas.h
    const bb = manifest.bodyBox
    const slackL = (got.minx - bb.x) * sx
    const slackR = (bb.x + bb.w - got.maxx) * sx
    const slackT = (got.miny - bb.y) * sy
    console.log(
      `${rel.padEnd(30)} 画布 ${got.cw}x${got.ch} 墨迹 x ${got.minx}..${got.maxx} y ${got.miny}..${got.maxy}` +
      ` → bodyBox 左边空 ${slackL.toFixed(1)}px、右边空 ${slackR.toFixed(1)}px、顶上空 ${slackT.toFixed(1)}px（CSS 像素）`,
    )
  }
  console.log(`\nbodyBox = ${JSON.stringify(manifest.bodyBox)}，画布 ${JSON.stringify(manifest.canvas)}，舞台 320×180`)
  console.log('于是屏幕上「胶囊右沿 → 鲸鱼左沿」的实际间距 = FLOAT_GAP + 上面那个左边空量')
} finally {
  await app?.close().catch(() => {})
  try {
    rmSync(userData, { recursive: true, force: true })
  } catch { /* EBUSY */ }
}
