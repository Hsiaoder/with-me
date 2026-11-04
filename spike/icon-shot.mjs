/**
 * 一次性截图探针：把面板、气泡、食物列表都叫出来，各抓一帧合成画面存成 PNG。
 *
 * 存在的理由：显隐、命中、坐标这些 e2e 验得了；「尾巴有没有指着宠物头」「四个字挤不挤」
 * 「列表和气泡叠不叠」是画面级的事，只能看像素。占位素材会掩护这类缺陷。
 *
 * 跑法：node spike/icon-shot.mjs   → spike/out/bubble-shot.png、spike/out/foods-shot.png
 */
import { _electron as electron } from 'playwright'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SKIN_SRC = join(tmpdir(), 'dsh-asar-BHUAA9', 'pet', 'skins', 'dshtry')
const ud = mkdtempSync(join(tmpdir(), 'icon-shot-'))
mkdirSync(join(ud, 'skins'), { recursive: true })
cpSync(SKIN_SRC, join(ud, 'skins', 'dshtry'), { recursive: true })
// 不写这份存档的话默认皮肤是 block（绿方块），截出来看不到试穿形象
writeFileSync(join(ud, 'save.json'), JSON.stringify({ version: 1, skin: 'dshtry' }), 'utf8')

let code = 0
try {
  if (!existsSync(SKIN_SRC)) throw new Error(`试穿皮肤不在：${SKIN_SRC}（先跑 node spike/dsh-asar-extract.mjs）`)
  const app = await electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: { ...process.env, PET_USER_DATA: ud, PET_FREEZE_CURSOR: '1' },
  })
  const page = await app.firstWindow()
  await page.waitForTimeout(1600)

  const grab = async (name) => {
    const b64 = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      return w.capturePage().then((img) => img.toPNG().toString('base64'))
    })
    mkdirSync(join('spike', 'out'), { recursive: true })
    writeFileSync(join('spike', 'out', name), Buffer.from(b64, 'base64'))
  }

  // 点一下叫出面板（2026-11-04 起面板不再靠悬停弹出，喂光标已经叫不动它了）
  const h = await page.evaluate(() => window.__petDebug.hitBox)
  await page.evaluate((p) => {
    const fire = (t) => window.dispatchEvent(new PointerEvent(t, { clientX: p.x, clientY: p.y, bubbles: true }))
    fire('pointerdown')
    fire('pointerup')
  }, { x: h.x + h.w / 2, y: h.y + h.h / 2 })
  await page.waitForTimeout(200)

  // 说一句接近 24 字上限的话 + 带回应按钮，专门看白色区装不装得下、按钮压不压尾巴
  await page.evaluate(() => window.__petDebug.say({ text: '无聊到数地板纹路了，你回来陪我玩嘛', reply: '别数我陪你' }, 60000))
  // 等淡入走完再抓：0.18s 的 @starting-style 过渡中间 opacity 还是 0，
  // 那种帧上"气泡没显示"和"气泡真没显示"长得一模一样。
  await page.waitForTimeout(400)
  await grab('bubble-shot.png')

  // 再截一张带食物列表的（气泡收掉，免得两层叠在一起看不出列表）
  await page.evaluate(() => window.__petDebug.hideBubble())
  await page.click('.pet-panel button[data-id="feed"]')
  await page.waitForSelector('.pet-panel .pet-food')
  await grab('foods-shot.png')

  // 量一下关键几何，免得"看着对"其实溢出屏幕
  const geo = await page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const b = el.getBoundingClientRect()
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
    }
    return {
      inner: { w: window.innerWidth, h: window.innerHeight },
      body: window.__petDebug.hitBox,
      plate: r('.pet-panel'),
      foods: r('.pet-foods'),
      thumb: r('.pet-thumb'),
    }
  })
  console.log(JSON.stringify(geo))
  console.log('已存：spike/out/bubble-shot.png、spike/out/foods-shot.png')
  await app.close()
} catch (e) {
  code = 1
  console.error(String(e && e.stack ? e.stack : e))
} finally {
  rmSync(ud, { recursive: true, force: true, maxRetries: 8, maxRetryTime: 2000 })
  process.exitCode = code
}
