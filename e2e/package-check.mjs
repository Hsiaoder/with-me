/**
 * 装机产物验证：app:// 在 asar / app.asar.unpacked 之下到底能不能把媒体流出来。
 *
 * 为什么不复用 e2e/pet-check.mjs：那个跑的是源码树（dist/ 直接在磁盘上），
 * asar 这一层它碰不到，等于没验。
 *
 * 断言分两层，故意分开报：
 *   1) 代码层——index.html / ES module / CSS 取得到（asar 内，qqpet 已验证过的路）
 *   2) 媒体层——webm 分段解码出画面、mp3 出时长、woff2 取得到且装得上（asar 外才有意义）
 * 第 1 层红是打包坏了；第 2 层红才是那个未知数在响。
 *
 * 启动目标二选一（默认走等价回退路，见 launchOpts 上方注释）：
 *   默认          electron.exe + release/win-unpacked/resources/app.asar
 *   PKG_PROBE_EXE=1  release/win-unpacked/with-me.exe（args 必须为空，带了 '.' 反而起不来）
 *   开关只接受 '0' / '1'：设了别的值（CI 里写成 true 之类）立刻报错退出，不许静默落回等价路。
 *
 * 跑法：npm run dist && node e2e/package-check.mjs
 */
import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 被打产物所在的目录。默认 `release/win-unpacked`（`npm run dist` 的真产物）。
 *
 * 为什么留这个口子：做反向对照要「改点东西再重打一次」，而 electron-builder 每次都会先清空它的
 * 输出目录——直接往 `release/` 里 `--dir` 重来，一旦中途 EBUSY 就会把真产物掏成半个
 * （实测踩过：win-unpacked 只剩 resources/，探针随后超时，那次结果不作数）。
 * 所以反向对照一律用独立目录：
 *   npx electron-builder --win dir --config.directories.output=release-rc --config.electronDist=node_modules/electron/dist
 *   PKG_PROBE_ROOT=release-rc/win-unpacked node e2e/package-check.mjs
 */
const UNPACKED = join(process.cwd(), process.env.PKG_PROBE_ROOT ?? join('release', 'win-unpacked'))
const EXE = join(UNPACKED, 'with-me.exe')
const ASAR = join(UNPACKED, 'resources', 'app.asar')
const ELECTRON = join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe')

// 为什么默认不打装机 exe 而是 electron.exe + 同一份 app.asar：
//   - 本机装了 Device Guard / 智能应用控制，改名后的未签名 with-me.exe 直接被拦，electron.launch
//     报 "Process failed to launch!"（且 playwright 会泄漏一条异步 unhandledRejection 把 node 打死，
//     「先试 exe 失败再自动回退」这条路在这台机器上根本跑不稳）——是安全策略拦 exe，不是打包坏了。
//   - with-me.exe 只是 electron.exe 的改名版，resources/app.asar 与旁边的 app.asar.unpacked 是同一份产物，
//     electron.exe <app.asar> 走的是同一套 asar→unpacked 重定向。断言逐条不变，只换了启动方式，没放宽判据。
//   判定 A 的证据因此可由「仓库里的这条命令」复现。想直连装机 exe（能跑它的机器 / CI）就设 PKG_PROBE_EXE=1。
// 启动路必须显式：这份判定的价值就在「到底验的是哪个二进制」，静默回退等于把结论换个来源还不说。
const exeSwitch = process.env.PKG_PROBE_EXE
if (exeSwitch !== undefined && !['0', '1'].includes(exeSwitch)) {
  console.error(`PKG_PROBE_EXE 只接受 '0' 或 '1'，收到 ${JSON.stringify(exeSwitch)}`)
  process.exit(2)
}
const useInstalledExe = exeSwitch === '1'
let launchOpts
if (useInstalledExe) {
  if (!existsSync(EXE)) {
    console.error(`找不到 ${EXE}，先跑 npm run dist`)
    process.exit(1)
  }
  launchOpts = { executablePath: EXE, args: [] }
} else {
  if (!existsSync(ASAR) || !existsSync(ELECTRON)) {
    console.error(`缺 ${ASAR} 或 ${ELECTRON}，先跑 npm run dist`)
    process.exit(1)
  }
  launchOpts = { executablePath: ELECTRON, args: [ASAR] }
}

const userData = mkdtempSync(join(tmpdir(), 'pet-pkg-'))
const results = {}
let app

try {
  app = await electron.launch({ ...launchOpts, env: { ...process.env, PET_USER_DATA: userData } })
  console.log(`探针启动方式：${useInstalledExe ? `装机 exe ${EXE}` : `electron.exe + app.asar（等价回退）${ASAR}`}`)

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

  // 2) 媒体层——字体（woff2 也在 unpack 名单里）
  //   这一层要测的是「app:// 能不能把 woff2 供出来、装得上」，不是「当前 DOM 用没用到这支字体」。
  //   旧写法只 `await document.fonts.ready` 再 `fonts.check(...)`，而 check 只对「已加载」的 face
  //   返回 true：'WithMe Num' 仅被 .pet-float（飘字 +N，style.css:425-434）消费，默认待机画面里没有
  //   这个元素，那条 @font-face 根本不触发加载 → check 恒 false。这是脚本问错了问题的假阴，不是
  //   环境问题。改成从 CSS 的 @font-face 规则里同时读出 family 名和 src 的 url（文件名以 style.css
  //   为唯一真相，探针不写死文件名），对每支 woff2 先 fetch 断言 200 且字节数 > 0（app:// 供得出来），
  //   再显式 document.fonts.load 之后断言 check 为 true（装得上）。sans / num 两支都要覆盖。
  results.font = await page.evaluate(async () => {
    const faces = []
    for (const sheet of document.styleSheets) {
      let rules
      try {
        rules = sheet.cssRules // 跨源样式表读不到，跳过而不是抛
      } catch {
        continue
      }
      for (const rule of rules) {
        if (rule.type !== CSSRule.FONT_FACE_RULE) continue
        const family = rule.style.getPropertyValue('font-family').trim().replace(/^["']|["']$/g, '')
        const m = rule.style.getPropertyValue('src').match(/url\(["']?([^"')]+)["']?\)/)
        if (!family || !m) continue
        // src 里的 url 相对样式表解析；浏览器多半已归一成绝对，new URL 两种写法都能接住
        const url = new URL(m[1], sheet.href ?? document.baseURI).href
        const res = await fetch(url)
        const byteLength = (await res.arrayBuffer()).byteLength
        const spec = `12px "${family}"`
        // 逐支兜住 load 的异常：真坏包时 document.fonts.load 会以网络错误 reject，
        // 异常直接从 page.evaluate 冒出来——上一支还没进 faces、后面的字体也不再验，
        // 打印只剩一句裸 "A network error occurred."。包一层后失败变成一条带 loadError 的观测值，
        // 下面的断言照常逐条报「哪一支、取到什么状态、load 报了什么」。
        let loadError = null
        try {
          await document.fonts.load(spec)
        } catch (e) {
          loadError = String(e)
        }
        const checkAfterLoad = document.fonts.check(spec)
        faces.push({ family, url, status: res.status, byteLength, loadError, checkAfterLoad })
      }
    }
    return faces
  })
  assert.ok(results.font.length >= 2,
    `CSS 里登记到的 @font-face 不足两支（sans/num 没都进包？）：${JSON.stringify(results.font)}`)
  for (const f of results.font) {
    assert.equal(f.status, 200, `woff2 经 app:// 取不到（第 2 层媒体没流出来）：${JSON.stringify(f)}`)
    assert.ok(f.byteLength > 0, `woff2 取到了但是空文件：${JSON.stringify(f)}`)
    assert.ok(f.checkAfterLoad, `woff2 取得到却装不上（fonts.load 之后 check 仍 false）：${JSON.stringify(f)}`)
  }

  console.log('打包产物验证通过', JSON.stringify(results, null, 2))
} finally {
  // 失败路径也要收进程：launch 成功过才 close；close 自身报错不掩盖前面抛出的主异常。
  try {
    await app?.close()
  } catch {
    /* 压根没起来 / 已退出，别再在 finally 里抛第二个错 */
  }
  rmSync(userData, { recursive: true, force: true })
}
