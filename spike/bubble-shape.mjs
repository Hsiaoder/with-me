/**
 * 一次性探针（throwaway）：把气泡底图在 Chromium 里量一遍，打字符图。
 *
 * 为什么要量而不读路径文本：这类素材是**一条 path 两个子路径**靠缠绕方向凑出「环 + 尾巴」，
 * 人眼扫一遍 d 字符串很容易把内沿当外沿；而且不同素材的 viewBox 不一样（1024 / 512），
 * 圆心还不一定在框正中。逐点问 `SVGGeometryElement.isPointInFill` 拿到的就是真的填到了哪儿。
 *
 * 这里同时报**空腔**（没填到的地方）：那才是能写字的那块。逐行给出空腔段，
 * 于是内腔圆的圆心、半径、以及「文字框能不能塞进去」一次全出来，不用猜圆心在哪儿。
 * 多层的（我们自己重画那版是「外沿铺蓝 + 内腔盖白」两层）按文档顺序取最后一层，
 * 就是渲染器会给这个点上色的那一层。
 *
 * 跑法：node spike/bubble-shape.mjs [svg 路径] [每格单位，默认 16]
 */
import { _electron as electron } from 'playwright'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SRC = process.argv[2] ?? 'C:/Users/11408/AppData/Local/Temp/chat-bubble-ref.svg'
const STEP = Number(process.argv[3] ?? 16)
const svg = readFileSync(SRC, 'utf8')
const ud = mkdtempSync(join(tmpdir(), 'bubble-shape-'))

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, PET_USER_DATA: ud, PET_FREEZE_CURSOR: '1' },
})
const page = await app.firstWindow()
await page.waitForFunction(() => document.querySelectorAll('video').length === 2, null, { timeout: 30_000 })

const out = await page.evaluate(({ markup, step }) => {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:1024px;height:1024px'
  host.innerHTML = markup
  document.body.append(host)
  const el = host.querySelector('svg')
  const [, , W, H] = el.getAttribute('viewBox').split(/[\s,]+/).map(Number)
  // 文档顺序 = 从底往上画，倒着找第一个包含该点的形状 = 这个像素实际显示的颜色
  const shapes = [...el.querySelectorAll('path,circle,ellipse')].reverse()
  const at = (x, y) => {
    for (const s of shapes) {
      const p = new DOMPoint(x, y)
      // 描边画在填充**上面**，所以先问 stroke：我们重画那版环就是 stroke，
      // 只问 isPointInFill 会把整条蓝环读成白
      if (s.isPointInStroke(p)) return '#'
      if (s.isPointInFill(p)) {
        const own = s.getAttribute('fill')
        const inherited = s.closest('[fill]')?.getAttribute('fill') ?? 'none'
        const c = own ?? inherited
        return c === 'none' ? '.' : c.toLowerCase() === '#ffffff' ? 'W' : '#'
      }
    }
    return '.'
  }
  const painted = (x, y) => at(x, y) !== '.'

  const runsOf = (y, want) => {
    const runs = []
    let start = null
    for (let x = 0; x <= W; x += 4) {
      const on = want(x, y)
      if (on && start === null) start = x
      if (!on && start !== null) { runs.push([start, x - 4]); start = null }
    }
    if (start !== null) runs.push([start, W])
    return runs
  }
  const ink = []
  const cavity = []
  for (let y = 0; y <= H; y += step) {
    const a = runsOf(y, (x) => painted(x, y))
    // 「空腔」= **不是蓝环**的那块：参考图里它是透明（iconfont 只画环），
    // 我们的图里它是实心白。两种都要算，所以判据是「不是环色」而不是「没着墨」。
    const b = runsOf(y, (x) => at(x, y) !== '#')
    if (a.length) ink.push({ y, runs: a })
    const inner = b.filter(([x0, x1]) => x0 > 4 && x1 < W - 4 && x1 - x0 > 24)
    if (inner.length) cavity.push({ y, runs: inner })
  }
  const art = []
  for (let y = 0; y < H; y += step) {
    let line = ''
    for (let x = 0; x < W; x += step) line += at(x + step / 2, y + step / 2)
    art.push(String(y).padStart(4) + ' ' + line)
  }
  // 空腔的最大宽度行 = 内腔圆的赤道，那一行的中点就是圆心的 x
  const widest = cavity.reduce((m, r) => {
    const w = r.runs.reduce((s, [a, b]) => Math.max(s, b - a), 0)
    return w > m.w ? { w, y: r.y, runs: r.runs } : m
  }, { w: -1, y: -1, runs: [] })
  const ys = cavity.map((r) => r.y)
  host.remove()
  return { vb: [W, H], ink, cavity, art, widest, cavityTop: ys[0], cavityBottom: ys[ys.length - 1] }
}, { markup: svg, step: STEP })

await app.close()
try { rmSync(ud, { recursive: true, force: true }) } catch { /* Windows 句柄没放干净就算了 */ }

console.log(`源：${SRC}   viewBox ${out.vb.join('×')}   每格 ${STEP} 单位`)
console.log(`空腔最宽行 y=${out.widest.y}：${JSON.stringify(out.widest.runs)}（宽 ${out.widest.w}）`)
console.log(`空腔纵向 ${out.cavityTop}..${out.cavityBottom}`)
console.log('\n逐行着墨段 [x0,x1]：')
for (const r of out.ink) console.log(String(r.y).padStart(4), JSON.stringify(r.runs))
console.log('\n字符图  W=白 #=蓝 .=透明/框外')
console.log(out.art.join('\n'))
