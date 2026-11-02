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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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

try {
  const feed = (p) => page.evaluate((pt) => window.__petDebug.cursor(pt), p)
const dbg = () => page.evaluate(() => ({
  open: window.__petDebug.panelOpen,
  pool: window.__petDebug.current.pool,
  sends: window.__petDebug.grabSends,
  hit: window.__petDebug.hitBox,
  inner: { w: window.innerWidth, h: window.innerHeight },
}))

check('悬停满 400ms 出现面板，五个按钮齐全', async () => {
  const h = await page.evaluate(() => window.__petDebug.hitBox)
  const center = { x: h.x + h.w / 2, y: h.y + h.h / 2 }
  await feed(center)
  assert.equal((await dbg()).open, false, '刚进去就弹出了，停留计时没生效')
  await page.waitForTimeout(460)
  await feed(center)
  assert.equal((await dbg()).open, true, '停留满 400ms 后仍没弹出')
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
  await feed(center)
  const r = await page.evaluate(() => {
    const b = document.querySelector('.pet-panel').getBoundingClientRect()
    return { x: b.x, y: b.y, w: b.width }
  })
  assert.ok(r.x + r.w <= inner.w, `面板溢出右边缘：${r.x}+${r.w} > ${inner.w}`)
  assert.ok(r.x >= 0, `面板跑到左边外面：${r.x}`)
})

check('离开身体与面板满 400ms 后面板收起', async () => {
  await feed({ x: 5, y: 5 })
  await page.waitForTimeout(460)
  await feed({ x: 5, y: 5 })
  assert.equal((await dbg()).open, false, '离开了面板还没收')
})

app = await electron.launch({ args: ['.'], cwd: process.cwd() })
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
  console.log(`\ne2e：${checks.length - failed}/${checks.length} 通过`)
  if (failed) process.exitCode = 1
} finally {
  await app?.close()
}
