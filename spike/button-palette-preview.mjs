/**
 * 一次性预览：把四套按钮配色（现状 / A 品牌蓝白 / B 奶油暖白 / C 冷白高对比）
 * 渲染成真实素材——圆底改 SVG 的 fill，底板按精确色值重染 PNG，
 * 每套各出「浅桌面」「深桌面」两行，外加一条底板 + 格子 + 箭头。
 *
 * 为什么不用 CSS 近似：这次改的就是素材本身的颜色，近似图会骗人。
 * 跑法：node spike/button-palette-preview.mjs → spike/out/palette-preview.png
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'child_process'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright'
import { CANDIDATES, 现状 } from './color-math.mjs'

const FF = createRequire(import.meta.url)('ffmpeg-static')
const ROOT = 'src/renderer'
const OUT = join('spike', 'out', 'palette')

/** 圆底 SVG 的五层 → 角色。名字是实测 fill 值，别按猜。 */
const DISC_MAP = { '#9696A3': '环', '#747487': '底影', '#DADCE7': '面', '#36BDF7': '内圈', '#FFFFFF': '高光' }
/** 底板 PNG 的四层（精确 RGB）→ 角色 */
const PLATE_MAP = { '150,150,163': '环', '116,116,135': '底影', '54,189,247': '内圈', '218,220,231': '面' }

const SETS = [['现状', 现状], ...Object.entries(CANDIDATES).map(([k, v]) => [k[0], v])]

function recolorSvg(srcPath, s) {
  let out = readFileSync(srcPath, 'utf8')
  for (const [from, role] of Object.entries(DISC_MAP)) {
    const to = s[role]
    for (const variant of [from, from.toLowerCase()]) {
      out = out.split(`fill="${variant}"`).join(`fill="${to}"`)
    }
  }
  return out
}

/** 精确色值重染：只动这几个颜色，抗锯齿的过渡色保持原样（否则边缘会出现硬边） */
function recolorPng(srcFile, dstFile, s) {
  const head = readFileSync(srcFile)
  const W = head.readUInt32BE(16)
  const H = head.readUInt32BE(20)
  const raw = execFileSync(FF, ['-v', 'error', '-i', srcFile, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 26 })
  const out = Buffer.from(raw)
  let hit = 0
  for (let p = 0; p < out.length; p += 4) {
    const k = `${out[p]},${out[p + 1]},${out[p + 2]}`
    const role = PLATE_MAP[k]
    if (!role) continue
    const hex = s[role].replace('#', '')
    out[p] = parseInt(hex.slice(0, 2), 16)
    out[p + 1] = parseInt(hex.slice(2, 4), 16)
    out[p + 2] = parseInt(hex.slice(4, 6), 16)
    hit++
  }
  execFileSync(FF, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', 'pipe:0', dstFile], {
    input: out,
    maxBuffer: 1 << 26,
  })
  return hit
}

mkdirSync(OUT, { recursive: true })
const ICONS = ['icons/rice.svg', 'icons/game.svg', 'icons/heart.svg', 'icons/settings.svg', 'emotes/dots3.png']
const built = {}
for (const [name, s] of SETS) {
  const dir = join(OUT, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'disc.svg'), recolorSvg(resolve(ROOT, 'icons/button_round_depth_line.svg'), s))
  const hit = recolorPng(resolve(ROOT, 'icons/button_rectangle_depth_line.png'), join(dir, 'plate.png'), s)
  built[name] = { dir, hit, plateFill: s.板心 }
  console.log(`${name}: 底板重染 ${hit} 个像素`)
}

const u = (name, rel) => pathToFileURL(resolve(OUT, name, rel)).href
const icon = (f) => pathToFileURL(resolve(ROOT, f)).href

const buttonRow = (name, bg) => `
  <div class="btns" style="background:${bg}">
    ${ICONS.map((f) => `<div class="btn"><img class="disc" src="${u(name, 'disc.svg')}"><img src="${icon(f)}"></div>`).join('')}
  </div>`

const plateRow = (name) => `
  <div class="plate" style="background-image:url('${u(name, 'plate.png')}');border-image-source:url('${u(name, 'plate.png')}');--fill:${built[name].plateFill}">
    <div class="cell">代币</div><div class="cell">白饭</div><div class="cell">糖葫芦</div><div class="cell">大闸蟹</div>
  </div>`

const rows = SETS.map(([name, s]) => `
  <div class="set">
    <div class="title">${name}　面 ${s.面} · 环 ${s.环} · 底影 ${s.底影} · 板心 ${s.板心}</div>
    <div class="pair">${buttonRow(name, '#eef1f5')}<div class="cap">浅桌面</div></div>
    <div class="pair">${buttonRow(name, '#22262c')}<div class="cap">深桌面</div></div>
    ${plateRow(name)}
  </div>`).join('')

const html = `<!doctype html><meta charset="utf-8"><style>
  :root { --fill: #fff }
  body { margin:0; padding:14px 16px; font:12px/1.4 "Microsoft YaHei UI",sans-serif; background:#fafafa; color:#22262c }
  .set { margin-bottom:18px }
  .title { font-weight:600; margin-bottom:6px }
  .pair { display:flex; align-items:center; gap:8px; margin-bottom:4px }
  .cap { color:#666 }
  .btns { display:flex; gap:8px; padding:10px 12px; border-radius:10px }
  .btn { position:relative; width:40px; height:40px; display:flex; align-items:center; justify-content:center }
  .btn .disc { position:absolute; inset:0; width:100%; height:100% }
  .btn img { width:24px; height:24px; display:block }
  /* 圆底在预览里是 img 叠层（应用里是 CSS 背景），定位元素默认压在静态 img 上面，
     不给图标 z-index 就什么都看不见——这是预览的坑，不是产品的坑 */
  .btn > img:not(.disc) { position:relative; z-index:1 }
  .btn img[src*="rice"], .btn img[src*="settings"] { width:20px; height:20px }
  .btn img[src*="dots3"] { width:18px; height:21px }
  .plate { display:flex; gap:4px; align-items:center; padding:11px; margin-top:6px; width:max-content;
    border:8px solid transparent; border-bottom-width:12px;
    border-image-slice:8 8 12; border-image-repeat:stretch;
    background-color:var(--fill); background-clip:padding-box }
  .cell { width:56px; height:56px; display:flex; align-items:center; justify-content:center;
    background:rgba(255,255,255,.94); border:1px solid rgba(0,0,0,.12); border-radius:8px; color:#2b2f36; font-size:12px }
</style>${rows}`

// 底板 URL 已经逐条内联在 style 里（border-image-source 不能用 CSS 变量传 url()）
const htmlPath = join(tmpdir(), 'palette-preview.html')
writeFileSync(htmlPath, html)
const app = await electron.launch({
  args: [join('spike', 'preview-main.cjs')],
  env: { ...process.env, PREVIEW_URL: pathToFileURL(htmlPath).href },
})
try {
  const page = await app.firstWindow()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(400)
  await page.screenshot({ path: join('spike', 'out', 'palette-preview.png'), fullPage: true })
  console.log('已存：spike/out/palette-preview.png')
} finally {
  await app.close()
}
