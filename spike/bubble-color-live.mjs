/**
 * 一次性探针（throwaway）：把新版气泡（直边 + 灰蓝环 + 实心蓝回应钮）按真尺寸截一帧。
 * 跑法：node spike/bubble-color-live.mjs → spike/out/bubble-color-live.png
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
await app.close()
try { rmSync(ud, { recursive: true, force: true }) } catch { /* 句柄没放干净就算了 */ }
console.log('写出 spike/out/bubble-color-live.png')
