/**
 * 一次性：可见性设置的端到端实测——真起一个全屏程序，看宠物藏不藏、回不回。
 *
 * 为什么不能只靠单测和 e2e：策略和解析都能测，但「一个全屏窗口到底会不会被判成
 * fullscreen」只有真机器知道。这条同时验两条判据：
 *   · SHQueryUserNotificationState 进 2/3/4
 *   · 或者前台窗口几何上铺满整块屏（covers）
 * 后者是我为「通知状态一直读 5 的无边框播放器」准备的兜底，不实测就是空话。
 *
 * 两个坑位都绕开了：
 *   · 不用 playwright 起宠物——它的 app.process().stdout 收不到主进程输出，
 *     「宠物没回来」这种失败就没有现场证据。
 *   · 全屏夹具到点自己 app.quit()，不靠外面 kill：kill 之后窗口可能还挂着，
 *     测出来的「不回来」到底是策略卡住还是窗口没关，根本分不清。
 *
 * 跑法：node spike/visibility-live.mjs
 */
import { spawn, execFile, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ELECTRON = require('electron')
const HERE = dirname(fileURLToPath(import.meta.url))

const work = mkdtempSync(join(tmpdir(), 'vis-live-'))
const petUd = join(work, 'pet')
const fsUd = join(work, 'fs-userdata')
mkdirSync(petUd, { recursive: true })
mkdirSync(fsUd, { recursive: true })

writeFileSync(join(petUd, 'save.json'), JSON.stringify({
  version: 1,
  skin: 'block',
  stats: { hunger: 80, mind: 80, clean: 80, mood: 80 },
  // 两档都设成隐藏：这条要验的是「设置成隐藏时真的会隐藏」
  settings: { onFullscreen: 'hide', onPresentation: 'hide' },
  lastSeenAt: 1,
}, null, 2), 'utf8')

const fixture = join(work, 'fullscreen-app.js')
writeFileSync(fixture, `
const { app, BrowserWindow } = require('electron')
app.setPath('userData', process.env.FS_UD)
app.whenReady().then(() => {
  const w = new BrowserWindow({ fullscreen: true, frame: false, width: 1600, height: 1000 })
  w.loadURL('data:text/html,<h1>fullscreen fixture')
  setTimeout(() => app.quit(), Number(process.env.FS_LIFE || 6000))
})
`, 'utf8')

/** 宠物窗口的可见性。PowerShell 起来一次要几百毫秒，所以轮询间隔给到 600ms。 */
async function petVisible() {
  const out = await new Promise((res) => {
    execFile('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(HERE, 'vis-window.ps1')],
      { encoding: 'utf8' }, (_e, stdout) => res(stdout))
  })
  return /visible=True/.test(out)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 必须异步等：用 execFileSync 轮询会把 Node 的事件循环堵死，
 * 被 spawn 的宠物往 stdout 打的日志一条回调都进不来，失败时就没有任何现场证据。
 */
async function waitFor(pred, budgetMs, what) {
  const t0 = Date.now()
  for (;;) {
    if (await pred()) return Date.now() - t0
    if (Date.now() - t0 >= budgetMs) throw new Error(`${what}（等了 ${(budgetMs / 1000).toFixed(0)} 秒）`)
    await sleep(600)
  }
}

const pet = spawn(ELECTRON, ['.'], {
  cwd: join(HERE, '..'),
  env: { ...process.env, PET_USER_DATA: petUd },
})
const lines = []
pet.stdout.on('data', (d) => lines.push(...d.toString().split(/\r?\n/).filter(Boolean)))
pet.stderr.on('data', (d) => lines.push(...d.toString().split(/\r?\n/).filter(Boolean)))

let fixtureChild = null
try {
  console.log(`基线 宠物可见 = ${await waitFor(() => petVisible(), 30_000, '宠物窗口一直没出现')}`)

  fixtureChild = spawn(ELECTRON, [fixture], {
    cwd: join(HERE, '..'),
    env: { ...process.env, FS_UD: fsUd, FS_LIFE: '9000' },
  })
  console.log(`全屏程序起来后宠物藏了 = ${await waitFor(async () => !(await petVisible()), 12_000, '全屏程序起来了，宠物却没藏')}`)

  // 等夹具自己退出（不 kill），再等宠物回来
  await new Promise((res) => fixtureChild.on('exit', res))
  console.log(`全屏程序退出后宠物回来了 = ${await waitFor(() => petVisible(), 15_000, '全屏程序退出了，宠物没回来')}`)
} finally {
  const scenes = lines.filter((l) => l.includes('[visibility]'))
  console.log(`\n主进程的场景读数（${scenes.length} 条）：`)
  for (const l of scenes.slice(-12)) console.log('  ' + l)
  if (!scenes.length) console.log('  ⚠ 一条都没有：要么探测子进程没起来，要么 stdout 又没收到')
  if (fixtureChild && !fixtureChild.killed) fixtureChild.kill()
  pet.kill()
}
