/**
 * 一次性探针（throwaway）：三版小鲸鱼按钮底并排摆出来看，真尺寸 + 3 倍放大各一行。
 *
 * 为什么一次摆三版：鲸鱼这种轮廓靠描述文字定不下来（「尾部上翘的两叶鳍」在 40px 上
 * 到底是读作鲸鱼还是一摊东西，只有看了才知道）。同屏对比才谈得拢。
 *
 * 跑法：node spike/whale-button.mjs → spike/out/whale-button.png
 */
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RING = '#6990a7'
const FACE = '#ebf5fb'
const ICONS = ['icons/rice.svg', 'icons/game.svg', 'icons/heart.svg', 'icons/settings.svg', 'emotes/dots3.png']

/** 环的画法：每个图元先「填 + 描边同色、描边宽 2t」铺一层，再盖一层纯填色——
 *  并集外沿就得到厚度 t 的均匀边，交界处不会多出横线。 */
function whale(body, t = 6) {
  const stroke = `<g fill="${FACE}" stroke="${RING}" stroke-width="${t * 2}" stroke-linejoin="round">${body}</g>`
  const fill = `<g fill="${FACE}">${body}</g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">${stroke}${fill}</svg>`
}

// D1：胖身子 + 一条上翘的尾（只一叶，剪影最简）
const D1 = `
  <path d="M8 46 C8 28 24 20 42 24 C54 27 60 34 62 40
           C64 30 70 22 78 18 C78 30 72 40 64 46
           C56 56 22 60 10 52 Z" />`
// D2：身子 + 横展的两叶鳍（鲸鱼下潜时那个「心形」尾巴）
const D2 = `
  <path d="M8 44 C8 26 26 18 44 24 C54 27 60 33 63 39
           C62 30 66 22 74 18 C74 28 70 34 66 39
           C74 40 80 44 80 50 C72 48 66 44 62 42
           C50 56 20 58 10 50 Z" />`
// D3：C 版收干净：背一条弧、肚子一条弧、尾鳍一个铲形
const D3 = `
  <path d="M8 44 C8 26 26 18 44 24 C52 27 58 32 61 38
           C63 28 69 20 77 17 C77 29 71 38 63 43
           C54 54 20 58 9 50 Z" />`
// D4：接近正圆的身子，尾巴只在右边露一点尖（40px 上最稳）
const D4 = `
  <ellipse cx="34" cy="42" rx="26" ry="22" />
  <path d="M54 38 C60 30 68 24 76 22 C76 32 70 40 62 46 Z" />`

const CANDIDATES = [['D1 一叶上翘', D1], ['D2 横展两叶', D2], ['D3 铲形鳍', D3], ['D4 圆身尖尾', D4]]

const ud = mkdtempSync(join(tmpdir(), 'whale-probe-'))
const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, PET_USER_DATA: ud, PET_FREEZE_CURSOR: '1' },
})
const page = await app.firstWindow()
await page.waitForFunction(() => document.querySelectorAll('video').length === 2, null, { timeout: 30_000 })

const cells = CANDIDATES.map(([name, body]) => {
  const svg = whale(body)
  const row = (size, withIcon) =>
    `<div style="display:flex;gap:10px;align-items:center">` +
    [0, 1, 2, 3, 4].map((i) =>
      `<div style="position:relative;width:${size}px;height:${size}px">` +
      svg.replace('<svg ', `<svg style="position:absolute;inset:0" width="${size}" height="${size}" `) +
      (withIcon ? `<img src="${ICONS[i]}" style="position:absolute;left:${size * 0.22}px;top:${size * 0.27}px;width:${size * 0.4}px;height:${size * 0.4}px" />` : '') +
      '</div>').join('') +
    `</div>`
  return `<div style="margin-bottom:14px">
      <div style="font:13px sans-serif;color:#fff">${name}</div>
      ${row(40, true)}
      ${row(120, false)}
    </div>`
})

await page.evaluate((html) => {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:20px;top:20px;padding:12px;background:#4a6b86;border-radius:10px'
  host.innerHTML = html
  document.body.append(host)
}, cells.join(''))

mkdirSync(join('spike', 'out'), { recursive: true })
await page.screenshot({ path: join('spike', 'out', 'whale-button.png'), clip: { x: 10, y: 10, width: 700, height: 560 } })
await app.close()
try { rmSync(ud, { recursive: true, force: true }) } catch { /* 句柄没放干净就算了 */ }
console.log('写出 spike/out/whale-button.png（每版两行：40px 带图标 / 120px 只看轮廓）')
