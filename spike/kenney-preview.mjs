/**
 * Kenney 光标包的选型预览页（spike，产物只落 %TEMP%，不进仓库）。
 *
 * 要回答的问题只有一个：这套白底图形压在我们那种「任意桌面像素」上到底读不读得出来。
 * 所以每个图形都排四格：Basic/Outline × 浅底/深底。一眼就能看出该用哪一式。
 *
 * 跑法：node spike/kenney-preview.mjs   然后 start "%TEMP%\\kenney-preview\\index.html"
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PACK = 'E:\\ai-pet\\ui\\kenney_cursor-pack'
const OUT = join(tmpdir(), 'kenney-preview')

const url = (p) => 'file:///' + p.replace(/\\/g, '/')
const names = (style) =>
  readdirSync(join(PACK, 'Vector', style)).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4))

/** 把写死的 fill 读出来，好在页面上标「这式子其实是几色」。 */
const fillsOf = (style, name) => {
  const text = readFileSync(join(PACK, 'Vector', style, `${name}.svg`), 'utf8')
  return [...new Set([...text.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]))].join(' ')
}

const basic = names('Basic')
const outline = names('Outline')
const all = [...new Set([...basic, ...outline])].sort()

/** 分类靠文件名前缀，包里没有分组信息。 */
const GROUPS = [
  ['方向与移动 arrow/navigation', /^(arrow|navigation|tracking|rotate|resize|stairs|steps)/],
  ['指针 pointer', /^pointer/],
  ['手 hand/gauntlet', /^(hand|gauntlet|boot)/],
  ['缩放与目标 zoom/target', /^(zoom|target|cross|line|dot|bracket|mark)/],
  ['忙碌与进度 busy/progress', /^(busy|progress)/],
  ['消息气泡 message', /^message/],
  ['光标功能 cursor', /^cursor/],
  ['工具 tool', /^tool/],
  ['绘图 drawing', /^drawing/],
  ['锁与门 lock/door', /^(lock|door)/],
  ['看 look', /^look/],
  ['其他', null],
]

const groupOf = (n) => GROUPS.find(([, re]) => re === null || re.test(n))[0]
const byGroup = new Map()
for (const n of all) {
  const g = groupOf(n)
  if (!byGroup.has(g)) byGroup.set(g, [])
  byGroup.get(g).push(n)
}

const cell = (n) => {
  const b = join(PACK, 'Vector', 'Basic', `${n}.svg`)
  const o = join(PACK, 'Vector', 'Outline', `${n}.svg`)
  return `<div class="glyph">
    <div class="pair">
      <div class="half light"><img src="${url(b)}" alt=""></div>
      <div class="half dark"><img src="${url(b)}" alt=""></div>
    </div>
    <div class="pair">
      <div class="half light"><img src="${url(o)}" alt=""></div>
      <div class="half dark"><img src="${url(o)}" alt=""></div>
    </div>
    <code>${n}</code>
  </div>`
}

const html = `<!doctype html><meta charset="utf-8"><title>Kenney 光标包 · 选型</title>
<style>
  body{margin:0;padding:20px 24px 60px;background:#f4f6f8;font:13px/1.5 "Microsoft YaHei UI",sans-serif;color:#222}
  h1{font-size:19px;margin:0 0 4px}
  h2{font-size:15px;margin:26px 0 8px;padding-bottom:4px;border-bottom:1px solid #d6dbe1}
  .note{color:#5b6773;margin:0 0 14px}
  .legend{display:flex;gap:14px;align-items:center;margin:8px 0 18px;color:#5b6773}
  .swatch{width:26px;height:26px;border-radius:4px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
  .glyph{background:#fff;border:1px solid #e2e6ea;border-radius:8px;padding:8px;text-align:center}
  .pair{display:flex;gap:4px;margin-bottom:4px}
  .half{flex:1;display:flex;align-items:center;justify-content:center;padding:6px 0;border-radius:4px}
  .half img{width:32px;height:32px;display:block}
  .light{background:#ffffff;box-shadow:inset 0 0 0 1px #e2e6ea}
  .dark{background:#2b2f36}
  code{font-size:11px;color:#5b6773;word-break:break-all}
  .counts{color:#8b96a1;font-size:12px}
</style>
<h1>Kenney Cursor Pack 1.1 · ${all.length} 个图形</h1>
<p class="note">上排 <b>Basic</b>（纯白 ${fillsOf('Basic', basic[0])}），下排 <b>Outline</b>（${fillsOf('Outline', outline[0])}）。
左格压在浅底上，右格压在深底上——桌宠的面板是浮在<b>任意桌面像素</b>上的，两格都得读得出才可用。</p>
<div class="legend"><span class="swatch light"></span>浅底 <span class="swatch dark"></span>深底
<span class="counts">SVG 32×32，另有 PNG/Basic|Outline/{Default=32px,Double=64px}</span></div>
${[...byGroup].map(([g, ns]) => `<h2>${g} <span class="counts">${ns.length}</span></h2><div class="grid">${ns.map(cell).join('')}</div>`).join('')}
`

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'index.html'), html, 'utf8')
console.log(`图形 ${all.length} 个，分 ${byGroup.size} 类 → ${join(OUT, 'index.html')}`)
console.log(`Basic 单色：${fillsOf('Basic', 'cursor_cogs')}   Outline：${fillsOf('Outline', 'cursor_cogs')}`)
if (existsSync(join(PACK, 'License.txt'))) {
  const lic = readFileSync(join(PACK, 'License.txt'), 'utf8')
  console.log(`许可证行：${lic.split('\n').find((l) => l.includes('License:'))?.trim()}`)
}
