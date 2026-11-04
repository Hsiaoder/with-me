/**
 * 一次性截图探针：把状态栏叫出来截一帧，量它在宠物哪一侧、有没有溢出屏幕。
 * 进度条这种「看着对不算对」的东西，只能看像素 + 读矩形两样一起。
 * 跑法：node spike/stats-shot.mjs → spike/out/stats-shot.png
 */
import { _electron as electron } from 'playwright'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SKIN_SRC = join(tmpdir(), 'dsh-asar-BHUAA9', 'pet', 'skins', 'dshtry')
const ud = mkdtempSync(join(tmpdir(), 'stats-shot-'))
mkdirSync(join(ud, 'skins'), { recursive: true })
cpSync(SKIN_SRC, join(ud, 'skins', 'dshtry'), { recursive: true })
writeFileSync(join(ud, 'save.json'), JSON.stringify({ version: 2, skin: 'dshtry' }), 'utf8')

if (!existsSync(SKIN_SRC)) throw new Error(`试穿皮肤不在：${SKIN_SRC}（先跑 node spike/dsh-asar-extract.mjs）`)
const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, PET_USER_DATA: ud, PET_FREEZE_CURSOR: '1' },
})
try {
  const page = await app.firstWindow()
  await page.waitForTimeout(1600)

  // 面板由点击叫出来（喂光标已经叫不动了），所以这里点身体
  const clickBody = async () => {
    const h = await page.evaluate(() => window.__petDebug.hitBox)
    await page.evaluate((p) => {
      const fire = (t) => window.dispatchEvent(new PointerEvent(t, { clientX: p.x, clientY: p.y, bubbles: true }))
      fire('pointerdown')
      fire('pointerup')
    }, { x: h.x + h.w / 2, y: h.y + h.h / 2 })
    await page.waitForTimeout(150)
  }

  // 喂一次，让读数离开初值：全 70/70/50/0 那张图看不出条宽与颜色是不是真的跟着数走
  await clickBody()
  await page.click('.pet-panel button[data-id="feed"]')
  await page.waitForSelector('.pet-panel .pet-food')
  await page.click('.pet-panel .pet-food[data-food="hotpot"]')
  await page.waitForTimeout(300)

  // 选完即收，面板已经关了；再点一下身体才叫得回来
  await clickBody()
  await page.click('.pet-panel button[data-id="status"]')
  await page.waitForSelector('.pet-panel .pet-stat')
  await page.waitForTimeout(300)

  const geo = await page.evaluate(() => {
    const b = window.__petDebug.hitBox
    const p = document.querySelector('.pet-panel').getBoundingClientRect()
    return {
      body: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) },
      panel: { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.width), h: Math.round(p.height) },
      inner: { w: window.innerWidth, h: window.innerHeight },
      rows: [...document.querySelectorAll('.pet-stat')].map((r) => ({
        key: r.dataset.key,
        value: r.querySelector('.pet-stat-value')?.textContent,
        band: r.querySelector('.pet-stat-bar')?.className,
      })),
    }
  })
  console.log(JSON.stringify(geo, null, 1))

  const b64 = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    return w.capturePage().then((img) => img.toPNG().toString('base64'))
  })
  mkdirSync(join('spike', 'out'), { recursive: true })
  writeFileSync(join('spike', 'out', 'stats-shot.png'), Buffer.from(b64, 'base64'))
  console.log('已存：spike/out/stats-shot.png')
} finally {
  await app.close()
  rmSync(ud, { recursive: true, force: true, maxRetries: 8, maxRetryTime: 2000 })
}
