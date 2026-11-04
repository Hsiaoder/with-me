/**
 * Kenney 表情包的选型预览页（spike，产物只落 %TEMP%，不进仓库）。
 *
 * 挑选要同时回答两个问题：要哪几个表情、用哪种风格。所以排成矩阵——
 * 一行一个表情名，16 列是 Pixel/Vector × Style 1-8，横向扫一眼就能比出风格差异。
 * 图片全部 base64 内联，index.html 单文件拷走也能看。
 *
 * 跑法：node spike/kenney-emotes-preview.mjs   然后 start "%TEMP%\\kenney-emotes-preview\\index.html"
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PACK = 'E:\\ai-pet\\ui\\kenney_emotes-pack'
const OUT = join(tmpdir(), 'kenney-emotes-preview')

const STYLES = []
for (let i = 1; i <= 8; i++) STYLES.push({ kind: 'pixel', n: i, dir: join(PACK, 'PNG', 'Pixel', `Style ${i}`) })
for (let i = 1; i <= 8; i++) STYLES.push({ kind: 'vector', n: i, dir: join(PACK, 'PNG', 'Vector', `Style ${i}`) })

const b64 = (p) => 'data:image/png;base64,' + readFileSync(p).toString('base64')
const label = (s) => (s.kind === 'pixel' ? 'P' : 'V') + s.n

/** 16 个风格目录都有的公共表情名，保证矩阵不留空格。 */
const filesOf = STYLES.map((s) => readdirSync(s.dir).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)).sort())
const names = filesOf[0].filter((nm) => filesOf.every((f) => f.includes(nm)))
const orphans = filesOf.flat().filter((f) => !names.includes(f))

const headCells = STYLES.map((s, i) =>
  `<th class="col-${s.kind}"><button class="solo" data-col="${i}" title="只看这一列">${label(s)}</button></th>`).join('')

const rows = names.map((nm, r) => {
  const tds = STYLES.map((s, c) =>
    `<td class="col-${s.kind}" data-c="${c}"><div class="cell" data-r="${r}" data-c="${c}" ` +
    `title="${nm} · ${s.kind} Style ${s.n}"><img src="${b64(join(s.dir, `${nm}.png`))}" alt=""></div></td>`).join('')
  return `<tr><th class="rowhead"><code>${nm}</code>` +
    `<button class="rowpick" data-r="${r}" title="把这一行在当前可见的列里全勾上">选</button></th>${tds}</tr>`
}).join('')

const preview = existsSync(join(PACK, 'Preview.png')) ? b64(join(PACK, 'Preview.png')) : ''
const licenseLine = existsSync(join(PACK, 'License.txt'))
  ? readFileSync(join(PACK, 'License.txt'), 'utf8').match(/License \(Creative Commons Zero, CC0\)/)?.[0] || '许可证未匹配到预期行'
  : '缺 License.txt'

const html = `<!doctype html><meta charset="utf-8"><title>Kenney Emotes · 选型</title>
<style>
  body{margin:0;padding:0 24px 56px;background:#f4f6f8;font:13px/1.5 "Microsoft YaHei UI",sans-serif;color:#222;
       --zp:16px;--zv:26px;display:flex;flex-direction:column;height:100vh;box-sizing:border-box}
  body[data-z="2"]{--zp:32px;--zv:46px}
  body[data-z="3"]{--zp:48px;--zv:64px}
  h1{font-size:19px;margin:0;padding-top:18px}
  .note{color:#5b6773;margin:6px 0 10px;max-width:1050px}
  .bar{position:sticky;top:0;z-index:6;background:#f4f6f8;padding:10px 0 8px;border-bottom:1px solid #d6dbe1;
       display:flex;gap:20px;align-items:center;flex-wrap:wrap}
  .bar b{font-weight:600;color:#5b6773}
  .seg{display:inline-flex;border:1px solid #c7ced6;border-radius:6px;overflow:hidden}
  .seg button{border:0;background:#fff;padding:4px 11px;font:inherit;cursor:pointer;color:#3c4650}
  .seg button+button{border-left:1px solid #c7ced6}
  .seg button.on{background:#2f6fd0;color:#fff}
  .wrap{overflow:auto;flex:1;min-height:160px;border:1px solid #d6dbe1;border-radius:8px;background:#fff;margin-top:10px}
  table{border-collapse:separate;border-spacing:0;font-size:11px}
  thead th{position:sticky;top:0;z-index:3;background:#eef1f4;padding:3px 2px;border-bottom:1px solid #c7ced6;border-left:1px solid #e5e9ed}
  thead th:first-child{left:0;z-index:5;text-align:left;padding-left:9px;min-width:170px}
  .solo{border:0;background:transparent;font:inherit;font-weight:600;color:#3c4650;cursor:pointer;padding:2px 5px}
  .solo:hover{color:#2f6fd0}
  tbody th.rowhead{position:sticky;left:0;z-index:4;background:#fff;text-align:left;padding:3px 8px;
       border-bottom:1px solid #eef1f4;white-space:nowrap;min-width:170px}
  tbody tr:nth-child(even) th.rowhead{background:#fafbfc}
  .rowhead code{font-size:11px;color:#3c4650}
  .rowpick{margin-left:7px;border:1px solid #c7ced6;background:#fff;border-radius:4px;font:inherit;font-size:10px;
       padding:0 6px;cursor:pointer;color:#8b96a1}
  .rowpick.on,.rowpick.part{background:#2f6fd0;border-color:#2f6fd0;color:#fff}
  .rowpick.part{opacity:.55}
  td{border-left:1px solid #f0f2f5;border-bottom:1px solid #eef1f4;text-align:center;padding:0}
  .cell{display:flex;align-items:center;justify-content:center;cursor:pointer;height:calc(var(--zv) + 8px)}
  .cell img{display:block;image-rendering:pixelated;max-width:100%}
  .col-pixel img{width:var(--zp)}
  .col-vector img{width:var(--zv)}
  .cell.sel{outline:2px solid #2f6fd0;outline-offset:-2px;background:#dbe8fb}
  .cell:hover{outline:2px solid #9dbdf0;outline-offset:-2px}
  body[data-bg="mid"] .cell{background:#8b939c}
  body[data-bg="dark"] .cell{background:#2b2f36}
  body[data-bg="check"] .cell{background-image:linear-gradient(45deg,#dfe3e7 25%,transparent 25%,transparent 75%,#dfe3e7 75%),
       linear-gradient(45deg,#dfe3e7 25%,#fff 25%,#fff 75%,#dfe3e7 75%);background-size:12px 12px;
       background-position:0 0,6px 6px}
  body[data-kind="pixel"] .col-vector{display:none}
  body[data-kind="vector"] .col-pixel{display:none}
  .dim{opacity:.12}
  .out{position:fixed;left:0;right:0;bottom:0;background:#1e252c;color:#e7ebf0;padding:9px 24px;
       display:flex;gap:12px;align-items:center}
  .out textarea{flex:1;height:36px;background:#12181d;color:#c8f0c8;border:1px solid #37424c;border-radius:5px;
       font:11px/1.4 Consolas,monospace;padding:3px 6px;resize:none}
  .out button{border:0;border-radius:5px;padding:5px 12px;background:#2f6fd0;color:#fff;font:inherit;cursor:pointer}
  .pic{margin:10px 0 0;border:1px solid #d6dbe1;border-radius:8px;background:#fff;padding:8px 10px;font-size:12px;color:#5b6773}
  .pic img{max-width:100%;max-height:38vh;display:block;margin-top:6px}
</style>
<h1>Kenney Emotes Pack · ${names.length} 个表情 × ${STYLES.length} 种风格</h1>
<p class="note">许可证：${licenseLine} — 个人和商用都可，署名非强制。<br>
横向比风格：<b>P1-P8 = Pixel</b>（原生 16×16，硬边）、<b>V1-V8 = Vector</b>（原生 32×38）。左侧一列就是文件名。
<b>点格子</b>选单个「表情 × 风格」；<b>点行尾「选」</b>把这一行在当前可见的列里全勾上。底色切到「深」看压深色桌面、
「棋盘」看压半透明面板——桌宠是浮在任意桌面像素上的，浅底读不出来的就不能用。</p>
<div class="bar">
  <span><b>底色</b> <span class="seg" id="bg"><button data-v="white" class="on">浅</button><button data-v="check">棋盘</button><button data-v="mid">中灰</button><button data-v="dark">深</button></span></span>
  <span><b>放大</b> <span class="seg" id="zoom"><button data-v="1" class="on">1×</button><button data-v="2">2×</button><button data-v="3">3×</button></span></span>
  <span><b>列</b> <span class="seg" id="kind"><button data-v="all" class="on">全部</button><button data-v="pixel">只 Pixel</button><button data-v="vector">只 Vector</button></span></span>
  <span id="colhint"><b>单列：</b>点表头 P1/V3 只看那一列，再点一次还原</span>
</div>
<div class="wrap"><table>
  <thead><tr><th>表情名 / 已选数</th>${headCells}</tr></thead>
  <tbody>${rows}</tbody>
</table></div>
${preview ? `<details class="pic"><summary>官方 Preview.png 对照（点开看整包原样，收起不占地方）</summary><img src="${preview}" alt=""></details>` : ''}
<div class="out">
  <span>已选 <b id="cnt">0</b></span>
  <textarea id="ta" readonly placeholder="点格子后这里出现清单"></textarea>
  <button id="copy">复制清单</button>
  <button id="onlynames">只要表情名</button>
  <button id="clear">清空</button>
</div>
<script>
var NAMES=${JSON.stringify(names)};
var STYLES=${JSON.stringify(STYLES.map((s) => s.kind + ' Style ' + s.n))};
var sel={},solo=-1,n=0;
var ta=document.getElementById('ta');
function has(r,c){return sel[r+'-'+c]===1}
function put(r,c,on){var k=r+'-'+c;if(on)sel[k]=1;else delete sel[k];n=Object.keys(sel).length}
function visibleCols(){var out=[];for(var c=0;c<STYLES.length;c++){
  var td=document.querySelector('td[data-c="'+c+'"]');
  if(td&&td.offsetParent!==null)out.push(c)}return out}
function paint(){
  document.getElementById('cnt').textContent=n;
  var arr=[];for(var k in sel){var p=k.split('-');arr.push(NAMES[p[0]]+'  \\u00b7  '+STYLES[p[1]])}
  arr.sort();ta.value=arr.join('\\n');
  var cells=document.querySelectorAll('.cell');
  for(var i=0;i<cells.length;i++){var e=cells[i];
    e.classList.toggle('sel',has(+e.dataset.r,+e.dataset.c))}
  var picks=document.querySelectorAll('.rowpick');
  for(var j=0;j<picks.length;j++){var rp=picks[j],r=+rp.dataset.r,vc=visibleCols(),on=0;
    for(var q=0;q<vc.length;q++)if(has(r,vc[q]))on++;
    rp.classList.toggle('on',vc.length>0&&on===vc.length);
    rp.classList.toggle('part',on>0&&on<vc.length);
    rp.textContent=on===0?'选':on+'/'+vc.length}
}
document.addEventListener('click',function(ev){
  var t=ev.target;
  var cell=t.closest?t.closest('.cell'):null;
  if(cell){put(+cell.dataset.r,+cell.dataset.c,!has(+cell.dataset.r,+cell.dataset.c));paint();return}
  var rp=t.closest?t.closest('.rowpick'):null;
  if(rp){var r=+rp.dataset.r,vc=visibleCols(),all=true;
    for(var i=0;i<vc.length;i++)if(!has(r,vc[i]))all=false;
    for(var j=0;j<vc.length;j++)put(r,vc[j],!all);
    paint();return}
  var so=t.closest?t.closest('.solo'):null;
  if(so){solo=solo===+so.dataset.col?-1:+so.dataset.col;
    var ths=document.querySelectorAll('thead th');
    for(var a=1;a<ths.length;a++)ths[a].classList.toggle('dim',solo>=0&&a-1!==solo);
    var tds=document.querySelectorAll('tbody td');
    for(var b2=0;b2<tds.length;b2++)tds[b2].classList.toggle('dim',solo>=0&&+tds[b2].dataset.c!==solo);
    document.getElementById('colhint').innerHTML='<b>单列：</b>'+(solo<0?'点表头 P1/V3 只看那一列，再点一次还原':'正在只看 '+STYLES[solo]+'，再点一次还原');
    paint();return}
  var seg=t.closest?t.closest('.seg button'):null;
  if(seg){var par=seg.parentNode,parent=par.id;
    for(var x=0;x<par.children.length;x++)par.children[x].classList.remove('on');
    seg.classList.add('on');
    if(parent==='bg')document.body.dataset.bg=seg.dataset.v;
    if(parent==='zoom')document.body.dataset.z=seg.dataset.v;
    if(parent==='kind'){document.body.dataset.kind=seg.dataset.v;paint()}
    return}
  if(t.id==='clear'){sel={};n=0;paint();return}
  if(t.id==='onlynames'){var set={};for(var k3 in sel)set[NAMES[k3.split('-')[0]]]=1;
    ta.value=Object.keys(set).sort().join('\\n');return}
  if(t.id==='copy'){ta.select();
    var done=function(){t.textContent='已复制';setTimeout(function(){t.textContent='复制清单'},900)};
    if(navigator.clipboard&&navigator.clipboard.writeText)
      navigator.clipboard.writeText(ta.value).then(done,done);
    else{document.execCommand('copy');done()}
    return}
});
document.body.dataset.bg='white';document.body.dataset.z='1';document.body.dataset.kind='all';
paint();
</script>
`

mkdirSync(OUT, { recursive: true })
const file = join(OUT, 'index.html')
writeFileSync(file, html, 'utf8')

console.log(`${names.length} 表情 × ${STYLES.length} 风格 = ${names.length * STYLES.length} 格，单文件 ${Math.round(Buffer.byteLength(html, 'utf8') / 1024)} KB`)
console.log(`许可证：${licenseLine}`)
if (orphans.length) console.log(`注意：有文件不在 16 个风格的公共名单里，未进矩阵 → ${[...new Set(orphans)].join(', ')}`)
console.log(`→ ${file}`)
