/**
 * 一次性：用真光标重放用户的操作（点宠物 → 移到别处），看那个点归谁。
 *
 * 为什么必须真光标：WindowFromPoint 走的是系统命中测试，透明窗的
 * WS_EX_TRANSPARENT 只有在系统层面才生效，CDP 的合成事件测不到这件事。
 * 跑法：node spike/focus-probe.mjs
 */
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PS = join(process.cwd(), 'spike/winprobe.ps1')
const run = (...args) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS, ...args], { encoding: 'utf8' }).trim()
const owner = (x, y) => run('owner', '-X', String(x), '-Y', String(y))
const move = (x, y) => run('move', '-X', String(x), '-Y', String(y))
const click = () => run('click')
const grab = () => page.evaluate(() => window.__petDebug.grabRequested)

const work = mkdtempSync(join(tmpdir(), 'focus-probe-'))
const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env: { ...process.env, PET_USER_DATA: work } })
let page
try {
  page = await app.firstWindow()
  await page.waitForFunction(() => (document.querySelector('video.is-front')?.videoWidth ?? 0) > 0, null, { timeout: 30_000 })
  await page.evaluate(() => window.__testPlay('idle', 'patrol'))
  const hit = await page.evaluate(() => window.__petDebug.hitBox)
  const sx = await page.evaluate(() => window.screenX)
  const sy = await page.evaluate(() => window.screenY)
  // PowerShell 是 DPI-不敏感进程：SetCursorPos / WindowFromPoint 都用逻辑像素，
  // 和页面的 CSS 像素同一套坐标，不乘 devicePixelRatio（乘了就跑到屏幕外）。
  const cssToScreen = (p) => ({ x: Math.round(sx + p.x), y: Math.round(sy + p.y) })
  const pet = cssToScreen({ x: hit.x + hit.w / 2, y: hit.y + hit.h / 2 })
  const fgText = run('fg')
  const fgMatch = fgText.match(/fgcenter=(\d+),(\d+)/)
  const away = fgMatch ? { x: Number(fgMatch[1]), y: Number(fgMatch[2]) } : cssToScreen({ x: 400, y: 400 })

  console.log(fgText.split('\n')[0])
  console.log(`宠物(逻辑px) ${pet.x},${pet.y}   前台窗口中心 ${away.x},${away.y}`)
  console.log(`目标点归属（宠物还没接管时）  ${owner(away.x, away.y)}`)

  move(pet.x, pet.y)
  await new Promise((r) => setTimeout(r, 500))
  console.log(`移到宠物上 grab=${await grab()}  该点归属  ${owner(pet.x, pet.y)}`)

  click()                                    // 真点一下宠物
  await new Promise((r) => setTimeout(r, 500))
  console.log(`点了宠物之后 grab=${await grab()} 面板开=${await page.evaluate(() => window.__petDebug.panelOpen)}`)

  // 一格一格挪到前台窗口的中心，每格都问那个点归谁；
  // 只要归我们的透明窗，下面的应用就收不到 hover，画不出手型光标。
  const STEPS = 8
  for (let i = 1; i <= STEPS; i++) {
    const t = {
      x: Math.round(pet.x + ((away.x - pet.x) * i) / STEPS),
      y: Math.round(pet.y + ((away.y - pet.y) * i) / STEPS),
    }
    move(t.x, t.y)
    await new Promise((r) => setTimeout(r, 120))
    console.log(`  第${i}步 → ${t.x},${t.y}  grab=${await grab()}  ${owner(t.x, t.y)}`)
  }
  await new Promise((r) => setTimeout(r, 600))
  console.log(`停在同一点 600ms 后  grab=${await grab()}  ${owner(away.x, away.y)}`)
} finally {
  await app.close().catch(() => {})
  try {
    rmSync(work, { recursive: true, force: true })
  } catch { /* 句柄可能还没释放 */ }
}
