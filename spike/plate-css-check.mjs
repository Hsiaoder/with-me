/**
 * 真实样式表验收探针：加载 src/renderer/style.css 本体（不是我手抄的副本），
 * 建出真的 DOM 结构，读回计算样式，确认这次改动在真实文件里成立。
 *
 * 用法：node spike/plate-css-check.mjs
 */
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CSS_URL = 'file:///' + path.resolve('src/renderer/style.css').replace(/\\/g, '/')

const page_html = `<!doctype html><meta charset=utf8>
<link rel="stylesheet" href="${CSS_URL}">
<div class="pet-panel">
  <div class="pet-plate is-foods">
    <button class="pet-page" data-dir="prev"><img class="pet-arrow" src="icons/arrow_basic_w_small.svg"></button>
    <div class="pet-food-main"><div class="pet-food-strip"><button class="pet-food">米饭</button></div></div>
    <button class="pet-page" data-dir="next"><img class="pet-arrow" src="icons/arrow_basic_e_small.svg"></button>
  </div>
  <div class="pet-plate is-settings"><button class="on">开</button><button class="hov">关</button></div>
</div>`

const tmpMain = path.join(os.tmpdir(), 'plate-css-check-main.cjs')
fs.writeFileSync(tmpMain, `
const { app, BrowserWindow } = require('electron')
app.on('window-all-closed', (e) => e.preventDefault())
app.whenReady().then(() => {
  new BrowserWindow({ width: 520, height: 240, x: -32000, y: -32000, show: true, frame: false }).loadURL('about:blank')
})
`)

// 必须写成 file:// 的页面再用 goto：setContent 把文档留在 about:blank，
// Chromium 不允许那种页面加载 file:// 的外部样式表，结果就是所有规则都不生效。
const probeHtmlPath = path.join(os.tmpdir(), 'plate-css-check.html')
fs.writeFileSync(probeHtmlPath, page_html)

const app = await electron.launch({ args: [tmpMain] })
const page = await app.firstWindow()
await page.goto('file:///' + probeHtmlPath.replace(/\\/g, '/'))
await page.waitForTimeout(400)

// 前置自检：样式表没加载成功的话，下面每一条判据都会「自然地」变红，
// 那种红是假的。先确认它真的进来了，并确认文件里那条 border-image 被解析到了。
const loaded = await page.evaluate(() => {
  const sheets = [...document.styleSheets]
  let sawFoodsPlate = false
  for (const sh of sheets) {
    try {
      for (const r of sh.cssRules) if (r.selectorText === '.pet-plate.is-foods') sawFoodsPlate = true
    } catch (e) { /* 跨域表读不到规则，跳过 */ }
  }
  return { count: sheets.length, hrefs: sheets.map((s) => (s.href || '').split('/').pop()), sawFoodsPlate }
})
console.log('### 前置自检：样式表加载情况')
console.log(' ', JSON.stringify(loaded))
if (!loaded.sawFoodsPlate) {
  await app.close()
  fs.unlinkSync(tmpMain); fs.unlinkSync(probeHtmlPath)
  throw new Error('style.css 没被加载或没解析出 .pet-plate.is-foods —— 后面的判据全部无效，先修探针')
}

const read = async (sel) => page.evaluate((s) => {
  const el = document.querySelector(s)
  if (!el) return { missing: true }
  const cs = getComputedStyle(el)
  return {
    slice: cs.borderImageSlice,
    src: cs.borderImageSource.replace(/url\("(data:[^"]{0,12})[^"]*"\)/, 'url(…), ').slice(0, 60),
    borderW: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].join('/'),
    bg: cs.backgroundColor,
    clip: cs.backgroundClip,
    radius: cs.borderTopLeftRadius,
    pad: cs.paddingTop,
  }
}, sel)

const targets = {
  '.pet-plate.is-foods': '食物底板（本次改动的主对象）',
  '.pet-plate.is-settings': '设置底板（吃 --plate-fill）',
  '.pet-plate.is-settings .on': '选中态（--on-fill）',
  '.pet-panel .pet-food': '格子白卡（不该被这次改动碰到）',
}
const out = {}
for (const [sel, label] of Object.entries(targets)) {
  out[sel] = { label, v: await read(sel) }
  console.log(`\n### ${label}  ${sel}`)
  console.log(' ', JSON.stringify(out[sel].v))
}

// hover 要真触发才有意义
await page.hover('.pet-plate.is-settings button:not(.on)')
const hovered = await page.evaluate(() => {
  const el = document.querySelector('.pet-plate.is-settings button:not(.on)')
  return getComputedStyle(el).backgroundColor
})
console.log('\n### hover 态实际底色（真悬停后读的）\n ', hovered)

await app.close()
fs.unlinkSync(tmpMain)
fs.unlinkSync(probeHtmlPath)

const f = out['.pet-plate.is-foods'].v
const s = out['.pet-plate.is-settings'].v
const on = out['.pet-plate.is-settings .on'].v
const cell = out['.pet-panel .pet-food'].v
const ok = (label, pass, detail) => console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ← ' + detail : ''}`)
console.log('\n=== 判据（读的是 style.css 本体）===')
ok('食物底板 slice = 8 8 12 且无 fill', f.slice === '8 8 12', JSON.stringify(f.slice))
ok('食物底板四边厚度 8/8/12/8 未动', f.borderW === '8px/8px/12px/8px', f.borderW)
ok('食物底板留白 pad 仍是 3px（格子尺寸契约没动）', f.pad === '3px', f.pad)
ok('食物底板中心 = 浅蓝 220,234,245', f.bg === 'rgb(220, 234, 245)', f.bg)
ok('食物底板 background-clip = padding-box', f.clip === 'padding-box', f.clip)
ok('素材仍被引用（没退化成纯 CSS 板）', /border-image|url/.test(f.src) || f.src !== 'none', f.src)
ok('设置底板也吃到同一个 --plate-fill', s.bg === 'rgb(220, 234, 245)', s.bg)
ok('选中态换成蓝 --on-fill', on.bg === 'rgb(169, 212, 239)', on.bg)
ok('格子仍是白卡（不该被改）', /255, 255, 255/.test(cell.bg), cell.bg)
ok('hover 底色换成 --hover-fill', hovered === 'rgb(207, 230, 246)', hovered)
ok('全场不再有那两套青绿', ![f, s, on, cell].some((x) => /238, 246, 244|220, 239, 233/.test(x.bg)), '')
