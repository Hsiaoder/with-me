/**
 * 一次性：按用户的真实动作（真点宠物 → 移到别处停住）复现"滚轮不灵，得再点一下"，
 * 每步都用真输入 + 真命中测试，把 capture（鼠标捕获）也读出来。
 *
 * 为什么必须真输入：Chromium 的 SetCapture 是在原生鼠标消息里做的，
 * Playwright 的 CDP 合成事件不走那条路，永远复现不出捕获泄漏。
 * 跑法：node spike/capture-repro.mjs
 */
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PS = join(process.cwd(), 'spike/winprobe.ps1')
const probe = (...a) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS, ...a], { encoding: 'utf8' }).trim()
const move = (x, y) => probe('move', '-X', String(x), '-Y', String(y))
const read = (x, y) => probe('point', '-X', String(x), '-Y', String(y))
const hold = () => probe('hold')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const work = mkdtempSync(join(tmpdir(), 'cap-probe-'))
const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env: { ...process.env, PET_USER_DATA: work } })
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => (document.querySelector('video.is-front')?.videoWidth ?? 0) > 0, null, { timeout: 30_000 })
  await page.evaluate(() => window.__testPlay('idle', 'patrol'))
  const hit = await page.evaluate(() => window.__petDebug.hitBox)
  const ox = await page.evaluate(() => window.screenX)
  const oy = await page.evaluate(() => window.screenY)
  // PowerShell 是 DPI-不敏感进程：SetCursorPos 收逻辑像素，与页面 CSS 像素同一套，不乘 dpr
  const pet = { x: Math.round(ox + hit.x + hit.w / 2), y: Math.round(oy + hit.y + hit.h / 2) }
  const away = { x: pet.x - 420, y: pet.y - 280 }
  const grabNow = () => page.evaluate(() => window.__petDebug.grabRequested)

  console.log(`宠物中心=${pet.x},${pet.y}   观察点=${away.x},${away.y}`)
  console.log(`【1】什么都没做，停在观察点\n    ${read(away.x, away.y)}`)

  move(pet.x, pet.y); await sleep(400)
  console.log(`【2】移到宠物身上\n    ${read(pet.x, pet.y)}\n    渲染层grab=${await grabNow()}`)

  hold()
  console.log(`【3】真按下去再松开（点宠物）\n    ${read(pet.x, pet.y)}\n    渲染层grab=${await grabNow()}`)

  move(away.x, away.y); await sleep(300)
  console.log(`【4】移到观察点（手不动，此刻滚轮该不该灵？）\n    ${read(away.x, away.y)}\n    渲染层grab=${await grabNow()}`)

  await sleep(1200)
  console.log(`【5】同一个点再等 1.2 秒\n    ${read(away.x, away.y)}\n    渲染层grab=${await grabNow()}`)
} finally {
  await app.close().catch(() => {})
  try {
    rmSync(work, { recursive: true, force: true })
  } catch { /* 句柄未释放就算了 */ }
}
