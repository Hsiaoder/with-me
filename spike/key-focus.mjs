/**
 * 一次性：键盘焦点到底会不会跟着那次点击跑到宠物身上——用 F13 当探针。
 *
 * 为什么用 F13：几乎所有应用都没绑它，发出去不会往谁的文档里打字、也不会触发谁的动作。
 * 判据：宠物页面挂了 keydown 计数。点完宠物发 F13，页面收到 = 焦点真过来了；
 * 一次都没收到 = 焦点不在我们这，用户看到的「要再点一下」是别的原因。
 * 跑法：node spike/key-focus.mjs
 */
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PS = join(process.cwd(), 'spike/winprobe.ps1')
const probe = (...a) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS, ...a], { encoding: 'utf8' }).trim()
const move = (x, y) => probe('move', '-X', String(x), '-Y', String(y))
const hold = () => probe('hold')
const f13 = () => probe('key', '-X', '124')     // 0x7C = F13
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const work = mkdtempSync(join(tmpdir(), 'keyfocus-'))
const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env: { ...process.env, PET_USER_DATA: work } })
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => (document.querySelector('video.is-front')?.videoWidth ?? 0) > 0, null, { timeout: 30_000 })
  await page.evaluate(() => window.__testPlay('idle', 'patrol'))
  await page.evaluate(() => {
    window.__keys = []
    // 监听 window 上的捕获阶段：任何 keydown 都跑不掉
    window.addEventListener('keydown', (e) => window.__keys.push(e.key), true)
  })
  const hit = await page.evaluate(() => window.__petDebug.hitBox)
  const ox = await page.evaluate(() => window.screenX)
  const oy = await page.evaluate(() => window.screenY)
  const pet = { x: Math.round(ox + hit.x + hit.w / 2), y: Math.round(oy + hit.y + hit.h / 2) }
  const away = { x: pet.x - 400, y: pet.y - 300 }
  const keys = () => page.evaluate(() => window.__keys.join('+') || '(没收到任何按键)')

  // 基线：光标在无关处，发两次 F13。我们本就不该收到。
  move(away.x, away.y); await sleep(400); f13(); f13(); await sleep(300)
  console.log(`【A】基线（光标在无关处，没点宠物）：页面收到按键 = ${await keys()}`)

  // 悬停到宠物身上（此时 grab 开，但没人点我们）
  move(pet.x, pet.y); await sleep(600); f13(); await sleep(300)
  console.log(`【B】只是悬停在宠物上（grab=${await page.evaluate(() => window.__petDebug.grabRequested)}）：${await keys()}`)

  // 真点一下宠物，再发 F13
  await page.evaluate(() => { window.__keys = [] })
  hold(); await sleep(400); f13(); f13(); await sleep(400)
  console.log(`【C】真点一下宠物之后再发 F13：${await keys()}  hasFocus=${await page.evaluate(() => document.hasFocus())}  activeElement=${await page.evaluate(() => document.activeElement.tagName)}`)

  // 移开，等 grab 放开，再发一次
  move(away.x, away.y); await sleep(900)
  await page.evaluate(() => { window.__keys = [] })
  f13(); f13(); await sleep(400)
  console.log(`【D】移开 900ms 后再发 F13：${await keys()}  grab=${await page.evaluate(() => window.__petDebug.grabRequested)}`)
} finally {
  await app.close().catch(() => {})
  try { rmSync(work, { recursive: true, force: true }) } catch { /* 句柄未释放就算了 */ }
}
