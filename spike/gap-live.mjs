/**
 * 一次性探针（throwaway，不进门禁）：真机尺寸下量三块「谁盖住谁、离身体多远」。
 *
 * 要回答两个数：
 * ① 状态栏底沿比按钮条顶沿低多少（用户说「盖住下面的按钮了」）；
 * ② 按钮条顶沿离看得见的身体底沿多远（用户说「离身体有点远了」）。
 * ② 必须按**墨迹**量：dshtry 命中框比墨迹左右各宽 37~40，纵向也可能带空白边。
 *
 * 跑法：node spike/gap-live.mjs → spike/out/gap-live.png
 */
import { _electron as electron } from 'playwright'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LIVE = 'C:/Users/11408/AppData/Local/Temp/dsh-asar-BHUAA9/pet'
const ud = mkdtempSync(join(tmpdir(), 'gap-live-'))
// 照抄真存档：`skin` 字段一丢就退回 block 方块皮肤，量出来的间距全是别的皮肤的数
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
await page.waitForSelector('.pet-actions')

const rects = () => page.evaluate(() => {
  const box = (sel) => {
    const n = document.querySelector(sel)
    if (!n) return null
    const r = n.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) }
  }
  const ink = window.__petDebug.inkBox
  const hit = window.__petDebug.hitBox
  return {
    skin: window.__petDebug.current.pool,
    bar: box('.pet-actions'),
    stats: box('.pet-plate.is-stats'),
    foods: box('.pet-plate.is-foods'),
    ink: { x: Math.round(ink.x), y: Math.round(ink.y), w: Math.round(ink.w), h: Math.round(ink.h), bottom: Math.round(ink.bottom ?? ink.y + ink.h), right: Math.round(ink.x + ink.w) },
    hit: { x: Math.round(hit.x), y: Math.round(hit.y), w: Math.round(hit.w), h: Math.round(hit.h), bottom: Math.round(hit.y + hit.h), right: Math.round(hit.x + hit.w) },
  }
})

const base = await rects()
console.log('只有按钮条：', JSON.stringify(base, null, 1))
console.log(`按钮条顶沿 - 墨迹底沿 = ${base.bar.y - base.ink.bottom}px（命中框那条是 ${base.bar.y - base.hit.bottom}px）`)

await page.click('.pet-actions button[data-id="status"]')
await page.waitForSelector('.pet-plate.is-stats')
await page.waitForTimeout(400)
const s = await rects()
const xOver = Math.min(s.stats.right, s.bar.right) - Math.max(s.stats.x, s.bar.x)
const yOver = s.stats.bottom - s.bar.y
console.log('状态栏 + 按钮条：', JSON.stringify({ stats: s.stats, bar: s.bar }, null, 1))
console.log(`横向重叠 ${xOver}px，纵向状态栏压过按钮条顶沿 ${yOver}px`)

await page.click('.pet-actions button[data-id="feed"]')
await page.waitForSelector('.pet-plate.is-foods')
await page.waitForTimeout(400)
const f = await rects()
console.log('食物副板：', JSON.stringify({ foods: f.foods, bar: f.bar }, null, 1))

// 连带问题：状态栏抬上去以后，会不会顶到气泡？先量现在这一版气泡落在哪。
await page.evaluate(() => window.__petDebug.say('在不在呀', 60000))
await page.waitForTimeout(300)
const bub = await page.evaluate(() => {
  const n = document.querySelector('.pet-bubble')
  const r = n.getBoundingClientRect()
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) }
})
const bx = Math.min(bub.right, s.stats.right) - Math.max(bub.x, s.stats.x)
const by = Math.min(bub.bottom, s.stats.bottom) - Math.max(bub.y, s.stats.y)
console.log('气泡：', JSON.stringify(bub), `与状态栏重叠 ${bx}×${by}px`)

const pad = 60
const x0 = Math.max(0, Math.min(f.bar.x, s.stats.x, base.ink.x, bub.x) - pad)
const y0 = Math.max(0, Math.min(base.ink.y, s.stats.y, bub.y) - pad)
const x1 = Math.max(f.bar.right, s.stats.right, base.ink.right) + pad
const y1 = Math.max(f.foods.bottom, s.stats.bottom, base.ink.bottom) + pad
mkdirSync(join('spike', 'out'), { recursive: true })
await page.screenshot({ path: join('spike', 'out', 'gap-live.png'), clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } })
await app.close()
try { rmSync(ud, { recursive: true, force: true }) } catch { /* 句柄没放干净就算了 */ }
console.log('写出 spike/out/gap-live.png')
