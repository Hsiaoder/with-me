/**
 * 一次性预览：把五枚图标按两套候选配色重染，和现状并排截图。
 * 只动 spike/out 里的临时副本，src/renderer 一个字都不改——配色得先看，看了才能拍板。
 * 跑法：node spike/icon-color-preview.mjs → spike/out/icon-color-preview.png
 */
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'child_process'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright'

const FF = createRequire(import.meta.url)('ffmpeg-static')
const ROOT = 'src/renderer'
const OUT = join('spike', 'out')

/** 按 <path> 出现顺序换 fill：iconfont 那几张是一色一路径，分段填色只能靠序号。 */
function paint(svg, byIndex) {
  let i = -1
  return svg.replace(/<path\b[^>]*>/g, (tag) => {
    const hex = byIndex[++i]
    return hex ? tag.replace(/fill="#[0-9A-Fa-f]{6}"/, `fill="${hex}"`) : tag
  })
}

/** PNG 重染：只动「近灰且偏暗」的像素，按原亮度压进目标色相，白气泡与透明底一律不碰。 */
function tintPng(srcFile, dstFile, [tr, tg, tb]) {
  const raw = execFileSync(FF, ['-v', 'error', '-i', srcFile, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 24 })
  const head = readFileSync(srcFile)
  const W = head.readUInt32BE(16)
  const H = head.readUInt32BE(20)
  const out = Buffer.from(raw)
  let touched = 0
  for (let p = 0; p < out.length; p += 4) {
    const [r, g, b, a] = [out[p], out[p + 1], out[p + 2], out[p + 3]]
    if (a < 20) continue
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max - min > 40) continue // 已经有彩色的（气泡那圈蓝灰）不二次染色
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    if (lum > 0.72) continue // 白
    out[p] = Math.round(tr * lum)
    out[p + 1] = Math.round(tg * lum)
    out[p + 2] = Math.round(tb * lum)
    touched++
  }
  execFileSync(FF, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', 'pipe:0', dstFile], {
    input: out,
    maxBuffer: 1 << 24,
  })
  return { W, H, touched }
}

/**
 * 两套候选：
 * A 通体语义色——每枚按部位铺彩，最跳；
 * B 深主体 + 一处彩——轮廓留带色相的近黑，只让一个部件上色，26px 上更认得出。
 */
const SETS = {
  A: {
    'icons/rice.svg': (s) => paint(s, { 0: '#7A4A21', 1: '#7A4A21', 2: '#7A4A21', 3: '#7A4A21', 4: '#7A4A21', 5: '#7A4A21', 6: '#E07B39' }),
    'icons/game.svg': (s) => paint(s, { 0: '#F2A93B', 1: '#F2A93B', 2: '#F2A93B', 3: '#4C6EF5', 4: '#F2A93B' }),
    'icons/heart.svg': (s) => paint(s, { 0: '#E14B5A' }),
    'icons/settings.svg': (s) => paint(s, { 0: '#5C6F8A' }),
  },
  B: {
    // 主体留深色（带色相的近黑），语义色只给一处——26px 上「一黑一彩」比「通体彩」认得出得多。
    'icons/rice.svg': (s) => paint(s, { 0: '#3E2C1C', 1: '#3E2C1C', 2: '#3E2C1C', 3: '#3E2C1C', 4: '#3E2C1C', 5: '#3E2C1C', 6: '#E07B39' }),
    'icons/game.svg': (s) => paint(s, { 0: '#F2A93B', 1: '#F2A93B', 2: '#F2A93B', 3: '#2A3050', 4: '#F2A93B' }),
    'icons/heart.svg': (s) => paint(s, { 0: '#E14B5A' }),
    'icons/settings.svg': (s) => paint(s, { 0: '#3E5C8F' }),
  },
}

const ICONS = [
  { file: 'icons/rice.svg', label: '喂食' },
  { file: 'icons/game.svg', label: '小游戏' },
  { file: 'icons/heart.svg', label: '状态' },
  { file: 'icons/settings.svg', label: '设置' },
  { file: 'emotes/dots3.png', label: '说话' },
]

mkdirSync(OUT, { recursive: true })
const cand = {}
let tint = null
for (const [name, plan] of Object.entries(SETS)) {
  const dir = join(OUT, `icons-${name}`)
  mkdirSync(dir, { recursive: true })
  cand[name] = {}
  for (const [file, fn] of Object.entries(plan)) {
    const dst = join(dir, file.split('/').pop())
    writeFileSync(dst, fn(readFileSync(resolve(ROOT, file), 'utf8')))
    cand[name][file] = dst
  }
  // 说话那枚是 Kenney 的 PNG 气泡，SVG 的 paint 对它无效：按亮度把暗部染进目标色相，白气泡不碰
  const dots = join(dir, 'dots3_tinted.png')
  tint = tintPng(resolve(ROOT, 'emotes/dots3.png'), dots, name === 'A' ? [46, 155, 181] : [30, 132, 160])
  cand[name]['emotes/dots3.png'] = dots
}
console.log(`dots3 重染 ${tint.touched} 个像素（${tint.W}×${tint.H}）`)

const src = (file) => pathToFileURL(resolve(ROOT, file)).href
const dst = (set, file) => pathToFileURL(cand[set][file]).href
const disc = pathToFileURL(resolve(ROOT, 'icons/whale_round.svg')).href

const cell = (u, label, bg) => `
  <div class="slot" style="background:${bg}">
    <div class="btn"><img class="disc" src="${disc}" alt=""><img src="${u}" alt=""></div>
    <div class="cap">${label}</div>
  </div>`

const BGS = [
  { bg: '#eef1f5', tag: '浅色桌面' },
  { bg: '#22262c', tag: '深色桌面' },
]
const ROWS = [
  { title: '现状（单色/原色）', pick: (i, bg) => src(i.file) },
  { title: '候选 A：通体语义色', pick: (i) => dst('A', i.file) },
  { title: '候选 B：深主体 + 一处彩（推荐）', pick: (i) => dst('B', i.file) },
]
const rows = ROWS.flatMap((r) => BGS.map((d) => `
  <div class="row">
    <div class="title">${r.title} · ${d.tag}</div>
    <div class="cells">${ICONS.map((i) => cell(r.pick(i), i.label, d.bg)).join('')}</div>
  </div>`)).join('')

const html = `<!doctype html><meta charset="utf-8"><style>
  body { margin:0; padding:14px 16px; font:13px/1.4 "Microsoft YaHei UI",sans-serif; background:#fafafa; color:#2b2f36 }
  .row { margin-bottom:12px }
  .title { font-size:12px; color:#666; margin-bottom:5px }
  .cells { display:flex; gap:10px }
  .slot { padding:8px 6px 4px; border-radius:10px }
  .btn { position:relative; width:40px; height:40px; display:flex; align-items:center; justify-content:center }
  .btn .disc { position:absolute; inset:0; width:100%; height:100% }
  .btn img { width:26px; height:26px; display:block; filter:drop-shadow(0 1px 2px rgba(0,0,0,.45)) }
  .btn .disc { filter:none }
  .cap { font-size:11px; text-align:center; margin-top:2px; color:#444 }
</style>${rows}
<div class="legend">A：碗 #E07B39 / 米粒 #7A4A21 · 机身 #4C6EF5 / 摇杆按键 #F2A93B · 心 #E14B5A · 齿轮 #5C6F8A · 气泡点 #2E9BB5<br>
B：碗 #E07B39 / 米粒 #3E2C1C · 机身 #2A3050 / 摇杆按键 #F2A93B · 心 #E14B5A · 齿轮 #3E5C8F · 气泡点 #1E84A0</div>`

const htmlPath = join(tmpdir(), 'icon-color-preview.html')
writeFileSync(htmlPath, html)
const app = await electron.launch({
  args: [join('spike', 'preview-main.cjs')],
  env: { ...process.env, PREVIEW_URL: pathToFileURL(htmlPath).href },
})
try {
  const page = await app.firstWindow()
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: join(OUT, 'icon-color-preview.png'), fullPage: true })
  console.log('已存：spike/out/icon-color-preview.png')
} finally {
  await app.close()
  rmSync(htmlPath, { force: true })
}
