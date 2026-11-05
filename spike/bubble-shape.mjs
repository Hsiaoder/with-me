/**
 * 一次性探针（throwaway，不进验收门）：把气泡底图在 Chromium 里量一遍，打字符图。
 *
 * 为什么要量而不读路径文本：那是 iconfont 导出的单条 path，两个子路径靠缠绕方向凑出
 * 「环 + 尾巴」，人眼扫一遍 d 字符串很容易把哪条是内沿、哪条是外沿搞反。
 * 逐个子路径问 `SVGGeometryElement.isPointInFill` 拿到的就是**真的填到了哪儿**，
 * 环的内外半径、尾巴落在哪几行、空腔有多大一次全出来。
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
  const [, , W, H] = el.getAttribute('viewBox').split(/\s+/).map(Number)
  // 文档顺序 = 从底往上画，倒着找第一个包含该点的形状 = 这个像素实际显示的颜色
  const shapes = [...el.querySelectorAll('path,circle,ellipse')].reverse()
  const at = (x, y) => {
    for (const s of shapes) {
      if (s.isPointInFill(new DOMPoint(x, y))) {
        const c = s.getAttribute('fill') ?? (s.closest('[fill]') ?? {}).getAttribute?.('fill') ?? 'none'
        return c === '#ffffff' ? 'W' : c === 'none' ? '.' : '#'
      }
    }
    return '.'
  }
  const rows = []
  for (let y = 0; y <= H; y += step) {
    const runs = []
    let start = null
    for (let x = 0; x <= W; x += 4) {
      const on = at(x, y) !== '.'
      if (on && start === null) start = x
      if (!on && start !== null) { runs.push([start, x - 4]); start = null }
    }
    if (start !== null) runs.push([start, W])
    if (runs.length) rows.push({ y, runs })
  }
  // 空腔：从圆心沿四个轴向往外走，第一个「不是白」的距离就是能写字的圆的半径
  const white = (x, y) => at(x, y) === 'W'
  const cavity = {}
  for (const [k, p] of Object.entries({
    left: (r) => white(512 - r, 512),
    right: (r) => white(512 + r, 512),
    up: (r) => white(512, 512 - r),
    down: (r) => white(512, 512 + r),
  })) {
    let r = 0
    while (r < 600 && p(r + 4)) r += 4
    cavity[k] = r
  }
  // 尾巴：整幅图里 x 最小 / y 最大的着墨点
  let minX = 9999, maxY = -1, maxYatX = null
  for (let y = 0; y <= H; y += 4) {
    for (let x = 0; x <= W; x += 4) {
      if (at(x, y) === '.') continue
      if (x < minX) minX = x
      if (y > maxY) { maxY = y; maxYatX = x }
    }
  }
  const art = []
  for (let y = 0; y < H; y += step) {
    let line = ''
    for (let x = 0; x < W; x += step) line += at(x + step / 2, y + step / 2)
    art.push(String(y).padStart(4) + ' ' + line)
  }
  host.remove()
  return { art, rows, cavity, minX, maxY, maxYatX, box: [W, H] }
}, { markup: svg, step: STEP })

await app.close()
try { rmSync(ud, { recursive: true, force: true }) } catch { /* Windows 句柄没放干净就算了 */ }

console.log(`源：${SRC}   viewBox ${out.box.join('×')}   每格 ${STEP} 单位`)
console.log('空腔（白）半径 上下左右：', JSON.stringify(out.cavity))
console.log('着墨最左 x：', out.minX, ' 最下 y：', out.maxY, '（那一行的 x=', out.maxYatX, '）')
console.log('\n逐行着墨段 [x0,x1]：')
for (const r of out.rows) console.log(String(r.y).padStart(4), JSON.stringify(r.runs))
console.log('\n字符图  W=白 #=蓝 .=透明')
console.log(out.art.join('\n'))
