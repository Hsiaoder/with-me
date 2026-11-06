/**
 * 一次性探针（throwaway）：真尺寸截两张新版状态栏 / 食物列表（经验条 + 新解锁节奏）。
 * 跑法：node spike/level-ui-live.mjs → spike/out/stats-exp-live.png + foods-unlock-live.png
 */
import { _electron as electron } from 'playwright'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LIVE = 'C:/Users/11408/AppData/Local/Temp/dsh-asar-BHUAA9/pet'
const ud = mkdtempSync(join(tmpdir(), 'level-ui-'))
const save = JSON.parse(readFileSync(join(LIVE, 'save.json'), 'utf8'))
// 把 exp 摆到 Lv.3 门槛前一口，好同时看到「刚解锁」和「还差多少」
save.exp = 40
writeFileSync(join(ud, 'save.json'), JSON.stringify(save), 'utf8')
cpSync(join(LIVE, 'skins'), join(ud, 'skins'), { recursive: true })

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, PET_USER_DATA: ud.replace(/\\/g, '/'), PET_FREEZE_CURSOR: '1' },
})
const page = await app.firstWindow()
await page.waitForFunction(() => document.querySelectorAll('video').length === 2, null, { timeout: 30_000 })
await page.waitForTimeout(1500)
await page.evaluate((p) => window.__petDebug.moveTo(p), { x: 520, y: 330 })
await page.waitForTimeout(200)
const c = await page.evaluate(() => {
  const h = window.__petDebug.hitBox
  return { x: Math.round(h.x + h.w / 2), y: Math.round(h.y + h.h / 2) }
})
await page.evaluate((p) => {
  const fire = (t) => window.dispatchEvent(new PointerEvent(t, { clientX: p.x, clientY: p.y, bubbles: true }))
  fire('pointerdown')
  fire('pointerup')
}, c)
await page.waitForSelector('.pet-actions')
mkdirSync(join('spike', 'out'), { recursive: true })

await page.click('.pet-actions button[data-id="status"]')
await page.waitForSelector('.pet-plate.is-stats')
await page.waitForTimeout(400)
const stats = await page.evaluate(() => {
  const r = document.querySelector('.pet-plate.is-stats').getBoundingClientRect()
  return {
    clip: { x: Math.max(0, r.x - 12), y: Math.max(0, r.y - 12), width: r.width + 24, height: r.height + 24 },
    lines: [...document.querySelectorAll('.pet-plate.is-stats > *')].map((n) => n.textContent),
    exp: document.querySelector('.pet-exp')?.getAttribute('title'),
  }
})
console.log('状态栏各行：', JSON.stringify(stats.lines, null, 1))
console.log('经验条 title：', stats.exp)
await page.screenshot({ path: join('spike', 'out', 'stats-exp-live.png'), clip: stats.clip })

await page.click('.pet-actions button[data-id="feed"]')
await page.waitForSelector('.pet-plate.is-foods')
await page.waitForTimeout(400)
const foods = await page.evaluate(() => {
  const r = document.querySelector('.pet-plate.is-foods').getBoundingClientRect()
  return {
    clip: { x: Math.max(0, r.x - 12), y: Math.max(0, r.y - 12), width: r.width + 24, height: r.height + 24 },
    badges: [...document.querySelectorAll('.pet-food')].map((c) => (c.classList.contains('is-locked') ? c.querySelector('.pet-food-lock')?.textContent : '开')),
  }
})
console.log('12 格的锁标：', JSON.stringify(foods.badges))
await page.screenshot({ path: join('spike', 'out', 'foods-unlock-live.png'), clip: foods.clip })
await app.close()
try { rmSync(ud, { recursive: true, force: true }) } catch { /* 句柄没放干净就算了 */ }
console.log('写出 spike/out/stats-exp-live.png 与 foods-unlock-live.png')
