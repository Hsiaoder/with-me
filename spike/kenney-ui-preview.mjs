/**
 * Kenney 素材包选型页（spike，产物只落 %TEMP%，不进仓库）。
 *
 * 三个包并成一页三个标签：表情包 / UI 包 / Pixel Adventure。
 * 选型要同时回答「要哪个」和「用哪一式」，所以统一排成矩阵——
 * 一行一个素材名（就是文件名），一列一个变体（风格/配色/描边），横扫比变体、纵向挑素材。
 * 光标包另由 spike/kenney-preview.mjs 负责（SVG 描边那套逻辑不同）。
 *
 * 跑法：node spike/kenney-ui-preview.mjs   然后 start "%TEMP%\\kenney-ui-preview\\index.html"
 */
import { mkdirSync, readdirSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const UI = 'E:\\ai-pet\\ui'
const OUT = join(tmpdir(), 'kenney-ui-preview')
const IMG = join(OUT, 'img')
mkdirSync(IMG, { recursive: true })

const pngs = (dir) => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)).sort()
  } catch {
    return null
  }
}

/** 拷进输出目录，返回相对路径 + 真实像素尺寸（这个包里素材不是方的）。 */
let copied = 0
const natSize = (src) => {
  const b = readFileSync(src)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}
/** 单格显示宽上限：192×64 的按钮底板按原宽排会把整行撑爆。 */
const MAXW = 110
const asset = (relOut, src) => {
  const to = join(IMG, relOut)
  mkdirSync(join(to, '..'), { recursive: true })
  copyFileSync(src, to)
  copied++
  const { w, h } = natSize(src)
  return { src: 'img/' + relOut.replace(/\\/g, '/'), w: Math.min(w, MAXW), nat: w + '×' + h }
}

/**
 * 一个 section = 一张矩阵表。rows 是素材名，cols 是变体。
 * cell(row, colIndex) 决定该格用哪个文件、显示多宽。
 */
const SECTIONS = []

/* ---------- 1. 表情包：30 × (Pixel 1-8 + Vector 1-8) ---------- */
{
  const pack = join(UI, 'kenney_emotes-pack')
  const cols = []
  for (let i = 1; i <= 8; i++) cols.push({ label: `P${i}`, full: `pixel Style ${i}`, dir: join(pack, 'PNG', 'Pixel', `Style ${i}`),})
  for (let i = 1; i <= 8; i++) cols.push({ label: `V${i}`, full: `vector Style ${i}`, dir: join(pack, 'PNG', 'Vector', `Style ${i}`),})
  const common = pngs(cols[0].dir).filter((nm) => cols.every((c) => pngs(c.dir).includes(nm)))
  SECTIONS.push({
    tab: 'emotes', title: '表情包 Emotes · 30 个表情 × 16 种风格',
    note: 'P = Pixel（原生 16×16，硬边）｜V = Vector（原生 32×38）。同一行横扫挑风格，选定后把行名和列标一起告诉我。',
    rows: common, cols,
    cell: (nm, c) => asset(`emotes/${c.label}/${nm}.png`, join(c.dir, `${nm}.png`)),
    overview: existsSync(join(pack, 'Preview.png')) ? asset('emotes/_preview.png', join(pack, 'Preview.png')) : null,
  })
}

/* ---------- 2. UI 包：82 个控件 × 5 色，外加 Extra 24 ---------- */
{
  const pack = join(UI, 'kenney_ui-pack')
  const colors = ['Blue', 'Green', 'Grey', 'Red', 'Yellow']
  const cols = colors.map((c) => ({ label: c, full: `PNG/${c}/Default 32×32`, dir: join(pack, 'PNG', c, 'Default'),}))
  const main = pngs(cols[0].dir)
  SECTIONS.push({
    tab: 'ui', title: 'UI 包 · 82 个控件 × 5 色',
    note: '每格是 PNG/颜色/Default（32×32）。同美术还有 Double（64×64）和 Vector/（SVG）两套，路径就在旁边目录，放大到 3× 觉得糊就换那两套。',
    rows: main, cols,
    cell: (nm, c) => asset(`ui/${c.label}/${nm}.png`, join(c.dir, `${nm}.png`)),
    overview: existsSync(join(pack, 'Sample.png')) ? asset('ui/_sample.png', join(pack, 'Sample.png')) : null,
  })
  const extraDir = join(pack, 'PNG', 'Extra', 'Default')
  SECTIONS.push({
    tab: 'ui', title: `UI 包 Extra · ${pngs(extraDir).length} 个（不分色）`,
    note: 'Extra 里是 line 描边按钮、分隔线、上下箭头、播放/循环、输入框这些，只有单色一套。',
    rows: pngs(extraDir), cols: [{ label: 'Extra', full: 'PNG/Extra/Default 32×32', dir: extraDir,}],
    cell: (nm, c) => asset(`ui/${c.label}/${nm}.png`, join(c.dir, `${nm}.png`)),
  })
}

/* ---------- 3. Pixel Adventure：大/小瓦片 × 粗细描边 ---------- */
{
  const pack = join(UI, 'kenney_ui-pack-pixel-adventure')
  const sets = [
    { key: 'large', title: 'Adventure 大瓦片 · 91 块 32×32', sheet: join(pack, 'Tilesheets', 'Large tiles', 'Thick outline', 'tilemap_packed.png') },
    { key: 'small', title: 'Adventure 小瓦片 · 161 块 16×16', sheet: join(pack, 'Tilesheets', 'Small tiles', 'Thick outline', 'tilemap_packed.png') },
  ]
  for (const s of sets) {
    const thick = join(pack, 'Tiles', s.key === 'large' ? 'Large tiles' : 'Small tiles', 'Thick outline')
    const thin = join(pack, 'Tiles', s.key === 'large' ? 'Large tiles' : 'Small tiles', 'Thin outline')
    const cols = [{ label: '粗边', full: 'Thick outline', dir: thick,}, { label: '细边', full: 'Thin outline', dir: thin,}]
    SECTIONS.push({
      tab: 'adventure', title: s.title,
      note: '编号无语义，先扫一眼下面的总览图定位，再回表里按编号选。两列是描边粗细，桌宠浮在任意桌面上时粗边更稳。',
      rows: pngs(thick), cols,
      cell: (nm, c) => asset(`adv/${s.key}/${c.label}/${nm}.png`, join(c.dir, `${nm}.png`)),
      overview: existsSync(s.sheet) ? asset(`adv/${s.key}/_sheet.png`, s.sheet) : null,
    })
  }
}

/* ---------- 4. 空间扩展包：60 个控件 × 5 色 + Extra 70 ---------- */
{
  const pack = join(UI, 'kenney_ui-pack-space-expansion')
  const colors = ['Blue', 'Green', 'Grey', 'Red', 'Yellow']
  const cols = colors.map((c) => ({ label: c, full: `PNG/${c}/Default`, dir: join(pack, 'PNG', c, 'Default') }))
  SECTIONS.push({
    tab: 'space', title: `空间扩展包 · ${pngs(cols[0].dir).length} 个控件 × 5 色`,
    note: '是 UI 包的扩展，与基础包**零重名**：进度条（bar_*）、带标题栏的按钮（button_square_header_*）、准星（crosshair_*）。尺寸不方，最长 192×64，表里按真实比例显示（超过 110px 宽会等比缩到 110）。',
    rows: pngs(cols[0].dir), cols,
    cell: (nm, c) => asset(`space/${c.label}/${nm}.png`, join(c.dir, `${nm}.png`)),
    overview: existsSync(join(pack, 'Sample.png')) ? asset('space/_sample.png', join(pack, 'Sample.png')) : null,
  })
  const extraDir = join(pack, 'PNG', 'Extra', 'Default')
  SECTIONS.push({
    tab: 'space', title: `空间扩展包 Extra · ${pngs(extraDir).length} 个（不分色）`,
    note: 'Extra 里是玻璃面板（panel_glass_*）、带阴影的进度条（bar_shadow_*）、光标（cursor_*）、准星和通用按钮底板。同样有 Double 高清版和 Vector/SVG。',
    rows: pngs(extraDir), cols: [{ label: 'Extra', full: 'PNG/Extra/Default', dir: extraDir }],
    cell: (nm, c) => asset(`space/${c.label}/${nm}.png`, join(c.dir, `${nm}.png`)),
  })
}

/* ---------- 渲染 ---------- */
const TABS = [
  { id: 'emotes', label: '表情包' },
  { id: 'ui', label: 'UI 包' },
  { id: 'space', label: '空间扩展包' },
  { id: 'adventure', label: 'Pixel Adventure' },
]

const rowId = (si, nm) => `s${si}-${nm}`

const renderSection = (sec, si) => {
  const head = sec.cols.map((c) =>
    `<th><button class="solo" data-col="${esc(c.label)}" data-sec="${si}" title="只看这一列">${c.label}</button></th>`).join('')
  const body = sec.rows.map((nm) => {
    const tds = sec.cols.map((c, ci) => {
      const a = sec.cell(nm, c)
      return `<td><div class="cell" style="--w:${a.w}px" data-name="${esc(nm)}" data-col="${esc(c.label)}" ` +
        `data-pack="${esc(sec.tab)}" data-sec="${si}" data-row="${esc(rowId(si, nm))}" ` +
        `title="${esc(nm)} · ${esc(c.full)} · 原生 ${esc(a.nat)}">` +
        `<img src="${a.src}" alt=""></div></td>`
    }).join('')
    return `<tr data-row="${esc(rowId(si, nm))}" data-nm="${esc(nm.toLowerCase())}"><th class="rowhead"><code>${esc(nm)}</code>` +
      `<button class="rowpick" data-row="${esc(rowId(si, nm))}" title="把这一行在当前可见的列里全勾上">选</button></th>${tds}</tr>`
  }).join('')
  return `<section class="sec"><h2>${sec.title}</h2><p class="note">${sec.note}</p>` +
    (sec.overview ? `<details class="ov"><summary>总览图（包/图集原样，收起不占地方）</summary><img src="${sec.overview.src}" alt=""></details>` : '') +
    `<div class="wrap"><table><thead><tr><th>素材名</th>${head}</tr></thead><tbody>${body}</tbody></table></div></section>`
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const licOf = (p) => {
  const f = join(p, 'License.txt')
  return existsSync(f) ? readFileSync(f, 'utf8').match(/License:? \(Creative Commons Zero, CC0\)/)?.[0] || '未匹配' : '缺'
}

const tabBar = TABS.map((t, i) =>
  `<button class="tab${i === 0 ? ' on' : ''}" data-tab="${t.id}">${t.label} <span class="tcnt" data-tcnt="${t.id}">0</span></button>`).join('')

const sectionsByTab = TABS.map((t) =>
  `<div class="tabpane${t.id === 'emotes' ? ' on' : ''}" data-pane="${t.id}">${SECTIONS.map((s, i) => s.tab === t.id ? renderSection(s, i) : '').join('')}</div>`).join('')

const html = `<!doctype html><meta charset="utf-8"><title>Kenney 素材包 · 选型</title>
<style>
  body{margin:0;padding:0 22px 54px;background:#f4f6f8;color:#222;--k:1;
       font:13px/1.55 "Microsoft YaHei UI",sans-serif;display:flex;flex-direction:column;height:100vh;box-sizing:border-box}
  body[data-z="2"]{--k:2}body[data-z="3"]{--k:3}
  h1{font-size:19px;margin:0;padding:16px 0 0}
  .note{color:#5b6773;margin:4px 0 0;max-width:1080px;font-size:12.5px}
  .tabs{display:flex;gap:6px;margin:12px 0 0;border-bottom:1px solid #c7ced6}
  .tab{border:1px solid #c7ced6;border-bottom:0;background:#e7ebef;border-radius:7px 7px 0 0;padding:6px 14px;
       font:inherit;cursor:pointer;color:#3c4650}
  .tab.on{background:#fff;color:#111;font-weight:600}
  .tcnt{display:inline-block;min-width:16px;padding:0 4px;border-radius:8px;background:#2f6fd0;color:#fff;font-size:11px}
  .tcnt.zero{background:#c0c8d0;color:#5b6773}
  .bar{display:flex;gap:18px;align-items:center;flex-wrap:wrap;padding:9px 0 7px;background:#f4f6f8;
       position:sticky;top:0;z-index:6;border-bottom:1px solid #d6dbe1}
  .bar b{font-weight:600;color:#5b6773}
  .seg{display:inline-flex;border:1px solid #c7ced6;border-radius:6px;overflow:hidden}
  .seg button{border:0;background:#fff;padding:4px 11px;font:inherit;cursor:pointer;color:#3c4650}
  .seg button+button{border-left:1px solid #c7ced6}
  .seg button.on{background:#2f6fd0;color:#fff}
  input#q{border:1px solid #c7ced6;border-radius:6px;padding:4px 9px;font:inherit;width:210px}
  .tabpane{display:none;flex:1;min-height:0;overflow:auto}
  .tabpane.on{display:block}
  .sec{padding-bottom:2px}
  .sec h2{font-size:15px;margin:14px 0 2px}
  .wrap{overflow:visible;border:1px solid #d6dbe1;border-radius:8px;background:#fff;margin:8px 0 14px}
  table{border-collapse:separate;border-spacing:0;font-size:11px}
  thead th{position:sticky;top:0;z-index:3;background:#eef1f4;padding:2px 2px;border-bottom:1px solid #c7ced6;border-left:1px solid #e5e9ed;vertical-align:middle}
  thead th:first-child{left:0;z-index:5;text-align:left;padding-left:9px;min-width:180px}
  .solo{border:0;background:transparent;font:inherit;font-weight:600;color:#3c4650;cursor:pointer;padding:2px 5px}
  .solo:hover,.solo.on{color:#2f6fd0}
  tbody th.rowhead{position:sticky;left:0;z-index:4;background:#fff;text-align:left;padding:3px 8px;
       border-bottom:1px solid #eef1f4;white-space:nowrap;min-width:180px}
  tbody tr:nth-child(even) th.rowhead{background:#fafbfc}
  .rowhead code{font-size:11px;color:#3c4650}
  .rowpick{margin-left:7px;border:1px solid #c7ced6;background:#fff;border-radius:4px;font:inherit;font-size:10px;
       padding:0 6px;cursor:pointer;color:#8b96a1}
  .rowpick.on,.rowpick.part{background:#2f6fd0;border-color:#2f6fd0;color:#fff}
  .rowpick.part{opacity:.6}
  td{border-left:1px solid #f0f2f5;border-bottom:1px solid #eef1f4;text-align:center;padding:0}
  .cell{display:flex;align-items:center;justify-content:center;cursor:pointer;padding:5px}
  .cell img{display:block;image-rendering:pixelated;width:min(calc(var(--w) * var(--k)),300px);height:auto}
  .cell.sel{outline:2px solid #2f6fd0;outline-offset:-2px;background:#dbe8fb}
  .cell:hover{outline:2px solid #9dbdf0;outline-offset:-2px}
  body[data-bg="mid"] .cell{background:#8b939c}
  body[data-bg="dark"] .cell{background:#2b2f36}
  body[data-bg="check"] .cell{background-image:linear-gradient(45deg,#dfe3e7 25%,transparent 25%,transparent 75%,#dfe3e7 75%),
       linear-gradient(45deg,#dfe3e7 25%,#fff 25%,#fff 75%,#dfe3e7 75%);background-size:12px 12px;background-position:0 0,6px 6px}
  .dim{opacity:.1}
  tr.hide{display:none}
  .ov{margin:8px 0 0;border:1px solid #d6dbe1;border-radius:8px;background:#fff;padding:7px 10px;font-size:12px;color:#5b6773}
  .ov img{max-width:100%;max-height:34vh;display:block;margin-top:6px;image-rendering:pixelated}
  .out{position:fixed;left:0;right:0;bottom:0;background:#1e252c;color:#e7ebf0;padding:8px 22px;
       display:flex;gap:11px;align-items:center}
  .out textarea{flex:1;height:36px;background:#12181d;color:#c8f0c8;border:1px solid #37424c;border-radius:5px;
       font:11px/1.4 Consolas,monospace;padding:3px 6px;resize:none}
  .out button{border:0;border-radius:5px;padding:5px 12px;background:#2f6fd0;color:#fff;font:inherit;cursor:pointer;white-space:nowrap}
</style>
<h1>Kenney 素材包选型 · ${SECTIONS.length} 张矩阵 / ${copied} 个素材</h1>
<div class="tabs">${tabBar}</div>
<div class="bar">
  <span><b>底色</b> <span class="seg" id="bg"><button class="segbtn on" data-v="white">浅</button><button class="segbtn" data-v="check">棋盘</button><button class="segbtn" data-v="mid">中灰</button><button class="segbtn" data-v="dark">深</button></span></span>
  <span><b>放大</b> <span class="seg" id="zoom"><button class="segbtn on" data-v="1">1×</button><button class="segbtn" data-v="2">2×</button><button class="segbtn" data-v="3">3×</button></span></span>
  <span><b>搜</b> <input id="q" placeholder="按名字过滤，如 button / slide / 0007"></span>
  <span id="colhint"><b>单列：</b>点表头的变体名只看那一列，再点一次还原</span>
</div>
${sectionsByTab}
<div class="out">
  <span>已选 <b id="cnt">0</b></span>
  <textarea id="ta" readonly placeholder="点格子后这里出现清单"></textarea>
  <button id="copy">复制清单</button>
  <button id="onlynames">只要名字</button>
  <button id="clear">清空</button>
</div>
<script>
var sel={},solo={},n=0;
var ta=document.getElementById('ta');
function keyOf(el){return el.dataset.pack+'|'+el.dataset.sec+'|'+el.dataset.name+'|'+el.dataset.col}
function paint(){
  var cells=document.querySelectorAll('.cell');
  for(var i=0;i<cells.length;i++)cells[i].classList.toggle('sel',sel[keyOf(cells[i])]===1);
  var picks=document.querySelectorAll('.rowpick');
  for(var j=0;j<picks.length;j++){
    var rp=picks[j],row=rp.dataset.row,vis=[],on=0;
    var cs=document.querySelectorAll('.cell[data-row="'+row+'"]');
    for(var q=0;q<cs.length;q++){var td=cs[q].parentNode;
      if(td.offsetParent!==null&&!cs[q].classList.contains('dim')){vis.push(cs[q]);if(sel[keyOf(cs[q])]===1)on++}}
    rp.classList.toggle('on',vis.length>0&&on===vis.length);
    rp.classList.toggle('part',on>0&&on<vis.length);
    rp.textContent=on===0?'选':on+'/'+vis.length;
  }
  n=Object.keys(sel).length;
  document.getElementById('cnt').textContent=n;
  var lines=[];for(var k in sel){var p=k.split('|');lines.push(p[2]+'  \\u00b7  '+packName(p[0])+'  \\u00b7  '+p[3])}
  lines.sort();ta.value=lines.join('\\n');
  var tabs={};for(var k2 in sel){var t=k2.split('|')[0];tabs[t]=(tabs[t]||0)+1}
  var badges=document.querySelectorAll('.tcnt');
  for(var b=0;b<badges.length;b++){var id=badges[b].dataset.tcnt,v=tabs[id]||0;
    badges[b].textContent=v;badges[b].classList.toggle('zero',v===0)}
}
function packName(id){return id==='emotes'?'表情包':id==='ui'?'UI包':id==='space'?'空间扩展包':'Adventure'}
document.addEventListener('click',function(ev){
  var t=ev.target;
  var cell=up(t,'cell');
  if(cell){var k=keyOf(cell);if(sel[k])delete sel[k];else sel[k]=1;paint();return}
  var rp=up(t,'rowpick');
  if(rp){var row=rp.dataset.row,cs=document.querySelectorAll('.cell[data-row="'+row+'"]'),vis=[];
    for(var i=0;i<cs.length;i++){if(cs[i].parentNode.offsetParent!==null&&!cs[i].classList.contains('dim'))vis.push(cs[i])}
    var all=vis.length>0;for(var j=0;j<vis.length;j++)if(!sel[keyOf(vis[j])]){all=false;break}
    for(var m=0;m<vis.length;m++){var kk=keyOf(vis[m]);if(all)delete sel[kk];else sel[kk]=1}
    paint();return}
  var so=up(t,'solo');
  if(so){var si=so.dataset.sec,L=so.dataset.col;
    solo[si]=solo[si]===L?null:L;
    var mine=document.querySelectorAll('.cell[data-sec="'+si+'"]');
    for(var a=0;a<mine.length;a++)mine[a].classList.toggle('dim',solo[si]!==null&&mine[a].dataset.col!==solo[si]);
    var ths=so.closest('tr').children;
    for(var b2=0;b2<ths.length;b2++){var bt=ths[b2].querySelector('.solo');
      if(bt)bt.classList.toggle('dim',solo[si]!==null&&bt.dataset.col!==solo[si])}
    document.getElementById('colhint').innerHTML='<b>单列：</b>'+(solo[si]?'正在只看 第'+si+'表的 '+solo[si]+' 列，再点一次还原':'点表头的变体名只看那一列，再点一次还原');
    paint();return}
  var tb=up(t,'tab');
  if(tb){var id=tb.dataset.tab,ts=document.querySelectorAll('.tab');
    for(var x=0;x<ts.length;x++)ts[x].classList.toggle('on',ts[x].dataset.tab===id);
    var ps=document.querySelectorAll('.tabpane');
    for(var y=0;y<ps.length;y++)ps[y].classList.toggle('on',ps[y].dataset.pane===id);
    paint();return}
  var seg=up(t,'segbtn');
  if(seg){var par=seg.parentNode,parent=par.id;
    for(var z=0;z<par.children.length;z++)par.children[z].classList.remove('on');
    seg.classList.add('on');
    if(parent==='bg')document.body.dataset.bg=seg.dataset.v;
    if(parent==='zoom')document.body.dataset.z=seg.dataset.v;
    return}
  if(t.id==='clear'){sel={};paint();return}
  if(t.id==='onlynames'){var set={};for(var k3 in sel){var p3=k3.split('|');set[p3[2]+' \\u00b7 '+packName(p3[0])]=1}
    ta.value=Object.keys(set).sort().join('\\n');return}
  if(t.id==='copy'){ta.select();
    var done=function(){t.textContent='已复制';setTimeout(function(){t.textContent='复制清单'},900)};
    if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(ta.value).then(done,done);
    else{document.execCommand('copy');done()}return}
});
document.getElementById('q').addEventListener('input',function(){
  var v=this.value.trim().toLowerCase();
  var rows=document.querySelectorAll('tbody tr');
  for(var i=0;i<rows.length;i++)rows[i].classList.toggle('hide',v!==''&&rows[i].dataset.nm.indexOf(v)<0);
});
function up(el,cls){return el&&el.closest?el.closest('.'+cls):null}
document.body.dataset.bg='white';document.body.dataset.z='1';
paint();
</script>
`

writeFileSync(join(OUT, 'index.html'), html, 'utf8')

console.log(`标签 ${TABS.length} 个 / 矩阵 ${SECTIONS.length} 张，拷入素材 ${copied} 个文件`)
console.log(`许可证：表情包 ${licOf(join(UI, 'kenney_emotes-pack'))} ｜ UI包 ${licOf(join(UI, 'kenney_ui-pack'))} ｜ 空间扩展 ${licOf(join(UI, 'kenney_ui-pack-space-expansion'))} ｜ Adventure ${licOf(join(UI, 'kenney_ui-pack-pixel-adventure'))}`)
console.log(`→ ${join(OUT, 'index.html')}`)
