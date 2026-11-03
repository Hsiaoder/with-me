/** 一次性：hide 之后 display 到底怎么变的，逐时刻取值。 */
import { _electron as electron } from 'playwright'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const work = mkdtempSync(join(tmpdir(), 'disp-probe-'))
const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env: { ...process.env, PET_USER_DATA: work } })
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => (document.querySelector('video.is-front')?.videoWidth ?? 0) > 0, null, { timeout: 30_000 })
  // 先冻住行为链：不然宠物在走动，喂进去的坐标早就不在身上了，面板压根不会开
  await page.evaluate(() => window.__testPlay('idle', 'patrol'))
  const feed = (x, y) => page.evaluate((p) => window.__petDebug.cursor(p), { x, y })
  const h = await page.evaluate(() => window.__petDebug.hitBox)
  await feed(h.x + h.w / 2, h.y + h.h / 2)
  await page.waitForTimeout(460)
  await feed(h.x + h.w / 2, h.y + h.h / 2)
  await page.waitForTimeout(60)
  const snap = (tag) => page.evaluate((t) => {
    const el = document.querySelector('.pet-panel')
    const cs = getComputedStyle(el)
    return `${t}: hidden=${el.hidden} open=${window.__petDebug.panelOpen} display=${cs.display} opacity=${cs.opacity} w=${el.offsetWidth}`
  }, tag)
  console.log(await snap('开着时'))
  await feed(4, 4)
  for (const ms of [0, 50, 200, 400, 1000, 1800]) {
    await page.waitForTimeout(ms === 0 ? 5 : ms - (ms === 50 ? 5 : 0))
    console.log(await snap(`离开+${ms}ms`))
  }
  console.log(await page.evaluate(() => {
    const sheets = [...document.styleSheets]
    const rules = []
    for (const s of sheets) {
      try { for (const r of s.cssRules) if (r.selectorText?.includes('pet-panel')) rules.push(r.cssText.slice(0, 120)) }
      catch { rules.push('(读不到)') }
    }
    return `规则表里 pet-panel 相关 ${rules.length} 条:\n` + rules.join('\n')
  }))
} finally {
  await app.close().catch(() => {})
  try { rmSync(work, { recursive: true, force: true }) } catch { /* 忽略 */ }
}
