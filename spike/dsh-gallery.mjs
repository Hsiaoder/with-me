/**
 * 一次性：把 dsh-pet 打包版 app.asar 里全部动画抽出来，生成一个本地预览网页。
 *
 * 源用 asar 里的 alpha 原片（见 spike/README.md「素材试穿」那节），
 * 不用 E:/localwork/pet-animations 那批黑底中间产物——那是抠像前的东西。
 *
 * 素材和网页都落在 %TEMP%，不进仓库（授权另说，见记忆 project-dafeiyu-license）。
 * 跑法：node spike/dsh-gallery.mjs
 */
import { existsSync, mkdirSync, openSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ASAR = 'E:/localwork/dsh-pet-0.3.8-win-x64/resources/app.asar'
const OUT = join(tmpdir(), 'dsh-gallery')
const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3])

const fd = openSync(ASAR, 'r')
const head = Buffer.alloc(16)
readSync(fd, head, 0, 16, 0)
const BASE = 16 + head.readUInt32LE(12)
const headerBuf = Buffer.alloc(head.readUInt32LE(12))
readSync(fd, headerBuf, 0, headerBuf.length, 16)
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
  const name = p.slice('assets/webm/'.length)
  const dest = join(OUT, 'assets', name)
  if (!existsSync(dest) || statSync(dest).size !== e.size) extract(p, dest)
  clips.push({ name: name.replace(/\.webm$/, ''), bytes: e.size })
}

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
header{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding:10px 16px;background:rgba(244,245,247,.94);border-bottom:1px solid var(--border);backdrop-filter:blur(6px)}
h1{font-size:15px;margin:0 8px 0 0;font-weight:650}
.toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
button{font:inherit;padding:5px 10px;border:1px solid var(--border);border-radius:6px;background:var(--panel);
  color:var(--text);cursor:pointer}
button.active{border-color:var(--accent);color:var(--accent);background:#eef3ff}
input[type=search]{font:inherit;padding:5px 10px;border:1px solid var(--border);border-radius:6px;min-width:200px}
.count{color:var(--muted);font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;padding:16px}
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
<main>
  <div class="grid" id="grid"></div>
  <div class="empty" id="empty">没有匹配的动画</div>
</main>
<script>
const clips = ${JSON.stringify(clips, null, 0)};

const grid = document.getElementById('grid')
const count = document.getElementById('count')
const empty = document.getElementById('empty')
const filterInput = document.getElementById('filter')

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
  card.dataset.file = c.name + '.webm'

  const stage = document.createElement('div')
  stage.className = 'stage'
  stage.dataset.bg = 'checker'
  const video = document.createElement('video')
  video.muted = true
  video.loop = true
  video.playsInline = true
  // metadata 而不是 none：一打开就能看到每段的尺寸和时长，不用等它开播
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
  const name = document.createElement('div')
  name.className = 'name'
  name.textContent = c.name
  const sub = document.createElement('div')
  sub.className = 'sub'
  sub.textContent = (c.bytes / 1024).toFixed(0) + ' KB'
  meta.append(name, sub)

  // 名字里带「-」的按前缀归一组（点击回应 / 工作状态 / 碎碎念 / 余额），一眼能看出同一类的有几段
  const at = c.name.indexOf('-')
  if (at > 0) {
    const tag = document.createElement('span')
    tag.className = 'tag'
    tag.textContent = c.name.slice(0, at)
    meta.prepend(tag)
  }

  card.append(stage, meta)
  grid.append(card)
  io.observe(card)
}

function updateFilter() {
  const words = filterInput.value.trim().split(/\\s+/).filter(Boolean)
  let visible = 0
  for (const card of grid.children) {
    const hit = words.every((w) => card.dataset.name.includes(w))
    card.hidden = !hit
    if (hit) visible++
  }
  empty.classList.toggle('show', visible === 0)
  count.textContent = visible + ' / ' + clips.length
}
updateFilter()
filterInput.addEventListener('input', updateFilter)

document.getElementById('play-all').addEventListener('click', () =>
  document.querySelectorAll('video[src]').forEach((v) => v.play().catch(() => {})))
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
console.log(`抽出 ${clips.length} 段动画 → ${join(OUT, 'assets')}`)
console.log(`网页  → ${join(OUT, 'index.html')}`)
