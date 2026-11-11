/**
 * 装机产物验证：app:// 在 asar / app.asar.unpacked 之下到底能不能把媒体流出来。
 *
 * 为什么不复用 e2e/pet-check.mjs：那个跑的是源码树（dist/ 直接在磁盘上），
 * asar 这一层它碰不到，等于没验。
 *
 * 断言分两层，故意分开报：
 *   1) 代码层——index.html / ES module / CSS 取得到（asar 内，qqpet 已验证过的路）
 *   2) 媒体层——webm 分段解码出画面、mp3 出时长、woff2 真的生效（asar 外才有意义）
 * 第 1 层红是打包坏了；第 2 层红才是那个未知数在响。
 *
 * 跑法：npm run dist && node e2e/package-check.mjs
 */
import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EXE = join(process.cwd(), 'release', 'win-unpacked', 'with-me.exe')
if (!existsSync(EXE)) {
  console.error(`找不到 ${EXE}，先跑 npm run dist`)
  process.exit(1)
}

const userData = mkdtempSync(join(tmpdir(), 'pet-pkg-'))
const results = {}

try {
  const app = await electron.launch({
    executablePath: EXE,
    args: [],                       // 打包后的 exe 不需要 '.'，带了反而起不来
    env: { ...process.env, PET_USER_DATA: userData },
  })
  const page = await app.firstWindow()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e)))

  // 1) 代码层
  await page.waitForFunction(() => !!window.__petDebug, null, { timeout: 30_000 })
  assert.deepEqual(pageErrors, [], `渲染层抛了异常：${pageErrors.join('\n')}`)
  results.code = await page.evaluate(() => ({
    url: location.href,
    skinName: window.__petDebug.skinName,
  }))
  assert.match(results.code.url, /^app:\/\/assets\/renderer\/index\.html$/)

  // 2) 媒体层——动画
  await page.waitForFunction(
    () => (document.querySelector('video.is-front')?.videoWidth ?? 0) > 0,
    null, { timeout: 30_000 },
  )
  results.webm = await page.evaluate(() => {
    const v = document.querySelector('video.is-front')
    return { src: v?.currentSrc ?? '', w: v?.videoWidth ?? 0, h: v?.videoHeight ?? 0 }
  })
  assert.ok(results.webm.w > 0, `webm 解不出画面：${JSON.stringify(results.webm)}`)

  // 2) 媒体层——语音 manifest + 一条 mp3
  results.voiceManifest = await page.evaluate(async () => {
    const r = await fetch('voice/manifest.json')
    return { status: r.status, bytes: (await r.text()).length }
  })
  assert.equal(results.voiceManifest.status, 200, `语音表取不到：${JSON.stringify(results.voiceManifest)}`)
  assert.ok(results.voiceManifest.bytes > 1000, `语音表是空的：${JSON.stringify(results.voiceManifest)}`)

  results.mp3 = await page.evaluate(async () => {
    // manifest 是数组：[{globalIndex, reason, index, text, file}]，且 file 已经带 `voice/` 前缀
    const entries = await (await fetch('voice/manifest.json')).json()
    const file = entries[0]?.file
    const a = new Audio(file)
    await new Promise((res, rej) => {
      a.addEventListener('loadedmetadata', res, { once: true })
      a.addEventListener('error', rej, { once: true })
      setTimeout(() => rej(new Error('超时')), 15_000)
    })
    return { file, duration: a.duration }
  })
  assert.ok(Number.isFinite(results.mp3.duration) && results.mp3.duration > 0,
    `mp3 没有时长：${JSON.stringify(results.mp3)}`)

  // 2) 媒体层——字体（woff2 也是 unpack 名单里的）
  results.font = await page.evaluate(async () => {
    await document.fonts.ready
    return {
      sans: document.fonts.check('12px "WithMe Sans"'),
      num: document.fonts.check('12px "WithMe Num"'),
    }
  })
  assert.ok(results.font.sans && results.font.num, `字体没生效：${JSON.stringify(results.font)}`)

  await app.close()
  console.log('打包产物验证通过', JSON.stringify(results, null, 2))
} finally {
  rmSync(userData, { recursive: true, force: true })
}
