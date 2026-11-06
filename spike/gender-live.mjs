/**
 * 一次性探针（throwaway）：拿**真存档的副本**把状态栏叫出来截一帧，看用户实际看到什么。
 *
 * 为什么要副本：性别那一格显示 ♀ 还是 ♂，取决于存档里存的是哪一档，
 * 而不是代码里的默认值。用户报「符号是错的」，先要分清是**渲染错**还是**存档就是那一档**。
 * 副本 = 只读地复制一份到临时 userData，绝不回写真存档。
 *
 * 跑法：node spike/gender-live.mjs → spike/out/gender-live.png
 */
import { _electron as electron } from 'playwright'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LIVE = 'C:/Users/11408/AppData/Local/Temp/dsh-asar-BHUAA9/pet'
const live = JSON.parse(readFileSync(join(LIVE, 'save.json'), 'utf8'))
console.log('真存档里的 identity：', JSON.stringify(live.identity), ' exp：', live.exp)

const ud = mkdtempSync(join(tmpdir(), 'gender-live-'))
writeFileSync(join(ud, 'save.json'), JSON.stringify(live), 'utf8')
cpSync(join(LIVE, 'skins'), join(ud, 'skins'), { recursive: true })

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, PET_USER_DATA: ud.replace(/\\/g, '/'), PET_FREEZE_CURSOR: '1' },
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
  const lv = document.querySelector('.pet-stat[data-key="level"]')
  return {
    cls: b.className,
    codes: [...b.textContent].map((c) => c.codePointAt(0).toString(16).toUpperCase()),
    color: cs.color,
    title: b.title,
    levelHtml: lv ? lv.innerHTML : null,
    plate: (() => { const r = document.querySelector('.pet-plate.is-stats').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } })(),
  }
})
console.log(JSON.stringify(read, null, 2))

const r = read.plate
await page.screenshot({ path: join('spike', 'out', 'gender-live.png'), clip: { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.w + 16, height: r.h + 16 } })
await app.close()
try { rmSync(ud, { recursive: true, force: true }) } catch { /* 句柄没放干净就算了 */ }
console.log('写出 spike/out/gender-live.png')
