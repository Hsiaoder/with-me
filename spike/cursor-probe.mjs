/**
 * 自定义光标的真机探针（spike）。
 *
 * 要证的只有一件事：鼠标进到宠物命中区时，**操作系统层面**显示的是不是 hand_point。
 * CSS 里写了 cursor、DOM 上类加上了，都不算——覆盖层是透明 + 可穿透的，穿透开着时
 * 这扇窗收不到 WM_SETCURSOR，Chromium 压根不会去设光标。
 * 所以判据取 `GetCursorInfo` 的 hCursor（对比空地处），再把光标位图存出来用眼睛看。
 *
 * 跑法：node spike/cursor-probe.mjs   → spike/out/cursor-on-pet.png
 * 注意：会真的挪动鼠标 200ms 左右，跑之前手上别握着鼠标。
 */
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SKIN_SRC = join(tmpdir(), 'dsh-asar-BHUAA9', 'pet', 'skins', 'dshtry')
const ud = mkdtempSync(join(tmpdir(), 'cursor-probe-'))
mkdirSync(join(ud, 'skins'), { recursive: true })
cpSync(SKIN_SRC, join(ud, 'skins', 'dshtry'), { recursive: true })
writeFileSync(join(ud, 'save.json'), JSON.stringify({ version: 1, skin: 'dshtry' }), 'utf8')

const PS = join('spike', 'cursor-dump.ps1')
const OUT = join('spike', 'out')

/** @returns {string} 探针读数 */
function dump(x, y, out) {
  return execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS], {
    encoding: 'utf8',
    env: { ...process.env, CURSOR_X: String(Math.round(x)), CURSOR_Y: String(Math.round(y)), CURSOR_OUT: out ?? '' },
  }).trim()
}

let code = 0
try {
  if (!existsSync(SKIN_SRC)) throw new Error(`试穿皮肤不在：${SKIN_SRC}（先跑 node spike/dsh-asar-extract.mjs）`)
  mkdirSync(OUT, { recursive: true })

  // 不冻光标：这条要验的就是「真实鼠标走进命中区」整条链路
  const app = await electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: { ...process.env, PET_USER_DATA: ud },
  })
  const page = await app.firstWindow()
  await page.waitForTimeout(1600)

  const disp = await app.evaluate(({ screen }) => {
    const d = screen.getPrimaryDisplay()
    return { wa: d.workArea, scale: d.scaleFactor }
  })
  const dpr = await page.evaluate(() => window.devicePixelRatio)
  const hit = await page.evaluate(() => window.__petDebug.hitBox)
  const center = { x: hit.x + hit.w / 2, y: hit.y + hit.h / 2 }
  console.log(`scaleFactor=${disp.scale} dpr=${dpr} workArea=${JSON.stringify(disp.wa)}`)
  console.log(`hitBox(CSS)=${JSON.stringify(hit)} 身体中心=${center.x},${center.y}`)

  /**
   * SetCursorPos 要物理像素，hitBox 是 CSS/DIP 像素，两者比值这台机器上说不准：
   * Electron 报 scaleFactor=2，可 workArea 的 DIP 尺寸就等于物理尺寸（虚拟屏 1600x1000，
   * 要 1603 被夹到 1600）——那是进程没做 DPI 感知，DIP==物理。
   * 所以不猜：拿 pet-over 这个类当探针，哪个倍率能真的走进命中区就用哪个。
   */
  let scale = 0
  for (const cand of [1, dpr, disp.scale]) {
    const p = { x: (disp.wa.x + center.x) * cand, y: (disp.wa.y + center.y) * cand }
    dump(p.x, p.y)
    await page.waitForTimeout(120)
    const on = await page.evaluate(() => document.body.classList.contains('pet-over'))
    console.log(`  倍率 ${cand} → ${Math.round(p.x)},${Math.round(p.y)} pet-over=${on}`)
    if (on) { scale = cand; break }
  }
  if (scale === 0) throw new Error('三种倍率都没能走进命中区，探针到此为止')

  const bodyPt = { x: (disp.wa.x + center.x) * scale, y: (disp.wa.y + center.y) * scale }
  const on = dump(bodyPt.x, bodyPt.y, join(OUT, 'cursor-on-pet.png'))
  await page.waitForTimeout(120)
  const onOver = await page.evaluate(() => document.body.classList.contains('pet-over'))
  console.log(`命中区里 ${on}  pet-over=${onOver}`)

  /**
   * 面板要静止悬停 400ms 才出，所以量完身体就地等着，别先把鼠标挪开——
   * 挪开那一刻 1500ms 的收起倒计时就起了，走到按钮上时面板正好已经消失，
   * 读到的是**底下那个窗口**的光标（实测读到过一枚 32x64 的纵向缩放手）。
   * 穿透开着时我们这扇窗收不到 WM_SETCURSOR，那种读数跟 CSS 一点关系都没有。
   */
  await page.waitForTimeout(520)
  const open = await page.evaluate(() => window.__petDebug.panelOpen)
  const btn = await page.evaluate(() => {
    const r = document.querySelector('.pet-panel button').getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  const onBtn = dump((disp.wa.x + btn.x) * scale, (disp.wa.y + btn.y) * scale, join(OUT, 'cursor-on-button.png'))
  const dom = await page.evaluate((p) => {
    const b = document.querySelector('.pet-panel button')
    const el = document.elementFromPoint(p.x, p.y)
    return {
      computed: getComputedStyle(b).cursor,
      at: el ? `${el.tagName}.${el.className}` : 'null',
      overPanel: el !== null && el.closest('[data-hit]') !== null,
      open: window.__petDebug.panelOpen,
    }
  }, btn)
  console.log(`按钮上    ${onBtn}（面板开着=${open}，该点命中=${dom.at} overPanel=${dom.overPanel} 现在开着=${dom.open}）`)
  console.log(`按钮 computed cursor = ${dom.computed}`)

  const empty = { x: 40, y: 40 }
  const base = dump(empty.x, empty.y)
  await page.waitForTimeout(120)
  const baseOver = await page.evaluate(() => document.body.classList.contains('pet-over'))
  console.log(`回到空地 ${base}  pet-over=${baseOver}`)

  const h = (s) => /h=(-?\d+)/.exec(s)?.[1]
  console.log(`\n句柄：身体 ${h(on)} → 按钮 ${h(onBtn)} → 空地 ${h(base)}`)
  console.log(`身体与按钮同一枚光标：${h(on) === h(onBtn)}；空地是系统箭头：${h(base) === '65539'}`)
  console.log(`光标图已存：${join(OUT, 'cursor-on-pet.png')}、${join(OUT, 'cursor-on-button.png')}`)
  await app.close()
} catch (e) {
  code = 1
  console.error(String(e && e.message ? e.message : e))
} finally {
  rmSync(ud, { recursive: true, force: true })
  process.exitCode = code
}
