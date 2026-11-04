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
import { CLIP_FADE_MS, PANEL_HIDE_MS, SETTING_HIDE_MS } from '../src/shared/config.ts'

const require = createRequire(import.meta.url)

const manifest = JSON.parse(readFileSync(join(process.cwd(), 'skins/block/manifest.json'), 'utf8'))
const SCALE_X = 320 / manifest.canvas.w
const SCALE_Y = 180 / manifest.canvas.h

const checks = []
const check = (name, fn) => checks.push({ name, fn })

/** 失败原因全量缩进打印：deepEqual 的差异从第二行才开始，只留首行等于没报。 */
const indent = (s) =>
  s.split('\n').slice(0, 12).map((l) => `      ${l}`).join('\n')

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

check('铁律④：淡出只许挂在退场层上，两层不许同时动', async () => {
  // 两层同时淡（新层 0→1、旧层 1→0）叠出来的不透明度是 f+(1−f)²，中间只剩 0.75，
  // 桌面会从宠物身上透过去——那就是「每次换片都闪一下」。所以过渡只能有一份。
  const css = readFileSync(join(process.cwd(), 'src/renderer/style.css'), 'utf8')
  const body = (re) => re.exec(css)?.[1] ?? ''
  const base = body(/\n\.pet-video\s*\{([^}]*)\}/)
  const front = body(/\.pet-video\.is-front\s*\{([^}]*)\}/)
  const out = body(/\.pet-video\.is-out\s*\{([^}]*)\}/)
  assert.ok(!/transition/.test(base), '.pet-video 基类带了过渡：新层也会淡，中间漏光')
  assert.ok(!/transition/.test(front), '.is-front 带了过渡：新层该直接满不透明压在下边')
  assert.match(out, /transition:\s*opacity 0\.18s/, '退场层必须淡出 0.18s')
  assert.match(out, /z-index:\s*2/, '退场层要盖在新层上面淡，不然淡的是底下那层')
  assert.equal(CLIP_FADE_MS, 180, 'config 的淡出时长和 style.css 里的对不上了')
})

check('换片那一瞬不漏光：淡出期间峰值 alpha 恒为 255', async () => {
  const box = await page.evaluate(() => window.__petDebug.hitBox)
  const region = {
    x: Math.max(0, Math.round(box.x - 20)),
    y: Math.max(0, Math.round(box.y - 20)),
    width: Math.round(box.w + 40),
    height: Math.round(box.h + 40),
  }
  // 抓的是窗口真实合成结果，不是页面里 video 的状态：opacity 加起来是 1 不代表叠出来不透明
  const samples = await app.evaluate(async ({ BrowserWindow }, { region, pool, name }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.isVisible())
    // 不 await：__testPlay 的 promise 要等整条素材播完才 resolve
    void win.webContents.executeJavaScript(`window.__testPlay('${pool}', '${name}'); 'kicked'`)
    const out = []
    for (let n = 0; n < 45; n++) {
      const img = await win.capturePage(region)
      const b = img.toBitmap()
      let max = 0
      for (let i = 3; i < b.length; i += 4) if (b[i] > max) max = b[i]
      const fading = await win.webContents.executeJavaScript('document.querySelectorAll("video.is-out").length')
      out.push({ max, fading })
    }
    return out
  }, { region, pool: 'idle', name: 'patrol2' })

  const fades = samples.filter((s) => s.fading > 0)
  assert.ok(fades.length >= 2, `45 次采样只撞见 ${fades.length} 帧淡出，这条检查测不到东西`)
  const worst = Math.min(...fades.map((s) => s.max))
  assert.equal(worst, 255, `淡出期间峰值 alpha 只有 ${worst}：两层都在动，桌面从宠物身上透过去了`)
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
/**
 * 把面板叫出来、光标停在身体上。位置类检查的前置用它，别依赖"上一条检查留下的状态"——
 * 那些检查会把宠物挪走。宠物可能正在走动，所以重读命中框重试。
 */
async function openOnBody(retry = 3) {
  for (let i = 0; i < retry; i++) {
    const h = await page.evaluate(() => window.__petDebug.hitBox)
    await feed({ x: h.x + h.w / 2, y: h.y + h.h / 2 })
    await page.waitForTimeout(460)
    if ((await dbg()).open) return true
  }
  return false
}
const dbg = () => page.evaluate(() => ({
  open: window.__petDebug.panelOpen,
  pool: window.__petDebug.current.pool,
  sends: window.__petDebug.grabSends,
  grab: window.__petDebug.grabRequested,
  hit: window.__petDebug.hitBox,
  inner: { w: window.innerWidth, h: window.innerHeight },
}))

check('悬停满 400ms 自动出现面板，四个按钮齐全', async () => {
  const h = await page.evaluate(() => window.__petDebug.hitBox)
  const center = { x: h.x + h.w / 2, y: h.y + h.h / 2 }
  await feed(center)
  assert.equal((await dbg()).open, false, '刚进去就弹出了，停留计时没生效')
  // 只喂这一次。真机上光标停住不动时主进程不会重复发同坐标（cursor.ts 去重），
  // 再喂一次等于把「计时到点自己开」这条链路绕过掉——上一版就是这么假通过的。
  await page.waitForTimeout(460)
  assert.equal((await dbg()).open, true, '光标静止满 400ms 后仍没弹出')
  const labels = await page.locator('.pet-panel button').evaluateAll((bs) =>
    bs.map((b) => `${b.getAttribute('aria-label')}=${b.querySelector('img')?.getAttribute('src')}`))
  assert.deepEqual(labels,
    ['喂食=icons/rice.svg', '小游戏=icons/activity.svg', '状态=icons/status.svg', '设置=icons/settings.svg'],
    `按钮的文字/图标不对：${JSON.stringify(labels)}`)
  // 图必须真的解码出来：路径错了 img 是 0×0，按钮看着就是一枚空圆片。
  // 先等 decode 落地再断言，否则抢到的是「还没解完」而不是「解不出来」。
  const decoded = await page.locator('.pet-panel button img').evaluateAll(async (imgs) => {
    await Promise.all(imgs.map((i) => i.decode().catch(() => {})))
    return imgs.map((i) => `${i.naturalWidth > 0}/${i.complete}`)
  })
  assert.deepEqual(decoded, ['true/true', 'true/true', 'true/true', 'true/true'],
    `图标没解码成功：${JSON.stringify(decoded)}`)
})

check('面板以角色的对称轴居中，不是贴着身体左沿', async () => {
  assert.ok(await openOnBody(), '前置：面板叫不出来')
  const g = await page.evaluate(() => {
    const b = window.__petDebug.hitBox
    const p = document.querySelector('.pet-panel').getBoundingClientRect()
    return { axis: b.x + b.w / 2, center: p.x + p.width / 2 }
  })
  assert.ok(Math.abs(g.axis - g.center) < 2,
    `面板中线 ${g.center.toFixed(1)} 没对上身体对称轴 ${g.axis.toFixed(1)}`)
})

check('拖到屏幕左右边缘时，是身体贴边而不是舞台贴边', async () => {
  // 画布左右各有大片空白（试穿皮肤实测左 95.5、右 92.5 CSS 像素）。
  // 以前夹的是舞台矩形，角色永远碰不到屏幕边——差的就是那截空白。
  const inner = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
  // 目标点必须远远越过屏幕边：夹取才是这条要验的东西，拖到「刚好不够」的位置
  // 量到的是没夹住的中间值，改错方向也能过。
  for (const [where, target] of [['左', -99999], ['右', 99999]]) {
    await page.evaluate((p) => window.__petDebug.moveTo(p), { x: inner.w / 2 - 160, y: 200 })
    const box = await page.evaluate(() => window.__petDebug.hitBox)
    const from = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
    await page.evaluate(({ from, to }) => {
      const fire = (type, p) => window.dispatchEvent(new PointerEvent(type, { clientX: p.x, clientY: p.y, bubbles: true }))
      fire('pointerdown', from)
      fire('pointermove', to)
      fire('pointerup', to)
    }, { from, to: { x: target, y: 200 } })
    const b = await page.evaluate(() => window.__petDebug.hitBox)
    const edge = where === '左' ? b.x : inner.w - (b.x + b.w)
    assert.ok(edge < 2, `拖到${where}边缘后身体还差 ${edge.toFixed(1)} 像素才贴住屏幕`)
  }
})

check('面板默认跟在脚底下，脚下没地方才翻到头顶，且不溢出屏幕', async () => {
  const panelRect = () => page.evaluate(() => {
    const b = document.querySelector('.pet-panel').getBoundingClientRect()
    return { x: b.x, y: b.y, w: b.width, h: b.height }
  })
  const inner = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))

  // 宠物挪到屏幕中间：脚底下有整块地方 → 面板必须在身体下方
  assert.ok(await openOnBody(), '前置：面板叫不出来')
  await page.evaluate((p) => window.__petDebug.moveTo(p), { x: 600, y: 300 })
  await page.waitForTimeout(150)
  let body = await page.evaluate(() => window.__petDebug.hitBox)
  let pr = await panelRect()
  assert.ok(pr.h > 0, '面板量到 0 高：它没开着，或者已被移出布局')
  assert.ok(pr.y >= body.y + body.h, `脚下有地方时面板该在下方：panel.y=${pr.y} bodyBottom=${body.y + body.h}`)
  assert.ok(pr.x >= 0 && pr.x + pr.w <= inner.w, `横向溢出：${pr.x}+${pr.w} vs ${inner.w}`)

  // 宠物站回地上：脚底下只剩屏幕边那几像素 → 翻到头顶
  await page.evaluate((p) => window.__petDebug.moveTo(p), { x: 600, y: inner.h - 200 })
  await page.waitForTimeout(150)
  body = await page.evaluate(() => window.__petDebug.hitBox)
  pr = await panelRect()
  assert.ok(pr.y + pr.h <= body.y + 1, `脚下放不下时面板该翻到头顶：panelBottom=${pr.y + pr.h} bodyTop=${body.y}`)
  assert.ok(pr.y >= 0, `顶部溢出：${pr.y}`)
})

check('点喂食按钮：宠物给一个 click 池的反应', async () => {
  assert.ok(await openOnBody(), '前置：面板叫不出来，按钮点不到')
  await page.click('.pet-panel button[data-id="feed"]')
  await page.waitForFunction(() => window.__petDebug.current.pool === 'click', null, { timeout: 5000 })
  assert.equal((await dbg()).pool, 'click')
})

check('心跳：光标不动时仍在持续续期租约', async () => {
  // 这条测的是刚修掉的 bug：requestGrab 原本只在光标移动时发，手停在面板上不动，
  // 500ms 后租约过期、鼠标被放开给桌面，下一次点击就穿到下面的窗口去了。
  assert.ok(await openOnBody(), '前置：面板叫不出来，心跳无从谈起')
  const before = (await dbg()).sends
  await page.waitForTimeout(1400)
  const after = (await dbg()).sends
  assert.ok(after - before >= 3, `1.4 秒里只发了 ${after - before} 次续期，心跳没生效`)
  assert.equal((await dbg()).open, true, '等待期间面板自己收了，说明 wantGrab 掉了')
})

check('宠物贴右边缘时面板夹回屏幕内', async () => {
  const inner = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
  await page.evaluate((p) => window.__petDebug.moveTo(p), { x: inner.w - 40, y: inner.h - 300 })
  assert.ok(await openOnBody(), '面板没开，量到的矩形是 0，夹取断言会假通过')
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

check('可见性探测子进程已启动（新出现的 powershell，父进程是 electron）', async () => {
  const fresh = psParentPairs().filter(([pid, parent]) => !beforePids.has(pid) && electronPids().has(parent))
  assert.ok(fresh.length >= 1, '没看到场景探测用的 powershell 子进程，可见性功能没起来')
  probePids = fresh.map(([pid]) => pid)
})

check('设置视图：切视图、改一项、当场落盘、收起延时更宽裕', async () => {
  assert.ok(await openOnBody(), '前置：面板叫不出来')
  await page.click('.pet-panel button[data-id="settings"]')
  await page.waitForSelector('.pet-panel .pet-setting')
  const selected = () => page.locator('.pet-setting').evaluateAll((rows) =>
    rows.map((r) => r.querySelector('button.on')?.dataset.value))

  assert.equal(await page.locator('.pet-setting').count(), 2, '两档场景该有两行')
  assert.deepEqual(await selected(), ['show', 'show'], '默认值必须是「都陪我」')

  await page.click('.pet-panel button[data-key="onFullscreen"][data-value="hide"]')
  assert.deepEqual(await selected(), ['hide', 'show'], '只该被点的那一项变选中态')

  // 立刻落盘：只在退出时写的话，进程被杀就丢，而设置丢了很难查。
  // 轮询而不是睡一下：IPC 到写盘是异步的，读早了会误报成「没落盘」。
  const file = join(userData, 'save.json')
  const want = JSON.stringify({ onFullscreen: 'hide', onPresentation: 'show' })
  let saved = null
  for (let i = 0; i < 30; i++) {
    try {
      saved = JSON.parse(readFileSync(file, 'utf8')).settings
      if (JSON.stringify(saved) === want) break
    } catch {
      /* 还没写出来 */
    }
    await page.waitForTimeout(100)
  }
  assert.equal(JSON.stringify(saved), want, `设置没在 3 秒内落盘：${JSON.stringify(saved)}`)

  // 设置视图里挑选项要的时间更长：过了动作视图的 1500ms 还不能收
  const h = await page.evaluate(() => window.__petDebug.hitBox)
  await feed({ x: h.x + h.w / 2, y: h.y + h.h + 400 })
  await page.waitForTimeout(PANEL_HIDE_MS + 300)
  assert.equal((await dbg()).open, true, `设置视图在 ${PANEL_HIDE_MS}ms 后就收了，SETTING_HIDE_MS 没生效`)
  await page.waitForTimeout(SETTING_HIDE_MS)
  assert.equal((await dbg()).open, false, '设置视图最终也没收，收起逻辑被绕过了')

  // 收起后回动作视图；重新打开时看到的应该是按钮而不是设置页
  assert.ok(await openOnBody(), '前置：面板叫不回来')
  assert.equal(await page.locator('.pet-panel .pet-setting').count(), 0, '收起再开还停在设置视图')
  assert.deepEqual(await page.locator('.pet-panel button').evaluateAll((bs) =>
    bs.map((b) => b.getAttribute('aria-label'))), ['喂食', '小游戏', '状态', '设置'])
})

check('离开身体与面板满 1500ms 后面板自动收起', async () => {
  // 上一版这里直接喂离开坐标然后断言「收了」——可那时候面板已经被拖拽测试关掉了，
  // 断言的是「本来就没开」，什么都没测到。先把面板叫起来，再验它自己收回去。
  const h = await page.evaluate(() => window.__petDebug.hitBox)
  await feed({ x: h.x + h.w / 2, y: h.y + h.h / 2 })
  await page.waitForTimeout(460)
  assert.equal((await dbg()).open, true, '前置条件：静止悬停满 400ms 该弹出面板')
  await feed({ x: 5, y: 5 })
  // 只喂这一次离开坐标：静止时光标不会再产生新事件，收起也得计时自己完成。
  // 收起比弹出慢得多（PANEL_HIDE_MS 1500 vs HOVER_DWELL_MS 400）：鼠标在按钮之间
  // 走位的那段时间不该把面板收掉，否则用户会觉得按钮自己跑了。
  await page.waitForTimeout(500)
  assert.equal((await dbg()).open, true, '才 500ms 就收了：收起延时没走 PANEL_HIDE_MS')
  await page.waitForTimeout(1100)
  assert.equal((await dbg()).open, false, '光标静止离开满 1500ms 后没收起')
})

check('光标离开身体与面板后立刻放开鼠标，不等面板收起', async () => {
  // 整窗粒度的穿透：只要还「接住」，整块屏幕的点击都被透明层吞掉。
  // 面板的收起延时只管可见性，不该顺手把鼠标也扣住——真机上就是这个症状：
  // 从宠物移出去点别处，那一下要点两次才灵。
  assert.ok(await openOnBody(), '前置条件：面板该开着')
  const s = await dbg()
  assert.equal(s.grab, true, '前置条件：光标在身上，该接住鼠标')

  await feed({ x: 4, y: 4 })
  const after = await page.evaluate(() => ({ grab: window.__petDebug.grabRequested, open: window.__petDebug.panelOpen }))
  assert.equal(after.grab, false, '光标已经离开身体和面板，鼠标却没放开')
  assert.equal(after.open, true, '面板该还开着（PANEL_HIDE_MS 是可见性延时，不是扣鼠标）')
})

check('面板收起后真的移出布局：不吃点击、不改光标形状', async () => {
  // 真机症状：点完宠物移出去，光标在宠物上方那条带子里变成手指。
  // 根因是样式优先级：UA 的 `[hidden]{display:none}` 被作者样式
  // `.pet-panel{display:flex}` 顶掉了，所以「收起」只等于透明度 0，元素照旧占位、
  // 照旧参与命中测试，命中的还是带 cursor:pointer 的按钮。
  // 现在收起由 `.pet-panel[hidden]{display:none}` 显式做，命中判定也只问 DOM。
  const h = await page.evaluate(() => window.__petDebug.hitBox)
  await feed({ x: h.x + h.w / 2, y: h.y + h.h / 2 })
  await page.waitForTimeout(460)
  assert.equal((await dbg()).open, true, '前置：面板该开着')
  const band = await page.evaluate(() => {
    const b = document.querySelector('.pet-panel').getBoundingClientRect()
    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }
  })
  await feed({ x: 4, y: 4 })
  await page.waitForTimeout(1600)
  assert.equal((await dbg()).open, false, '前置：面板该已收起')
  // open=false 是立刻生效的，display 却要等 0.18s 的离散过渡走完（淡出是故意留的）。
  // 不在这里等一下就等于在动画中间读数，会得到还没换过去的 flex。
  await page.waitForTimeout(400)
  const at = await page.evaluate((p) => {
    const el = document.elementFromPoint(p.x, p.y)
    return {
      tag: el ? el.tagName : 'null',
      cursor: el ? getComputedStyle(el).cursor : 'n/a',
      hitDataHit: el !== null && el.closest('[data-hit]') !== null,
      display: getComputedStyle(document.querySelector('.pet-panel')).display,
    }
  }, band)
  assert.equal(at.display, 'none', `收起后面板还在布局里：${JSON.stringify(at)}`)
  assert.equal(at.hitDataHit, false, `收起的面板还能被命中：${JSON.stringify(at)} @${band.x},${band.y}`)
  assert.notEqual(at.cursor, 'pointer', `看不见的按钮还在改光标形状：${JSON.stringify(at)}`)
})

check('久无人理后由皮肤权重自主选池：turn 进得了运行链路，move 不再被自主选中', async () => {
  // 复审 #2 的 P1-2：pickAmbient 单测全绿但渲染层从来没调用它，
  // 于是 weights 和 turn 全死在链路外。这条只认运行时那份 manifest 与规则层。
  //
  // 只断言「抽到哪个池」，不断言 play/loop，也不断言池内哪一条：当前正在播什么
  // 会影响随机层排除自己后剩下的候选，而 play/loop 的接缝由 nextClip 单测覆盖。
  // 放在运行链路里会变成「跑到这条时刚好在播什么」的顺序依赖。
  const picks = []
  for (const rng of [0, 0.5, 0.99]) {
    picks.push(await page.evaluate((x) => window.__petDebug.ambientNext(x), rng))
  }
  const block = JSON.parse(readFileSync(join(process.cwd(), 'skins/block/manifest.json'), 'utf8'))
  assert.equal(block.weights, undefined, '这条按无权重（idle/turn 各 1）算的期望值，改权重就得同步改断言')
  assert.deepEqual(picks.map((p) => p.ref.pool), ['idle', 'turn', 'turn'],
    `权重均分时低段该抽 idle、高段该抽 turn：${JSON.stringify(picks.map((p) => p.ref))}`)
  assert.ok(!picks.some((p) => p.ref.pool === 'move'),
    `宠物不该再自己平行走动：${JSON.stringify(picks.map((p) => p.ref))}`)
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
  env: { ...process.env, PET_USER_DATA: userData, PET_FREEZE_CURSOR: '1' },
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
      console.error(`FAIL  ${name}\n${indent(String(e.message))}`)
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
