/**
 * 一次性探针：面板拆成两块之后，逐块问布局——矩形、pointer-events、transform，
 * 以及「按钮中心那一点到底命中了谁」。click 卡住这类事只能靠命中链回答。
 * 跑法：node spike/panel-rects.mjs
 */
import { _electron as electron } from 'playwright'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SKIN_SRC = join(tmpdir(), 'dsh-asar-BHUAA9', 'pet', 'skins', 'dshtry')
if (!existsSync(SKIN_SRC)) throw new Error(`试穿皮肤不在：${SKIN_SRC}`)
const ud = mkdtempSync(join(tmpdir(), 'panel-rects-'))
mkdirSync(join(ud, 'skins'), { recursive: true })
cpSync(SKIN_SRC, join(ud, 'skins', 'dshtry'), { recursive: true })
writeFileSync(join(ud, 'save.json'), JSON.stringify({ version: 2, skin: 'dshtry' }), 'utf8')

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, PET_USER_DATA: ud, PET_FREEZE_CURSOR: '1' },
})
const dump = () =>
  app.firstWindow().then((page) =>
    page.evaluate(() => {
      const q = (s) => {
        const e = document.querySelector(s)
        if (!e) return null
        const r = e.getBoundingClientRect()
        const cs = getComputedStyle(e)
        return {
          rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          pe: cs.pointerEvents,
          disp: cs.display,
          tr: cs.transform,
          vis: cs.visibility,
        }
      }
      const b = document.querySelector('.pet-panel button[data-id="feed"]')
      const br = b?.getBoundingClientRect()
      const mid = br ? document.elementFromPoint(br.x + br.width / 2, br.y + br.height / 2) : null
      const body = window.__petDebug.hitBox
      return {
        view: window.__petDebug.panelView,
        hidden: document.querySelector('.pet-panel')?.hidden,
        body: [Math.round(body.x), Math.round(body.y), Math.round(body.w), Math.round(body.h)],
        bodyBottom: Math.round(body.y + body.h),
        inner: [window.innerWidth, window.innerHeight],
        root: q('.pet-panel'),
        actions: q('.pet-actions'),
        plate: q('.pet-plate'),
        btn: q('.pet-panel button[data-id="feed"]'),
        hitAtBtnCenter: mid ? `${mid.tagName}.${mid.className}` : null,
      }
    }),
  )

try {
  const page = await app.firstWindow()
  await page.waitForTimeout(1500)
  const h = await page.evaluate(() => window.__petDebug.hitBox)
  await page.evaluate((p) => {
    const fire = (t) => window.dispatchEvent(new PointerEvent(t, { clientX: p.x, clientY: p.y, bubbles: true }))
    fire('pointerdown')
    fire('pointerup')
  }, { x: h.x + h.w / 2, y: h.y + h.h / 2 })
  await page.waitForTimeout(250)
  console.log('动作视图', JSON.stringify(await dump(), null, 1))
  await page.click('.pet-panel button[data-id="feed"]')
  await page.waitForTimeout(250)
  console.log('食物视图', JSON.stringify(await dump(), null, 1))
  await page.evaluate(() => window.__petDebug.hidePanel())
  await page.waitForTimeout(600)
  console.log('食物视图 +600ms', JSON.stringify(await dump(), null, 1))
  await page.evaluate(() => window.__petDebug.hidePanel())
  console.log('收起后', JSON.stringify(await dump(), null, 1))
} finally {
  await app.close()
  rmSync(ud, { recursive: true, force: true, maxRetries: 8, maxRetryTime: 2000 })
}
