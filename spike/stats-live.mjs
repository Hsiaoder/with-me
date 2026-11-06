/**
 * 一次性探针（throwaway，不进门禁）：拿真存档的副本把新版状态栏叫出来，量+截一帧。
 *
 * 为什么还要单独跑一次：e2e 用的是仓库自带的 block 皮肤，墨迹内缩只有 10px；
 * 用户看的是 dshtry 那套鲸鱼，内缩 37px——「离得远」要在这套上量才算数。
 * 副本 = 只读地复制一份到临时 userData，绝不回写真存档。
 *
 * 跑法：node spike/stats-live.mjs → spike/out/stats-live.png
 */
import { _electron as electron } from 'playwright'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LIVE = 'C:/Users/11408/AppData/Local/Temp/dsh-asar-BHUAA9/pet'
const live = JSON.parse(readFileSync(join(LIVE, 'save.json'), 'utf8'))
console.log('真存档 identity：', JSON.stringify(live.identity))

const ud = mkdtempSync(join(tmpdir(), 'stats-live-'))
writeFileSync(join(ud, 'save.json'), JSON.stringify(live), 'utf8')
cpSync(join(LIVE, 'skins'), join(ud, 'skins'), { recursive: true })

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, PET_USER_DATA: ud.replace(/\\/g, '/'), PET_FREEZE_CURSOR: '1' },
})
const page = await app.firstWindow()
await page.waitForFunction(() => document.querySelectorAll('video').length === 2, null, { timeout: 30_000 })
await page.waitForTimeout(1500)

const read = () => page.evaluate(() => {
  const hit = window.__petDebug.hitBox
  const ink = window.__petDebug.inkBox
  const plate = document.querySelector('.pet-plate.is-stats')
  const r = plate.getBoundingClientRect()
  const g = document.querySelector('.pet-gender')
  const cs = getComputedStyle(g)
  return {
    pool: window.__petDebug.current.pool,
    lines: [...document.querySelectorAll('.pet-stat-line')].map((n) => n.textContent),
    activity: document.querySelector('.pet-stats-activity')?.textContent,
    online: document.querySelector('.pet-stats-online')?.textContent,
    gender: { text: g.textContent, color: cs.color, bg: cs.backgroundColor, border: cs.borderTopWidth },
    gapToInk: Math.round(r.x - (ink.x + ink.w)),
    gapToHit: Math.round(r.x - (hit.x + hit.w)),
    inkInsetRight: Math.round((hit.x + hit.w) - (ink.x + ink.w)),
    box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    hit: { x: Math.round(hit.x), y: Math.round(hit.y), w: Math.round(hit.w), h: Math.round(hit.h) },
  }
})

await page.evaluate((p) => window.__petDebug.moveTo(p), { x: 500, y: 300 })
await page.waitForTimeout(200)
const center = await page.evaluate(() => {
  const h = window.__petDebug.hitBox
  return { x: h.x + h.w / 2, y: h.y + h.h / 2 }
})
await page.evaluate((p) => {
  const fire = (t) => window.dispatchEvent(new PointerEvent(t, { clientX: p.x, clientY: p.y, bubbles: true }))
  fire('pointerdown')
  fire('pointerup')
}, center)
await page.click('.pet-actions button[data-id="status"]')
await page.waitForSelector('.pet-plate.is-stats')
await page.waitForTimeout(300)
const a = await read()
console.log('第一次读：', JSON.stringify(a, null, 1))
await page.waitForTimeout(1300)
const b = await read()
console.log(`1.3 秒后：activity=${b.activity} online=${b.online}（前一次 ${a.online}）`)

// 反向对照：把副板临时贴回命中框，量出来的距离应该正好多出墨迹内缩那一截
const wrong = await page.evaluate(() => {
  const plate = document.querySelector('.pet-plate.is-stats')
  const hit = window.__petDebug.hitBox
  const ink = window.__petDebug.inkBox
  const y = plate.getBoundingClientRect().y
  plate.style.transform = `translate(${Math.round(hit.x + hit.w + 16)}px, ${Math.round(y)}px)`
  return Math.round(plate.getBoundingClientRect().x - (ink.x + ink.w))
})
console.log(`贴回命中框时到墨迹 ${wrong}px（现在 ${a.gapToInk}px）——差值就是那 37px 的透明区域`)

const x0 = Math.min(a.box.x, a.hit.x) - 40
const y0 = Math.min(a.box.y, a.hit.y) - 40
const x1 = Math.max(a.box.x + a.box.w, a.hit.x + a.hit.w) + 40
const y1 = Math.max(a.box.y + a.box.h, a.hit.y + a.hit.h) + 40
mkdirSync(join('spike', 'out'), { recursive: true })
await page.screenshot({ path: join('spike', 'out', 'stats-live.png'), clip: { x: Math.max(0, x0), y: Math.max(0, y0), width: x1 - x0, height: y1 - y0 } })
await app.close()
try { rmSync(ud, { recursive: true, force: true }) } catch { /* 句柄没放干净就算了 */ }
console.log('写出 spike/out/stats-live.png')
