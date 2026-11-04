/**
 * 拖拽延迟探针：把「按下 → 宠物跟上 → 换片可见」这三段拆开量，别靠眼睛猜是哪一段慢。
 *
 * 采样点全在页面时间轴上（performance.now / PointerEvent.timeStamp 同一个基准）：
 * ① 每帧记 rAF 帧号、宠物命中框 x、当前池、前台 video 的状态；
 * ② 捕获每个 pointermove 的 clientX 与时间；
 * ③ node 侧用 Playwright 的 mouse 以固定节奏推一段真实输入。
 * 跑法：node spike/drag-latency.mjs
 */
import { _electron as electron } from 'playwright'
import { cpSync, mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SKIN_SRC = join(tmpdir(), 'dsh-asar-BHUAA9', 'pet', 'skins', 'dshtry')
const ud = mkdtempSync(join(tmpdir(), 'drag-latency-'))
mkdirSync(join(ud, 'skins'), { recursive: true })
cpSync(SKIN_SRC, join(ud, 'skins', 'dshtry'), { recursive: true })
writeFileSync(join(ud, 'save.json'), JSON.stringify({ version: 1, skin: 'dshtry' }), 'utf8')

if (!existsSync(SKIN_SRC)) throw new Error(`试穿皮肤不在：${SKIN_SRC}（先跑 node spike/dsh-asar-extract.mjs）`)
const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, PET_USER_DATA: ud, PET_FREEZE_CURSOR: '1' },
})
const page = await app.firstWindow()
await page.waitForTimeout(1600)

await page.evaluate(() => {
  const d = window.__petDebug
  const P = { samples: [], moves: [], down: null, up: null }
  window.__probe = P
  const front = () => {
    const v = document.querySelector('.pet-video.is-front')
    if (!v) return null
    return { clip: v.src.split('/').slice(-2).join('/'), rs: v.readyState, ct: Math.round(v.currentTime * 1000) }
  }
  const sample = () => {
    const b = d.hitBox
    P.samples.push({ t: Math.round(performance.now()), frames: d.frames, pool: d.current.pool, x: Math.round(b.x), front: front() })
  }
  const loop = () => { sample(); requestAnimationFrame(loop) }
  requestAnimationFrame(loop)
  addEventListener('pointerdown', (e) => { P.down = { t: Math.round(e.timeStamp), x: e.clientX, y: e.clientY } }, true)
  addEventListener('pointermove', (e) => { P.moves.push({ t: Math.round(e.timeStamp), x: e.clientX }) }, true)
  addEventListener('pointerup', (e) => { P.up = { t: Math.round(e.timeStamp), x: e.clientX } }, true)
})

const h = await page.evaluate(() => window.__petDebug.hitBox)
const cx = Math.round(h.x + h.w / 2)
const cy = Math.round(h.y + h.h / 2)

await page.mouse.move(cx, cy)
await page.waitForTimeout(120)
await page.mouse.down()
// 向右推 24 步、每步 12px、每步约 16ms —— 比人手更快更稳，好对齐时间轴
for (let i = 1; i <= 24; i++) {
  await page.mouse.move(cx + i * 12, cy)
  await page.waitForTimeout(16)
}
await page.mouse.up()
await page.waitForTimeout(1200)

const P = await page.evaluate(() => window.__probe)
await app.close()

const s = P.samples
const intervals = s.slice(1).map((p, i) => p.t - s[i].t).sort((a, b) => a - b)
const med = (arr) => (arr.length ? arr[Math.floor(arr.length / 2)] : NaN)
console.log(`帧数 ${s.length}，rAF 间隔 中位 ${med(intervals)}ms / 最大 ${intervals.at(-1)}ms`)
const frameDelta = s.at(-1).frames - s[0].frames
console.log(`渲染循环推进了 ${frameDelta} 帧（页面存活 ${s.at(-1).t - s[0].t}ms）`)

const downT = P.down.t
const upT = P.up.t
const flip = s.find((p) => p.pool === 'drag')
const shown = s.find((p) => p.front && p.front.clip.startsWith('drag/'))
console.log(`按下 t=${downT} 松手 t=${upT}（按住 ${upT - downT}ms）`)
console.log(`current.pool 变 drag：按下后 ${flip ? flip.t - downT : '没发生'}ms（松手后 ${flip ? flip.t - upT : '-'}ms）`)
console.log(`前台 video 变 drag 素材：按下后 ${shown ? shown.t - downT : '没发生'}ms（松手后 ${shown ? shown.t - upT : '-'}ms）`)

// 拖拽期间前台到底在放哪条：把 [down, up] 区间内的 front.clip 去重列出来。
const during = s.filter((p) => p.t >= downT && p.t <= upT)
const clips = [...new Set(during.map((p) => p.front?.clip))]
console.log(`拖拽期间（${downT}..${upT}，${during.length} 帧）前台素材：${clips.join(' → ') || '无采样'}`)
const ct = during.map((p) => p.front?.ct).filter((v) => v !== undefined)
console.log(`该素材 currentTime 从 ${ct[0]}ms 走到 ${ct.at(-1)}ms（在推进就不是卡住）`)

// 位移该跟上的位置：x0 + (光标此刻位移)。取每个采样时刻「最后一次收到的 move」为准。
const x0 = s.find((p) => p.t >= downT)?.x
let worst = { lagPx: 0, at: 0 }
const deltas = []
for (const p of s) {
  if (p.t < downT || p.t > upT + 400 || x0 === undefined) continue
  const mv = P.moves.filter((m) => m.t <= p.t).at(-1)
  if (!mv || !P.down) continue
  const expect = x0 + (mv.x - P.down.x)
  const d = expect - p.x
  deltas.push(d)
  if (Math.abs(d) > Math.abs(worst.lagPx)) worst = { lagPx: d, at: p.t - downT }
}
deltas.sort((a, b) => a - b)
console.log(`位移差：中位 ${med(deltas)}px，最大 ${worst.lagPx}px（出现在按下后 ${worst.at}ms）`)
console.log(`样本：${JSON.stringify(s.slice(0, 3))}`)
