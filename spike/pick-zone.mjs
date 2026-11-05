/**
 * 一次性探针（throwaway，不进验收门）：量「点完一格食物」前后的交互区。
 *
 * 用户报的两条：吃饭时鼠标变回普通箭头 + 下面的按钮消失了。
 * 这里要证实的是链条：closePanel 把两块都摘掉 → 光标所在点不再落在
 * 「身体 ∪ 面板 ∪ 气泡」的外接矩形里 → pet-over/wantGrab 同时翻 false。
 */
import { _electron as electron } from 'playwright'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const userData = mkdtempSync(join(tmpdir(), 'pet-probe-zone-'))
const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, PET_USER_DATA: userData, PET_FREEZE_CURSOR: '1' },
})
const page = await app.firstWindow()
await page.waitForFunction(() => document.querySelectorAll('video').length === 2, null, { timeout: 30_000 })
await page.evaluate(() => document.querySelector('.pet-panel').setAttribute('data-no-motion', ''))

const dbg = () => page.evaluate(() => ({
  open: window.__petDebug.panelOpen,
  view: window.__petDebug.panelView,
  grab: window.__petDebug.grabRequested,
  over: document.body.classList.contains('pet-over'),
  pool: window.__petDebug.current.pool,
}))
const rects = () => page.evaluate(() => {
  const box = (s) => {
    const el = document.querySelector(s)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  }
  return { body: window.__petDebug.hitBox, actions: box('.pet-actions'), plate: box('.pet-plate') }
})
const feed = (p) => page.evaluate((pt) => window.__petDebug.cursor(pt), p)

const h = await page.evaluate(() => window.__petDebug.hitBox)
const center = { x: Math.round(h.x + h.w / 2), y: Math.round(h.y + h.h / 2) }
const fire = (t, p) => page.evaluate(({ type, q }) => {
  window.dispatchEvent(new PointerEvent(type, { clientX: q.x, clientY: q.y, bubbles: true }))
}, { type: t, q: p })

await feed(center)
await fire('pointerdown', center)
await fire('pointerup', center)
await page.waitForTimeout(150)
await page.click('.pet-actions button[data-id="feed"]')
await page.waitForSelector('.pet-panel .pet-food')
console.log('列表开着时：', JSON.stringify(await rects()), JSON.stringify(await dbg()))

const cell = await page.evaluate(() => {
  const r = document.querySelector('.pet-food[data-food="rice"]').getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
})
await feed(cell)
console.log('光标压在格子上：', JSON.stringify(await dbg()))
await page.click('.pet-food[data-food="rice"]')
await page.waitForTimeout(200)
console.log('点完食物（池=eat 后）：', JSON.stringify(await rects()), JSON.stringify(await dbg()))
await feed(cell)
console.log('同一坐标再喂一次光标：', JSON.stringify(await dbg()))

// 回到按钮条正中，看交互区还剩哪块能接住
const band = await page.evaluate(() => {
  const r = document.querySelector('.pet-actions')?.getBoundingClientRect()
  return r ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null
})
console.log('按钮条此刻的矩形：', JSON.stringify(band))
if (band) {
  await feed(band)
  console.log('光标回到按钮条：', JSON.stringify(await dbg()))
}

// 吃饭期间会不会自己收：手离开宠物，等满延时
await feed({ x: 20, y: 20 })
await page.waitForTimeout(2200)
console.log('离开 2.2 秒后（还在吃吗看 pool）：', JSON.stringify(await dbg()))

await app.close()
