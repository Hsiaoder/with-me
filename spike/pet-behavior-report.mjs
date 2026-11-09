/**
 * 宠物行为总报告（spike，产物只落 %TEMP%，不进仓库）。
 *
 * 数据一律从 dist/shared 的编译产物现读，不手抄：状态、动画集合、台词表、阈值、
 * 食物与游戏清单、以及「当前皮肤到底有没有这些片段」全部由代码算出来。
 * 这样改了 animation.ts / talk.ts / stats.ts 之后重跑一次，报告不会和代码对不上。
 *
 * 跑法：先 `npm run build`，再 `node spike/pet-behavior-report.mjs`
 *      然后 start "%TEMP%\\pet-behavior\\index.html"
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as anim from '../dist/shared/animation.js'
import * as talk from '../dist/shared/talk.js'
import * as cfg from '../dist/shared/config.js'
import * as stats from '../dist/shared/stats.js'
import * as games from '../dist/shared/games.js'
import * as foods from '../dist/shared/food.js'
import { labelWidth } from '../dist/shared/text.js'

const OUT = join(tmpdir(), 'pet-behavior')
mkdirSync(OUT, { recursive: true })

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ---- 皮肤素材覆盖：报告里所有「会静默回落」的判据都来自这里 ----
const skins = readdirSync('skins').filter((s) => existsSync(join('skins', s, 'manifest.json')))
const poolOf = (skin) => {
  const m = JSON.parse(readFileSync(join('skins', skin, 'manifest.json'), 'utf8'))
  return m.pools || {}
}

/** 具名片段在某个皮肤里取得到吗（animation.ts 的按名播放路）。 */
const has = (pools, ref) => Array.isArray(pools[ref.pool]) && pools[ref.pool].includes(ref.name)

const interactClips = [
  { label: `连点 ≥${anim.CLICK_STREAK_MIN} 次`, ref: { pool: 'guess', name: 'ticklish' } },
  { label: '刚播犯困片又被点', ref: { pool: 'daily', name: 'dozewake' } },
]

const speechClips = Object.entries(anim.SPEECH).flatMap(([, list]) => list || [])
const allNamed = [...anim.ALL_CLIPS, ...speechClips.filter((c) => !anim.ALL_CLIPS.some((a) => a.pool === c.pool && a.name === c.name))]

// ---- 台词：条数、字数、按钮宽度、是否配动画 ----
const reasons = Object.keys(talk.TALK_LINES)
const lineRows = reasons.flatMap((r) =>
  talk.TALK_LINES[r].map((l, i) => ({
    reason: r,
    idx: i + 1,
    say: l.say,
    chars: [...l.say].length,
    reply: l.reply,
    w: labelWidth(l.reply),
    self: talk.SELF_TALK_REASONS.includes(r),
    hasClip: !!anim.SPEECH[r] && (anim.SPEECH[r]?.length || 0) > 0,
  })),
)
const totalLines = lineRows.length
const selfLines = lineRows.filter((l) => l.self).length
const overChars = lineRows.filter((l) => l.chars > cfg.TALK_MAX_CHARS)
const overReply = lineRows.filter((l) => l.reply.length && l.w > talk.REPLY_MAX_WIDTH)

// ---- HTML ----
const badge = (ok, yes, no) => `<span class="${ok ? 'ok' : 'no'}">${ok ? yes : no}</span>`

const clipTable = (title, list) => {
  if (!list.length) return ''
  const head = `<tr><th>片段</th><th>池</th>${skins.map((s) => `<th>${esc(s)}</th>`).join('')}</tr>`
  const rows = list.map((c) => {
    const ref = c.ref || c
    const cells = skins.map((s) => `<td>${badge(has(poolOf(s), ref), '有', '缺')}</td>`).join('')
    return `<tr><td><code>${esc(ref.name)}</code>${c.label ? `<span class="why">${esc(c.label)}</span>` : ''}</td><td>${esc(ref.pool)}</td>${cells}</tr>`
  }).join('')
  return `<h4>${esc(title)}</h4><table class="grid">${head}${rows}</table>`
}

const talkTable = () => {
  const head = `<tr><th>档</th><th>#</th><th>台词</th><th>字</th><th>回应按钮</th><th>按钮宽</th><th>触发</th><th>配动画</th></tr>`
  const rows = lineRows
    .map(
      (l) =>
        `<tr data-r="${esc(l.reason)}"><td><code>${esc(l.reason)}</code></td><td>${l.idx}</td><td>${esc(l.say)}</td>` +
        `<td class="${l.chars > cfg.TALK_MAX_CHARS ? 'bad' : ''}">${l.chars}</td><td>${esc(l.reply)}</td>` +
        `<td class="${l.w > talk.REPLY_MAX_WIDTH ? 'bad' : ''}">${l.w.toFixed(2)}</td>` +
        `<td>${l.self ? '闲够+概率' : '事件必说'}</td><td>${l.hasClip ? '是' : '—'}</td></tr>`,
    )
    .join('')
  return `<table class="grid" id="talk">${head}${rows}</table>`
}

const condTable = () => {
  const pools = poolOf(skins[0] || 'block')
  const rows = [
    ['数值低到讨食', `hunger < ${stats.HUNGRY_BELOW}`, 'whateat / turn·look', 'hungry', '闲够 20s + 概率 + 冷却 25s'],
    ['数值低到蔫着', `mood < ${stats.BLUE_BELOW}`, 'tailslap；说话配 squat/siesta/stretch', 'blue', '同上'],
    ['心情高', `mood > ${stats.BAND_HIGH_ABOVE}`, 'MOOD_HIGH 舞动 4 条', '—', '交出决策权那一拍优先'],
    ['久无人理', `idleMs > ${cfg.IDLE_LONG_MS}ms`, 'SLEEPY 权重 1→3', '—', '规则层交出决策权'],
    ['深夜还在用', '过凌晨 5 点且 idleMs < 60s', 'yawn', '—', '优先级第 3'],
    ['连点', `streak ≥ ${anim.CLICK_STREAK_MIN}`, 'guess·ticklish', '—', '交互事件'],
    ['犯困时被点', 'lastWasSleepy', 'daily·dozewake', '—', '交互事件'],
    ['跨级', '前后快照 Lv 变化', 'guess·bluewhale', 'levelup', '绕开冷却（pickLine）'],
    ['每日首开 / 启动', '当天第一次', '迎接系 5 条', 'greet', '绕开冷却'],
    ['退出', '关窗前', 'daily·curtsy', 'bye', '绕开冷却'],
    ['食物按等级解锁', 'level ≥ unlock.level', '—', 'unlock', '走冷却'],
    ['点回应按钮', 'onReply 回调', '—', 'thanks', '走冷却'],
    ['喂食那一口', '点食物', '食物表具名吃相（eat 池）', 'feed', '事件必说，不配 SPEECH 动画'],
    ['拖起来', `位移 > ${cfg.DRAG_START_PX}px`, 'drag 池', '—', '规则层 drag 态'],
    ['点身体', '按下未达拖拽阈值', 'click 池', '—', '规则层 respond 态'],
    ['小游戏开局', '选某个游戏', 'GAME_INTRO 入口片一次', 'game', '事件必说'],
    ['面板「说话」按钮', '调试用', 'click 池', '按顺序逐条', '绕开冷却与概率'],
  ]
  return `<table class="grid"><tr><th>条件</th><th>阈值</th><th>动画</th><th>台词档</th><th>走不走冷却/概率</th></tr>` +
    rows.map((r) => `<tr><td>${esc(r[0])}</td><td><code>${esc(r[1])}</code></td><td>${esc(r[2])}</td><td>${r[3] === '—' ? '—' : `<code>${esc(r[3])}</code>`}</td><td>${esc(r[4])}</td></tr>`).join('') +
    `</table><p class="note">「动画」列的具名片段是否真播得出来，看下面 §素材覆盖；当前皮肤没有的那条会静默回落到池选。</p>`
}

const constTable = () => {
  const rows = [
    ['IDLE_LONG_MS', cfg.IDLE_LONG_MS, '久无人理满这么久，规则层交出决策权'],
    ['TALK_COOLDOWN_MS', cfg.TALK_COOLDOWN_MS, '距上次说话不足这么久就不再插一句'],
    ['TALK_IDLE_PROB', cfg.TALK_IDLE_PROB, '自己搭话那一拍开口的概率'],
    ['TALK_MAX_CHARS', cfg.TALK_MAX_CHARS, '台词码点上限，超了 clamp() 截断'],
    ['REPLY_MAX_WIDTH', talk.REPLY_MAX_WIDTH, '回应按钮的宽度上限（汉字宽）'],
    ['BUBBLE_SHOW_MS', cfg.BUBBLE_SHOW_MS, '气泡默认停留'],
    ['LEASE_TIMEOUT_MS', cfg.LEASE_TIMEOUT_MS, '不续期就恢复点击穿透'],
    ['GRAB_HEARTBEAT_MS', cfg.GRAB_HEARTBEAT_MS, '接住鼠标的续期心跳'],
    ['DRAG_START_PX', cfg.DRAG_START_PX, '按下走够这么多像素才算拖起来'],
    ['CLICK_STREAK_MIN', anim.CLICK_STREAK_MIN, '连点到这个数判定为连续点击'],
    ['STAT_MAX', stats.STAT_MAX, '数值满值'],
    ['STAT_TICK_MS', stats.STAT_TICK_MS, '数值衰减节拍'],
    ['LONELY_AFTER_MS', stats.LONELY_AFTER_MS, '独自待够这么久开始掉心情'],
    ['MOOD_LONELY_PER_MIN', stats.MOOD_LONELY_PER_MIN, '孤独时每分钟掉多少心情'],
    ['OFFLINE_RATE', stats.OFFLINE_RATE, '离线期间的衰减折算倍率'],
    ['OFFLINE_MAX_LOSS', stats.OFFLINE_MAX_LOSS, '离线补算的掉值上限'],
    ['DIMINISH_WINDOW_MS', stats.DIMINISH_WINDOW_MS, '连续喂食的边际递减窗口'],
    ['DIMINISH_MULT', stats.DIMINISH_MULT, '窗口内的效果倍率'],
    ['FEED_MOOD_HUNGRY_BONUS', stats.FEED_MOOD_HUNGRY_BONUS, '饿着喂到的心情加成'],
    ['HUNGRY_BELOW / FULL_ABOVE / STARVING_BELOW', `${stats.HUNGRY_BELOW} / ${stats.FULL_ABOVE} / ${stats.STARVING_BELOW}`, '饥饿三档边界'],
    ['BLUE_BELOW / CHEER_ABOVE / CHUBBY_ABOVE', `${stats.BLUE_BELOW} / ${stats.CHEER_ABOVE} / ${stats.CHUBBY_ABOVE}`, '心情与体重的分档边界'],
    ['BAND_HIGH_ABOVE', stats.BAND_HIGH_ABOVE, '读数条「高」档的门槛（动画优先级 1 用它）'],
  ]
  return `<table class="grid"><tr><th>常量</th><th>值</th><th>意思</th></tr>` +
    rows.map((r) => `<tr><td><code>${esc(r[0])}</code></td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('') + `</table>`
}

const listTable = (head, rows) =>
  `<table class="grid"><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>` +
  rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') + '</table>'

const gameRows = (games.GAMES || []).map((g) => [
  `<code>${esc(g.id)}</code>`, esc(g.name), esc(g.desc || ''),
  `入口片 <code>${esc(anim.GAME_INTRO[g.id]?.name || '—')}</code>（池 ${esc(anim.GAME_INTRO[g.id]?.pool || '—')}）`,
])

const foodRows = (foods.FOODS || []).map((f) => {
  const u = f.unlock || {}
  return [
    esc(f.name), `<code>${esc(f.id)}</code>`,
    f.anim ? `吃相 <code>${esc(f.anim.name)}</code>` : '—',
    u.kind === 'start' ? '开局可用' : u.kind === 'level' ? `Lv.${u.level} 解锁` : esc(u.kind || '—'),
  ]
})

const coverage = () => {
  const per = skins.map((s) => {
    const p = poolOf(s)
    const miss = allNamed.filter((c) => !has(p, c))
    return { skin: s, pools: Object.keys(p), total: allNamed.length, miss }
  })
  const rows = per.map((x) => `<tr><td><code>${esc(x.skin)}</code></td><td>${esc(x.pools.join(', '))}</td>` +
    `<td>${x.total - x.miss.length} / ${x.total}</td><td>${x.miss.length ? badge(false, '', `${x.miss.length} 条取不到`) : badge(true, '全覆盖', '')}</td></tr>`).join('')
  const detail = per.map((x) => x.miss.length
    ? `<h4>${esc(x.skin)} 皮肤缺的具名片段（会静默回落）</h4><div class="chips">` +
      x.miss.map((c) => `<span class="chip">${esc(c.pool)}·${esc(c.name)}</span>`).join('') + '</div>'
    : '').join('')
  return `<table class="grid"><tr><th>皮肤</th><th>它有的池</th><th>具名片段命中</th><th>结论</th></tr>${rows}</table>${detail}`
}

const statSection = () => {
  const rows = stats.STAT_KEYS.map((k) => {
    const decay = stats.DECAY_PER_MIN[k]
    return [
      `<b>${esc(stats.STAT_LABELS[k])}</b> <code>${esc(k)}</code>`,
      String(stats.INITIAL_STATS[k]),
      decay === 0 ? '不随时间变' : `−${decay}/分钟`,
      `${stats.STAT_MAX}`,
      {
        hunger: '喂食（各食物不同）；游戏往下拉；抛掷往下拉',
        mood: '喂食、逗玩 +8、游戏、回应 +2；孤独时掉更快',
        weight: '喂食往上；逗玩与游戏往下；离线不掉',
        bond: '逗玩、游戏、回应、每天第一次开面板',
      }[k],
      {
        hunger: `低于 ${stats.HUNGRY_BELOW} 走 hungry 台词；低于 ${stats.STARVING_BELOW} 算饿过头`,
        mood: `低于 ${stats.BLUE_BELOW} 走 blue 台词 + 甩尾；高于 ${stats.BAND_HIGH_ABOVE} 播舞动`,
        weight: `高于 ${stats.CHUBBY_ABOVE} 判定偏胖`,
        bond: '长期陪伴账，不直接触发台词',
      }[k],
    ]
  })
  const gate = `<table class="grid"><tr><th>闸</th><th>值</th><th>作用</th></tr>` + [
    ['同类动作递减窗口', `${stats.DIMINISH_WINDOW_MS / 60000} 分钟`, `窗口内再做收益 ×${stats.DIMINISH_MULT}。所有食物共用一条闸`],
    ['吃撑了不再涨饱食', `hunger > ${stats.FULL_ABOVE}`, '饥饿增量直接给 0（比减半更硬），体重照涨'],
    ['饿着喂的加成', `hunger < ${stats.HUNGRY_BELOW} 时心情 +${stats.FEED_MOOD_HUNGRY_BONUS}`, '叠在该食物自己的心情上'],
    ['孤独加速掉心情', `无人理 > ${stats.LONELY_AFTER_MS / 60000} 分钟`, `心情速率从 ${stats.DECAY_PER_MIN.mood} 抬到 ${stats.MOOD_LONELY_PER_MIN}/分钟`],
    ['离线折算', `×${stats.OFFLINE_RATE}`, '关机/休眠按在线速率三成补算'],
    ['离线掉值上限', `每条最多 −${stats.OFFLINE_MAX_LOSS}`, '让「关电脑」不变成惩罚'],
    ['离线不动的项', '体重、孤独加速、经验', '睡觉不会瘦；也没人冷落它；关掉应用不涨等级'],
    ['每天第一次开面板', `间隔 > ${stats.DAILY_OPEN_GAP_MS / 3600000} 小时`, '给亲密 +0.2、经验 +2；时刻**入库**（其余动作的时刻只在内存）'],
    ['游戏按次结算封顶', `count 夹在 [1, ${stats.GAME_COUNT_CAP}]`, '连对十几下不会一次把饱食抽干'],
  ].map((r) => `<tr><td>${esc(r[0])}</td><td><code>${esc(r[1])}</code></td><td>${esc(r[2])}</td></tr>`).join('') + '</table>'

  const act = `<table class="grid"><tr><th>动作</th><th>饥饿</th><th>心情</th><th>体重</th><th>亲密</th><th>经验</th></tr>` + [
    ['逗玩 play', '—', `+${stats.PLAY_MOOD}`, `−${stats.PLAY_WEIGHT_COST}`, `+${stats.PLAY_BOND}`, `+${stats.EXP_GAIN.play}`],
    ['游戏 game ×n', `−${stats.GAME_HUNGER_COST}×n`, `+${stats.GAME_MOOD}×n`, `−${stats.GAME_WEIGHT_COST}×n`, `+${stats.GAME_BOND}×n`, `+${stats.EXP_GAIN.game}×n`],
    ['回应按钮 reply', '—', `+${stats.REPLY_MOOD}`, '—', `+${stats.REPLY_BOND}`, `+${stats.EXP_GAIN.reply}`],
    ['每天首开 daily-open', '—', '—', '—', `+${stats.DAILY_OPEN_BOND}`, `+${stats.EXP_GAIN['daily-open']}`],
    ['在线挂机每分钟', `−${stats.DECAY_PER_MIN.hunger}`, `−${stats.DECAY_PER_MIN.mood}`, '—', `−${stats.DECAY_PER_MIN.bond.toFixed(4)}`, `+${stats.IDLE_EXP_PER_MIN}`],
  ].map((r) => `<tr><td><b>${esc(r[0])}</b></td>${r.slice(1).map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') + '</table>'

  const food = `<table class="grid"><tr><th>食物</th><th>饥饿</th><th>心情</th><th>体重</th></tr>` +
    Object.entries(stats.FOOD_EFFECT).map(([id, f]) => {
      const fd = (foods.FOODS || []).find((x) => x.id === id)
      const u = fd?.unlock
      const tag = !fd ? '<span class="bad">食物表里没这条</span>'
        : u?.kind === 'level' ? `<span class="why">Lv.${u.level} 解锁</span>` : '<span class="why">开局可用</span>'
      return `<tr><td><code>${esc(id)}</code>${tag}</td><td>+${f.hunger}</td><td>+${f.mood}</td><td>+${f.weight}</td></tr>`
    }).join('') + '</table>'

  const curve = `<table class="grid"><tr><th>段位</th><th>本级要攒</th><th>累计经验</th></tr>` +
    [[1, 2], [2, 3], [10, 11], [30, 31], [59, 60]].map(([n]) =>
      `<tr><td>Lv.${n} → Lv.${n + 1}</td><td>${stats.LEVEL_STEPS[n - 1]}</td><td>${stats.LEVEL_CUM[n]}</td></tr>`).join('') +
    `<tr><td><b>满级累计</b></td><td colspan="2"><b>${stats.LEVEL_CUM[stats.LEVEL_CUM.length - 1]}</b>（${stats.MAX_LEVEL} 级，${stats.LEVEL_STEPS.length} 段）</td></tr></table>` +
    `<p class="note">在线 10 小时 = 600 分钟 × ${stats.IDLE_EXP_PER_MIN} = 120 经验/天，加互动约 50 → 约 170/天，${stats.LEVEL_CUM[stats.LEVEL_CUM.length - 1]} 约 27 天走完。等级<b>不入库</b>，从经验现算；经验只增不减，所以冷落几天亲密条会掉、等级不会退。</p>`

  const float = `<table class="grid"><tr><th>规则</th><th>为什么</th></tr>` + [
    ['只有涨的飘出来', '自然衰减每分钟都在动，跟着飘就是刷屏'],
    ['一次明确动作可以带负号', '小游戏落地时饱食/体重是往下掉的，那得让用户看见'],
    ['经验不飘', '0.2/0.3 的小碎步会把要紧的那两条挤走'],
    ['四舍五入成 0 的不飘', '+0.0 比不飘更怪'],
  ].map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join('') + '</table>'

  return [
    '<h3>四条数值的账</h3>',
    listTable(['数值', '起始', '每分钟自然变化', '满值', '谁能抬它', '低了/高了演什么'], rows),
    '<h3>动作直接给的增减</h3>', act,
    '<h3>九道闸（这些条件会改写上面的增减）</h3>', gate,
    '<h3>每种食物的效果</h3>', food,
    '<h3>等级曲线</h3>', curve,
    '<h3>飘字规则</h3>', float,
    `<p class="note">时钟在<b>主进程</b>：每 ${stats.STAT_TICK_MS / 1000} 秒结算一次，渲染层只上报动作、只订阅快照，不参与算。离线补算在开机时按 <code>lastSeenAt</code> 做一次。</p>`,
  ].join('\n')
}

const html = `<!doctype html><meta charset="utf-8"><title>宠物行为总报告</title>
<style>
  body{margin:0;padding:0 0 40px;background:#f4f6f8;font:14px/1.6 "Microsoft YaHei UI",sans-serif;color:#222}
  .wrap{max-width:1180px;margin:0 auto;padding:0 22px}
  h1{font-size:24px;margin:22px 0 2px}
  h2{font-size:18px;margin:30px 0 6px;padding-bottom:5px;border-bottom:2px solid #d6dbe1}
  h4{font-size:14px;margin:16px 0 4px;color:#3c4650}
  .sub{color:#5b6773;margin:0 0 14px;font-size:13px}
  .note{color:#5b6773;font-size:12.5px;margin:6px 0 0}
  .cards{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0 4px}
  .card{background:#fff;border:1px solid #d6dbe1;border-radius:10px;padding:10px 14px;min-width:130px}
  .card b{display:block;font-size:22px;line-height:1.2}
  .card span{font-size:12px;color:#5b6773}
  table.grid{border-collapse:collapse;width:100%;background:#fff;font-size:12.5px;margin:4px 0 8px}
  table.grid th{background:#eef1f4;text-align:left;padding:6px 8px;border:1px solid #dfe4e9;font-weight:600}
  table.grid td{padding:5px 8px;border:1px solid #e7ebef;vertical-align:top}
  table.grid tr:nth-child(even) td{background:#fafbfc}
  code{font:12px/1.4 Consolas,monospace;color:#2b4a75}
  .ok{color:#1a7f4b;font-weight:600}.no{color:#b3261e;font-weight:600}
  .bad{color:#b3261e;font-weight:700}
  .why{display:block;color:#8b96a1;font-size:11px}
  .chips{display:flex;flex-wrap:wrap;gap:5px;margin:4px 0 10px}
  .chip{background:#fff;border:1px solid #e3b7b2;color:#8a2820;border-radius:5px;padding:1px 7px;font:11.5px Consolas,monospace}
  .toc{background:#fff;border:1px solid #d6dbe1;border-radius:10px;padding:10px 16px;margin:14px 0;font-size:13px}
  .toc a{color:#2f6fd0;text-decoration:none;margin-right:16px}
  .flag{background:#fff5f4;border:1px solid #e9b7b2;border-radius:8px;padding:9px 13px;margin:10px 0;font-size:13px;color:#8a2820}
  .filter{margin:8px 0}
  .filter input{border:1px solid #c7ced6;border-radius:6px;padding:5px 10px;font:inherit;width:260px}
</style>
<div class="wrap">
<h1>宠物行为总报告 · 状态 / 动画 / 台词 / 条件</h1>
<p class="sub">数据由 <code>spike/pet-behavior-report.mjs</code> 从 <code>dist/shared/*.js</code> 现读生成，不手抄。改了 animation / talk / stats / food / games 之后重跑一次即可对齐。</p>
<div class="cards">
  <div class="card"><b>${reasons.length}</b><span>台词档数</span></div>
  <div class="card"><b>${totalLines}</b><span>台词条数</span></div>
  <div class="card"><b>${allNamed.length}</b><span>具名动画片段</span></div>
  <div class="card"><b>${selfLines}</b><span>自己搭话的条数</span></div>
  <div class="card"><b>${Math.round((selfLines / totalLines) * 100)}%</b><span>占台词表比例</span></div>
  <div class="card"><b>${(games.GAMES || []).length}</b><span>小游戏</span></div>
  <div class="card"><b>${(foods.FOODS || []).length}</b><span>食物</span></div>
</div>
<div class="toc">
  <a href="#s1">1 状态三层</a><a href="#s2">2 条件触发总表</a><a href="#s3">3 动画全集</a>
  <a href="#s4">4 台词全表</a><a href="#s5">5 小游戏与食物</a><a href="#s6">6 常量</a><a href="#s7">7 素材覆盖</a><a href="#s8">8 数值账</a>
</div>

<h2 id="s1">1 状态其实是三层</h2>
${listTable(['层', '状态 / 取值', '说明'], [
  ['规则层', '<code>active</code> / <code>respond</code> / <code>drag</code>', '只决定「这一拍进哪个池」。反应动画播完那一拍只归位不自主活动'],
  ['数值层', `<code>hunger</code> <code>mood</code> <code>weight</code> <code>bond</code>，起始 ${JSON.stringify(stats.INITIAL_STATS)}`, '每 ' + (stats.STAT_TICK_MS / 1000) + ' 秒衰减一次；决定说哪一档话、以及动画优先级'],
  ['情境层', '<code>mood</code> <code>idleMs</code> <code>lateNightWorking</code> <code>lastWasSleepy</code> <code>clickStreak</code>', '交出决策权那一拍按它挑具名片段，优先级：心情高 &gt; 心情低 &gt; 深夜 &gt; 加权挂机'],
])}
<p class="note">决策顺序：规则层给池 → 给的是哨兵 <code>*</code>（交出决策权）时，才由情境层选具名日常片段 → 皮肤里没有这条就回落到池选，不会卡在同一条上。</p>

<h2 id="s2">2 条件触发总表</h2>
${condTable()}

<h2 id="s3">3 动画全集（按集合）</h2>
${clipTable('AMBIENT 常驻随机', anim.AMBIENT)}
${clipTable('SLEEPY 犯困（久无人理时权重 1→3）', anim.SLEEPY)}
${clipTable('MOOD_HIGH 心情高舞动', anim.MOOD_HIGH)}
${clipTable('MOOD_LOW 心情低', anim.MOOD_LOW)}
${clipTable('LATE_NIGHT 深夜', anim.LATE_NIGHT)}
${clipTable('交互特例', interactClips)}
${clipTable('跨级 / 游戏入口', [{ ref: anim.LEVELUP_CLIP, label: '跨级' }, ...Object.entries(anim.GAME_INTRO).map(([k, v]) => ({ ref: v, label: `游戏入口 ${k}` }))])}
${clipTable('SPEECH 说话配动画', Object.entries(anim.SPEECH).flatMap(([r, list]) => (list || []).map((c) => ({ ...c, label: `说话档 ${r}` }))))}
<p class="note">喂食那一口不吃这张表：它按食物表里的具名吃相播（<code>feed</code> 档刻意不在 SPEECH 里）。</p>

<h2 id="s4">4 台词全表（${reasons.length} 档 ${totalLines} 条）</h2>
<div class="filter"><input id="q" placeholder="过滤：档名或台词，如 hungry / 泡泡 / 饿"></div>
${talkTable()}
<p class="note">「触发」列：<b>闲够+概率</b> = 走 <code>pickTalk</code>，要同时满足久无人理 ${cfg.IDLE_LONG_MS / 1000}s、掷中 ${cfg.TALK_IDLE_PROB}、过 ${cfg.TALK_COOLDOWN_MS / 1000}s 冷却；<b>事件必说</b> = 不掷概率，但仍受冷却（跨级 / greet / bye 例外，走 <code>pickLine</code> 绕开）。</p>

<h2 id="s5">5 小游戏与食物</h2>
${listTable(['id', '名称', '玩法', '入口片'], gameRows)}
${listTable(['食物', 'id', '吃相片段', '解锁'], foodRows)}

<h2 id="s6">6 常量</h2>
${constTable()}

<h2 id="s7">7 素材覆盖：这些条件在当前皮肤上真播得出来吗</h2>
${coverage()}

<h2 id="s8">8 状态栏数值：怎么变、什么条件、变多少</h2>
${statSection()}
</div>
<script>
document.getElementById('q').addEventListener('input',function(){
  var v=this.value.trim().toLowerCase();
  var tr=document.querySelectorAll('#talk tr[data-r]');
  for(var i=0;i<tr.length;i++){var r=tr[i];
    r.style.display=(v===''||r.getAttribute('data-r').indexOf(v)>=0||r.children[2].textContent.toLowerCase().indexOf(v)>=0)?'':'none'}
});
</script>
`

if (overChars.length || overReply.length) {
  console.log(`警告：${overChars.length} 条超码点上限、${overReply.length} 条回应按钮超宽 —— 报告里已标红`)
}
const file = join(OUT, 'index.html')
writeFileSync(file, html, 'utf8')
console.log(`台词 ${totalLines} 条 / ${reasons.length} 档（自己搭话 ${selfLines} 条，占 ${Math.round((selfLines / totalLines) * 100)}%）`)
console.log(`具名片段 ${allNamed.length} 条；皮肤：${skins.join(', ')}`)
for (const s of skins) {
  const p = poolOf(s)
  const miss = allNamed.filter((c) => !has(p, c))
  console.log(`  ${s}: 命中 ${allNamed.length - miss.length}/${allNamed.length}，缺 ${miss.length} 条`)
}
console.log(`→ ${file}`)
