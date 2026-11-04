/**
 * 一次性截图探针：把面板叫出来，抓一帧合成后的画面存成 PNG。
 *
 * 存在的理由：按钮「有没有圆圈」是像素级的事，e2e 只能验命中和光标，验不了外观。
 * 用户报的画现象也得先在这台机器的桌面帧上证实，不能靠推测改 CSS。
 *
 * 跑法：node spike/icon-shot.mjs   → spike/out/icon-shot.png
 */
import { _electron as electron } from 'playwright'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SKIN_SRC = join(tmpdir(), 'dsh-asar-BHUAA9', 'pet', 'skins', 'dshtry')
const ud = mkdtempSync(join(tmpdir(), 'icon-shot-'))
mkdirSync(join(ud, 'skins'), { recursive: true })
cpSync(SKIN_SRC, join(ud, 'skins', 'dshtry'), { recursive: true })
// 不写这份存档的话默认皮肤是 block，截出来是绿方块，看不到试穿形象
writeFileSync(join(ud, 'save.json'), JSON.stringify({ version: 1, skin: 'dshtry' }), 'utf8')

let code = 0
try {
  const app = await electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: { ...process.env, PET_USER_DATA: ud, PET_FREEZE_CURSOR: '1' },
  })
  const page = await app.firstWindow()
  await page.waitForTimeout(1600)

  // 把光标停在身体正中，等满 400ms 让面板自己弹出来
  await page.evaluate(() => {
    const h = window.__petDebug.hitBox
    window.__petDebug.cursor({ x: h.x + h.w / 2, y: h.y + h.h / 2 })
  })
  await page.waitForTimeout(600)
  const open = await page.evaluate(() => window.__petDebug.panelOpen)
  console.log(`面板开着：${open}`)

  const shot = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    return w.capturePage().then((img) => img.toPNG().toString('base64'))
  })
  const out = join('spike', 'out', 'icon-shot.png')
  mkdirSync(join('spike', 'out'), { recursive: true })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(out, Buffer.from(shot, 'base64'))
  console.log(`已存：${out}`)

  // 顺手量一下按钮的实际样式，避免「截图看着没圆，其实是 UA 又给补回来了」
  const css = await page.evaluate(() => {
    const b = document.querySelector('.pet-panel button')
    const s = getComputedStyle(b)
    return { border: s.border, background: s.backgroundColor, radius: s.borderRadius, shadow: s.boxShadow }
  })
  console.log(`按钮样式：${JSON.stringify(css)}`)
  await app.close()
} catch (e) {
  code = 1
  console.error(String(e && e.stack ? e.stack : e))
} finally {
  rmSync(ud, { recursive: true, force: true })
  process.exitCode = code
}
