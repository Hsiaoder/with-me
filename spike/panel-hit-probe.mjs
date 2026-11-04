/**
 * 一次性：面板收起后，那几个看不见的按钮还在不在命中测试里。
 *
 * 症状：点完宠物移出去，光标在宠物上方那条带子里变成手指。
 * 假设：`.pet-panel { display:flex }` 是作者样式，压过了 UA 的 `[hidden]{display:none}`，
 * 所以 hidden 只是透明度 0，元素照样占位、照样命中，而按钮都写着 cursor:pointer。
 * 跑法：node spike/panel-hit-probe.mjs
 */
import { _electron as electron } from 'playwright'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const work = mkdtempSync(join(tmpdir(), 'panel-hit-'))
const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env: { ...process.env, PET_USER_DATA: work } })
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => (document.querySelector('video.is-front')?.videoWidth ?? 0) > 0, null, { timeout: 30_000 })
  await page.evaluate(() => window.__testPlay('idle', 'patrol'))

  const probe = () => page.evaluate(() => {
    const p = document.querySelector('.pet-panel')
    const cs = getComputedStyle(p)
    // 按面板自己的实际矩形取样，别猜位置：上一版猜的带子落到了舞台 div 上，什么都没测到
    const b = p.getBoundingClientRect()
    const band = { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }
    const el = document.elementFromPoint(band.x, band.y)
    return {
      panelHidden: p.hidden,
      isOpen: window.__petDebug.panelOpen,
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      pointerEvents: cs.pointerEvents,
      offsetWH: [p.offsetWidth, p.offsetHeight],
      band,
      hitAtBand: el ? `${el.tagName}.${el.className || '(无class)'}${el.tagName === 'BUTTON' ? '[' + el.textContent + ']' : ''}` : 'null',
      cursorAtBand: el ? getComputedStyle(el).cursor : 'n/a',
      grab: window.__petDebug.grabRequested,
    }
  })

  const feed = (x, y) => page.evaluate((pt) => window.__petDebug.cursor(pt), { x, y })
  const hit = await page.evaluate(() => window.__petDebug.hitBox)
  const center = { x: hit.x + hit.w / 2, y: hit.y + hit.h / 2 }

  // 面板现在由点击叫出来（喂光标叫不动），所以这里点一下身体
  await page.evaluate((p) => {
    const fire = (t) => window.dispatchEvent(new PointerEvent(t, { clientX: p.x, clientY: p.y, bubbles: true }))
    fire('pointerdown')
    fire('pointerup')
  }, center)
  await page.waitForTimeout(200)
  await feed(center.x, center.y)
  console.log('【1】点开面板：', JSON.stringify(await probe()))

  // 点宠物：现在是 toggle，开着的时候这一下会把它收掉
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(600)
  const after = await probe()
  console.log('【2】点完宠物 600ms 后：', JSON.stringify(after, null, 1))
  console.log(`    判读：panelHidden=${after.panelHidden} 但 hidden 时 display=${after.display} ` +
    `→ ${after.display === 'none' ? '真的移出布局（没问题）' : '仍在布局里'}；` +
    `带子里命中的元素=${after.hitAtBand}，cursor=${after.cursorAtBand}`)
} finally {
  await app.close().catch(() => {})
  try {
    rmSync(work, { recursive: true, force: true })
  } catch { /* 句柄未释放就算了 */ }
}
