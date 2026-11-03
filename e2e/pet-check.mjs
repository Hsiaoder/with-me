/**
 * 真实 Electron/Chromium 下的播放器与装配验证。
 *
 * 为什么必须有它：test/clip-player.test.ts 那组断言跑在假实现上，只能证明接口语义
 * 定清楚了，证明不了真 video 元素的 loadeddata / ended / class 交换按那套语义走。
 *
 * 用普通脚本 + node:assert，不引 @playwright/test：开发依赖白名单里只有 `playwright`，
 * 为一个文件再拉一个测试框架不值得。跑法：npm run e2e
 */
import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

const manifest = JSON.parse(readFileSync(join(process.cwd(), 'skins/block/manifest.json'), 'utf8'))
const SCALE_X = 320 / manifest.canvas.w
const SCALE_Y = 180 / manifest.canvas.h

const checks = []
const check = (name, fn) => checks.push({ name, fn })

let app
let page
const pageErrors = []

check('页面从 app:// 起来，装配没有抛错', async () => {
  assert.match(page.url(), /^app:\/\/assets\/renderer\/index\.html/)
  await page.waitForTimeout(1500)
  assert.deepEqual(pageErrors, [], `渲染层抛了异常：${pageErrors.join('\n')}`)
})

check('覆盖层没有焦点时 rAF 不被节流到走一步卡一下', async () => {
  // 这扇窗是 focusable:false 的，常态就是"没有焦点"。若 Chromium 因此节流渲染，
  // 走路会变成一秒跳一下，心跳也会失准（就是这么发现问题的）。
  const a = await page.evaluate(() => window.__petDebug.frames)
  await page.waitForTimeout(1000)
  const b = await page.evaluate(() => window.__petDebug.frames)
  const fps = b - a
  assert.ok(fps >= 30, `rAF 只有约 ${fps} 帧/秒，覆盖层被后台节流了`)
})

check('两个 video 槽，前台恰好一个，且已解码在播', async () => {
  const s = await page.evaluate(() => {
    const front = document.querySelector('video.is-front')
    return {
      videos: document.querySelectorAll('video').length,
      fronts: document.querySelectorAll('video.is-front').length,
      readyState: front?.readyState ?? 0,
      width: front?.videoWidth ?? 0,
      paused: front?.paused ?? true,
      src: front?.currentSrc ?? '',
    }
  })
  assert.equal(s.videos, 2)
  assert.equal(s.fronts, 1)
  assert.ok(s.readyState >= 2, `readyState=${s.readyState}`)
  assert.equal(s.width, manifest.canvas.w)
  assert.equal(s.paused, false)
  assert.match(s.src, /^app:\/\/skin\/[\w-]+\/[\w-]+\.webm$/)
})

check('硬约束：任何 video 都不许开 loop', async () => {
  const loops = await page.evaluate(() => [...document.querySelectorAll('video')].map((v) => v.loop))
  assert.deepEqual(loops, [false, false], '有人把 video.loop 打开了，违反规格第 4 节')
})

check('铁律④：交叉淡入的过渡时长是 0.18s', async () => {
  const dur = await page.evaluate(() => getComputedStyle(document.querySelector('video')).transitionDuration)
  assert.equal(dur, '0.18s')
})

check('currentTime 在推进，不是停在首帧', async () => {
  const t1 = await page.evaluate(() => document.querySelector('video.is-front').currentTime)
  await page.waitForTimeout(1200)
  const t2 = await page.evaluate(() => document.querySelector('video.is-front').currentTime)
  // 素材 4 秒一圈，中途会绕回，所以「变小」也算在推进
  assert.ok(Math.abs(t2 - t1) > 0.2 || t2 < t1, `currentTime 没动：${t1} → ${t2}`)
})

check('换片后仍然只有一个前台，且换到了新素材', async () => {
  const before = await page.evaluate(() => document.querySelector('video.is-front').currentSrc)
  const result = await page.evaluate(() => window.__testPlay('click', 'tapped'))
  assert.equal(result, 'ended', '手工点歌没播完，行为链可能把它抢走了')
  const after = await page.evaluate(() => ({
    fronts: document.querySelectorAll('video.is-front').length,
    src: document.querySelector('video.is-front').currentSrc,
    current: window.__petDebug.current,
  }))
  assert.equal(after.fronts, 1)
  assert.match(after.src, /click\/tapped\.webm$/)
  assert.notEqual(after.src, before)
  assert.deepEqual(after.current, { pool: 'click', name: 'tapped' })
})

check('命中框 = 舞台位置 + bodyBox 按缩放换算', async () => {
  const got = await page.evaluate(() => ({
    hit: window.__petDebug.hitBox,
    transform: document.querySelector('.pet-sprite').style.transform,
  }))
  const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(got.transform)
  assert.ok(m, `读不到舞台位移：${got.transform}`)
  const [x, y] = [Number(m[1]), Number(m[2])]
  assert.ok(Math.abs(got.hit.x - (x + manifest.bodyBox.x * SCALE_X)) < 1, `hit.x=${got.hit.x}`)
  assert.ok(Math.abs(got.hit.y - (y + manifest.bodyBox.y * SCALE_Y)) < 1, `hit.y=${got.hit.y}`)
  assert.ok(Math.abs(got.hit.w - manifest.bodyBox.w * SCALE_X) < 1)
  assert.ok(Math.abs(got.hit.h - manifest.bodyBox.h * SCALE_Y) < 1)
})

const feed = (p) => page.evaluate((pt) => window.__petDebug.cursor(pt), p)
const dbg = () => page.evaluate(() => ({
  open: window.__petDebug.panelOpen,
  pool: window.__petDebug.current.pool,
  sends: window.__petDebug.grabSends,
  grab: window.__petDebug.grabRequested,
  hit: window.__petDebug.hitBox,
  inner: { w: window.innerWidth, h: window.innerHeight },
}))

check('悬停满 400ms 自动出现面板，五个按钮齐全', async () => {
  const h = await page.evaluate(() => window.__petDebug.hitBox)
  const center = { x: h.x + h.w / 2, y: h.y + h.h / 2 }
  await feed(center)
  assert.equal((await dbg()).open, false, '刚进去就弹出了，停留计时没生效')
  // 只喂这一次。真机上光标停住不动时主进程不会重复发同坐标（cursor.ts 去重），
  // 再喂一次等于把「计时到点自己开」这条链路绕过掉——上一版就是这么假通过的。
  await page.waitForTimeout(460)
  assert.equal((await dbg()).open, true, '光标静止满 400ms 后仍没弹出')
  assert.equal(await page.locator('.pet-panel button').count(), 5)
})

check('面板出现在身体上方且不溢出屏幕', async () => {
  const s = await dbg()
  const r = await page.evaluate(() => {
    const b = document.querySelector('.pet-panel').getBoundingClientRect()
    return { x: b.x, y: b.y, w: b.width }
  })
  assert.ok(r.y < s.hit.y, `面板该在身体上方：panel.y=${r.y} body.y=${s.hit.y}`)
  assert.ok(r.x >= 0 && r.x + r.w <= s.inner.w, `横向溢出：${r.x}+${r.w} vs ${s.inner.w}`)
  assert.ok(r.y >= 0, `顶部溢出：${r.y}`)
})

check('点 move 按钮切到 move 池', async () => {
  await page.click('.pet-panel button[data-pool="move"]')
  await page.waitForFunction(() => window.__petDebug.current.pool === 'move', null, { timeout: 5000 })
  assert.equal((await dbg()).pool, 'move')
})

check('心跳：光标不动时仍在持续续期租约', async () => {
  // 这条测的是刚修掉的 bug：requestGrab 原本只在光标移动时发，手停在面板上不动，
  // 500ms 后租约过期、鼠标被放开给桌面，下一次点击就穿到下面的窗口去了。
  const before = (await dbg()).sends
  await page.waitForTimeout(1400)
  const after = (await dbg()).sends
  assert.ok(after - before >= 3, `1.4 秒里只发了 ${after - before} 次续期，心跳没生效`)
  assert.equal((await dbg()).open, true, '等待期间面板自己收了，说明 wantGrab 掉了')
})

check('宠物贴右边缘时面板夹回屏幕内', async () => {
  const inner = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
  await page.evaluate((p) => window.__petDebug.moveTo(p), { x: inner.w - 40, y: inner.h - 300 })
  const h = await page.evaluate(() => window.__petDebug.hitBox)
  const center = { x: h.x + h.w / 2, y: h.y + h.h / 2 }
  await feed(center)
  await page.waitForTimeout(460)
  assert.equal((await dbg()).open, true, '面板没开，量到的矩形是 0，夹取断言会假通过')
  const r = await page.evaluate(() => {
    const b = document.querySelector('.pet-panel').getBoundingClientRect()
    return { x: b.x, y: b.y, w: b.width }
  })
  assert.ok(r.x + r.w <= inner.w, `面板溢出右边缘：${r.x}+${r.w} > ${inner.w}`)
  assert.ok(r.x >= 0, `面板跑到左边外面：${r.x}`)
})

/** 当前所有 powershell 的 PID。 */
function psPids() {
  const out = execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | ForEach-Object { $_.ProcessId }",
  ], { encoding: 'utf8' }).trim()
  return new Set(out ? out.split(/\r?\n/).map(Number) : [])
}

/** 当前所有 powershell 的父进程 PID 集合（用来确认它是 electron 的子进程，而不是别处的）。 */
function psParentPairs() {
  const out = execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | ForEach-Object { \"$($_.ProcessId),$($_.ParentProcessId)\" }",
  ], { encoding: 'utf8' }).trim()
  return out ? out.split(/\r?\n/).map((l) => l.split(',').map(Number)) : []
}

function electronPids() {
  const out = execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | ForEach-Object { $_.ProcessId }",
  ], { encoding: 'utf8' }).trim()
  return new Set(out ? out.split(/\r?\n/).map(Number) : [])
}

let beforePids = new Set()
/** 「探测子进程已启动」那条检查记下的 PID，退出后拿它验有没有变孤儿。 */
let probePids = []

check('拖拽跟随光标，松手停在原地不回弹', async () => {
  const start = await page.evaluate(() => window.__petDebug.hitBox)
  const from = { x: start.x + start.w / 2, y: start.y + start.h / 2 }
  const to = { x: from.x - 220, y: from.y - 120 }
  const drag = await page.evaluate(async ({ from, to }) => {
    const fire = (type, p) => window.dispatchEvent(new PointerEvent(type, { clientX: p.x, clientY: p.y, bubbles: true }))
    fire('pointerdown', from)
    fire('pointermove', { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 })
    fire('pointermove', to)
    const during = window.__petDebug.hitBox
    fire('pointerup', to)
    await new Promise((r) => setTimeout(r, 200))
    return { during, after: window.__petDebug.hitBox, bottom: window.innerHeight }
  }, { from, to })
  // 拖拽中要跟上光标
  assert.ok(Math.abs(drag.during.x - (to.x - start.w / 2)) < 40, `拖拽中没有跟随：${JSON.stringify(drag.during)}`)
  // 松手后 x 和 y 都必须停在松手处。只比 x 的话，把高度拉回地面的 bug 会漏过去
  assert.ok(Math.abs(drag.after.x - drag.during.x) < 2, `松手后 x 跳了：${drag.during.x} → ${drag.after.x}`)
  assert.ok(Math.abs(drag.after.y - drag.during.y) < 2, `松手后 y 跳了：${drag.during.y} → ${drag.after.y}`)
  assert.ok(drag.after.y < drag.bottom - 200, `松手后被吸回地面：y=${drag.after.y} 屏高=${drag.bottom}`)
})

check('Ctrl+Shift+点身体切换命中框', async () => {
  // F9 走不通：这扇窗 focusable:false，收不到键盘事件。改用带修饰键的点击。
  const toggle = () => page.evaluate(() => {
    const h = window.__petDebug.hitBox
    window.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: h.x + h.w / 2, clientY: h.y + h.h / 2, ctrlKey: true, shiftKey: true, bubbles: true,
    }))
    return document.querySelectorAll('.hit-outline').length
  })
  assert.equal(await toggle(), 1, '第一次没有画出命中框')
  assert.equal(await toggle(), 0, '第二次没有把命中框收掉')
})

check('让路探测子进程已启动（新出现的 powershell，父进程是 electron）', async () => {
  const fresh = psParentPairs().filter(([pid, parent]) => !beforePids.has(pid) && electronPids().has(parent))
  assert.ok(fresh.length >= 1, '没看到探测用的 powershell 子进程，让路功能没起来')
  probePids = fresh.map(([pid]) => pid)
})

check('离开身体与面板满 400ms 后面板自动收起', async () => {
  // 上一版这里直接喂离开坐标然后断言「收了」——可那时候面板已经被拖拽测试关掉了，
  // 断言的是「本来就没开」，什么都没测到。先把面板叫起来，再验它自己收回去。
  const h = await page.evaluate(() => window.__petDebug.hitBox)
  await feed({ x: h.x + h.w / 2, y: h.y + h.h / 2 })
  await page.waitForTimeout(460)
  assert.equal((await dbg()).open, true, '前置条件：静止悬停满 400ms 该弹出面板')
  await feed({ x: 5, y: 5 })
  // 只喂这一次离开坐标：静止时光标不会再产生新事件，收起也得计时自己完成
  await page.waitForTimeout(460)
  assert.equal((await dbg()).open, false, '光标静止离开后没收起')
})

check('光标离开身体与面板后立刻放开鼠标，不等面板收起', async () => {
  // 整窗粒度的穿透：只要还「接住」，整块屏幕的点击都被透明层吞掉。
  // 面板的 400ms 收起延时只管可见性，不该顺手把鼠标也扣住 400ms——
  // 真机上就是这个症状：从宠物移出去点别处，那一下要点两次才灵。
  const h = await page.evaluate(() => window.__petDebug.hitBox)
  await feed({ x: h.x + h.w / 2, y: h.y + h.h / 2 })
  await page.waitForTimeout(460)
  const open = await dbg()
  assert.equal(open.open, true, '前置条件：面板该开着')
  assert.equal(open.grab, true, '前置条件：光标在身上，该接住鼠标')

  await feed({ x: 4, y: 4 })
  const after = await page.evaluate(() => ({ grab: window.__petDebug.grabRequested, open: window.__petDebug.panelOpen }))
  assert.equal(after.grab, false, '光标已经离开身体和面板，鼠标却没放开')
  assert.equal(after.open, true, '面板该还开着（400ms 收起延时是可见性，不是扣鼠标）')
})

check('面板收起后不再参与命中测试：看不见的按钮不许抢光标和点击', async () => {
  // 真机症状：点完宠物移出去，光标在宠物上方那条带子里变成手指。
  // 根因不在透明度：`.pet-panel{display:flex}` 是作者样式，压过了 UA 的
  // `[hidden]{display:none}`，所以收起后元素还占着 275x44，命中的仍是带
  // cursor:pointer 的按钮——光标形状按命中的元素画，看不见也照画。
  const h = await page.evaluate(() => window.__petDebug.hitBox)
  await feed({ x: h.x + h.w / 2, y: h.y + h.h / 2 })
  await page.waitForTimeout(460)
  assert.equal((await dbg()).open, true, '前置：面板该开着')
  const band = await page.evaluate(() => {
    const b = document.querySelector('.pet-panel').getBoundingClientRect()
    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }
  })
  await feed({ x: 4, y: 4 })
  await page.waitForTimeout(460)
  assert.equal((await dbg()).open, false, '前置：面板该已收起')
  const at = await page.evaluate((p) => {
    const el = document.elementFromPoint(p.x, p.y)
    return { tag: el ? el.tagName : 'null', cursor: el ? getComputedStyle(el).cursor : 'n/a' }
  }, band)
  assert.notEqual(at.tag, 'BUTTON', `收起的面板还在命中测试里：${JSON.stringify(at)} @${band.x},${band.y}`)
  assert.notEqual(at.cursor, 'pointer', `看不见的按钮还在改光标形状：${JSON.stringify(at)}`)
})

check('久无人理后由皮肤权重自主选池：turn 进得了运行链路', async () => {
  // 复审 #2 的 P1-2：pickAmbient 单测全绿但渲染层从来没调用它，
  // 于是 weights 和 turn 全死在链路外。这条只认运行时那份 manifest 与规则层。
  const toTurn = await page.evaluate(() => window.__petDebug.ambientNext(0.99))
  assert.equal(toTurn.kind, 'play', `该换新的一条，却拿到 ${toTurn.kind}`)
  assert.equal(toTurn.ref.pool, 'turn', `rng=0.99 三个环境池等权应抽到 turn，实际 ${toTurn.ref.pool}`)
  const toMove = await page.evaluate(() => window.__petDebug.ambientNext(0.5))
  assert.equal(toMove.ref.pool, 'move', `rng=0.5 应抽到 move，实际 ${toMove.ref.pool}`)
})

check('同一个 userData 的第二个实例被单实例锁挡掉', async () => {
  // 锁是按 userData 目录分的，PET_USER_DATA 必须先设到位再申请锁，否则
  // 所有测试实例共用真实 %APPDATA% 那把锁，桌面上跑着一只宠物时 e2e 直接起不来。
  // 另一半（不同目录可以并行）没法自动验：那会在屏幕上真放出第二只宠物。
  const bin = require('electron')
  const r = spawnSync(bin, ['.'], {
    cwd: process.cwd(),
    env: { ...process.env, PET_USER_DATA: userData },
    encoding: 'utf8',
    timeout: 20_000,
  })
  assert.ok(!r.error, `第二个实例没能在 20 秒内自行退出，锁没起作用：${String(r.error)}`)
  assert.equal(r.status, 0, `第二实例退出码 ${r.status}，输出：${r.stdout?.slice(0, 200)}`)
  assert.match(r.stdout ?? '', /已经有一只宠物在跑了/, '第二实例退出了但没说明原因')
})

beforePids = psPids()
// 单实例锁是按 userData 分开的，测试必须用自己的临时目录：
// 否则你桌面上正跑着一只宠物时，e2e 起的实例会被锁挡掉，firstWindow 直接挂住。
const userData = mkdtempSync(join(tmpdir(), 'pet-e2e-'))
app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { ...process.env, PET_USER_DATA: userData },
})
try {
  page = await app.firstWindow()
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  await page.waitForFunction(() => document.querySelectorAll('video').length === 2, null, { timeout: 30_000 })

  let failed = 0
  for (const { name, fn } of checks) {
    try {
      await fn()
      console.log(`  ok  ${name}`)
    } catch (e) {
      failed++
      console.error(`FAIL  ${name}\n      ${String(e.message).split('\n')[0]}`)
    }
  }

  await app.close()
  await new Promise((r) => setTimeout(r, 800))

  // 设计文档第 10 节「子进程三规」之一：别把探测用的 PowerShell 变成孤儿进程。
  // 只有被 SIGKILL 时 before-quit 不会跑，所以这里同时验一下正常退出这条路。
  const alive = [...psPids()]
  const orphans = probePids.filter((p) => alive.includes(p))
  if (orphans.length) {
    failed++
    console.error(`FAIL  退出后残留探测子进程：${orphans.join(', ')}`)
  } else {
    console.log('  ok  退出后没有残留的探测子进程')
  }

  const total = checks.length + 1
  console.log(`\ne2e：${total - failed}/${total} 通过`)
  if (failed) process.exitCode = 1
} finally {
  await app?.close().catch(() => {})
  // Windows 上刚退出的进程可能还攥着文件句柄，rmSync 会抛 EBUSY；清不掉就算了
  try {
    rmSync(userData, { recursive: true, force: true })
  } catch {
    /* 忽略 */
  }
}
