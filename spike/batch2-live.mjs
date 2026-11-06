/**
 * 一次性探针（throwaway）：真窗口里把「鲸鱼按钮 + 云朵气泡」同一帧截出来看。
 *
 * 为什么必须真窗口：drop-shadow 跟着 alpha 轮廓走这件事，jsdom 与静态预览都给不出答案；
 * 而按钮底换形之后图标在鲸鱼身上偏不偏，也只有真布局量得到。
 * 副本 = 只读地复制一份到临时 userData，绝不回写真存档。
 *
 * 跑法：node spike/batch2-live.mjs → spike/out/batch2-live.png
 */
import { _electron as electron } from 'playwright'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LIVE = 'C:/Users/11408/AppData/Local/Temp/dsh-asar-BHUAA9/pet'
const live = JSON.parse(readFileSync(join(LIVE, 'save.json'), 'utf8'))
const ud = mkdtempSync(join(tmpdir(), 'batch2-live-'))
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

const inner = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
await page.evaluate((p) => window.__petDebug.moveTo(p), { x: Math.round(inner.w / 2) - 90, y: inner.h - 320 })
await page.waitForTimeout(200)
const center = await page.evaluate(() => {
  const h = window.__petDebug.hitBox
  return { x: h.x + h.w / 2, y: h.y + h.h / 2 }
})
await page.evaluate((p) => {
  const fire = (t) => window.dispatchEvent(new PointerEvent(t, { clientX: p.x, clientY: p.y, bubbles: true }))
  fire('pointerdown')
  fire('pointerup')
}, center)
await page.waitForSelector('.pet-actions')
// 出场动画还在跑的时候 getBoundingClientRect 量到的是**缩放中**的按钮（35 而不是 40），
// 图标偏移会跟着一起骗眼睛——等它落定再量。
await page.waitForTimeout(800)
// 气泡：把冷却清掉、把「闲够了」的时钟拨回很久以前、概率抽成必中，再走一次开口那一拍
await page.evaluate(() => {
  window.__petDebug.setLastTalk(0)
  window.__petDebug.setLastInteraction(0)
  window.__petDebug.setTalkRng(0)
  return window.__petDebug.tickAmbientForTalk()
})
await page.waitForTimeout(300)

const shot = await page.evaluate(() => {
  const r = (el) => (el ? el.getBoundingClientRect() : null)
  const btn = document.querySelector('.pet-panel button[data-id]')
  const cs = getComputedStyle(btn)
  const bg = getComputedStyle(document.querySelector('.pet-bubble-bg'))
  const icon = getComputedStyle(document.querySelector('.pet-panel button[data-id] .pet-icon'))
  return {
    bubbleText: window.__petDebug.bubbleText,
    btnBg: cs.backgroundImage,
    btnFilter: cs.filter,
    btnBox: { w: Math.round(r(btn).width), h: Math.round(r(btn).height) },
    iconBox: { x: Math.round(r(btn.querySelector('.pet-icon')).x - r(btn).x), y: Math.round(r(btn.querySelector('.pet-icon')).y - r(btn).y), w: Math.round(r(btn.querySelector('.pet-icon')).width) },
    bubbleFilter: bg.filter,
    bubbleRect: (() => { const q = r(document.querySelector('.pet-bubble')); return q && { x: Math.round(q.x), y: Math.round(q.y), w: Math.round(q.width), h: Math.round(q.height) } })(),
    hit: window.__petDebug.hitBox,
    panel: (() => { const q = r(document.querySelector('.pet-actions')); return q && { x: Math.round(q.x), y: Math.round(q.y), w: Math.round(q.width), h: Math.round(q.height) } })(),
  }
})
console.log(JSON.stringify(shot, null, 1))

const rects = [shot.hit, shot.panel, shot.bubbleRect].filter(Boolean)
const x0 = Math.min(...rects.map((q) => q.x)) - 30
const y0 = Math.min(...rects.map((q) => q.y)) - 30
const x1 = Math.max(...rects.map((q) => q.x + q.w)) + 30
const y1 = Math.max(...rects.map((q) => q.y + q.h)) + 30
mkdirSync(join('spike', 'out'), { recursive: true })
await page.screenshot({ path: join('spike', 'out', 'batch2-live.png'), clip: { x: Math.max(0, x0), y: Math.max(0, y0), width: x1 - x0, height: y1 - y0 } })
await app.close()
try { rmSync(ud, { recursive: true, force: true }) } catch { /* 句柄没放干净就算了 */ }
console.log('写出 spike/out/batch2-live.png')
