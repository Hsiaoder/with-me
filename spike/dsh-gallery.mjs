/**
 * 一次性：把 dsh-pet 打包版 app.asar 里全部动画抽出来，生成一个本地预览网页。
 *
 * 源用 asar 里的 alpha 原片（见 spike/README.md「素材试穿」那节），
 * 不用 E:/localwork/pet-animations 那批黑底中间产物——那是抠像前的东西。
 *
 * 分类是按名字里的关键词匹配的，顺序即优先级，第一个命中的算数；
 * 都没命中就进「其他活动」。跑完会把每条的归类打到控制台，分错了改 CATS 就行。
 *
 * 素材和网页都落在 %TEMP%，不进仓库（授权另说，见记忆 project-dafeiyu-license）。
 * 跑法：node spike/dsh-gallery.mjs
 */
import { existsSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ASAR = 'E:/localwork/dsh-pet-0.3.8-win-x64/resources/app.asar'
const OUT = join(tmpdir(), 'dsh-gallery')
const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3])

/**
 * 分类表：[类名, 关键词数组]。命中任一关键词就归这一类，前面的优先。
 *
 * 分这几类的理由是它对着皮肤池和面板按钮：吃东西→喂食、玩耍→小游戏、
 * 状态→状态按钮、点击/被拖→click 与 drag 池、待机与日常+移动→idle 与 move 池。
 */
const CATS = [
  ['互动反应', ['点击回应', '被鼠标拖拽', '被吓一跳', '敲击桌面', '是啊，吃什么']],
  ['吃东西', ['吃', '涮火锅']],
  // 「碎碎念」不带连字符：还有一条叫「深度思考碎碎念」，写死前缀会漏掉它
  ['状态', ['余额-', '工作状态-', '碎碎念']],
  ['玩耍', ['抛接', '五子棋', '魔方', '玩具汽车', '陀螺', '水枪', '秋千', '木马', '毽子',
    '魔术', '吹气球', '玩游戏', '堆雪人', '放风筝', '抓碎']],
  ['移动', ['走路', '奔跑', '踏步', '踱步']],
  // 节日排在舞蹈前面：「舞狮头」含「舞」，排后面会被抢走
  ['节日与节气', ['中秋', '重阳', '腊八', '青团', '粽子', '福字', '红包', '圣诞', '南瓜灯',
    '舞狮', '孔明灯', '河灯', '烟花', '茱', '乞巧', '拆礼物', '落叶', '讨糖']],
  ['舞蹈与音乐', ['舞', '笛子', '小提琴', '哼歌', '演奏']],
  ['特效与展示', ['蓝鲸', '鲸鱼', '生花', '蝴蝶', '动物环绕', '变鸽子', '幽灵', '换装',
    '照镜子', '旋转展示', '屈膝礼仪', '吐泡泡']],
  ['待机与日常', ['待机', '哈欠', '伸懒腰', '刷牙', '小憩', '打瞌睡', '下蹲', '东张西望',
    '纳凉', '撸猫', '写代码', '记录']],
]
const FALLBACK = '其他活动'

function classify(name) {
  for (const [cat, words] of CATS) if (words.some((w) => name.includes(w))) return cat
  return FALLBACK
}

const fd = openSync(ASAR, 'r')
const head = Buffer.alloc(16)
readSync(fd, head, 0, 16, 0)
const headerSize = head.readUInt32LE(12)
const BASE = 16 + headerSize
const headerBuf = Buffer.alloc(headerSize)
readSync(fd, headerBuf, 0, headerSize, 16)
const index = JSON.parse(headerBuf.toString('utf8').replace(/\0+$/, ''))

const entries = new Map()
;(function walk(node, dir) {
  for (const [k, v] of Object.entries(node.files ?? {})) {
    const p = dir ? `${dir}/${k}` : k
    if (v.files) walk(v, p)
    else entries.set(p, { size: Number(v.size), offset: Number(v.offset) })
  }
})(index, '')

/** asar 的 offset 相对数据段整体差 1 字节，别写死：搜 EBML magic 对齐再切。 */
function extract(path, dest) {
  const e = entries.get(path)
  if (!e) throw new Error(`asar 里没有 ${path}`)
  const buf = Buffer.alloc(e.size)
  readSync(fd, buf, 0, e.size, BASE + e.offset)
  let delta = buf.indexOf(EBML)
  if (delta !== 0) {
    readSync(fd, buf, 0, e.size, BASE + e.offset + (delta < 0 ? 1 : delta))
    if (buf.indexOf(EBML) !== 0) throw new Error(`${path} 找不到 EBML magic，切片错位`)
  }
  writeFileSync(dest, buf)
  return e.size
}

mkdirSync(join(OUT, 'assets'), { recursive: true })
const clips = []
for (const [p, e] of [...entries].sort()) {
  if (!p.startsWith('assets/webm/') || !p.endsWith('.webm')) continue
  const name = p.slice('assets/webm/'.length).replace(/\.webm$/, '')
  const dest = join(OUT, 'assets', name + '.webm')
  if (!existsSync(dest) || statSync(dest).size !== e.size) extract(p, dest)
  clips.push({ name, bytes: e.size, cat: classify(name) })
}

const counts = {}
for (const c of clips) counts[c.cat] = (counts[c.cat] ?? 0) + 1
for (const [cat, n] of Object.entries(counts)) console.log(`${cat.padEnd(6)} ${String(n).padStart(3)} 条`)
console.log('\n逐条归类：')
for (const c of clips) console.log(`  [${c.cat}] ${c.name}`)

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>dsh-pet 全部动画（asar 内 alpha 原片）</title>
<style>
:root{--bg:#f4f5f7;--panel:#fff;--text:#1f2329;--muted:#6b7280;--border:#d9dce1;--accent:#2f6fed}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif}
header{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding:10px 16px;background:rgba(244,245,247,.94);border-bottom:1px solid var(--border);backdrop-filter:blur(6px)}
h1{font-size:15px;margin:0 8px 0 0;font-weight:650}
.toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
button{font:inherit;padding:5px 10px;border:1px solid var(--border);border-radius:6px;background:var(--panel);
  color:var(--text);cursor:pointer}
button.active{border-color:var(--accent);color:var(--accent);background:#eef3ff}
input[type=search]{font:inherit;padding:5px 10px;border:1px solid var(--border);border-radius:6px;min-width:200px}
.count{color:var(--muted);font-size:13px}

.layout{display:flex;align-items:flex-start;gap:16px;padding:16px}
aside{position:sticky;top:56px;flex:0 0 168px;display:flex;flex-direction:column;gap:2px;
  background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:8px}
aside h2{font-size:11px;color:var(--muted);margin:4px 6px 6px;font-weight:600;letter-spacing:.04em}
.cat{display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;
  border:0;border-radius:6px;padding:6px 8px;text-align:left;background:transparent;cursor:pointer}
.cat:hover{background:#f0f2f5}
.cat.active{background:#eef3ff;color:var(--accent);font-weight:600}
.cat .n{color:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}
.cat.active .n{color:var(--accent)}

main{flex:1;min-width:0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;overflow:hidden;display:flex;flex-direction:column}
.card[hidden]{display:none}
.stage{position:relative;aspect-ratio:16/9;background-color:#fff}
.stage[data-bg=checker]{background-image:conic-gradient(#d4d4d4 25%,#fff 0 50%,#d4d4d4 0 75%,#fff 0);background-size:16px 16px}
.stage[data-bg=dark]{background-color:#1b1e24}
.stage[data-bg=white]{background-color:#fff}
video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.meta{padding:7px 9px 9px;display:flex;flex-direction:column;gap:3px}
.name{font-size:13px;font-weight:600;line-height:1.3}
.sub{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
.tag{align-self:flex-start;font-size:10px;color:var(--muted);border:1px solid var(--border);
  border-radius:4px;padding:1px 5px}
.empty{display:none;padding:60px 20px;text-align:center;color:var(--muted)}
.empty.show{display:block}
@media (max-width:760px){.layout{flex-direction:column}aside{position:static;flex:none;width:100%;
  flex-direction:row;flex-wrap:wrap;overflow-x:auto}}
</style>
</head>
<body>
<header>
  <h1>dsh-pet 全部动画 · asar 内 alpha 原片</h1>
  <div class="toolbar">
    <button type="button" id="play-all">全部播放</button>
    <button type="button" id="pause-all">全部暂停</button>
    <span class="count" id="count"></span>
    <button type="button" data-bg="checker" class="active">棋盘格</button>
    <button type="button" data-bg="white">白底</button>
    <button type="button" data-bg="dark">深底</button>
    <input id="filter" type="search" placeholder="按名字筛选，空格分词">
  </div>
</header>

<div class="layout">
  <aside id="menu"><h2>按动作分类</h2></aside>
  <main>
    <div class="grid" id="grid"></div>
    <div class="empty" id="empty">没有匹配的动画</div>
  </main>
</div>

<script>
const clips = ${JSON.stringify(clips, null, 0)};
const catOrder = ${JSON.stringify([...CATS.map(([c]) => c), FALLBACK], null, 0)};

const grid = document.getElementById('grid')
const menu = document.getElementById('menu')
const count = document.getElementById('count')
const empty = document.getElementById('empty')
const filterInput = document.getElementById('filter')
let activeCat = null

/** src 一开始就挂上（只读 metadata，不播就不整段解码），可见性只管播与停。
 *  把「加载」也交给 IntersectionObserver 太脆：观察器一旦不触发（后台标签页就是），整页全空白。 */
const io = new IntersectionObserver((rows) => {
  for (const r of rows) {
    const v = r.target.querySelector('video')
    if (r.isIntersecting) v.play().catch(() => {})
    else v.pause()
  }
}, { rootMargin: '250px 0px' })

for (const c of clips) {
  const card = document.createElement('div')
  card.className = 'card'
  card.dataset.name = c.name
  card.dataset.cat = c.cat

  const stage = document.createElement('div')
  stage.className = 'stage'
  stage.dataset.bg = 'checker'
  const video = document.createElement('video')
  video.muted = true
  video.loop = true
  video.playsInline = true
  video.preload = 'metadata'
  video.controls = true
  video.src = 'assets/' + encodeURIComponent(c.name + '.webm')
  video.addEventListener('loadedmetadata', () => {
    sub.textContent = [video.videoWidth + '×' + video.videoHeight,
      video.duration.toFixed(1) + ' 秒', (c.bytes / 1024).toFixed(0) + ' KB'].join(' · ')
  })
  stage.append(video)

  const meta = document.createElement('div')
  meta.className = 'meta'
  const tag = document.createElement('span')
  tag.className = 'tag'
  tag.textContent = c.cat
  const name = document.createElement('div')
  name.className = 'name'
  name.textContent = c.name
  const sub = document.createElement('div')
  sub.className = 'sub'
  sub.textContent = (c.bytes / 1024).toFixed(0) + ' KB'
  meta.append(tag, name, sub)

  card.append(stage, meta)
  grid.append(card)
  io.observe(card)
}

/** 左侧菜单：固定按 CATS 的顺序排，空类不显示。 */
function buildMenu() {
  const nOf = (cat) => clips.filter((c) => c.cat === cat).length
  const mk = (label, cat) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'cat'
    b.dataset.cat = cat
    b.innerHTML = '<span></span><span class="n">' + (cat === null ? clips.length : nOf(cat)) + '</span>'
    b.firstChild.textContent = label
    b.classList.toggle('active', activeCat === cat)
    b.addEventListener('click', () => { activeCat = cat; updateFilter() })
    return b
  }
  menu.append(mk('全部', null))
  for (const cat of catOrder) if (nOf(cat)) menu.append(mk(cat, cat))
}

function updateFilter() {
  const words = filterInput.value.trim().split(/\\s+/).filter(Boolean)
  let visible = 0
  for (const card of grid.children) {
    const hitCat = activeCat === null || card.dataset.cat === activeCat
    const hitWord = words.every((w) => card.dataset.name.includes(w))
    card.hidden = !(hitCat && hitWord)
    if (!card.hidden) visible++
  }
  for (const b of menu.querySelectorAll('.cat')) b.classList.toggle('active', b.dataset.cat === String(activeCat))
  empty.classList.toggle('show', visible === 0)
  count.textContent = visible + ' / ' + clips.length
}

buildMenu()
updateFilter()
filterInput.addEventListener('input', updateFilter)

document.getElementById('play-all').addEventListener('click', () =>
  document.querySelectorAll('video').forEach((v) => v.play().catch(() => {})))
document.getElementById('pause-all').addEventListener('click', () =>
  document.querySelectorAll('video').forEach((v) => v.pause()))

const bgButtons = [...document.querySelectorAll('[data-bg]:not(.stage)')]
bgButtons.forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.stage').forEach((s) => { s.dataset.bg = b.dataset.bg })
  bgButtons.forEach((o) => o.classList.toggle('active', o === b))
}))
</script>
</body>
</html>
`

writeFileSync(join(OUT, 'index.html'), html, 'utf8')
console.log(`\n抽出 ${clips.length} 段动画 → ${join(OUT, 'assets')}`)
console.log(`网页  → ${join(OUT, 'index.html')}`)
