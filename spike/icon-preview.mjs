/**
 * 一次性预览：把五枚手绘 SVG 摆在真实圆底（button_round_line）上，
 * 浅色与深色桌面各一行，另加一行「只有图标没有圆底」的对照，用无头 Chromium 截图。
 * 图标这种 26px 的东西，看代码想象等于没看。
 * 跑法：node spike/icon-preview.mjs → spike/out/icon-preview.png
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { _electron as electron } from 'playwright'

// 要预览哪几枚：路径相对 src/renderer，这样 svg 和 png 都能进来
const ICONS = [
  { file: 'icons/rice.svg', label: '喂食' },
  { file: 'icons/activity.svg', label: '小游戏' },
  { file: 'icons/heart.svg', label: '状态' },
  { file: 'icons/settings.svg', label: '设置' },
  { file: 'emotes/dots3.png', label: '说话' },
]

const url = (rel) => pathToFileURL(resolve('src/renderer', rel)).href

const cell = (icon, disc, bg) => {
  // 圆底这里用 img 叠层而不是 CSS background：file:// 页面的 CSS 背景图在这台机器上没画出来
  // （应用里走 app:// 是好的，上一轮真实截图 + e2e 的 decode 检查都验过），
  // 预览工具不该为一个渲染差异分神，img 一定出图。
  const frame = disc ? `<img class="disc" src="${url('icons/button_round_line.svg')}" alt="">` : ''
  return `<div class="slot" style="background:${bg}">
    <div class="btn">${frame}<img src="${url(icon.file)}" alt=""></div>
    <div class="cap">${icon.label}</div>
  </div>`
}

const rows = [
  { title: '浅色桌面 + 圆底', disc: true, bg: '#eef1f5' },
  { title: '深色桌面 + 圆底', disc: true, bg: '#22262c' },
  { title: '圆底单独看（对照）', disc: true, bg: '#ffffff' },
  { title: '只有图标、没有圆底（对照现在改之前）', disc: false, bg: '#eef1f5' },
].map((r) => `
  <div class="row">
    <div class="title">${r.title}</div>
    <div class="cells">${ICONS.map((i) => cell(i, r.disc, r.bg)).join('')}</div>
  </div>`).join('')

const html = `<!doctype html><meta charset="utf-8"><style>
  body { margin:0; padding:16px 18px; font:13px/1.4 "Microsoft YaHei UI",sans-serif; background:#fafafa; color:#2b2f36 }
  .row { margin-bottom:14px }
  .title { font-size:12px; color:#666; margin-bottom:6px }
  .cells { display:flex; gap:10px }
  .slot { padding:8px 6px 4px; border-radius:10px }
  .btn { position:relative; width:40px; height:40px; display:flex; align-items:center; justify-content:center }
  .btn .disc { position:absolute; inset:0; width:100%; height:100% }
  .btn img { width:26px; height:26px; display:block; filter:drop-shadow(0 1px 2px rgba(0,0,0,.45)) }
  .btn .disc { filter:none }
  .cap { font-size:11px; text-align:center; margin-top:2px; color:#444 }
</style>${rows}`

mkdirSync('spike/out', { recursive: true })
const htmlPath = join(tmpdir(), 'icon-preview.html')
writeFileSync(htmlPath, html)
const app = await electron.launch({
  args: [join('spike', 'preview-main.cjs')],
  env: { ...process.env, PREVIEW_URL: pathToFileURL(htmlPath).href },
})
const page = await app.firstWindow()
await page.waitForLoadState('networkidle')
await page.screenshot({ path: join('spike', 'out', 'icon-preview.png'), fullPage: true })
await app.close()
rmSync(htmlPath, { force: true })
console.log('已存：spike/out/icon-preview.png')
