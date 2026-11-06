/**
 * 一次性探针（throwaway）：把状态栏叫出来，读性别那一格的**实际字符 + 颜色**，再截一帧。
 *
 * 为什么要读而不是看代码：代码里 `GENDER_GLYPHS.female = '♀'` 是对的，
 * 但屏幕上出现什么还取决于存档里存的是哪一档、以及字体有没有把它画成别的样子。
 * 跑法：node spike/gender-shot.mjs → spike/out/gender-shot.png
 */
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ud = mkdtempSync(join(tmpdir(), 'gender-shot-'))
writeFileSync(join(ud, 'save.json'), JSON.stringify({ version: 2, skin: 'block', identity: { name: '小鲸', gender: 'female' } }), 'utf8')

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, PET_USER_DATA: ud, PET_FREEZE_CURSOR: '1' },
})
const page = await app.firstWindow()
await page.waitForFunction(() => document.querySelectorAll('video').length === 2, null, { timeout: 30_000 })
await page.waitForTimeout(1200)

const h = await page.evaluate(() => window.__petDebug.hitBox)
const center = { x: h.x + h.w / 2, y: h.y + h.h / 2 }
await page.evaluate((p) => {
  const fire = (t) => window.dispatchEvent(new PointerEvent(t, { clientX: p.x, clientY: p.y, bubbles: true }))
  fire('pointerdown')
  fire('pointerup')
}, center)
await page.click('.pet-actions button[data-id="status"]')
await page.waitForSelector('.pet-plate.is-stats')
await page.waitForTimeout(300)

const read = await page.evaluate(() => {
  const b = document.querySelector('.pet-gender')
  const cs = getComputedStyle(b)
  const r = b.getBoundingClientRect()
  return {
    cls: b.className,
    text: b.textContent,
    codes: [...b.textContent].map((c) => c.codePointAt(0).toString(16)),
    color: cs.color,
    font: cs.fontFamily,
    fontSize: cs.fontSize,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    title: b.title,
    lines: [...document.querySelectorAll('.pet-plate.is-stats > *')].map((n) => n.className + '|' + (n.dataset.key ?? '')),
  }
})
console.log(JSON.stringify(read, null, 2))

const png = await page.screenshot({ clip: { x: 0, y: 0, width: 1600, height: 900 } })
mkdirSync(join('spike', 'out'), { recursive: true })
writeFileSync(join('spike', 'out', 'gender-shot.png'), png)
await app.close()
try { rmSync(ud, { recursive: true, force: true }) } catch { /* 句柄没放干净就算了 */ }
console.log('写出 spike/out/gender-shot.png')
