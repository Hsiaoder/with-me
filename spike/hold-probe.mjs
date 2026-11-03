/**
 * 一次性 A/B：光标停在一个不动的点上（用户的姿势），问「这个点归谁、形状是什么」。
 *
 * 用户的操作是：点宠物 → 面板出来 → 把鼠标挪到 Qoder 界面上停住 → 手型不出、要再点一下。
 * 停住是关键：形状只在系统给那个点所属窗口发 WM_SETCURSOR 时才刷新，
 * 所以「谁拥有这个点」一旦被我扣住，下面的应用就连 hover 都收不到。
 *
 * 跑法：node spike/hold-probe.mjs
 */
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PS = join(process.cwd(), 'spike/winprobe.ps1')
const run = (...a) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS, ...a], { encoding: 'utf8' }).trim()
const read = (x, y) => run('cursor', '-X', String(x), '-Y', String(y))
const move = (x, y) => run('move', '-X', String(x), '-Y', String(y))

const work = mkdtempSync(join(tmpdir(), 'hold-probe-'))
const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env: { ...process.env, PET_USER_DATA: work } })
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => (document.querySelector('video.is-front')?.videoWidth ?? 0) > 0, null, { timeout: 30_000 })
  await page.evaluate(() => window.__testPlay('idle', 'patrol'))
  const hit = await page.evaluate(() => window.__petDebug.hitBox)
  const sx = await page.evaluate(() => window.screenX)
  const sy = await page.evaluate(() => window.screenY)
  const pet = { x: Math.round(sx + hit.x + hit.w / 2), y: Math.round(sy + hit.y + hit.h / 2) }

  // 固定观察点：宠物左边 400px、上边 300px，那里正常是别的窗口
  const P = { x: pet.x - 400, y: pet.y - 300 }
  move(P.x, P.y)
  await new Promise((r) => setTimeout(r, 400))
  console.log(`基准（没碰宠物，停在同一点）      ${read(P.x, P.y)}`)

  // 完全按用户的姿势：移到宠物 → 等面板出来 → 挪到 P → 从此手不动
  move(pet.x, pet.y)
  await new Promise((r) => setTimeout(r, 520))
  const st = await page.evaluate(() => ({ grab: window.__petDebug.grabRequested, open: window.__petDebug.panelOpen }))
  console.log(`在宠物上等面板：grab=${st.grab} 面板开=${st.open}`)
  move(P.x, P.y)
  const t0 = Date.now()
  for (const wait of [50, 150, 300, 500, 800]) {
    await new Promise((r) => setTimeout(r, Math.max(5, wait - (Date.now() - t0))))
    console.log(`移到 P 后 ~${wait}ms（手不动）  ${read(P.x, P.y)}  渲染层grab=${await page.evaluate(() => window.__petDebug.grabRequested)}`)
  }
} finally {
  await app.close().catch(() => {})
  try {
    rmSync(work, { recursive: true, force: true })
  } catch { /* 句柄可能还没释放 */ }
}
