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
import { CLIP_FADE_MS, PANEL_BUTTONS, PANEL_HIDE_MS, VIEW_HIDE_MS } from '../src/shared/config.ts'

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
/** 点一下身体（按下与松开同一点 = 没过拖拽阈值的那条路）。 */
const clickBody = (p) => page.evaluate((q) => {
  const fire = (t) => window.dispatchEvent(new PointerEvent(t, { clientX: q.x, clientY: q.y, bubbles: true }))
  fire('pointerdown')
  fire('pointerup')
}, p)
/**
 * 把面板叫出来、光标停在身体上。位置类检查的前置用它，别依赖"上一条检查留下的状态"——
 * 那些检查会把宠物挪走。宠物可能正在走动，所以重读命中框重试。
 * 2026-11-04 起面板由**点击**叫出来，所以这里点一下而不是喂光标；
 * 已经开着就绝对不能再点——那一次点会变成收起，前置就反了。
 */
async function openOnBody(retry = 3) {
  for (let i = 0; i < retry; i++) {
    const h = await page.evaluate(() => window.__petDebug.hitBox)
    const center = { x: h.x + h.w / 2, y: h.y + h.h / 2 }
    if (!(await dbg()).open) await clickBody(center)
    // 点完再喂一次光标：grabRequested 与交互区只在光标事件里更新，
    // 而真实用户点宠物时鼠标本来就停在宠物上——不喂就等于测了一个现实中不存在的组合。
    await feed(center)
    await page.waitForTimeout(120)
    if ((await dbg()).open) return true
  }
  return false
}

const overClass = () => page.evaluate(() => document.body.classList.contains('pet-over'))

check('光标形状跟着交互区走：身体上是 hand_point，舞台那截透明空白不是', async () => {
  // 判据必须是交互区而不是舞台矩形——画布四周那截透明空白还归桌面，
  // 在那儿显示「可以点」的手形是骗人的。这条只验到 DOM 层：
  // 系统真换了光标是操作系统口径的事，由 spike/cursor-probe.mjs 拿 GetCursorInfo 证。
  // 先确认面板是收着的：区域只在面板开着时才放大，否则这条会随上一条检查的状态飘。
  await feed({ x: 4, y: 4 })
  await page.waitForTimeout(PANEL_HIDE_MS + 400)
  assert.equal((await dbg()).open, false, '前置：面板该已收起')

  const stage = await page.evaluate(() => {
    const r = document.querySelector('.pet-stage').getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y) }
  })
  await feed({ x: stage.x + 2, y: stage.y + 2 })
  assert.equal(await overClass(), false, '面板没开时，舞台左上角那截透明空白也算进了区域')

  const h = await page.evaluate(() => window.__petDebug.hitBox)
  await feed({ x: h.x + h.w / 2, y: h.y + h.h / 2 })
  assert.equal(await overClass(), true, '进到身体命中区没换光标')

  // 规则本身：值只有 --pet-cursor 一份，用的地方三处（body 状态、按钮、设置底板）。
  // 热点是指尖那一格（PNG alpha 实测量出顶边 y=2、x 跨 8..11）。
  const decl = await page.evaluate(() => {
    const out = { var: null, users: [] }
    for (const sheet of document.styleSheets) {
      for (const r of sheet.cssRules) {
        if (r.selectorText === ':root') out.var = r.style.getPropertyValue('--pet-cursor')
        if (['body.pet-over', '.pet-plate', '.pet-panel button'].includes(r.selectorText)) {
          out.users.push(r.selectorText)
          if (r.style.cursor !== 'var(--pet-cursor)') out.users.push(`${r.selectorText}≠var`)
        }
      }
    }
    return out
  })
  assert.ok(decl.var, '样式表里没有 --pet-cursor 这条定义')
  assert.match(decl.var, /icons\/hand_point\.svg/, `光标没指向 hand_point：${decl.var}`)
  assert.match(decl.var, /9 2/, `热点不是量出来的指尖：${decl.var}`)
  assert.deepEqual(decl.users, ['body.pet-over', '.pet-plate', '.pet-panel button'],
    `三处没共用同一枚光标：${JSON.stringify(decl.users)}`)

  // 上一轮图标 404 就是栽在 MIME 白名单：文件在磁盘上不等于取得到，光标同理
  const got = await page.evaluate(async () => {
    const r = await fetch('icons/hand_point.svg')
    return { status: r.status, type: r.headers.get('content-type') }
  })
  assert.equal(got.status, 200, `光标素材取不到：${JSON.stringify(got)}`)
  assert.equal(got.type, 'image/svg+xml', `MIME 不对：${JSON.stringify(got)}`)
})

check('交互区是连续的：身体—空隙—按钮一路不掉', async () => {
  // 用户要的是"一路都是同一枚手"。两个矩形各自命中时中间那截会落空，
  // 所以区域取身体与开着的面板的外接矩形。
  assert.ok(await openOnBody(), '前置：面板该开着')

  const geo = await page.evaluate(() => {
    const b = window.__petDebug.hitBox
    const p = document.querySelector('.pet-actions').getBoundingClientRect()
    const bs = [...document.querySelectorAll('.pet-panel button')].map((x) => x.getBoundingClientRect())
    const bx = b.x + b.w / 2
    // 身体与面板之间那段：面板在脚下就取两者中间，在头顶也一样
    const between = p.y > b.y + b.h
      ? { x: bx, y: b.y + b.h + (p.y - b.y - b.h) / 2 }
      : { x: bx, y: p.y + p.height + (b.y - p.y - p.height) / 2 }
    return { between, gap: { x: (bs[0].right + bs[1].left) / 2, y: bs[0].top + bs[0].height / 2 } }
  })
  await feed(geo.between)
  assert.equal(await overClass(), true, `身体与面板中间那段掉出了区域 @${JSON.stringify(geo.between)}`)
  await feed(geo.gap)
  assert.equal(await overClass(), true, `两个按钮之间的空隙掉出了区域 @${JSON.stringify(geo.gap)}`)

  // 区域放大了，但"算不算有人在使用"仍然只问 DOM 命中：停在看不见的空隙里不该续命，
  // 否则吞掉桌面点击的那段时间就没有上界了。
  await page.waitForTimeout(PANEL_HIDE_MS + 400)
  assert.equal((await dbg()).open, false, '停在空隙里把面板续住了')
  assert.equal(await overClass(), false, '面板收起后区域没缩回身体')
})

const bubbleCenter = () => page.evaluate(() => {
  const r = document.querySelector('.pet-bubble').getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
})

check('气泡：显示、覆盖、到点收起、悬停续命、跟着宠物走、长按码点截断', async () => {
  const open = () => page.evaluate(() => window.__petDebug.bubbleOpen)
  const text = () => page.evaluate(() => window.__petDebug.bubbleText)

  assert.equal(await open(), false, '前置：开局不该有气泡')
  /**
   * 先把光标挪到空地上。续命判据读的是「最后已知光标」，而上一条检查留下的坐标
   * 正好落在新气泡底下（面板原本就在头顶，气泡也往上摆），不清干净的话气泡会被
   * 一根根本不存在的手指一直续着——上一轮 e2e 就是因为这类残留状态飘红过。
   */
  await feed({ x: 4, y: 4 })
  await page.evaluate(() => window.__petDebug.say('今天也想玩', 400))
  assert.equal(await open(), true, 'say 之后没显示')
  assert.equal(await text(), '今天也想玩')

  // 覆盖而不是叠加：同一时刻只许有一个气泡
  await page.evaluate(() => window.__petDebug.say('在呢在呢', 400))
  assert.equal(await page.evaluate(() => document.querySelectorAll('.pet-bubble').length), 1, '叠了两个气泡')
  assert.equal(await text(), '在呢在呢')

  // 收起 = 真的移出布局（和面板同一条规矩，problem/05 §5.3）
  await page.waitForTimeout(500)
  assert.equal(await open(), false, '到点没收起')
  await page.waitForTimeout(300)          // 等淡出的离散过渡走完，display 才真的换掉
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.pet-bubble')).display), 'none',
    '收起的气泡还在布局里，会照样吃点击')

  // 超长按码点截断加省略号（24 字上限）
  const long = await page.evaluate(() => {
    window.__petDebug.say('一'.repeat(40), 300)
    return window.__petDebug.bubbleText
  })
  assert.equal([...long].length, 25, `该截到 24 字 + 省略号，实际 ${long}`)
  assert.ok(long.endsWith('…'), `没加省略号：${long}`)

  // 空文本等于不显示
  assert.equal(await page.evaluate(() => window.__petDebug.say('   ', 300)), false, '空白文本也挂了个空气泡')

  // 悬停续命：光标压在气泡上，到点不该收
  await page.evaluate(() => window.__petDebug.say('别走别走', 400))
  await feed(await bubbleCenter())
  await page.waitForTimeout(900)
  assert.equal(await open(), true, '光标还压在气泡上就收走了')
  // 但停在气泡上不该把按钮面板叫出来：气泡是内容不是控件（读一句话就把按钮弹出来很怪）
  assert.equal((await dbg()).open, false, '停在气泡上把面板叫出来了')

  // 离开后续命停止
  await feed({ x: 4, y: 4 })
  await page.waitForTimeout(900)
  assert.equal(await open(), false, '离开气泡后也没收')

  // 跟随：宠物挪走，气泡得跟着挪
  await page.evaluate(() => window.__petDebug.say('跟我走', 4000))
  const before = await page.evaluate(() => document.querySelector('.pet-bubble').style.transform)
  const h = await page.evaluate(() => window.__petDebug.hitBox)
  await page.evaluate((p) => window.__petDebug.moveTo(p), { x: h.x - 260, y: h.y })
  await page.waitForTimeout(150)
  const after = await page.evaluate(() => document.querySelector('.pet-bubble').style.transform)
  assert.notEqual(after, before, '宠物走了气泡还钉在原地')

  // 交互区覆盖气泡：光标停在气泡正中时 pet-over 为真（位置已经跟着挪过，要重新量）
  await feed(await bubbleCenter())
  assert.equal(await overClass(), true, '光标在气泡上却没进交互区')

  /**
   * 堆叠：面板在头顶时，气泡必须整个悬在面板上面，两者不许叠在一起。
   * 这条是截图里看出可疑才补的——淡出中途的一帧不能当证据，得让布局自己回答。
   */
  await page.evaluate(() => window.__petDebug.say('叠在一起就看不清了', 60000))
  assert.ok(await openOnBody(), '前置：面板叫不出来就没有堆叠可验（收起时它不在布局里，量到的是全 0）')
  const stack = await page.evaluate(() => {
    const b = window.__petDebug.hitBox
    const p = document.querySelector('.pet-actions').getBoundingClientRect()
    const u = document.querySelector('.pet-bubble').getBoundingClientRect()
    return { panelAboveBody: p.y + p.height <= b.y, bubbleBottom: Math.round(u.y + u.height), panelTop: Math.round(p.y) }
  })
  assert.ok(stack.panelAboveBody, '前置：宠物站在地面时面板该在头顶')
  assert.ok(stack.bubbleBottom <= stack.panelTop + 1,
    `气泡压到面板上了：气泡底 ${stack.bubbleBottom} vs 面板顶 ${stack.panelTop}`)

  /**
   * 两块各自摆位之后多出两种堆法，都得单独问布局：
   * - 状态视图：读数挂在**侧面**。把它算进气泡要让路的那块，外接矩形的下沿会低到
   *   身体中线以下，bubbleAnchor 就判不出「面板在头顶」，气泡落回身体正上方压住按钮条。
   * - 食物视图：列表和按钮条在同一条中轴线上，气泡必须让到列表**外面**，不是让到按钮条外面。
   */
  await page.click('.pet-panel button[data-id="status"]')
  await page.waitForSelector('.pet-plate .pet-stat')
  await page.waitForTimeout(200)
  const withStats = await page.evaluate(() => {
    const a = document.querySelector('.pet-actions').getBoundingClientRect()
    const u = document.querySelector('.pet-bubble').getBoundingClientRect()
    return { bubbleBottom: Math.round(u.y + u.height), btnTop: Math.round(a.y) }
  })
  assert.ok(withStats.bubbleBottom <= withStats.btnTop + 1,
    `状态视图里气泡压住按钮条了：${JSON.stringify(withStats)}`)

  await page.click('.pet-panel button[data-id="feed"]')
  await page.waitForSelector('.pet-plate .pet-food')
  await page.waitForTimeout(200)
  const withFoods = await page.evaluate(() => {
    const p = document.querySelector('.pet-plate').getBoundingClientRect()
    const u = document.querySelector('.pet-bubble').getBoundingClientRect()
    return { bubbleBottom: Math.round(u.y + u.height), plateTop: Math.round(p.y) }
  })
  assert.ok(withFoods.bubbleBottom <= withFoods.plateTop + 1,
    `列表开着时气泡压住列表了：${JSON.stringify(withFoods)}`)

  await page.evaluate(() => window.__petDebug.hidePanel())

  await page.evaluate(() => window.__petDebug.hideBubble())
})

check('宠物贴屏幕顶时气泡越出去被裁掉，绝不压回宠物身上', async () => {
  const h0 = await page.evaluate(() => window.__petDebug.hitBox)
  await page.evaluate((p) => window.__petDebug.moveTo(p), { x: h0.x, y: 120 })
  await page.evaluate(() => {
    window.__petDebug.setLastTalk(0)
    window.__petDebug.say({ text: '顶上了也别说给我自己听', reply: '知道了' }, 60000)
  })
  await page.waitForTimeout(150)
  const g = await page.evaluate(() => {
    const u = document.querySelector('.pet-bubble').getBoundingClientRect()
    const b = window.__petDebug.hitBox
    return { top: Math.round(u.y), bottom: Math.round(u.y + u.height), bodyTop: Math.round(b.y) }
  })
  assert.ok(g.top < 0, `气泡该越出屏幕上沿，实际 top=${g.top}`)
  assert.ok(g.bottom <= g.bodyTop + 1, `气泡压到宠物身上了：底 ${g.bottom} vs 身体顶 ${g.bodyTop}`)

  // 拖回中间，它该整个回来
  const h1 = await page.evaluate(() => window.__petDebug.hitBox)
  await page.evaluate((p) => window.__petDebug.moveTo(p), { x: h1.x, y: 420 })
  await page.waitForTimeout(150)
  const back = await page.evaluate(() => {
    const u = document.querySelector('.pet-bubble').getBoundingClientRect()
    return { top: Math.round(u.y), bottom: Math.round(u.y + u.height), bodyTop: Math.round(window.__petDebug.hitBox.y) }
  })
  assert.ok(back.top >= 0, `拖回来气泡没完全回到屏幕内：top=${back.top}`)
  assert.ok(back.bottom <= back.bodyTop + 1, '回到中间反而压上宠物了')

  await page.evaluate(() => window.__petDebug.hideBubble())
})

check('气泡里的回应按钮：看得见、点得到、点完收掉', async () => {
  await feed({ x: 4, y: 4 })
  await page.evaluate(() => {
    window.__petDebug.setLastTalk(0)
    window.__petDebug.say({ text: '哇，是吃的！', reply: '吃吧吃吧' }, 60000)
  })
  const btn = page.locator('.pet-bubble-reply')
  assert.equal(await btn.textContent(), '吃吧吃吧', '按钮上不是那句短回应')
  const box = await btn.boundingBox()
  assert.ok(box && box.width >= 40 && box.height >= 14, `按钮小到点不到：${JSON.stringify(box)}`)
  // 按钮正中命中的必须是按钮自己：jsdom 量不到命中，只有 Chromium 的命中测试算数
  assert.equal(await page.evaluate((b) => {
    const el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)
    return el !== null && el.closest('.pet-bubble-reply') !== null
  }, box), true, '按钮被别层盖住了，用户点不到')

  await btn.click()
  assert.equal(await page.evaluate(() => window.__petDebug.bubbleOpen), false, '点了回应按钮气泡没收')
  assert.equal(await page.evaluate(() => window.__petDebug.bubbleText), '', '收了还留着字')
  // 定时器归装配层管：点完不该还挂着一条 60 秒的尾巴
  assert.equal(await page.evaluate(() => window.__petDebug.bubbleDeadlinePending), false,
    '点完按钮定时器还挂着')

  // 没配回复就不该有颗点不动的按钮占位
  await page.evaluate(() => window.__petDebug.say({ text: '嗯？' }, 60000))
  assert.equal(await page.evaluate(() => document.querySelector('.pet-bubble-reply').hidden), true)
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.pet-bubble-reply')).display), 'none',
    'hidden 没真的移出布局——作者样式又把 UA 那条顶掉了（面板的老坑）')
  await page.evaluate(() => window.__petDebug.hideBubble())
})

check('idle 那一拍按概率开口；事件驱动的必说；冷却挡住连点', async () => {
  const tick = () => page.evaluate(() => window.__petDebug.tickAmbientForTalk())
  const text = () => page.evaluate(() => window.__petDebug.bubbleText)
  const open = () => page.evaluate(() => window.__petDebug.bubbleOpen)
  const clocks = (talk, inter, rng) => page.evaluate((v) => {
    window.__petDebug.hideBubble()
    window.__petDebug.setLastTalk(v.talk)
    window.__petDebug.setLastInteraction(v.inter)
    window.__petDebug.setTalkRng(v.rng)
  }, { talk, inter, rng })

  // 掷不中概率：idle 闭嘴
  await clocks(0, 0, 0.99)
  assert.equal(await tick(), false, '没掷中概率还是说了话')

  // 掷中了：该冒一句
  await clocks(0, 0, 0.1)
  assert.equal(await tick(), true, '闲到交出决策权却一句话都没说')
  assert.ok((await text()).length > 0, '气泡开了但里面没字')

  // 冷却：刚说过，点按钮不该又冒一句新的
  const before = await text()
  // 用 openOnBody 而不是 feed(身体)：feed 只喂光标坐标、不点击，2026-11-04 起面板要点击才出。
  // 以前这条能过，靠的是上一条检查收尾时面板还开着——那是接残局，不是自证前置（§5.13）。
  assert.ok(await openOnBody(), '前置：面板叫不出来就没有「点按钮」这回事')
  await page.click('.pet-panel button[data-id="game"]')
  assert.equal(await text(), before, '25 秒冷却没挡住，连着冒了第二句')

  // 事件必说：把 rng 钉在掷不中 idle 的值上，点按钮仍然要回话
  await clocks(0, Date.now(), 0.99)
  await page.click('.pet-panel button[data-id="game"]')
  assert.equal(await open(), true, '点了按钮没回话——事件驱动的台词不许看概率')

  /**
   * 收尾：自己改过的状态自己还原（problem/06 §6.6 是双向的）。
   * 交互时钟拨回现在、rng 留在掷不中的值上，后面的面板检查才不会撞上
   * 「宠物自己开口」和「面板还开着」这两种残留——上一轮就是这么把
   * 「刚进去就弹出了」那条搞红的。
   */
  await clocks(Date.now(), Date.now(), 0.99)
  await feed({ x: 4, y: 4 })
  await page.waitForTimeout(PANEL_HIDE_MS + 400)
})
const dbg = () => page.evaluate(() => ({
  open: window.__petDebug.panelOpen,
  pool: window.__petDebug.current.pool,
  sends: window.__petDebug.grabSends,
  grab: window.__petDebug.grabRequested,
  hit: window.__petDebug.hitBox,
  inner: { w: window.innerWidth, h: window.innerHeight },
}))

check('点一下身体出面板，再点一下收起，五个按钮齐全', async () => {
  const h = await page.evaluate(() => window.__petDebug.hitBox)
  const center = { x: h.x + h.w / 2, y: h.y + h.h / 2 }
  await page.evaluate(() => window.__petDebug.hidePanel())
  // 鼠标停在身体上**不该**弹面板（2026-11-04 改：以前停留 400ms 就弹）。
  // 只喂一次、然后等过原来那个 400ms 的门槛，弹了就是没改干净。
  await feed(center)
  await page.waitForTimeout(600)
  assert.equal((await dbg()).open, false, '鼠标只是停在身体上，面板自己弹出来了——路过就闪又回来了')

  await clickBody(center)
  await page.waitForTimeout(120)
  assert.equal((await dbg()).open, true, '点了一下没把面板叫出来')
  const labels = await page.locator('.pet-panel button').evaluateAll((bs) =>
    bs.map((b) => `${b.getAttribute('aria-label')}=${b.querySelector('img')?.getAttribute('src')}`))
  assert.deepEqual(labels,
    ['喂食=icons/rice.svg', '小游戏=icons/game.svg', '状态=icons/heart.svg', '设置=icons/settings.svg',
      '说话=emotes/dots3.png'],
    `按钮的文字/图标不对：${JSON.stringify(labels)}`)
  // 图必须真的解码出来：路径错了 img 是 0×0，按钮看着就是一枚空片。
  // 先等 decode 落地再断言，否则抢到的是「还没解完」而不是「解不出来」。
  const decoded = await page.locator('.pet-panel button img').evaluateAll(async (imgs) => {
    await Promise.all(imgs.map((i) => i.decode().catch(() => {})))
    return imgs.map((i) => `${i.naturalWidth > 0}/${i.complete}`)
  })
  assert.deepEqual(decoded, ['true/true', 'true/true', 'true/true', 'true/true', 'true/true'],
    `图标没解码成功：${JSON.stringify(decoded)}`)

  // 圆底（Kenney button_round_depth_line）：计算样式里有 url 不算数——404 也照样在样式里，
  // 必须真的把它 decode 出来。这条同时钉住两条白名单（protocol 的 MIME 表 + copy-static 的 STATIC_EXT）。
  const disc = await page.evaluate(async () => {
    const b = document.querySelector('.pet-panel button[data-id]')
    const bg = getComputedStyle(b).backgroundImage
    const m = /url\("?([^")]+)"?\)/.exec(bg)
    if (!m) return { url: bg, ok: false }
    const img = new Image()
    img.src = m[1]
    try {
      await img.decode()
    } catch {
      return { url: m[1], ok: false }
    }
    return { url: m[1], ok: img.naturalWidth > 0, w: img.naturalWidth }
  })
  assert.ok(disc.ok, `圆底没加载出来：${JSON.stringify(disc)}`)
  // 钉住具体那一枚：只 decode 成功的话，素材换错名（line / depth_line 都在包里）也照样绿。
  assert.match(disc.url, /icons\/button_round_depth_line\.svg$/, `圆底不是 depth_line 那枚：${disc.url}`)
  // 圆底只给动作按钮：切进设置视图，那里的按钮有自己的方形底板，叠两层会像画歪了。
  // 要真的切过去看——动作视图里没有 .pet-setting 按钮，选择器写错就是一条永远为真的断言。
  await page.click('.pet-panel button[data-id="settings"]')
  await page.waitForSelector('.pet-panel .pet-setting')
  const plateBtn = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.pet-panel .pet-setting button')).backgroundImage)
  // 匹配整个 button_round_* 家族而不是具体一枚：素材换了名（line → depth_line）这条还得是真检查
  assert.ok(!/button_round/.test(plateBtn), `设置视图的按钮也被套上圆底了：${plateBtn}`)
  await page.evaluate(() => window.__petDebug.hidePanel())

  // 点击开的东西就得能点击关：重新点一下叫出来，再点一下收掉
  const h2 = await page.evaluate(() => window.__petDebug.hitBox)
  const center2 = { x: h2.x + h2.w / 2, y: h2.y + h2.h / 2 }
  await clickBody(center2)
  await page.waitForTimeout(120)
  assert.equal((await dbg()).open, true, '重新点一下没能再叫出面板')
  await clickBody(center2)
  await page.waitForTimeout(120)
  assert.equal((await dbg()).open, false, '再点一下没能把面板收掉')
})

check('五枚图标按实测墨迹逐枚定尺寸，说话那枚不被拉方', async () => {
  assert.ok(await openOnBody(), '前置：面板叫不出来就量不到图标')
  // 真实鼠标停在上一处点击的位置，悬停的 scale(1.15) 会把量到的矩形放大——先挪开
  await page.mouse.move(2, 2)
  await page.waitForTimeout(150)
  const icons = await page.evaluate(async () => {
    const list = [...document.querySelectorAll('.pet-actions button[data-id]')]
    await Promise.all(list.map((b) => b.querySelector('img').decode().catch(() => {})))
    return list.map((b) => {
      const i = b.querySelector('img')
      const r = i.getBoundingClientRect()
      return {
        id: b.dataset.id,
        box: `${Math.round(r.width)}x${Math.round(r.height)}`,
        nat: [i.naturalWidth, i.naturalHeight],
        shadow: getComputedStyle(i).filter,
      }
    })
  })
  assert.deepEqual(icons.map((i) => `${i.id}:${i.box}`),
    ['feed:20x20', 'game:24x24', 'status:24x24', 'settings:20x20', 'talk:18x21'],
    `图标尺寸和实测表不一致：${JSON.stringify(icons.map((i) => i.box))}`)
  const talk = icons.find((i) => i.id === 'talk')
  assert.ok(Math.abs(talk.box.split('x')[0] / talk.box.split('x')[1] - talk.nat[0] / talk.nat[1]) < 0.02,
    `说话那枚又被拉方了：渲染 ${talk.box} vs 素材 ${talk.nat.join('x')}`)
  // 只有白色实心那枚需要投影分边；深墨的四枚加投影只会在 2× 远程桌面上糊出灰晕
  const shadowed = icons.filter((i) => i.shadow !== 'none').map((i) => i.id)
  assert.deepEqual(shadowed, ['talk'], `投影没只留给白气泡：${JSON.stringify(shadowed)}`)
  await page.evaluate(() => window.__petDebug.hidePanel())
})

check('「说话」按钮：按顺序放台词，走完绕回，冷却拦不住它', async () => {
  // 这颗按钮是给调试气泡用的：必须**每点必出**，且能逐条把台词表走一遍。
  // 走 pickTalk 那条路就会被 25 秒冷却吞掉，点下去没反应——所以它绕开冷却，这条要钉住。
  const flow = await page.evaluate(async () => {
    const btn = document.querySelector('.pet-panel button[data-id="talk"]')
    if (!btn) return { missing: true }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const read = () => ({ open: window.__petDebug.bubbleOpen, text: window.__petDebug.bubbleText })
    // 把冷却拧成「刚刚说过」：正式链路这会儿绝不会开口
    window.__petDebug.setLastTalk(Date.now())
    const seq = []
    for (let i = 0; i < 3; i++) {
      btn.click()
      await sleep(40)
      seq.push(read())
    }
    const first = seq[0].text
    // 绕回不写死条数：一路点，把每句都记下来，直到又回到第一句。
    // 断言用「周期里每句都不重样」，这样加台词不会把这条检查弄红。
    let backAt = 0
    const cycle = []
    for (let i = 1; i <= 60; i++) {
      btn.click()
      await sleep(20)
      const t = window.__petDebug.bubbleText
      if (t === first) { backAt = i; break }
      cycle.push(t)
    }
    const tail = read()
    window.__petDebug.setLastTalk(0)
    return { seq, first, backAt, tail, cycle }
  })
  assert.ok(!flow.missing, '面板里没有 data-id="talk" 这颗按钮')
  assert.ok(flow.seq.every((s) => s.open), `点三次有没出气泡的：${JSON.stringify(flow.seq)}`)
  assert.notEqual(flow.seq[0].text, flow.seq[1].text, `连点两次还是同一句：${flow.seq[0].text}`)
  assert.notEqual(flow.seq[1].text, flow.seq[2].text, `连点两次还是同一句：${flow.seq[1].text}`)
  assert.ok(flow.backAt > 0, `点了 60 次也没绕回第一句，最后一句是：${flow.tail.text}`)
  assert.equal(new Set(flow.cycle).size, flow.cycle.length, `周期里有重样的句子：${JSON.stringify(flow.cycle)}`)
  await page.evaluate(() => window.__petDebug.hideBubble())
})

check('面板以角色的对称轴居中，不是贴着身体左沿', async () => {
  assert.ok(await openOnBody(), '前置：面板叫不出来')
  const g = await page.evaluate(() => {
    const b = window.__petDebug.hitBox
    const p = document.querySelector('.pet-actions').getBoundingClientRect()
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
    const b = document.querySelector('.pet-actions').getBoundingClientRect()
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

check('点喂食出食物列表；点一格播 click 池并回一句', async () => {
  assert.ok(await openOnBody(), '前置：面板叫不出来，按钮点不到')
  await page.click('.pet-panel button[data-id="feed"]')
  await page.waitForSelector('.pet-panel .pet-food')
  assert.equal(await page.evaluate(() => window.__petDebug.panelView), 'foods', '点喂食没进食物视图')
  assert.equal(await page.evaluate(() => document.querySelectorAll('.pet-panel .pet-food').length), 6)
  // 食物列表改用和状态读数同一张 CSS 卡片：没有 border-image、1px 描边、10px 圆角、6px 留白。
  // （以前这里钉的是 Kenney depth_line 的不对称九宫格 `8 8 12` 与 padding-box 配对，
  //   那套写法的理由留在 problem/03 §3.9；这一圈框被否掉了，见 §3.12。）
  const plate = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.pet-plate'))
    return {
      src: cs.borderImageSource,
      w: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].join('/'),
      pad: cs.paddingTop,
      bg: cs.backgroundColor,
      radius: cs.borderTopLeftRadius,
      shadow: cs.boxShadow,
    }
  })
  assert.equal(plate.src, 'none', `副板又铺上素材边框了：${plate.src}`)
  assert.equal(plate.w, '1px/1px/1px/1px', `描边厚度不对，该是卡片那一圈：${plate.w}`)
  assert.equal(plate.pad, '6px', `留白和另外两块副板不一致：${plate.pad}`)
  assert.equal(plate.bg, 'rgb(221, 238, 248)', `板面中心不是那个浅蓝：${plate.bg}`)
  assert.equal(plate.radius, '10px', `圆角不是卡片那版：${plate.radius}`)
  // 阴影必须是「只在下边」那一版：负 spread 一旦丢掉，透明窗里板顶外沿会漏出一层灰雾
  assert.ok(plate.shadow.includes('rgba(0, 0, 0'), `投影颜色不对：${plate.shadow}`)
  assert.ok(plate.shadow.includes('-4px'), `投影没有内收（上沿会漏灰雾）：${plate.shadow}`)
  // 格子底是 square_depth_line；翻页键是箭头图。两者都走那两条白名单，
  // 名字写错就是 404：格子变白片、箭头变空框，所以必须真的 decode 一次。
  // 格子退回 CSS 白卡：底板和格子以前铺同一套四层边，格子那个尺度上糊成框中框。
  // 所以这里要钉的是「格子**没有**背景图、板面是白卡」，而不是某个素材名。
  const art = await page.evaluate(async () => {
    const cs = getComputedStyle(document.querySelector('.pet-food'))
    const imgs = [...document.querySelectorAll('.pet-page img')]
    await Promise.all(imgs.map((i) => i.decode().catch(() => {})))
    return {
      cellBg: cs.backgroundImage,
      cellRadius: cs.borderTopLeftRadius,
      cellFont: cs.fontSize,
      arrows: imgs.map((i) => ({ src: i.getAttribute('src'), ok: i.naturalWidth > 0 })),
      labels: imgs.map((i) => i.closest('button')?.getAttribute('aria-label')),
    }
  })
  assert.equal(art.cellBg, 'none', `格子还铺着素材底，框中框没拆掉：${art.cellBg}`)
  assert.equal(art.cellRadius, '8px', `格子该是白卡的圆角：${art.cellRadius}`)
  assert.equal(art.cellFont, '12px', `格子字号该跟面板其余文字一致：${art.cellFont}`)
  assert.deepEqual(art.arrows, [
    { src: 'icons/arrow_basic_w_small.svg', ok: true },
    { src: 'icons/arrow_basic_e_small.svg', ok: true },
  ], `翻页键的箭头没加载出来：${JSON.stringify(art.arrows)}`)
  assert.deepEqual(art.labels, ['上一页', '下一页'], `箭头键的 label 没说清方向：${JSON.stringify(art.labels)}`)
  // 用户这次要的就是这条：列表出来时按钮不许消失，而且列表在按钮条**外侧**。
  // 只数 DOM 里有没有按钮不够——按钮得真能点（Playwright 的 click 会验可见与命中）。
  // 「外侧」不是「下面」：宠物站在屏幕最下沿时按钮条会翻到头顶，这时列表要在按钮条**上面**，
  // 中间那段永远留给身体。上一版把断言写成死往下，正好被这个位置打红。
  const stack = await page.evaluate(() => {
    const a = document.querySelector('.pet-actions').getBoundingClientRect()
    const p = document.querySelector('.pet-plate').getBoundingClientRect()
    const b = window.__petDebug.hitBox
    const away = b.y + b.h <= a.y + 1 ? 'below' : 'above'
    const gap = away === 'below' ? p.y - (a.y + a.height) : a.y - (p.y + p.height)
    return {
      btns: document.querySelectorAll('.pet-actions button[data-id]').length,
      away,
      gap: Math.round(gap),
      overlapsButtons: p.y < a.y + a.height && p.y + p.height > a.y,
      overlapsBody: p.y < b.y + b.h && p.y + p.height > b.y,
    }
  })
  assert.equal(stack.btns, 5, `列表开着按钮少了：${stack.btns} 颗`)
  assert.ok(!stack.overlapsButtons, `列表和按钮条叠住了：${JSON.stringify(stack)}`)
  assert.ok(!stack.overlapsBody, `列表压到身上了（该在按钮条外侧）：${JSON.stringify(stack)}`)
  assert.ok(stack.gap >= 4 && stack.gap <= 8, `列表与按钮条的间距该是 4..8px，现在 ${stack.gap}`)
  await page.click('.pet-actions button[data-id="game"]')
  await page.waitForTimeout(120)
  assert.equal(await page.evaluate(() => window.__petDebug.panelView), 'foods', '列表开着时点别的按钮不该把视图换掉')
  // 再点一次喂食 = 收回列表：不然除了等 5 秒自动收，没有别的关法
  await page.click('.pet-actions button[data-id="feed"]')
  await page.waitForTimeout(150)
  assert.equal(await page.evaluate(() => window.__petDebug.panelView), 'actions', '再点一次喂食没把列表收回')
  assert.equal(await page.evaluate(() => document.querySelector('.pet-plate')), null, '收回后副板还在布局里')
  // 下面还要验点一格播动画，先把列表叫回来——上面那串是「开关」检查，不该把残局留给后面
  await page.click('.pet-actions button[data-id="feed"]')
  await page.waitForSelector('.pet-panel .pet-food')
  // 一屏只露 4 格：视口是 overflow:hidden，其余靠滚
  // 12 格全在条上（视口只是没露出来），滚动才有东西可滚
  assert.equal(await page.evaluate(() => document.querySelectorAll('.pet-food-strip > *').length), 6)
  assert.ok(await page.evaluate(() => {
    const v = document.querySelector('.pet-food-viewport')
    return v.getBoundingClientRect().width < v.scrollWidth
  }), '视口没把内容夹住，滚动条就没有意义')

  // 点一格 → 播 click 池 + 出气泡（feed 台词）
  await page.evaluate(() => window.__petDebug.setLastTalk(0))
  await page.click('.pet-panel .pet-food[data-food="rice"]')
  await page.waitForFunction(() => window.__petDebug.current.pool === 'click', null, { timeout: 5000 })
  assert.equal((await dbg()).pool, 'click')
  assert.equal(await page.evaluate(() => window.__petDebug.bubbleOpen), true, '点了食物没回话')
  // 选完即收：列表压在宠物脚底那块，不收就看不到它吃。连喂的代价只是再悬停一次，
  // 而连喂的第二样本来会被 25 秒冷却吞掉台词，留着列表换不到什么。
  assert.equal((await dbg()).open, false, '点了食物但列表没收起')
  assert.ok(await openOnBody(), '前置：列表收掉之后面板叫不回来')
  assert.equal(await page.evaluate(() => window.__petDebug.panelView), 'actions', '重新叫出来还停在食物列表')
})

check('食物列表：整屏步进、到底置灰、拖横条、收起后复位', async () => {
  // 上一条检查现在会把列表收掉（选完即收），所以这条自己把列表叫出来，别接上一家的残局。
  // 先 hidePanel 再叫：上一条如果中途失败（比如底板素材断言炸了），列表会留在打开状态，
  // 那时点身体是「收起」而不是「叫出」，接下来的 feed 按钮就等 30 秒超时。
  await page.evaluate(() => window.__petDebug.hidePanel())
  assert.ok(await openOnBody(), '前置：面板叫不出来')
  await page.click('.pet-panel button[data-id="feed"]')
  await page.waitForSelector('.pet-panel .pet-food')
  const strip = () => page.evaluate(() => document.querySelector('.pet-food-strip').style.transform)
  const disabled = (dir) => page.evaluate((d) => document.querySelector(`.pet-page[data-page="${d}"]`).disabled, dir)

  assert.equal(await strip(), 'translateX(0px)', '前置：列表该从第一格开始')
  assert.equal(await disabled('prev'), true, '到顶了 prev 还亮着')
  assert.equal(await disabled('next'), false)

  await page.click('.pet-page[data-page="next"]')
  // 6 格只有 308 宽，视口 204 → 最大滚动 104，比一整屏步进 208 还小，按一次就到头。
  assert.equal(await strip(), 'translateX(-104px)', '6 格一步到底该是 -104')

  // 按到置灰为止，不是盲目按 8 次：到底之后 next 就该 disabled（上一条断言要的就是它），
  // 拿 page.click 去点一个 disabled 的按钮只会 30 秒超时——那是在等一个不该发生的事。
  for (let i = 0; i < 6 && !(await disabled('next')); i++) await page.click('.pet-page[data-page="next"]')
  assert.equal(await strip(), 'translateX(-104px)', '最大滚动该是 308−204=104')
  assert.equal(await disabled('next'), true, '到底了 next 还亮着，骗人去点')

  // 拖滑块：位移按轨道比例换算回去，所以拖 100px 不等于按一次翻页
  const box = await page.evaluate(() => {
    const t = document.querySelector('.pet-thumb').getBoundingClientRect()
    return { x: Math.round(t.x + t.width / 2), y: Math.round(t.y + t.height / 2) }
  })
  await page.evaluate((p) => {
    const thumb = document.querySelector('.pet-thumb')
    thumb.dispatchEvent(new MouseEvent('pointerdown', { clientX: p.x, clientY: p.y, bubbles: true }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: p.x - 100, clientY: p.y, bubbles: true }))
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: p.x - 100, clientY: p.y, bubbles: true }))
  }, box)
  const moved = await strip()
  assert.ok(parseFloat(moved.replace(/[^0-9.-]/g, '')) > -120, `拖横条没改变位置（还停在到底那格）：${moved}`)

  // 收起再打开 → 复位，不该停在用户上次看一半的位置
  await feed({ x: 4, y: 4 })
  await page.waitForTimeout(VIEW_HIDE_MS + 400)
  assert.ok(await openOnBody(), '前置：面板第二次叫不出来')
  await page.click('.pet-panel button[data-id="feed"]')
  assert.equal(await strip(), 'translateX(0px)', '重新打开还停在上次看一半的位置')

  // 交互区覆盖整块列表：两格之间那 4px 缝也该是手形（列表是 is-plate，整块吃命中）
  const seam = await page.evaluate(() => {
    const a = document.querySelector('.pet-food').getBoundingClientRect()
    const b = document.querySelectorAll('.pet-food')[1].getBoundingClientRect()
    return { x: Math.round((a.right + b.left) / 2), y: Math.round(a.top + a.height / 2) }
  })
  await feed(seam)
  assert.equal(await overClass(), true, `两格之间的缝掉出了交互区 @${JSON.stringify(seam)}`)

  await page.evaluate(() => window.__petDebug.hideBubble())
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
    const b = document.querySelector('.pet-actions').getBoundingClientRect()
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

check('拖拽动画挂在「真的拖起来了」那一刻，松手就切回环境链', async () => {
  const seen = await page.evaluate(async () => {
    const h = window.__petDebug.hitBox
    const from = { x: h.x + h.w / 2, y: h.y + h.h / 2 }
    const to = { x: from.x + 120, y: from.y - 60 }
    const fire = (type, p) => window.dispatchEvent(new PointerEvent(type, { clientX: p.x, clientY: p.y, bubbles: true }))
    const front = () => {
      const v = document.querySelector('.pet-video.is-front')
      return v ? v.src.split('/').slice(-2).join('/') : ''
    }
    fire('pointerdown', from)
    fire('pointermove', { x: from.x + 10, y: from.y })
    fire('pointermove', to)
    // 池是同步换的（requestClip 里就赋了 current），前台画面要等 loadeddata，所以先记下池再等一拍
    const poolAtMove = window.__petDebug.current.pool
    await new Promise((r) => setTimeout(r, 250))
    const during = { pool: poolAtMove, front: front(), talk: window.__petDebug.bubbleText }
    fire('pointerup', to)
    await new Promise((r) => setTimeout(r, 300))
    return { during, after: { pool: window.__petDebug.current.pool, front: front() } }
  })
  assert.strictEqual(seen.during.pool, 'drag', `拖拽中途还没换到 drag 池（现在是松手才换）：${JSON.stringify(seen.during)}`)
  assert.match(seen.during.front, /^drag\//, `拖拽中途前台还播着这条：${seen.during.front}`)
  assert.notStrictEqual(seen.after.pool, 'drag', `松手后仍停在 drag：${JSON.stringify(seen.after)}`)
  assert.match(seen.after.front, /^idle\//, `松手后前台没回到环境链：${seen.after.front}`)
})

check('点一下不动是「点」：走 click 池，绝不碰 drag', async () => {
  // 按下立刻算拖起是老逻辑的副产品：点身体也吃 drag 动画。加了位移阈值之后，
  // 没过阈值的那次必须是 click，否则「点一下」没有任何反应（点了必须有反应）。
  const seen = await page.evaluate(async () => {
    const h = window.__petDebug.hitBox
    const p = { x: h.x + h.w / 2, y: h.y + h.h / 2 }
    const fire = (type, q) => window.dispatchEvent(new PointerEvent(type, { clientX: q.x, clientY: q.y, bubbles: true }))
    const pools = [window.__petDebug.current.pool]
    // 按下与松开之间一个 await 都不留。留了空档，真实系统光标的 pointermove 就会挤进来
    // 把这次判成拖拽——按钮放大之后交互区更宽，窗口开着时鼠标更容易落在区内，概率明显上升。
    // 「点」的定义本来就是 down 和 up 之间没有别的输入进来。
    fire('pointerdown', p)
    fire('pointerup', p)
    pools.push(window.__petDebug.current.pool)
    await new Promise((r) => setTimeout(r, 300))
    const v = document.querySelector('.pet-video.is-front')
    pools.push(window.__petDebug.current.pool)
    return { pools, front: v ? v.src.split('/').slice(-2).join('/') : '' }
  })
  assert.ok(!seen.pools.includes('drag'), `只按下没移动就判成拖拽了：${JSON.stringify(seen.pools)}`)
  assert.strictEqual(seen.pools.at(-1), 'click', `松手后当前池不是 click：${JSON.stringify(seen.pools)}`)
  assert.match(seen.front, /^click\//, `点一下前台没播 click 素材：${seen.front}`)
  // 这一下点击同时把面板叫出来了，收干净再走下一条
  await page.evaluate(() => window.__petDebug.hidePanel())
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
  assert.equal((await dbg()).open, true, `设置视图在 ${PANEL_HIDE_MS}ms 后就收了，VIEW_HIDE_MS 没生效`)
  await page.waitForTimeout(VIEW_HIDE_MS)
  assert.equal((await dbg()).open, false, '设置视图最终也没收，收起逻辑被绕过了')

  // 收起后回动作视图；重新打开时看到的应该是按钮而不是设置页
  assert.ok(await openOnBody(), '前置：面板叫不回来')
  assert.equal(await page.locator('.pet-panel .pet-setting').count(), 0, '收起再开还停在设置视图')
  // 标签直接由 PANEL_BUTTONS 推：这里再抄一份清单，加按钮时就会多一处要记的账
  assert.deepEqual(await page.locator('.pet-panel button').evaluateAll((bs) =>
    bs.map((b) => b.getAttribute('aria-label'))), PANEL_BUTTONS.map((b) => b.label))
})

check('状态视图：竖在宠物右侧，名字与四条读数都在，颜色跟着数值走', async () => {
  // 先把宠物挪回中间：前面「贴右边缘」那几条会把它留在屏幕边上，
  // 那种位置下状态栏本来就该翻到左边，右侧断言会变成假失败。
  const inner = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
  await page.evaluate(() => window.__petDebug.hidePanel())
  await page.evaluate((p) => window.__petDebug.moveTo(p), { x: Math.round(inner.w / 2) - 90, y: inner.h - 260 })
  await page.waitForTimeout(150)
  assert.ok(await openOnBody(), '前置：面板叫不出来')
  await page.click('.pet-panel button[data-id="status"]')
  await page.waitForSelector('.pet-panel .pet-stat')
  const g = await page.evaluate(() => {
    const b = window.__petDebug.hitBox
    const p = document.querySelector('.pet-plate').getBoundingClientRect()
    const level = document.querySelector('.pet-stat[data-key="level"]')
    return {
      bodyRight: b.x + b.w, panelLeft: p.x, panelRight: p.right, inner: window.innerWidth,
      name: document.querySelector('.pet-stats-name')?.textContent,
      keys: [...document.querySelectorAll('.pet-stat')].map((r) => r.dataset.key),
      rows: [...document.querySelectorAll('.pet-stat:not([data-key="level"])')].map((r) => ({
        value: Number(r.querySelector('.pet-stat-value')?.textContent),
        band: r.querySelector('.pet-stat-bar')?.className,
        fill: r.querySelector('.pet-stat-bar > i')?.style.width,
      })),
      // 等级那一行：右端是 Lv.N，条是到下一级的进度，title 里带着累计经验
      level: level === null ? null : {
        text: level.querySelector('.pet-stat-value')?.textContent,
        fill: level.querySelector('.pet-stat-bar > i')?.style.width,
        hint: level.title,
      },
    }
  })
  assert.equal(g.name, '小鲸', `状态栏没显示存档里的名字：${g.name}`)
  assert.deepEqual(g.keys, ['level', 'hunger', 'mood', 'weight', 'bond'], '等级行没排在四条读数上面，或键名不对')
  assert.ok(g.panelLeft >= g.bodyRight - 1, `状态栏没在宠物右侧：panelLeft=${g.panelLeft} 身体右沿=${g.bodyRight}`)
  assert.ok(g.panelRight <= g.inner, `状态栏溢出屏幕右边：${g.panelRight} > ${g.inner}`)
  // 等级行自己得自洽：条宽 = (经验 % 10)/10，Lv = floor(经验/10)+1。
  // 这里不另抄一份公式，而是把 title 里那个「真实累计值」解出来反查渲染——两边不一致就是渲染算错了。
  const exp = Number(/累计经验 ([\d.]+)/.exec(g.level?.hint ?? '')?.[1] ?? Number.NaN)
  assert.ok(Number.isFinite(exp) && exp >= 0, `等级行的经验读数取不出来：${g.level?.hint}`)
  assert.equal(g.level.text, `Lv.${Math.floor(exp / 10) + 1}`, `等级和它对不上：${g.level.text} vs 经验 ${exp}`)
  assert.equal(g.level.fill, `${Math.round(((exp % 10) / 10) * 100)}%`, `进度条和累计经验对不上：${g.level.fill} vs ${exp}`)
  // 颜色必须跟着数字：分档写死在渲染里就会出「数值红了、条还是蓝的」那种假读数
  const bandOf = (v) => (v > 60 ? 'high' : v > 20 ? 'mid' : 'low')
  for (const r of g.rows) {
    assert.ok(r.value >= 0 && r.value <= 100, `读数越界：${r.value}`)
    assert.equal(r.band, `pet-stat-bar is-${bandOf(r.value)}`, `${r.value} 该是 ${bandOf(r.value)} 档：${r.band}`)
    assert.equal(r.fill, `${Math.round(r.value)}%`, `条宽和读数不一致：${r.fill} vs ${r.value}`)
  }
  await page.evaluate(() => window.__petDebug.hidePanel())
})

check('状态栏贴右边缘时翻到宠物左侧，而不是夹过来压住宠物', async () => {
  const inner = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
  await page.evaluate(() => window.__petDebug.hidePanel())
  await page.evaluate((p) => window.__petDebug.moveTo(p), { x: inner.w - 200, y: inner.h - 260 })
  await page.waitForTimeout(150)
  assert.ok(await openOnBody(), '前置：面板叫不出来')
  await page.click('.pet-panel button[data-id="status"]')
  await page.waitForSelector('.pet-panel .pet-stat')
  const g = await page.evaluate(() => {
    const b = window.__petDebug.hitBox
    const p = document.querySelector('.pet-plate').getBoundingClientRect()
    return { bodyLeft: b.x, panelRight: p.right, panelLeft: p.x }
  })
  assert.ok(g.panelRight <= g.bodyLeft + 1, `右侧放不下时该翻到左边，现在还压着宠物：panelRight=${g.panelRight} bodyLeft=${g.bodyLeft}`)
  await page.evaluate(() => window.__petDebug.hidePanel())
  await page.evaluate((p) => window.__petDebug.moveTo(p), { x: Math.round(inner.w / 2) - 90, y: inner.h - 260 })
})

check('喂食真的进了数值并落盘；点性别当场写进存档', async () => {
  // 断言拿「开机初值 70」比而不是比前后差：本套检查里前面已经喂过几次，
  // 饥饿可能已经顶到 100，那种时候「再喂一次会涨」是个不该成立的期待。
  await page.evaluate(() => window.__petDebug.hidePanel())
  const file = join(userData, 'save.json')
  const readSave = () => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      return null
    }
  }
  // 喂之前先抄一份：等级那本账要证的是「喂食进经验、但不进亲密条」，得有个对照
  const before = readSave()
  assert.ok(await openOnBody(), '前置：面板叫不出来')
  await page.click('.pet-panel button[data-id="feed"]')
  await page.waitForSelector('.pet-panel .pet-food')
  await page.click('.pet-panel .pet-food[data-food="hotpot"]')

  let stats = null
  for (let i = 0; i < 30; i++) {
    try {
      stats = JSON.parse(readFileSync(file, 'utf8')).stats
      if (stats && stats.hunger > 70) break
    } catch {
      /* 还没写出来 */
    }
    await page.waitForTimeout(100)
  }
  assert.ok(stats !== null, '存档里读不到 stats')
  assert.ok(stats.hunger > 70, `喂了火锅饥饿没涨（初值 70）：${stats.hunger}`)
  assert.ok(stats.weight > 50, `喂了火锅体重没涨（初值 50）：${stats.weight}`)

  // 经验：喂一次要涨。这里**不钉具体数值**——本套检查前面已经喂过几次，这一发常常落在
  // 10 分钟窗口内（于是是 0.1 而不是 0.2）；全额/减半那两条时序规则由 test/stats-runtime.test.ts 钉。
  const saved = readSave()
  assert.ok(typeof saved?.exp === 'number', `喂食没把经验写进存档：${JSON.stringify(saved?.exp)}`)
  assert.ok(saved.exp > (before?.exp ?? 0), `喂食经验没涨：${before?.exp} → ${saved.exp}`)
  // 而亲密条**不该动**（两条账分开）：留一点余量是因为主进程每 60 秒会结算一次自然衰减，
  // 那一档只有 0.2/天≈0.00013/分，落在 0.01 以内。
  const bondDelta = Math.abs((saved.stats.bond ?? 0) - (before?.stats?.bond ?? 0))
  assert.ok(bondDelta < 0.01, `喂食不该抬亲密条，却动了 ${bondDelta}`)

  // 性别：一枚符号，点一下换档并落盘。
  // 以前这里是两颗按钮（雌/雄）点其中一颗——断言「选中态换了」其实只验了类名。
  // 现在符号本身就是状态，所以验的是「档位 + 字符 + 颜色」三样一起换过去。
  await page.evaluate(() => window.__petDebug.hideBubble())
  await page.evaluate(() => window.__petDebug.hidePanel())
  assert.ok(await openOnBody(), '前置：面板叫不回来')
  await page.click('.pet-panel button[data-id="status"]')
  await page.waitForSelector('.pet-panel .pet-gender')
  const glyph = () => page.evaluate(() => {
    const b = document.querySelector('.pet-panel .pet-gender')
    if (!b) return null
    return {
      gender: b.dataset.gender,
      text: b.textContent,
      color: getComputedStyle(b).color,
      label: b.getAttribute('aria-label'),
    }
  })
  const beforeGender = await glyph()
  assert.equal(beforeGender?.gender, 'female', `开局该是雌：${JSON.stringify(beforeGender)}`)
  assert.equal(beforeGender?.text, '♀', `雌的符号不是 ♀：${JSON.stringify(beforeGender)}`)
  assert.equal(beforeGender?.color, 'rgb(224, 85, 154)', `雌的符号该是粉色：${beforeGender?.color}`)
  await page.click('.pet-panel .pet-gender')
  let picked = await glyph()
  for (let i = 0; i < 30 && picked?.gender !== 'male'; i++) {
    // 落盘 → 主进程广播快照 → 渲染层重绘，这一圈比一次点击慢
    await page.waitForTimeout(100)
    picked = await glyph()
  }
  assert.deepEqual(picked, {
    gender: 'male', text: '♂', color: 'rgb(74, 134, 216)', label: '雄（点一下换成雌）',
  }, `点完性别没换档：${JSON.stringify(picked)}`)
  let identity = null
  for (let i = 0; i < 30; i++) {
    try {
      identity = JSON.parse(readFileSync(file, 'utf8')).identity
      if (identity?.gender === 'male') break
    } catch {
      /* 还没写出来 */
    }
    await page.waitForTimeout(100)
  }
  assert.equal(identity?.gender, 'male', `性别没落盘：${JSON.stringify(identity)}`)
  assert.equal(identity?.name, '小鲸', `改性别把名字弄丢了：${JSON.stringify(identity)}`)
  // 返回按钮没了：卡片上除了性别符号不该再有别的可点项
  const clickable = await page.evaluate(() =>
    [...document.querySelectorAll('.pet-plate.is-stats button')].map((b) => b.className))
  assert.deepEqual(clickable, ['pet-gender is-male'], `状态栏里还有别的按钮：${JSON.stringify(clickable)}`)
  await page.evaluate(() => window.__petDebug.hidePanel())
})
check('离开身体与面板满 1500ms 后面板自动收起', async () => {
  // 上一版这里直接喂离开坐标然后断言「收了」——可那时候面板已经被拖拽测试关掉了，
  // 断言的是「本来就没开」，什么都没测到。先把面板叫起来，再验它自己收回去。
  assert.ok(await openOnBody(), '前置条件：点一下身体该把面板叫出来')
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

check('点完食物列表自己收起：光标一动不动也要立刻放开鼠标', async () => {
  /**
   * codex 复审 #3 P1。wantGrab 以前只在光标事件里算，于是漏掉「DOM 自己消失」这条路：
   * 用户点一格食物 → 列表收起 → 鼠标还停在原来那块格子的位置（真的没动）→
   * 心跳继续每 250ms 给整屏续租，桌面点击被透明层吞掉，直到他动一下鼠标才纠正。
   * 上面那条「光标离开」的检查覆盖不到这里，因为它挪了光标。
   */
  assert.ok(await openOnBody(), '前置：面板叫不出来')
  await page.click('.pet-panel button[data-id="feed"]')
  await page.waitForSelector('.pet-plate .pet-food')
  const cell = await page.evaluate(() => {
    const r = document.querySelector('.pet-plate .pet-food').getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  await feed(cell)
  assert.equal((await dbg()).grab, true, '前置：光标压在格子上，该接住鼠标')
  await page.click('.pet-plate .pet-food')
  await page.waitForTimeout(120)
  assert.equal((await dbg()).open, false, '前置：选完即收，列表该已收起')
  assert.equal((await dbg()).grab, false, '列表消失了却没放开鼠标：整屏会继续吞点击，直到鼠标再动一下')
})

check('点气泡的回应按钮后：光标一动不动也要立刻放开鼠标', async () => {
  // 同一条派生状态的第二个入口：气泡是 bubble.ts 自己 hide 的，装配层只能靠回调收尾。
  await page.evaluate(() => window.__petDebug.hidePanel())
  await page.evaluate(() => {
    window.__petDebug.setLastTalk(0)
    window.__petDebug.say({ text: '这条留着验按钮', reply: '点我' }, 60000)
  })
  const btn = await page.evaluate(() => {
    const r = document.querySelector('.pet-bubble-reply').getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  await feed(btn)
  assert.equal((await dbg()).grab, true, '前置：光标压在回应按钮上，该接住鼠标')
  await page.click('.pet-bubble-reply')
  await page.waitForTimeout(120)
  assert.equal(await page.evaluate(() => window.__petDebug.bubbleOpen), false, '前置：点了回应气泡该收掉')
  assert.equal((await dbg()).grab, false, '气泡没了却没放开鼠标')
})

check('面板收起后真的移出布局：不吃点击、不改光标形状', async () => {
  // 真机症状：点完宠物移出去，光标在宠物上方那条带子里变成手指。
  // 根因是样式优先级：UA 的 `[hidden]{display:none}` 被作者样式
  // `.pet-panel{display:flex}` 顶掉了，所以「收起」只等于透明度 0，元素照旧占位、
  // 照旧参与命中测试，命中的还是带 cursor:pointer 的按钮。
  // 现在收起由 `.pet-panel[hidden]{display:none}` 显式做，命中判定也只问 DOM。
  // 前置自己把面板叫出来：以前这里只 feed 一个身体坐标就断言「面板开着」，
  // 靠的是上一条检查收尾时面板还没关——feed 不点击，面板早就收干净了它就该红
  // （§5.13 同一类坑，本轮被我新加的两条检查照出来了第三次）。
  assert.ok(await openOnBody(), '前置：面板该开着')
  const band = await page.evaluate(() => {
    const b = document.querySelector('.pet-actions').getBoundingClientRect()
    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }
  })
  await feed({ x: 4, y: 4 })
  await page.waitForTimeout(1600)
  assert.equal((await dbg()).open, false, '前置：面板该已收起')
  // open=false 是立刻生效的，display 却要等 0.18s 的离散过渡走完（淡出是故意留的）。
  // 这里等的是「它真的变成 none」这个条件，不是固定 400ms：覆盖层没焦点时过渡会被节流，
  // 固定等待在长跑里读到过还没换过去的 block——那测的是时序，不是行为。
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.pet-panel')).display === 'none',
    null,
    { timeout: 4000 },
  )
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
