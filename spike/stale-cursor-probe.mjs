/**
 * 一次性：区分「Qoder 自己要显示手型」和「我们留下的残留形状」。
 *
 * 判据：形状是系统在光标跨窗口边界时重算的。把穿透还回去不算一次跨越，
 * 所以如果形状一直不变、而再多挪 2px 就变回箭头，那就是残留。
 * 跑法：node spike/stale-cursor-probe.mjs
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const work = mkdtempSync(join(tmpdir(), 'stale-cursor-'))
const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env: { ...process.env, PET_USER_DATA: work } })
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => (document.querySelector('video.is-front')?.videoWidth ?? 0) > 0, null, { timeout: 30_000 })
  await page.evaluate(() => window.__testPlay('idle', 'patrol'))
  const hit = await page.evaluate(() => window.__petDebug.hitBox)
  const ox = await page.evaluate(() => window.screenX)
  const oy = await page.evaluate(() => window.screenY)
  const pet = { x: Math.round(ox + hit.x + hit.w / 2), y: Math.round(oy + hit.y + hit.h / 2) }

  // 把面板叫出来，再取第一个按钮的中心点（真按钮，手型是应该的）
  move(pet.x, pet.y)
  await sleep(600)
  const btn = await page.evaluate(() => {
    const b = document.querySelectorAll('.pet-panel button')[2]
    const r = b.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: b.textContent }
  })
  move(btn.x, btn.y)
  await sleep(300)
  console.log(`【1】停在面板按钮「${btn.label}」上（手型应该出现）`)
  console.log(`    ${read(btn.x, btn.y)}`)

  // 从按钮往上离开宠物一段距离：这里已经不是我们的窗口了
  const out = { x: btn.x + 30, y: btn.y - 160 }
  move(out.x, out.y)
  await sleep(250)
  console.log(`【2】从按钮移到 ${out.x},${out.y}（已经离开宠物）`)
  console.log(`    ${read(out.x, out.y)}`)

  // 再多挪 2px，让系统重算一次形状
  move(out.x + 2, out.y)
  await sleep(250)
  console.log(`【3】同一点再多挪 2px`)
  console.log(`    ${read(out.x + 2, out.y)}`)

  // 反向对照：直接从宠物过去（不经按钮）
  const out2 = { x: pet.x + 30, y: pet.y - 300 }
  move(pet.x, pet.y); await sleep(500)
  move(out2.x, out2.y); await sleep(250)
  console.log(`【4】对照：从宠物身上直接移到 ${out2.x},${out2.y}`)
  console.log(`    ${read(out2.x, out2.y)}`)
} finally {
  await app.close().catch(() => {})
  try {
    rmSync(work, { recursive: true, force: true })
  } catch { /* 句柄未释放就算了 */ }
}
