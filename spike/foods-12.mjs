/**
 * 一次性探针（throwaway）：真窗口里把 12 格的食物列表截两屏（Lv.1 与全解锁），看新图与角标。
 *
 * 为什么要两屏：默认那只宠物 exp 才 3 点多，永远停在 Lv.1，第二屏（Lv.4）只能靠
 * 另起一只带 exp=30 的存档才看得见——顺便也就验了「角标消失、格子点亮」这一半。
 *
 * 跑法：node spike/foods-12.mjs → spike/out/foods-12-lv1.png / foods-12-lv4.png
 */
import { _electron as electron } from 'playwright'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LIVE = 'C:/Users/11408/AppData/Local/Temp/dsh-asar-BHUAA9/pet'
mkdirSync(join('spike', 'out'), { recursive: true })

async function shot(name, exp) {
  const dir = mkdtempSync(join(tmpdir(), 'foods-12-'))
  const live = JSON.parse(readFileSync(join(LIVE, 'save.json'), 'utf8'))
  writeFileSync(join(dir, 'save.json'), JSON.stringify({ ...live, exp }), 'utf8')
  cpSync(join(LIVE, 'skins'), join(dir, 'skins'), { recursive: true })
  const app = await electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: { ...process.env, PET_USER_DATA: dir.replace(/\\/g, '/'), PET_FREEZE_CURSOR: '1' },
  })
  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => document.querySelectorAll('video').length === 2, null, { timeout: 30_000 })
    await page.waitForTimeout(1200)
    const inner = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    await page.evaluate((p) => window.__petDebug.moveTo(p), { x: Math.round(inner.w / 2) - 90, y: inner.h - 300 })
    await page.waitForTimeout(200)
    const c = await page.evaluate(() => { const b = window.__petDebug.hitBox; return { x: b.x + b.w / 2, y: b.y + b.h / 2 } })
    await page.evaluate((p) => {
      const fire = (t) => window.dispatchEvent(new PointerEvent(t, { clientX: p.x, clientY: p.y, bubbles: true }))
      fire('pointerdown')
      fire('pointerup')
    }, c)
    await page.waitForSelector('.pet-actions')
    await page.waitForTimeout(700)     // 出场动画落定，矩形才不含 scale
    await page.evaluate(() => document.querySelector('.pet-panel button[data-id="feed"]').click())
    await page.waitForSelector('.pet-panel .pet-food')
    await page.waitForTimeout(300)
    const info = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.pet-panel .pet-food')]
      const plate = document.querySelector('.pet-plate.is-foods').getBoundingClientRect()
      return {
        n: cells.length,
        locked: cells.filter((x) => x.classList.contains('is-locked')).map((x) => `${x.dataset.food}:${x.querySelector('.pet-food-lock').textContent}`),
        plate: { x: Math.round(plate.x), y: Math.round(plate.y), w: Math.round(plate.width), h: Math.round(plate.height) },
      }
    })
    const clip = { x: info.plate.x - 4, y: info.plate.y - 4, width: info.plate.w + 8, height: info.plate.h + 8 }
    console.log(`${name}：${JSON.stringify(info)}`)
    await page.screenshot({ path: join('spike', 'out', `foods-12-${name}.png`), clip })
    // 滚到第二屏再截一张，看后面六张新图
    await page.evaluate(() => document.querySelector('.pet-page[data-page="next"]').click())
    await page.evaluate(() => document.querySelector('.pet-page[data-page="next"]').click())
    await page.waitForTimeout(400)
    await page.screenshot({ path: join('spike', 'out', `foods-12-${name}-p2.png`), clip })
  } finally {
    await app.close()
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 句柄没放干净就算了 */ }
  }
}

await shot('lv1', 3)
await shot('lv4', 30)
