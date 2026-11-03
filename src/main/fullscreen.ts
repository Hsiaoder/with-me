import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Platform } from './platform.js'

/**
 * 全屏应用让路。
 *
 * 置顶窗盖住全屏游戏和视频是必然结果，所以得知道「别人正占着整块屏幕」。
 * 问法是 Win32 的 `SHQueryUserNotificationState`：2/3/4 表示有全屏应用或演示模式。
 * Electron 没有这个 API，只能起一个 PowerShell 子进程每 500ms 问一次、把结果按行打出来。
 *
 * 常驻子进程有三条规矩（设计文档第 10 节）：不闪控制台窗口、别变成孤儿、
 * 关机流程里别再派生。第三条由调用方在 before-quit 里 stop 保证；
 * 第二条这里用「父进程不在了就自己退出」实现——不引 Job Object 是因为那要 native 代码。
 *
 * 脚本一律纯 ASCII：Windows PowerShell 5.1 读 .ps1 时按 ANSI 解码，
 * 带中文的脚本会被解坏（本项目在 spike 阶段真踩过），这里靠 -EncodedCommand 传 utf16le 绕过。
 */

const SCRIPT = (petHandle: string, parentPid: number): string => `
$ErrorActionPreference='SilentlyContinue'
Add-Type -Namespace PetProbe -Name Native -MemberDefinition '[System.Runtime.InteropServices.DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state); [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();'
$parent = ${parentPid}
while ($true) {
  if (-not (Get-Process -Id $parent -ErrorAction SilentlyContinue)) { break }
  $s = 0
  [void][PetProbe.Native]::SHQueryUserNotificationState([ref]$s)
  $mine = ([PetProbe.Native]::GetForegroundWindow() -eq [IntPtr]${petHandle})
  $yield = ($s -ge 2 -and $s -le 4 -and -not $mine)
  [Console]::Out.WriteLine([int]$yield)
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 500
}`

/** 让路判定：状态在 2..4（有人占着整屏）且前台不是宠物自己。非法值一律不让路。 */
export function mapNotificationState(state: number, isPetForeground: boolean): boolean {
  if (!Number.isInteger(state) || state < 2 || state > 4) return false
  return !isPetForeground
}

/** 解析子进程的一行输出。认不出的行返回 null，表示「保持上一次决定」。 */
export function shouldYieldLine(line: string): boolean | null {
  if (line === '1') return true
  if (line === '0') return false
  return null
}

/**
 * @param petHandle 宠物窗口的 HWND，十进制字符串。只允许数字——它会被拼进 PowerShell 源码。
 * @returns 停止探测的函数。非 Windows 平台返回空操作。
 */
export function startFullscreenWatch(platform: Platform, petHandle: string): () => void {
  if (process.platform !== 'win32') return () => {}
  if (!/^\d{1,20}$/.test(petHandle)) {
    console.error('[fullscreen] 窗口句柄不是十进制数字，放弃让路探测：', petHandle)
    return () => {}
  }

  let child: ChildProcess | null = null
  try {
    const encoded = Buffer.from(SCRIPT(petHandle, process.pid), 'utf16le').toString('base64')
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
  } catch (e) {
    console.error('[fullscreen] 探测进程起不来，宠物不会让路但功能照常：', e)
    return () => {}
  }

  let hiding = false
  let dying = false
  if (child.stdout) {
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (dying) return
      const next = shouldYieldLine(line)
      if (next === null || next === hiding) return
      hiding = next
      if (hiding) platform.hide()
      else platform.show()
    })
  }
  // 探测失败不影响宠物存在：PowerShell 被安全策略拦住时这里留个痕就好
  child.on('error', (e) => console.error('[fullscreen] 探测进程出错：', e.message))
  // 半路死掉时宠物可能正藏着：再也没有下一行输出把状态翻回来，它会一直隐到应用重启。
  // 不是主动 stop 的退出就当场恢复显示，让路失效至少比宠物消失好。
  child.on('close', () => {
    if (dying || !hiding) return
    hiding = false
    platform.show()
    console.error('[fullscreen] 探测进程退出，宠物已恢复显示，本轮不再让路')
  })

  const stop = (): void => {
    if (dying) return
    dying = true
    child?.kill()
    child = null
  }
  process.once('exit', stop)
  return stop
}
