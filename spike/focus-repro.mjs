/**
 * 一次性：真输入复现用户的动作，逐步问三件事——
 *   ① 键盘焦点在谁那（按线程读，前台窗口 ≠ 拿焦点的窗口）
 *   ② 谁握着鼠标捕获
 *   ③ 我们页面自己认不认「我有焦点」（document.hasFocus / activeElement）
 *
 * 用户的对照结论是：qqpet 点完宠物再移开，别的软件像没被点过一样；
 * with-me 点完宠物之后，别的软件要再点一下才响应。这两条只有 ①②③ 能分辨。
 * 跑法：node spike/focus-repro.mjs
 */
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PS = join(process.cwd(), 'spike/winprobe.ps1')
const probe = (...a) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS, ...a], { encoding: 'utf8' }).trim().replace(/\s+/g, ' ')
const move = (x, y) => probe('move', '-X', String(x), '-Y', String(y))
const hold = () => probe('hold')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const work = mkdtempSync(join(tmpdir(), 'focus-repro-'))
const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env: { ...process.env, PET_USER_DATA: work } })
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => (document.querySelector('video.is-front')?.videoWidth ?? 0) > 0, null, { timeout: 30_000 })
  await page.evaluate(() => window.__testPlay('idle', 'patrol'))
  const hit = await page.evaluate(() => window.__petDebug.hitBox)
  const ox = await page.evaluate(() => window.screenX)
  const oy = await page.evaluate(() => window.screenY)
  const toScreen = (p) => ({ x: Math.round(ox + p.x), y: Math.round(oy + p.y) })
  const pet = toScreen({ x: hit.x + hit.w / 2, y: hit.y + hit.h / 2 })
  // 观察点：屏幕左上，正常是桌面或某个应用，跟宠物毫不相干
  const away = { x: 120, y: 120 }

  const inner = () => page.evaluate(() => ({
    hasFocus: document.hasFocus(),
    active: document.activeElement ? `${document.activeElement.tagName}.${document.activeElement.className}` : 'null',
    grab: window.__petDebug.grabRequested,
    open: window.__petDebug.panelOpen,
  }))
  const show = async (tag) => {
    const win = probe('focus')
    const self = await inner()
    console.log(`${tag}\n    ${win}\n    页面内: hasFocus=${self.hasFocus} activeElement=${self.active} grab=${self.grab} 面板=${self.open}`)
  }

  move(away.x, away.y); await sleep(400)
  await show('【A】基线：光标在无关处，什么都没点')

  move(pet.x, pet.y); await sleep(500)
  await show('【B】移到宠物身上（悬停已叫出面板）')

  hold(); await sleep(300)
  await show('【C】真点一下宠物身体')

  const btn = await page.evaluate(() => {
    const b = document.querySelectorAll('.pet-panel button')[1]
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: b.textContent }
  })
  if (btn) {
    const bp = toScreen(btn)
    move(bp.x, bp.y); await sleep(200)
    hold(); await sleep(300)
    await show(`【D】真点一下面板按钮「${btn.label}」`)
  } else {
    console.log('【D】没找到按钮，面板可能已收起 —— 跳过')
  }

  move(away.x, away.y); await sleep(600)
  await show('【E】移到无关处停住（此刻该不该点一下别人才响应？）')
} finally {
  await app.close().catch(() => {})
  try {
    rmSync(work, { recursive: true, force: true })
  } catch { /* 句柄未释放就算了 */ }
}
