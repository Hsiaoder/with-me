/**
 * 一次性：点宠物那一下，有没有把焦点/激活从别的应用手里抢走。
 *
 * 为什么要查这个：滚轮消息（WM_MOUSEWHEEL）系统是按**焦点窗口**投递的，
 * 不按光标位置。用户说「移出去滚不动，必须点一下才能滚」——那只有焦点变了才解释得通。
 * 这扇窗靠 WS_EX_NOACTIVATE 保证点它不激活，所以还要看那个位还在不在。
 *
 * 跑法：node spike/focus-theft-probe.mjs
 */
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PS = join(process.cwd(), 'spike/winprobe.ps1')
const run = (...a) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS, ...a], { encoding: 'utf8' }).trim()
const fg = () => run('fg').split('\n')[0]
const exstyle = () => run('exstyle')
const owner = (x, y) => run('owner', '-X', String(x), '-Y', String(y))
const move = (x, y) => run('move', '-X', String(x), '-Y', String(y))

const work = mkdtempSync(join(tmpdir(), 'theft-probe-'))
const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env: { ...process.env, PET_USER_DATA: work } })
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => (document.querySelector('video.is-front')?.videoWidth ?? 0) > 0, null, { timeout: 30_000 })
  await page.evaluate(() => window.__testPlay('idle', 'patrol'))
  const pid = app.process().pid
  const hit = await page.evaluate(() => window.__petDebug.hitBox)
  const sx = await page.evaluate(() => window.screenX)
  const sy = await page.evaluate(() => window.screenY)
  const pet = { x: Math.round(sx + hit.x + hit.w / 2), y: Math.round(sy + hit.y + hit.h / 2) }
  const away = { x: pet.x - 380, y: pet.y - 260 }

  console.log(`宠物主进程 pid=${pid}`)
  console.log(`【1】点之前  前台：${fg()}`)
  console.log(`          扩展样式：${exstyle()}`)

  // 闸门：先确认真光标落到了宠物身上（grab 变 true），否则后面全是在测空气。
  // 上一轮就没落上——映射差一点整条结论就不成立，所以这里必须自己验。
  let onPet = false
  for (let i = 0; i < 8 && !onPet; i++) {
    move(pet.x, pet.y)
    await new Promise((r) => setTimeout(r, 150))
    onPet = await page.evaluate(() => window.__petDebug.grabRequested)
  }
  if (!onPet) {
    console.log('!! 真光标没能落在宠物上（grab 始终 false），本轮不判定')
  } else {
    console.log(`        确认：真光标已在宠物身上，grab=true，该点归属 ${owner(pet.x, pet.y)}`)
    run('click')
    await new Promise((r) => setTimeout(r, 400))
    console.log(`【2】点了宠物  前台：${fg()}`)
    console.log(`          扩展样式：${exstyle()}  渲染层grab=${await page.evaluate(() => window.__petDebug.grabRequested)}`)
  }

  move(away.x, away.y)
  // 手不动，只从页面里读 grab（毫秒粒度）。PowerShell 每次查询要一秒上下，
  // 用它采样会把 400ms 的事件糊过去——这是这个探针系列的精度上限，别拿它做毫秒 A/B。
  const marks = [0, 50, 150, 400, 800]
  const timeline = []
  for (const m of marks) {
    const wait = m - (timeline.length ? marks[timeline.length - 1] : 0)
    await new Promise((r) => setTimeout(r, wait))
    timeline.push(`${m}ms:grab=${await page.evaluate(() => window.__petDebug.grabRequested)}`)
  }
  console.log(`【3】移出去手不动  ${timeline.join('  ')}`)
  console.log(`          前台：${fg()}`)
  console.log(`          该点归属：${owner(away.x, away.y)}`)
  console.log(`          扩展样式：${exstyle()}`)
  console.log('\n判读：前台若变成 proc=electron，就是点宠物那一下抢走了激活，滚轮自然跟着走；')
  console.log('      NOACTIVATE=NO 说明那扇窗允许被激活，是根因；前台始终是 Qoder 而滚轮仍不动，就得换方向查。')
} finally {
  await app.close().catch(() => {})
  try {
    rmSync(work, { recursive: true, force: true })
  } catch { /* 句柄可能还没释放 */ }
}
