/** 一次性：测「光标离开宠物后，整块屏幕还会接住鼠标多久」。不进仓库。 */
import { _electron as electron } from 'playwright'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, PET_USER_DATA: mkdtempSync(join(tmpdir(), 'grab-probe-')) },
})
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => (document.querySelector('video.is-front')?.videoWidth ?? 0) > 0, null, { timeout: 30_000 })
  await page.evaluate(() => window.__testPlay('idle', 'patrol'))

  const feed = (p) => page.evaluate((pt) => window.__petDebug.cursor(pt), p)
  const snap = () => page.evaluate(() => ({
    grab: window.__petDebug.grabRequested,
    open: window.__petDebug.panelOpen,
  }))

  async function run(label, openPanelFirst) {
    const hit = await page.evaluate(() => window.__petDebug.hitBox)
    const center = { x: hit.x + hit.w / 2, y: hit.y + hit.h / 2 }
    await feed(center)
    if (openPanelFirst) {
      await page.waitForTimeout(460)
      await feed(center)
    }
    const before = await snap()
    const t0 = Date.now()
    await feed({ x: 4, y: 4 })           // 一下甩到屏幕左上角：身体和面板都不在
    let grabOffAt = null, closedAt = null
    while (Date.now() - t0 < 1300) {
      const s = await snap()
      if (grabOffAt === null && !s.grab) grabOffAt = Date.now() - t0
      if (closedAt === null && !s.open) closedAt = Date.now() - t0
      if (grabOffAt !== null && closedAt !== null) break
      await page.waitForTimeout(10)
    }
    console.log(`${label}`)
    console.log(`  离开前：grab=${before.grab} 面板开=${before.open}`)
    console.log(`  离开后：鼠标在 ${grabOffAt === null ? '>1300ms 仍接住' : grabOffAt + 'ms 才放开'}，面板在 ${closedAt === null ? '>1300ms 仍开' : closedAt + 'ms 收起'}`)
    console.log(`  这段时间 = 整块屏幕都不穿透、点击被吞掉的窗口\n`)
  }

  await run('A. 面板没开（直接掠过宠物就走）', false)
  await new Promise((r) => setTimeout(r, 600))
  await run('B. 面板已开（悬停叫出按钮后再甩出去）', true)
} finally {
  await app.close().catch(() => {})
}
