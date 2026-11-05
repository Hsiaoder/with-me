/**
 * 底板中心色探针：证明「border-image 不带 fill + background-clip: padding-box」真的改了像素。
 *
 * 跑在 Electron 里（和 e2e 同一个运行时，也就是 App 真正的 Chromium），能同时拿到
 * getComputedStyle 和截图像素。会开一个 200×60 的小窗几秒，用完关掉。
 *
 * 采样点：
 *   center (100,30) = 面板正中，看中心色由谁说话
 *   corner (0,0)    = 左上角圆角**外侧**缺口（素材在此 alpha=0），看背景有没有漏进 border 区
 *   edge   (40,1)   = 装饰带最外那道，三组必须同色——证明素材没被换掉或拉歪
 *
 * P 纯 CSS 对照   不引任何素材，中心必须是 (10,20,30) —— 它证明采样/尺寸/DPI 换算没错。
 *                 这一条不成立，下面三组的结论一律作废。
 * A 旧写法        期望中心 = 素材浅灰 218,220,231（现状「灰」被复现）
 * B 新写法        期望中心 = CSS 浅蓝 220,234,245，且 corner 不被污染
 * C 反向对照      故意漏写 background-clip → 期望 corner 被浅蓝污染。
 *                 C 必须和 B 不一样，否则这探针测不出失败，B 的「成功」不算证据。
 *
 * 用法：node spike/plate-fill-probe.mjs
 */
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ffmpegPath from 'ffmpeg-static'

const W = 200
const H = 60

const PNG = path.resolve('src/renderer/icons/button_rectangle_depth_line.png')
const dataUrl = 'data:image/png;base64,' + fs.readFileSync(PNG).toString('base64')

const VARIANTS = {
  P_纯CSS对照: { border: 'border: 8px solid rgb(10,20,30);', bi: '', bg: 'background-color: rgb(10,20,30);', clip: '' },
  A_旧写法_fill: { border: '', bi: `border-image: url("${dataUrl}") 8 8 12 fill;`, bg: 'background: none;', clip: '' },
  B_新写法: { border: '', bi: `border-image: url("${dataUrl}") 8 8 12;`, bg: 'background-color: #dceaf5;', clip: 'background-clip: padding-box;' },
  C_反向对照_漏clip: { border: '', bi: `border-image: url("${dataUrl}") 8 8 12;`, bg: 'background: #dceaf5;', clip: '' },
}

const html = (v) => `<!doctype html><meta charset=utf8><style>
  html, body { margin: 0; background: #ff00ff; }
  .plate {
    position: absolute; left: 0; top: 0; box-sizing: border-box;
    width: ${W}px; height: ${H}px; padding: 3px;
    border-style: solid; border-color: transparent;
    border-width: 8px 8px 12px 8px; border-radius: 0;
    ${v.border}
    ${v.bi}
    ${v.bg}
    ${v.clip}
  }
</style><div class="plate"></div>`

const tmpMain = path.join(os.tmpdir(), 'plate-probe-main.cjs')
fs.writeFileSync(tmpMain, `
const { app, BrowserWindow } = require('electron')
app.on('window-all-closed', (e) => e.preventDefault())
app.whenReady().then(() => {
  new BrowserWindow({ width: ${W}, height: ${H}, x: -32000, y: -32000, show: true, frame: false, resizable: false })
    .loadURL('about:blank')
})
`)

const app = await electron.launch({ args: [tmpMain] })
const page = await app.firstWindow()
const out = {}

for (const [name, v] of Object.entries(VARIANTS)) {
  await page.setContent(html(v))
  const m = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.plate'))
    return {
      dsf: devicePixelRatio, vw: innerWidth, vh: innerHeight,
      slice: cs.borderImageSlice, src: cs.borderImageSource.slice(0, 24),
      bg: cs.backgroundColor, clip: cs.backgroundClip,
      box: (() => { const r = document.querySelector('.plate').getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}` })(),
    }
  })
  const shot = path.join(os.tmpdir(), `plate-probe-${Date.now()}.png`)
  await page.screenshot({ path: shot })
  const raw = execFileSync(ffmpegPath, ['-loglevel', 'error', '-i', shot, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1 << 26 })
  fs.unlinkSync(shot)
  const iw = Math.round(m.vw * m.dsf), ih = Math.round(m.vh * m.dsf)
  if (raw.length !== iw * ih * 4) throw new Error(`${name} 截图是 ${raw.length / 4}px，期望 ${iw}x${ih} —— DPI/视口换算错了，采样不可信`)
  const px = (x, y) => { const i = (Math.round(y * m.dsf) * iw + Math.round(x * m.dsf)) * 4; return `(${raw[i]},${raw[i + 1]},${raw[i + 2]})` }
  out[name] = { m, center: px(100, 30), corner: px(0, 0), edge: px(40, 1) }
}
await app.close()
fs.unlinkSync(tmpMain)

for (const [name, r] of Object.entries(out)) {
  console.log(`### ${name}  [视口 ${r.m.vw}x${r.m.vh} dsf=${r.m.dsf} 板 ${r.m.box}]`)
  console.log(`  computed: slice=${JSON.stringify(r.m.slice)} src=${JSON.stringify(r.m.src)} bg=${r.m.bg} clip=${JSON.stringify(r.m.clip)}`)
  console.log(`  中心 ${r.center}   圆角缺口 ${r.corner}   装饰带 ${r.edge}\n`)
}

const p = out.P_纯CSS对照, a = out.A_旧写法_fill, b = out.B_新写法, c = out.C_反向对照_漏clip
const ok = (label, pass, detail) => console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ← ' + detail : ''}`)
console.log('=== 判据 ===')
ok('P 对照成立：采样没被 DPI 骗（中心=10,20,30）', /10,20,30/.test(p.center), p.center)
ok('A 复现现状：中心是素材那道浅灰', /218,220,231/.test(a.center), a.center)
ok('B 新写法：中心变成 CSS 的浅蓝', /220,234,245/.test(b.center), b.center)
ok('B 圆角缺口没被背景污染', b.corner !== b.center, `corner=${b.corner} center=${b.center}`)
ok('C 反向对照：漏写 clip 后缺口被污染', c.corner !== b.corner, `C.corner=${c.corner} vs B.corner=${b.corner}`)
ok('探针能区分 B 与 C', b.corner !== c.corner)
ok('B 的 slice 计算值不含 fill', !/fill/.test(b.m.slice), JSON.stringify(b.m.slice))
ok('三组装饰带上边同色（素材没被换/拉歪）', a.edge === b.edge && b.edge === c.edge, a.edge)
