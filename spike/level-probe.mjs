/**
 * 一次性探针（throwaway）：起一只 exp=9.6 的宠物，喂一口白饭，把每一步的经验与气泡打出来。
 *
 * 为什么单跑：e2e 那条只说「6 秒内没等到跨级那句」，看不出是经验没跨过 10、
 * 还是跨过了但没说话。逐拍打印才知道断在哪一环。
 *
 * 跑法：node spike/level-probe.mjs
 */
import { _electron as electron } from 'playwright'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'level-probe-'))
const savePath = join(dir, 'save.json')
writeFileSync(savePath, JSON.stringify({
  version: 2,
  skin: 'block',
  identity: { name: '小鲸', gender: 'female' },
  stats: { hunger: 40, mood: 40, weight: 40, bond: 40 },
  exp: 9.6,
  lastSeenAt: Date.now(),
}), 'utf8')

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, PET_USER_DATA: dir, PET_FREEZE_CURSOR: '1' },
})
const page = await app.firstWindow()
await page.waitForFunction(() => document.querySelectorAll('video').length === 2, null, { timeout: 30_000 })
await page.waitForTimeout(1500)
const read = () => JSON.parse(readFileSync(savePath, 'utf8'))
const snap = () => page.evaluate(() => ({
  level: document.querySelector('.pet-stats-level')?.textContent,
  bubble: window.__petDebug.bubbleText,
  pool: window.__petDebug.current.pool,
}))
const tap = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel)

console.log('开局 存档/快照：', JSON.stringify({ file: read().exp, ...(await snap()) }))
// 叫出面板（这一步会报 daily-open，经验 +0.2）
const h = await page.evaluate(() => { const b = window.__petDebug.hitBox; return { x: b.x + b.w / 2, y: b.y + b.h / 2 } })
await page.evaluate((q) => {
  const fire = (t) => window.dispatchEvent(new PointerEvent(t, { clientX: q.x, clientY: q.y, bubbles: true }))
  fire('pointerdown')
  fire('pointerup')
}, h)
await page.waitForSelector('.pet-actions')
await page.waitForTimeout(400)
console.log('开面板后（日开 +0.2 该到账）：', JSON.stringify({ file: read().exp, ...(await snap()) }))

await tap('.pet-panel button[data-id="status"]')
await page.waitForSelector('.pet-stats-level')
console.log('状态栏：', (await snap()).level)
await tap('.pet-panel button[data-id="feed"]')
await page.waitForSelector('.pet-panel .pet-food')
await page.evaluate(() => window.__petDebug.setLastTalk(0))
await tap('.pet-panel .pet-food[data-food="rice"]')
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(300)
  console.log(`  t+${(i + 1) * 0.3}s`, JSON.stringify({ file: read().exp, ...(await snap()) }))
}
await app.close()
rmSync(dir, { recursive: true, force: true })
