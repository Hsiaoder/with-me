/**
 * 一次性截图探针：证明面板出场动画真的在跑，并留下两帧给人看。
 * 为什么不能比 getBoundingClientRect：`capturePage()` 本身要几百毫秒，
 * 等它回来动画早就落定了，量到两次一样的矩形——那是探针自己慢，不是产品没动。
 * 直接读**计算样式**的 scale / translate 才是准的：点完立刻按帧采样，动画中它们一定不是 1 / 0。
 * 跑法：node spike/panel-motion-shot.mjs
 * 前置：桌面上那只宠物要已经退出（e2e 有单实例锁，同 userData 起不来第二份）。
 */
import { _electron as electron } from 'playwright'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'child_process'
import { createRequire } from 'node:module'

const FF = createRequire(import.meta.url)('ffmpeg-static')
const SKIN_SRC = join(tmpdir(), 'dsh-asar-BHUAA9', 'pet', 'skins', 'dshtry')
if (!existsSync(SKIN_SRC)) throw new Error(`试穿皮肤不在：${SKIN_SRC}（先跑 node spike/dsh-asar-extract.mjs）`)

const ud = mkdtempSync(join(tmpdir(), 'panel-motion-'))
mkdirSync(join(ud, 'skins'), { recursive: true })
cpSync(SKIN_SRC, join(ud, 'skins', 'dshtry'), { recursive: true })
writeFileSync(join(ud, 'save.json'), JSON.stringify({ version: 2, skin: 'dshtry' }), 'utf8')

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, PET_USER_DATA: ud, PET_FREEZE_CURSOR: '1' },
})

try {
  const page = await app.firstWindow()
  await page.waitForTimeout(1600)

  const shot = async (name) => {
    const buf = Buffer.from(
      await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0]
        return w.capturePage().then((img) => img.toPNG().toString('base64'))
      }),
      'base64',
    )
    writeFileSync(join('spike', 'out', name), buf)
    return buf
  }

  const clickBody = async () => {
    const h = await page.evaluate(() => window.__petDebug.hitBox)
    await page.evaluate((p) => {
      const fire = (t) => window.dispatchEvent(new PointerEvent(t, { clientX: p.x, clientY: p.y, bubbles: true }))
      fire('pointerdown')
      fire('pointerup')
    }, { x: h.x + h.w / 2, y: h.y + h.h / 2 })
  }

  /**
   * 按帧读计算样式。sel 用函数传进去而不是拼字符串：选择器拼错只会静测量失败，
   * 函数版查不到节点会明确返回 null。
   * 落定之后 `scale` 的计算值是 `none`（没人再声明它），那不是「量不到」，就是 1。
   */
  const sample = (sel, frames = 6) =>
    page.evaluate(async ({ sel, frames }) => {
      const pick = () => {
        const n = document.querySelector(sel)
        if (n === null) return null
        const cs = getComputedStyle(n)
        const raw = cs.scale
        return { scale: raw === 'none' || raw === '' ? 1 : Number.parseFloat(raw), translate: cs.translate }
      }
      const out = []
      for (let i = 0; i < frames; i++) {
        out.push(pick())
        await new Promise((r) => requestAnimationFrame(r))
      }
      return out
    }, { sel, frames })

  const verdict = (label, rows) => {
    const mid = rows.filter((r) => r !== null)
    if (mid.length < 2) { console.log(`✗ ${label}：没量到节点`); return }
    const moving = mid.some((r) => r.scale < 0.99) || mid.some((r) => r.translate !== '0px 0px')
    console.log(`${moving ? '✓' : '✗'} ${label}：scale ${mid.map((r) => r.scale.toFixed(2)).join(' → ')}｜translate ${mid.map((r) => r.translate).join(' ')}`)
  }

  // ① 面板刚叫出来的前几帧。取**中间那颗**：它的 --i 是 0、没有错峰延迟，
  //   拿第一颗会被 80ms 的延迟吃掉，前几帧全是起始值，看着像没动。
  await clickBody()
  verdict('按钮条出场（中间那颗）', await sample('.pet-actions button[data-id]:nth-child(3)', 10))
  await shot('motion-t0.png')
  await page.waitForTimeout(500)
  await shot('motion-t1.png')
  const settled = await sample('.pet-actions button[data-id]:nth-child(3)', 1)
  console.log(`落定后：scale ${settled.map((r) => r?.scale.toFixed(3)).join(' ')}｜translate ${settled[0]?.translate}`)

  // ② 列表那张卡片的出场
  await page.click('.pet-panel button[data-id="feed"]')
  verdict('副板出场', await sample('.pet-plate'))
  await shot('motion-foods-t0.png')
  await page.waitForTimeout(400)
  const f1 = await page.evaluate(() => {
    const r = document.querySelector('.pet-plate').getBoundingClientRect()
    return { w: Math.round(r.width), x: Math.round(r.x), y: Math.round(r.y), h: Math.round(r.height) }
  })
  console.log(`副板落定尺寸：${JSON.stringify(f1)}`)
  execFileSync(FF, ['-v', 'error', '-y', '-i', join('spike', 'out', 'motion-foods-t0.png'),
    '-vf', `crop=${Math.max(60, f1.w * 2 + 60)}:${f1.h * 2 + 80}:${Math.max(0, f1.x * 2 - 30)}:${Math.max(0, f1.y * 2 - 40)}`,
    join('spike', 'out', 'motion-foods-crop.png')])
  console.log('已存：spike/out/motion-*.png')
} finally {
  await app.close()
  rmSync(ud, { recursive: true, force: true, maxRetries: 8, maxRetryTime: 2000 })
}
