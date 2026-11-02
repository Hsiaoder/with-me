/**
 * Spike：整屏透明覆盖层 + 保留硬件加速 + 带 alpha 的 webm，在真机上是否成立。
 *
 * 一次性验证代码，不进生产路径。跑法：npx electron spike/main.mjs
 * 证据落在 spike/out/（已 gitignore）。
 *
 * 四步观察里，「边缘」和「流畅」由本脚本自动出数；「穿透」和「让路」必须人眼看，见 README。
 *
 * 环境变量：
 *   SPIKE_SOAK_MS   总时长，默认 120000
 *   SPIKE_SHOT_MS   多久后截图，默认 20000
 *   SPIKE_HOLD=1    跑完不退出，留给人眼观察
 *
 * 注意：主进程入口不能写顶层 await。Electron 要等入口模块求值完才触发 ready，
 * `await app.whenReady()` 写在顶层就死锁——已实测复现，见 README。
 */
import { app, BrowserWindow, screen, ipcMain, desktopCapturer } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { alphaStats, diffScreens } from './analyze.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'out')
const CLIP = join(here, '..', 'skins', 'block', 'animation', 'idle', 'patrol.webm')
const SOAK_MS = Number(process.env.SPIKE_SOAK_MS ?? 120_000)
const SHOT_MS = Number(process.env.SPIKE_SHOT_MS ?? 20_000)
const SAMPLE_MS = 10_000
const CURSOR_MS = 33
/** 屏幕差分范围往外扩的余量（CSS 像素）。 */
const ROI_MARGIN_CSS = 60

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 硬件加速刻意保持开启——它就是被验证项，关掉这次 spike 就没有意义。
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

async function main() {
  await app.whenReady()
  mkdirSync(OUT, { recursive: true })

  const display = screen.getPrimaryDisplay()
  const scale = display.scaleFactor
  const win = new BrowserWindow({
    ...display.workArea,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
    },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true)
  win.once('ready-to-show', () => win.showInactive())

  const log = {
    startedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    display: { bounds: display.bounds, workArea: display.workArea, scaleFactor: scale },
    windowBounds: win.getBounds(),
    clip: CLIP,
    rendererEvents: [],
    rendererRects: null,
    grabChanges: [],
    cursorSamples: [],
    resourceSamples: [],
  }

  // 监听必须挂在 loadFile 之前：渲染层在 rAF 里就上报矩形，挂晚了这条消息直接丢掉。
  // 上一轮就是这么漏的——矩形没拿到，主进程只能回退到写死的宠物框，把提示框的白底
  // 和文字变化全算成「覆盖层漏色」，多出来 58200 个不透明像素和 3933 个差值像素。
  let lastCursor = null
  let grabbed = false

  ipcMain.on('spike:grab', (_e, on) => {
    const want = Boolean(on)
    log.grabChanges.push({ on: want, at: Date.now(), cursor: lastCursor })
    if (want === grabbed) return
    grabbed = want
    win.setIgnoreMouseEvents(!want)
  })

  ipcMain.on('spike:renderer', (_e, msg) => {
    if (msg.kind === 'rects') {
      log.rendererRects = msg.rects
      console.log('[renderer] rects', JSON.stringify(msg.rects))
      return
    }
    log.rendererEvents.push({ ...msg, at: Date.now() })
    console.log('[renderer]', JSON.stringify(msg))
  })

  await win.loadFile(join(here, 'index.html'), { query: { clip: CLIP } })

  // 穿透状态下网页收不到 mousemove，光标只能由主进程推进。
  const cursorTimer = setInterval(() => {
    const c = screen.getCursorScreenPoint()
    const b = win.getBounds()
    const p = { x: c.x - b.x, y: c.y - b.y }
    if (p.x === lastCursor?.x && p.y === lastCursor?.y) return
    lastCursor = p
    if (log.cursorSamples.length < 5000) log.cursorSamples.push({ ...p, at: Date.now() })
    win.webContents.send('spike:cursor', p)
  }, CURSOR_MS)

  function sampleResources(tag) {
    const metrics = app.getAppMetrics().map((m) => ({
      type: m.type,
      pid: m.pid,
      cpuPercent: m.cpu.percentCPUUsage,
      workingSetKB: m.memory.workingSetSize,
    }))
    const total = metrics.reduce((s, m) => s + m.cpuPercent, 0)
    const mem = metrics.map((m) => `${m.type}:${Math.round(m.workingSetKB / 1024)}MB`).join(' ')
    log.resourceSamples.push({ tag, at: Date.now(), totalCpuPercent: Number(total.toFixed(2)), metrics })
    console.log(`[res] ${tag} cpu=${total.toFixed(2)}% mem=${mem}`)
  }

  /** 抓整块屏幕的真实合成结果。thumbnailSize 必须显式给，否则默认只有 150x150。 */
  async function grabScreen(tag) {
    const size = {
      width: Math.round(display.size.width * scale),
      height: Math.round(display.size.height * scale),
    }
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size })
    const src = sources.find((s) => String(s.display_id) === String(display.id)) ?? sources[0]
    const image = src.thumbnail
    writeFileSync(join(OUT, `${tag}.png`), image.toPNG())
    console.log(`[shot] ${tag}.png`, JSON.stringify(image.getSize()))
    return image
  }

  async function captureEvidence() {
    sampleResources('shot')

    const rects = log.rendererRects ?? { pet: { x: 400, y: 300, w: 320, h: 180 } }
    const list = Object.values(rects)
    const page = await win.webContents.capturePage()
    const pagePng = page.toPNG()
    writeFileSync(join(OUT, 'page.png'), pagePng)
    log.pageCapture = { bytes: pagePng.length, size: page.getSize() }
    log.pageAlpha = alphaStats(page.toBitmap(), page.getSize(), scale, list)
    console.log('[page] alpha', JSON.stringify(log.pageAlpha))

    // 藏起来拍一张当基准，再显示出来拍一张：差出来的东西只该是宠物和提示文字
    win.hide()
    await sleep(800)
    const base = await grabScreen('screen-baseline')
    win.showInactive()
    await sleep(1500)
    const shot = await grabScreen('screen-with-pet')
    // 只比覆盖层自己占的那块屏幕：往外扩 60 CSS 像素，接住刚好溢出舞台边缘的漏色，
    // 再往外就是别的应用的地盘，它们动一下不该算到覆盖层头上。
    const bounds = list.reduce(
      (a, rc) => ({
        x: Math.min(a.x, rc.x), y: Math.min(a.y, rc.y),
        x1: Math.max(a.x1, rc.x + rc.w), y1: Math.max(a.y1, rc.y + rc.h),
      }),
      { x: Infinity, y: Infinity, x1: -Infinity, y1: -Infinity },
    )
    const roi = {
      x: bounds.x - ROI_MARGIN_CSS, y: bounds.y - ROI_MARGIN_CSS,
      w: bounds.x1 - bounds.x + ROI_MARGIN_CSS * 2,
      h: bounds.y1 - bounds.y + ROI_MARGIN_CSS * 2,
    }
    log.screenDiff = diffScreens(base.toBitmap(), shot.toBitmap(), shot.getSize(), scale, list, roi)
    console.log('[diff]', JSON.stringify(log.screenDiff))
  }

  setTimeout(() => { void captureEvidence() }, SHOT_MS)
  const sampler = setInterval(() => sampleResources('tick'), SAMPLE_MS)

  setTimeout(async () => {
    clearInterval(cursorTimer)
    clearInterval(sampler)
    sampleResources('last')
    log.gpu = await app.getGPUInfo('basic')
    log.featureStatus = app.getGPUFeatureStatus()
    log.grabbedAtExit = grabbed
    log.cursorSampleCount = log.cursorSamples.length
    log.cursorSamples = log.cursorSamples.slice(-30)
    writeFileSync(join(OUT, 'report.json'), JSON.stringify(log, null, 2))
    console.log('[done] report written; grab changes =', log.grabChanges.length)
    if (process.env.SPIKE_HOLD === '1') return
    win.destroy()
    app.exit(0)
  }, SOAK_MS)
}

void main()
