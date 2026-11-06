// 一次性量尺寸：真窗口的真 CSS 下，飘字芯片装得下哪几条标签。跑完就删。
import { _electron as electron } from 'playwright'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const userData = mkdtempSync(join(tmpdir(), 'pet-float-w-'))
const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, PET_USER_DATA: userData, PET_FREEZE_CURSOR: '1' },
})
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => document.querySelectorAll('video').length === 2, null, { timeout: 30_000 })
  const got = await page.evaluate(() => {
    const layer = document.querySelector('.pet-floats')
    const was = layer.hidden
    layer.hidden = false
    const out = ['饥饿 +18', '心情 +2', '体重 +1', '亲密度 +0.3', '亲密度 +99.9', '饥饿 +100', '亲密度 +100.0'].map((t) => {
      const el = document.createElement('div')
      el.className = 'pet-float'
      el.textContent = t
      layer.append(el)
      const r = el.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(el)
      const ink = range.getBoundingClientRect().width
      const need = el.scrollWidth
      el.remove()
      return { t, box: Math.round(r.width), ink: Math.round(ink), need }
    })
    layer.hidden = was
    return out
  })
  for (const g of got) console.log(`${g.t.padEnd(14)} 墨迹 ${String(g.ink).padStart(3)}px  需 ${String(g.need).padStart(3)}  盒 ${g.box}  ${g.need <= g.box ? 'OK' : '装不下'}`)
} finally {
  await app?.close().catch(() => {})
  try {
    rmSync(userData, { recursive: true, force: true })
  } catch {
    /* EBUSY */
  }
}
