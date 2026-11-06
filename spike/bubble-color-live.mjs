/**
 * 一次性探针（throwaway）：把新版气泡（直边 + 头发色环 + 发箍色回应钮）和状态栏各截一帧真尺寸。
 * 跑法：node spike/bubble-color-live.mjs → spike/out/bubble-color-live.png + stats-align-live.png
 */
import { _electron as electron } from 'playwright'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LIVE = 'C:/Users/11408/AppData/Local/Temp/dsh-asar-BHUAA9/pet'
const ud = mkdtempSync(join(tmpdir(), 'bubble-color-'))
writeFileSync(join(ud, 'save.json'), readFileSync(join(LIVE, 'save.json'), 'utf8'), 'utf8')
cpSync(join(LIVE, 'skins'), join(ud, 'skins'), { recursive: true })

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, PET_USER_DATA: ud.replace(/\\/g, '/'), PET_FREEZE_CURSOR: '1' },
})
const page = await app.firstWindow()
await page.waitForFunction(() => document.querySelectorAll('video').length === 2, null, { timeout: 30_000 })
await page.waitForTimeout(1200)
await page.evaluate((p) => window.__petDebug.moveTo(p), { x: 520, y: 330 })
await page.waitForTimeout(200)
await page.evaluate(() => window.__petDebug.say('你回来陪我玩嘛', 60000))
await page.waitForTimeout(250)
// 回应钮由台词流程填，debug.say 只给正文——这里按同一套 CSS 手动填一颗，量的是颜色不是装配
const shot = await page.evaluate(() => {
  const b = document.querySelector('.pet-bubble-reply')
  b.hidden = false
  b.textContent = '来了来了'
  const r = document.querySelector('.pet-bubble').getBoundingClientRect()
  const cs = getComputedStyle(b)
  return {
    clip: { x: Math.max(0, r.x - 24), y: Math.max(0, r.y - 24), width: r.width + 48, height: r.height + 60 },
    reply: { bg: cs.backgroundColor, color: cs.color, border: cs.borderTopColor, shadow: cs.boxShadow },
  }
})
console.log(JSON.stringify(shot.reply, null, 1))
mkdirSync(join('spike', 'out'), { recursive: true })
await page.screenshot({ path: join('spike', 'out', 'bubble-color-live.png'), clip: shot.clip })

// 第二帧：状态栏三行的值是不是同一列起笔（性别符号刚改成靠左）
await page.evaluate(() => window.__petDebug.hidePanel())
await page.waitForTimeout(200)
// 重新拿一次命中框：这几十秒里宠物会走动，用旧坐标就点在空气上
const tap = await page.evaluate(() => {
  const h = window.__petDebug.hitBox
  return { x: Math.round(h.x + h.w / 2), y: Math.round(h.y + h.h / 2) }
})
await page.evaluate((p) => {
  const fire = (t) => window.dispatchEvent(new PointerEvent(t, { clientX: p.x, clientY: p.y, bubbles: true }))
  fire('pointerdown')
  fire('pointerup')
}, tap)
await page.waitForSelector('.pet-actions')
await page.click('.pet-actions button[data-id="status"]')
await page.waitForSelector('.pet-plate.is-stats')
await page.waitForTimeout(300)
const cols = await page.evaluate(() => {
  const plate = document.querySelector('.pet-plate.is-stats').getBoundingClientRect()
  /** 值那一坨**文字**的左沿（不是格子的左沿）：Range 只圈内容，才量得出符号有没有对齐到同一列。 */
  const left = (el) => {
    if (el === null) return null
    const r = document.createRange()
    r.selectNodeContents(el)
    return Math.round(r.getBoundingClientRect().x - plate.x)
  }
  return {
    name: left(document.querySelector('.pet-stats-name')),
    level: left(document.querySelector('.pet-stats-level .pet-stat-value')),
    gender: left(document.querySelector('.pet-gender')),
  }
})
console.log('三行值的文字左沿（离卡片左边，px）：', JSON.stringify(cols))
const pr = await page.evaluate(() => {
  const r = document.querySelector('.pet-plate.is-stats').getBoundingClientRect()
  return { x: Math.max(0, r.x - 12), y: Math.max(0, r.y - 12), width: r.width + 24, height: r.height + 24 }
})
await page.screenshot({ path: join('spike', 'out', 'stats-align-live.png'), clip: pr })
await app.close()
try { rmSync(ud, { recursive: true, force: true }) } catch { /* 句柄没放干净就算了 */ }
console.log('写出 spike/out/bubble-color-live.png 与 stats-align-live.png')
