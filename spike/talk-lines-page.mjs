/**
 * 台词表现状页（spike，产物只落 %TEMP%，不进仓库）。
 *
 * 三件事全部从代码派生，不手抄：
 *  ① 有哪些档、每档几条、每条 say/reply —— 读 dist/shared/talk.js
 *  ② 每档被谁调用、走不走冷却与概率 —— 扫 src/ 里的 pickTalk/sayFor/pickLine 调用点
 *  ③ 有没有"表里有但没人调用"的死档，和"配了动画但没有这一档"的反向缺口 —— 对着算
 *
 * 跑法：先 `npm run build`，再 `node spike/talk-lines-page.mjs`
 *      然后 start "%TEMP%\\pet-talk\\index.html"
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as talk from '../dist/shared/talk.js'
import * as anim from '../dist/shared/animation.js'
import * as cfg from '../dist/shared/config.js'
import { labelWidth } from '../dist/shared/text.js'

const OUT = join(tmpdir(), 'pet-talk')
mkdirSync(OUT, { recursive: true })
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ---- 扫调用点：谁在什么时候说这一档 ----
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(e)) out.push(p)
  }
  return out
}
const files = walk('src').filter((f) => !/shared[/\\](talk|animation)\.ts$/.test(f))

/**
 * reason → 调用点。三种情况分开判，因为「扫不到字面档名」不等于「没人调用」：
 * `maybeSayIdle` 这类会用三元算出 reason 再传进 pickTalk，字面扫描看不见。
 */
const calls = {}
const varSites = []
for (const f of files) {
  const text = readFileSync(f, 'utf8')
  const lines = text.split('\n')
  const rel = f.replace(/\\/g, '/')
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/(?:pickTalk|pickLine|sayFor)\(\s*'[a-z-]+'/g)) {
      const reason = m[0].match(/'([a-z-]+)'/)[1]
      const fn = m[0].includes('pickTalk') ? 'pickTalk' : m[0].includes('pickLine') ? 'pickLine' : 'sayFor'
      ;(calls[reason] ??= []).push({ fn, where: `${rel}:${i + 1}`, via: '字面' })
    }
    // 变量式：pickTalk(reason, ...) / sayFor(reason)
    if (/(?:pickTalk|pickLine|sayFor)\(\s*(?!')reason/.test(line)) {
      varSites.push({ file: rel, line: i + 1, text: line.trim() })
    }
  })
}

/**
 * 变量式调用所在的函数里出现了哪些字面档名 —— 用「从调用行往前找函数头、往后配平大括号」
 * 的粗窗口。只用来把档归到「经由变量到达」，不当成精确数据流。
 */
const VALID = new Set(Object.keys(talk.TALK_LINES))
for (const v of varSites) {
  const lines = readFileSync(v.file.replace(/\//g, '\\'), 'utf8').split('\n')
  let start = v.line - 1
  while (start > 0 && !/^\s{2}function\s/.test(lines[start])) start--
  let end = v.line - 1
  let depth = 0
  for (; end < lines.length; end++) {
    for (const ch of lines[end]) { if (ch === '{') depth++; else if (ch === '}') depth-- }
    if (depth <= 0 && end > v.line - 1) break
  }
  const body = lines.slice(start, end + 1).join('\n')
  const found = [...new Set([...body.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).filter((r) => VALID.has(r)))]
  const fnName = (lines[start] || '').match(/function\s+(\w+)/)?.[1] || '匿名'
  for (const r of found) {
    ;(calls[r] ??= []).push({ fn: '变量式', where: `${v.file}:${v.line}（在 ${fnName} 内）`, via: '变量' })
  }
}

const reasons = Object.keys(talk.TALK_LINES)
const selfSet = new Set(talk.SELF_TALK_REASONS)
// 调试专用的枚举：出现在这里不等于生产里会说
const debugFile = 'src/renderer/debug.ts'
const debugList = new Set()
if (files.map((f) => f.replace(/\\/g, '/')).includes(debugFile)) {
  const dt = readFileSync(debugFile, 'utf8')
  for (const m of dt.matchAll(/FIRES_REASONS[^\n]*\n?/g)) {
    for (const r of m[0].matchAll(/'([a-z-]+)'/g)) debugList.add(r[1])
  }
}

const rows = reasons.map((r) => {
  const list = talk.TALK_LINES[r]
  // 生产调用点：排除 debug.ts 里的字面命中，那是调试枚举不是触发
  const cs = (calls[r] || []).filter((c) => !c.where.startsWith('src/renderer/debug.ts'))
  const overSay = list.filter((l) => [...l.say].length > cfg.TALK_MAX_CHARS)
  const overReply = list.filter((l) => labelWidth(l.reply) > talk.REPLY_MAX_WIDTH)
  return {
    reason: r,
    n: list.length,
    self: selfSet.has(r),
    lines: list,
    overSay,
    overReply,
    clips: (anim.SPEECH[r] || []).map((c) => `${c.pool}·${c.name}`),
    calls: cs,
    wired: cs.length > 0,
    debugOnly: cs.length === 0 && debugList.has(r),
  }
})

/** 表外台词表：GREET_BY_HOUR 是上线问候真正读的那张，不在 TALK_LINES 里。 */
const hourBuckets = (talk.GREET_BY_HOUR || []).map(([h, list]) => ({ hour: h, n: list.length, sample: list[0]?.say || '' }))
const hourTotal = hourBuckets.reduce((a, b) => a + b.n, 0)

const totalLines = rows.reduce((a, r) => a + r.n, 0)
const selfLines = rows.filter((r) => r.self).reduce((a, r) => a + r.n, 0)
const unwired = rows.filter((r) => !r.wired && !r.debugOnly)
const debugOnly = rows.filter((r) => r.debugOnly)
const varOnly = rows.filter((r) => r.wired && r.calls.every((c) => c.via === '变量'))
const speechOnly = Object.keys(anim.SPEECH).filter((r) => !reasons.includes(r))
const badSay = rows.flatMap((r) => r.overSay.map((l) => `${r.reason}: ${l.say}`))
const badReply = rows.flatMap((r) => r.overReply.map((l) => `${r.reason}: ${l.reply}`))

// 皮肤侧能不能真播出来（SPEECH 配的片段在占位皮肤上取不到）
const pools = JSON.parse(readFileSync(join('skins', 'block', 'manifest.json'), 'utf8')).pools || {}
const clipMissing = Object.entries(anim.SPEECH).flatMap(([r, list]) =>
  (list || []).filter((c) => !(Array.isArray(pools[c.pool]) && pools[c.pool].includes(c.name)))
    .map((c) => ({ reason: r, ref: `${c.pool}·${c.name}` })))

const card = (label, value, tone = '') => `<div class="card ${tone}"><b>${value}</b><span>${label}</span></div>`

const reasonBlock = (r) => {
  const trigger = r.self
    ? `闲够 ${cfg.IDLE_LONG_MS / 1000}s + 掷中 ${cfg.TALK_IDLE_PROB} + 冷却 ${cfg.TALK_COOLDOWN_MS / 1000}s`
    : `事件必说，不掷概率；冷却 ${cfg.TALK_COOLDOWN_MS / 1000}s`
  const callTxt = r.calls.length
    ? r.calls.map((c) => `<code>${c.fn}</code> <a href="#">${esc(c.where)}</a>`).join('、')
    : '<span class="no">代码里没有任何调用点</span>'
  const tr = r.lines.map((l, i) =>
    `<tr><td>${i + 1}</td><td class="say">${esc(l.say)}</td><td>${[...l.say].length}</td>` +
    `<td>${esc(l.reply)}</td><td>${labelWidth(l.reply).toFixed(2)}</td></tr>`).join('')
  return `<section class="grp" data-r="${esc(r.reason)}">
  <h3><code>${esc(r.reason)}</code> <em>${r.n} 条</em>
    <span class="tag ${r.self ? 'self' : 'evt'}">${r.self ? '自己搭话' : '事件驱动'}</span>
    ${r.wired ? (r.calls.every((c) => c.via === '变量') ? '<span class="tag var">仅变量式到达</span>' : '') : r.debugOnly ? '<span class="tag var">只出现在调试清单</span>' : '<span class="tag dead">没扫到调用点</span>'}</h3>
  <div class="meta">
    <div><b>触发</b>${trigger}</div>
    <div><b>调用点</b>${callTxt}</div>
    <div><b>配动画</b>${r.clips.length ? r.clips.map((c) => `<code>${esc(c)}</code>`).join(' ') : '—'}</div>
  </div>
  <table><tr><th>#</th><th>台词</th><th>字</th><th>回应按钮</th><th>按钮宽</th></tr>${tr}</table>
</section>`
}

const html = `<!doctype html><meta charset="utf-8"><title>台词表现状</title>
<style>
  body{margin:0;padding:0 0 50px;background:#f4f6f8;font:14px/1.6 "Microsoft YaHei UI",sans-serif;color:#222}
  .wrap{max-width:1080px;margin:0 auto;padding:0 22px}
  h1{font-size:24px;margin:22px 0 2px}
  h2{font-size:18px;margin:26px 0 8px;padding-bottom:5px;border-bottom:2px solid #d6dbe1}
  h3{font-size:15px;margin:0 0 6px;display:flex;align-items:center;gap:9px}
  h3 em{font-style:normal;color:#5b6773;font-size:12.5px;font-weight:400}
  .sub{color:#5b6773;margin:0 0 12px;font-size:13px}
  .cards{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0 6px}
  .card{background:#fff;border:1px solid #d6dbe1;border-radius:10px;padding:9px 14px;min-width:118px}
  .card b{display:block;font-size:21px;line-height:1.2}
  .card span{font-size:12px;color:#5b6773}
  .card.warn b{color:#b3261e}
  .grp{background:#fff;border:1px solid #d6dbe1;border-radius:10px;padding:12px 16px;margin:10px 0}
  .tag{font-size:11px;border-radius:4px;padding:1px 7px;font-weight:600}
  .tag.self{background:#e6f0fb;color:#2b5c9a}.tag.evt{background:#eaf6ee;color:#1a7f4b}
  .tag.dead{background:#fdeceb;color:#b3261e}
  .tag.var{background:#fdf4e3;color:#8a5a12}
  .meta{font-size:12.5px;color:#3c4650;margin:2px 0 8px;display:grid;gap:2px}
  .meta b{color:#8b96a1;font-weight:600;margin-right:7px}
  table{border-collapse:collapse;width:100%;font-size:12.5px}
  th{background:#f2f5f8;text-align:left;padding:4px 7px;border:1px solid #e3e8ed;font-weight:600}
  td{padding:4px 7px;border:1px solid #eaeef2;vertical-align:top}
  td.say{font-size:13.5px}
  tr:nth-child(even) td{background:#fafbfc}
  code{font:12px Consolas,monospace;color:#2b4a75}
  a{color:#2f6fd0;text-decoration:none;font-size:11.5px}
  .no{color:#b3261e;font-weight:600}
  .flag{background:#fff5f4;border:1px solid #e9b7b2;border-radius:9px;padding:10px 14px;margin:10px 0;font-size:13px;color:#8a2820}
  .ok{background:#eef8f1;border-color:#bfe0cb;color:#1a6b40}
  .filter{margin:10px 0}
  .filter input{border:1px solid #c7ced6;border-radius:6px;padding:6px 11px;font:inherit;width:300px}
  .toc{font-size:12.5px;margin:8px 0 0;color:#5b6773}
  .toc a{margin-right:11px}
</style>
<div class="wrap">
<h1>台词表现状</h1>
<p class="sub">由 <code>spike/talk-lines-page.mjs</code> 从 <code>dist/shared/talk.js</code> 与 <code>src/</code> 调用点现读生成，不手抄。</p>
<div class="cards">
  ${card('台词档数', reasons.length)}
  ${card('台词条数', totalLines)}
  ${card('自己搭话', `${selfLines} 条 / ${Math.round((selfLines / totalLines) * 100)}%`)}
  ${card('配了动画的档', Object.keys(anim.SPEECH).length)}
  ${card('没扫到调用点', unwired.length, unwired.length ? 'warn' : '')}
  ${card('仅调试清单', debugOnly.length, debugOnly.length ? 'warn' : '')}
  ${card('仅变量到达', varOnly.length)}
  ${card('表外问候条数', hourTotal)}
  ${card('超字数的台词', badSay.length, badSay.length ? 'warn' : '')}
  ${card('超宽的按钮', badReply.length, badReply.length ? 'warn' : '')}
</div>

${unwired.length ? `<div class="flag"><b>这些档没扫到任何调用点（字面、变量、调试清单都没有）：</b>` +
  unwired.map((r) => `<code>${esc(r.reason)}</code>（${r.n} 条）`).join('、') +
  ` —— 可能是真没人说，也可能是我的粗窗口没覆盖到某种写法，进 src/ 确认一下再决定删不删。</div>` : ''}
${debugOnly.length ? `<div class="flag"><b>只在 <code>src/renderer/debug.ts</code> 的调试枚举里出现，生产里没有触发点：</b>` +
  debugOnly.map((r) => `<code>${esc(r.reason)}</code>（${r.n} 条）`).join('、') +
  `。注意 <code>greet</code> 这一档：上线问候实际读的是 <b>GREET_BY_HOUR</b> 那张表（见下方「表外台词表」），` +
  `所以「上线说问候」这个功能是通的，但 <code>TALK_LINES.greet</code> 里的 ${talk.TALK_LINES.greet?.length || 0} 条不会被取到。</div>` : ''}
${varOnly.length ? `<div class="flag"><b>只经由变量到达（没有字面档名）：</b>` +
  varOnly.map((r) => `<code>${esc(r.reason)}</code>`).join('、') +
  ` —— 判据来自调用行所在函数里出现的字面档名，是粗窗口不是精确数据流。</div>` : ''}
${speechOnly.length ? `<div class="flag"><b>反向缺口：animation.ts 的 SPEECH 配了动画，但 talk.ts 没有这一档：</b>` +
  speechOnly.map((r) => `<code>${esc(r)}</code>`).join('、') + `</div>` : ''}
${clipMissing.length ? `<div class="flag"><b>占位皮肤（block）播不出来的说话动画 ${clipMissing.length} 条：</b>` +
  clipMissing.map((c) => `<code>${esc(c.reason)}→${esc(c.ref)}</code>`).join('、') +
  ` —— 台词照说，画面回落到池选。</div>` : ''}
${badSay.length || badReply.length ? `<div class="flag"><b>超上限的内容：</b>` +
  [...badSay, ...badReply].map((s) => `<code>${esc(s)}</code>`).join('、') + `</div>` :
  `<div class="flag ok">全部 ${totalLines} 条都过上限：台词 ≤${cfg.TALK_MAX_CHARS} 码点，回应按钮 labelWidth ≤${talk.REPLY_MAX_WIDTH}。</div>`}

<h2>按档全表</h2>
<div class="filter"><input id="q" placeholder="过滤：档名或台词文字，如 hungry / 泡泡 / 饿"></div>
<div class="toc">${rows.map((r) => `<a href="#" data-jump="${esc(r.reason)}">${esc(r.reason)}(${r.n})</a>`).join('')}</div>
${rows.map(reasonBlock).join('\n')}

<h2>表外台词表：GREET_BY_HOUR（上线问候真正读的那张）</h2>
<p class="sub">按当前小时取「已到点」的最后一档。它不在 <code>TALK_LINES</code> 里，所以「按档统计」算不到它——这也是 <code>greet</code> 那一档看着像死数据的原因。</p>
<table><tr><th>从几点起</th><th>条数</th><th>该档第一句</th></tr>
${hourBuckets.map((b) => `<tr><td>${b.hour}:00</td><td>${b.n}</td><td class="say">${esc(b.sample)}</td></tr>`).join('')}
<tr><td><b>合计</b></td><td><b>${hourTotal}</b></td><td>${talk.greetLineForHour ? '取句函数 <code>greetLineForHour(hour, rng)</code> 已导出' : '未导出'}</td></tr></table>

<h2>口径</h2>
<table><tr><th>项</th><th>值</th><th>意思</th></tr>
<tr><td>自己搭话</td><td>${talk.SELF_TALK_REASONS.map((r) => `<code>${esc(r)}</code>`).join(' ')}</td>
<td>要同时满足：久无人理满 ${cfg.IDLE_LONG_MS / 1000}s、掷中 ${cfg.TALK_IDLE_PROB} 概率、过 ${cfg.TALK_COOLDOWN_MS / 1000}s 冷却</td></tr>
<tr><td>事件驱动</td><td>其余 ${reasons.length - talk.SELF_TALK_REASONS.length} 档</td><td>用户做了动作就必说，不掷概率，但仍受冷却</td></tr>
<tr><td>绕开冷却</td><td>走 <code>pickLine</code> 的调用点</td><td>低频高价值（跨级、每日首开、退出）该盖掉前一句，不该被冷却吞掉</td></tr>
<tr><td>台词上限</td><td>${cfg.TALK_MAX_CHARS} 码点</td><td>气泡文字区实测 120×74，13px 一行约 9 字、放 3 行</td></tr>
<tr><td>按钮上限</td><td>labelWidth ≤${talk.REPLY_MAX_WIDTH}</td><td>按钮宽 80px ÷ 12px 字号 ≈ 5 个汉字；汉字记 1、拉丁记 0.55</td></tr>
<tr><td>气泡停留</td><td>${cfg.BUBBLE_SHOW_MS} ms</td><td>光标还在气泡上会续命</td></tr>
</table>
</div>
<script>
var q=document.getElementById('q');
q.addEventListener('input',function(){
  var v=this.value.trim().toLowerCase();
  document.querySelectorAll('.grp').forEach(function(g){
    var hit=v===''||g.getAttribute('data-r').indexOf(v)>=0||g.textContent.toLowerCase().indexOf(v)>=0;
    g.style.display=hit?'':'none'});
});
document.querySelectorAll('[data-jump]').forEach(function(a){
  a.addEventListener('click',function(e){e.preventDefault();
    var g=document.querySelector('.grp[data-r="'+a.getAttribute('data-jump')+'"]');
    if(g){q.value='';q.dispatchEvent(new Event('input'));g.scrollIntoView({block:'start'});
      g.style.outline='2px solid #2f6fd0';setTimeout(function(){g.style.outline=''},1200)}});
});
</script>
`

writeFileSync(join(OUT, 'index.html'), html, 'utf8')
console.log(`档 ${reasons.length} / 条 ${totalLines}（自己搭话 ${selfLines}，${Math.round((selfLines / totalLines) * 100)}%）；表外 GREET_BY_HOUR ${hourTotal} 条`)
console.log(`没扫到调用点：${unwired.length ? unwired.map((r) => `${r.reason}(${r.n})`).join('、') : '无'}`)
console.log(`仅调试清单：${debugOnly.length ? debugOnly.map((r) => `${r.reason}(${r.n})`).join('、') : '无'}`)
console.log(`仅变量到达：${varOnly.length ? varOnly.map((r) => r.reason).join('、') : '无'}`)
console.log(`超字数 ${badSay.length}、超宽 ${badReply.length}；占位皮肤播不出的说话动画 ${clipMissing.length} 条`)
console.log(`变量式调用点 ${varSites.length} 处：${varSites.map((v) => `${v.file}:${v.line}`).join(', ') || '无'}`)
console.log(`→ ${join(OUT, 'index.html')}`)
