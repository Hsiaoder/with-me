import { describe, it, expect, vi } from 'vitest'
import { parseSample, createVisibilityPolicy, PROBE_SCRIPT, SHELL_CLASSES } from '../src/main/visibility.js'
import { spawn } from 'node:child_process'
import type { Platform } from '../src/main/platform.js'
import { mapScenario, type Settings } from '../src/shared/visibility.js'

const HIDE: Settings = { onFullscreen: 'hide', developerMode: false, muted: false }
const SHOW: Settings = { onFullscreen: 'show', developerMode: false, muted: false }

/** 只记录调了哪个动作，别真去碰 Electron。 */
function fakePlatform() {
  const calls: string[] = []
  const platform = { show: () => calls.push('show'), hide: () => calls.push('hide') } as unknown as Platform
  return { platform, calls }
}

describe('parseSample', () => {
  // 探测子进程只报事实（通知状态 + 前台是否铺满整屏），「算哪种场景」归 mapScenario 独管。
  it('解析 "<state> <covers>"', () => {
    expect(parseSample('5 False')).toEqual({ state: 5, covers: false })
    expect(parseSample(' 2 True ')).toEqual({ state: 2, covers: true })
    expect(parseSample('4 false')).toBeNull()   // 大小写敏感：PowerShell 打的是 True/False
  })

  it('垃圾行、缺列、越界状态都返回 null：保持上一次判断，绝不当成「没全屏」', () => {
    for (const l of ['', '  ', 'abc', '5', '5 Maybe', '5 True extra', '-1 True', '99 False', 'NaN False']) {
      expect(parseSample(l)).toBeNull()
    }
  })
})

describe('可见性策略的执行', () => {
  it('默认设置下任何场景都显示，一次 hide 都不调', () => {
    const { platform, calls } = fakePlatform()
    const w = createVisibilityPolicy(platform, SHOW)
    for (const s of ['none', 'fullscreen', 'presentation'] as const) w.setScenario(s)
    expect(calls).toEqual([])
  })

  it('设成隐藏后，全屏立刻隐藏，不等第二拍', () => {
    const { platform, calls } = fakePlatform()
    const w = createVisibilityPolicy(platform, HIDE)
    w.setScenario('fullscreen')
    expect(calls).toEqual(['hide'])
  })

  it('放映并入全屏：onFullscreen=隐藏时放映场景也收（过去它归 onPresentation，全屏设隐藏也漏收）', () => {
    const { platform, calls } = fakePlatform()
    const w = createVisibilityPolicy(platform, { onFullscreen: 'hide', developerMode: false, muted: false })
    w.setScenario('presentation')
    expect(calls).toEqual(['hide'])
  })

  it('恢复显示要连续 calm 拍都判定该显示，防抖', () => {
    const { platform, calls } = fakePlatform()
    const w = createVisibilityPolicy(platform, HIDE, 4)
    w.setScenario('fullscreen')
    expect(calls).toEqual(['hide'])
    // 状态在 2 和 5 之间自己翻是实测到的：单拍「该显示」不足以立刻 show
    w.setScenario('none')
    w.setScenario('fullscreen')   // 中途又全屏，计数清零
    w.setScenario('none')
    w.setScenario('none')
    w.setScenario('none')
    expect(calls, '才 3 拍，还不该放出来').toEqual(['hide'])
    w.setScenario('none')
    expect(calls).toEqual(['hide', 'show'])
  })

  it('reveal 跳过去抖，当场放出（探测进程死了不再有下一拍时用）', () => {
    const { platform, calls } = fakePlatform()
    const w = createVisibilityPolicy(platform, HIDE, 4)
    w.setScenario('fullscreen')
    expect(w.reveal()).toBe(true)
    expect(calls).toEqual(['hide', 'show'])
    expect(w.hidden).toBe(false)
    expect(w.reveal()).toBe(false)
    expect(calls, '已经显示着就不重复调').toEqual(['hide', 'show'])
  })

  it('手动隐藏时 reveal 不恢复显示，并明确报告没有恢复', () => {
    const { platform, calls } = fakePlatform()
    const w = createVisibilityPolicy(platform, SHOW)
    w.hideManually()

    expect(w.reveal()).toBe(false)
    expect(calls).toEqual(['hide'])
    expect(w.hidden).toBe(true)
  })

  it('改设置当场重新评估，不用等下一拍探测', () => {
    const { platform, calls } = fakePlatform()
    const w = createVisibilityPolicy(platform, HIDE)
    w.setScenario('fullscreen')
    expect(calls).toEqual(['hide'])
    w.setSettings(SHOW)
    expect(calls).toEqual(['hide', 'show'])
  })

  it('平时（none）不隐藏，即使设置是隐藏', () => {
    const spy = vi.fn()
    const w = createVisibilityPolicy({ hide: spy, show: spy } as unknown as Platform, HIDE)
    w.setScenario('none')
    expect(spy).not.toHaveBeenCalled()
  })

  it('手动隐藏压过后续自动样本，不会被探测器下一拍重新放出来', () => {
    const { platform, calls } = fakePlatform()
    const w = createVisibilityPolicy(platform, SHOW, 1)
    w.hideManually()
    w.setScenario('none')
    w.setScenario('fullscreen')
    expect(calls).toEqual(['hide'])
    expect(w.hidden).toBe(true)
  })

  it('手动显示清掉门控，并按当前普通场景立即恢复', () => {
    const { platform, calls } = fakePlatform()
    const w = createVisibilityPolicy(platform, SHOW, 4)
    w.hideManually()
    w.showManually()
    expect(calls).toEqual(['hide', 'show'])
    expect(w.hidden).toBe(false)
  })

  it('手动显示不越过「全屏时隐藏」设置', () => {
    const { platform, calls } = fakePlatform()
    const w = createVisibilityPolicy(platform, HIDE, 1)
    w.setScenario('fullscreen')
    w.hideManually()
    w.showManually()
    expect(calls).toEqual(['hide'])
    expect(w.hidden).toBe(true)
  })
})

/**
 * 探测脚本真跑一次。
 *
 * 为什么必须有：脚本语法坏掉时 stderr 是被我们丢掉的（`stdio: [..., 'ignore']`），
 * 于是整个可见性功能静默失效——不报错，只是永远不隐藏。单测覆盖不到这一层，
 * 只能真的把 PowerShell 起起来看它有没有打出可解析的一行。
 */
describe('探测脚本真的能跑', () => {
  const run = () =>
    new Promise<string>((resolve, reject) => {
      const encoded = Buffer.from(PROBE_SCRIPT(process.pid), 'utf16le').toString('base64')
      const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      let out = ''
      let err = ''
      const timer = setTimeout(() => {
        ps.kill()
        reject(new Error(`15 秒没输出。stderr: ${err.slice(0, 400)}`))
      }, 15_000)
      ps.stdout.on('data', (d: Buffer) => {
        out += d.toString()
        const m = /^\s*(\d{1,2} (?:True|False))\s/m.exec(out)
        if (m) {
          clearTimeout(timer)
          ps.kill()
          resolve(m[1]!)
        }
      })
      ps.stderr.on('data', (d: Buffer) => { err += d.toString() })
      ps.on('error', (e) => { clearTimeout(timer); reject(e) })
    })

  it(
    '第一行能被 parseSample 解析',
    async () => {
      if (process.platform !== 'win32') return
      const line = await run()
      expect(parseSample(line), `拿到的是「${line}」`).not.toBeNull()
    },
    30_000,
  )

  /** 同一份脚本再问一次前台窗口的类名（判据的输入，测试拿它才知道该期待什么）。 */
  const ask = (expr: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const encoded = Buffer.from(`${PROBE_SCRIPT(process.pid)}\n[Console]::Out.WriteLine(${expr})`, 'utf16le').toString('base64')
      const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      let out = ''
      let err = ''
      const timer = setTimeout(() => { ps.kill(); reject(new Error(`15 秒没输出。stderr: ${err.slice(0, 300)}`)) }, 15_000)
      ps.stdout.on('data', (d: Buffer) => {
        out += d.toString()
        // 前两行是探测循环自己打的（它会一直打），第三行才是我们要的类名——
        // 所以取**最后一行非空**，并在拿到之后立刻杀掉循环。
        const lines = out.split(/\r?\n/).filter((l) => l.trim() !== '')
        if (lines.length >= 3) { clearTimeout(timer); ps.kill(); resolve(lines[lines.length - 1]!.trim()) }
      })
      ps.stderr.on('data', (d: Buffer) => { err += d.toString() })
      ps.on('error', (e) => { clearTimeout(timer); reject(e) })
    })

  it('前台是系统自己的窗口时不许判成 fullscreen（锁屏那种铺满整屏的假全屏）', async () => {
    /**
     * 上一版写的是「没有全屏应用时不该判成 fullscreen」——那是在**赌机器状态**：
     * 跑测试的人前台开着一个无边框最大化的窗（在 Qoder Desktop 里跑就必然是），
     * 探针判 fullscreen 是对的，测试却红了。
     * 现在问的是不变量：**前台属于 SHELL 清单 → 一定不算全屏**。
     * 前台是别的东西时不断言（机器上真可能开着播放器/游戏，那是应该让路的场景）。
     */
    if (process.platform !== 'win32') return
    const cls = await ask('[PetVis.Native]::ForegroundClass()')
    const s = parseSample(await run())
    if (SHELL_CLASSES.includes(cls)) {
      expect(mapScenario(s!.state, s!.covers), `前台是系统窗口「${cls}」却判成了全屏——宠物会把自己藏掉`).not.toBe('fullscreen')
    }
  }, 30_000)
})
