/**
 * 一次性：跑 focus-canary.ps1，用记事本当键盘金丝雀。
 * 宠物用 playwright 起（这样能读到命中框、也能冻住走动），坐标才知道该给谁。
 * 跑法：node spike/focus-canary-run.mjs
 */
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PS = join(process.cwd(), 'spike/focus-canary.ps1')
const work = mkdtempSync(join(tmpdir(), 'canary-'))
const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env: { ...process.env, PET_USER_DATA: work } })
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => (document.querySelector('video.is-front')?.videoWidth ?? 0) > 0, null, { timeout: 30_000 })
  // 冻住行为链：宠物在走的话坐标就给不准了
  await page.evaluate(() => window.__testPlay('idle', 'patrol'))
  const hit = await page.evaluate(() => window.__petDebug.hitBox)
  const ox = await page.evaluate(() => window.screenX)
  const oy = await page.evaluate(() => window.screenY)
  const pet = { x: Math.round(ox + hit.x + hit.w / 2), y: Math.round(oy + hit.y + hit.h / 2) }
  console.log(`宠物中心（逻辑像素）= ${pet.x},${pet.y}`)
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', PS, '-PetX', String(pet.x), '-PetY', String(pet.y), '-AwayX', '120', '-AwayY', '120'], { encoding: 'utf8' })
  console.log(out)
  console.log('结束时页面状态:', JSON.stringify(await page.evaluate(() => ({
    grab: window.__petDebug.grabRequested, open: window.__petDebug.panelOpen,
  }))))
} finally {
  await app.close().catch(() => {})
  try {
    rmSync(work, { recursive: true, force: true })
  } catch { /* 句柄未释放就算了 */ }
}
