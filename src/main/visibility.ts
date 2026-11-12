import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Platform } from './platform.js'
import { decideVisibility, mapScenario, type Scenario, type Settings } from '../shared/visibility.js'

/**
 * 「什么时候显示宠物」。
 *
 * 前身是 fullscreen.ts 的自动让路。现在改成：探测子进程只**报事实**（通知状态 +
 * 前台窗口是否铺满整块屏），「算哪种场景、该不该显示」全在 TypeScript 这边——
 * 同一条规则在 PowerShell 里再写一遍的话，两边迟早对不上，而这里每条都能单测。
 *
 * 常驻子进程三条规矩照旧：不闪控制台窗口、别变孤儿（父进程没了自己退）、
 * 关机流程里由调用方 stop 收掉。脚本一律纯 ASCII：WinPS 5.1 读带中文的 .ps1 会解坏。
 */

export type Sample = { state: number; covers: boolean }

/**
 * 解析子进程的一行：`"<state> <True|False>"`。
 * 认不出就返回 null，调用方保持上一次判断——把垃圾行当成「没全屏」会误把宠物放出来。
 */
export function parseSample(line: string): Sample | null {
  const m = /^(\d{1,2}) (True|False)$/.exec(line.trim())
  if (!m) return null
  const state = Number(m[1])
  if (Number.isNaN(state) || state > 8) return null
  return { state, covers: m[2] === 'True' }
}

export interface VisibilityPolicy {
  setScenario(s: Scenario): void
  setSettings(s: Settings): void
  /** 用户从托盘明确要求隐藏：后续自动样本不能把窗口重新放出来。 */
  hideManually(): void
  /** 清掉手动隐藏门控，并按当前场景与设置立即重新判断。 */
  showManually(): void
  /** 立刻放出来，不走去抖。探测进程半路死掉时用——那时不会再有下一拍把状态翻回来。 */
  reveal(): void
  readonly hidden: boolean
}

/**
 * @param calm 连续多少拍「该显示」才真的显示出来。
 *
 * 为什么要去抖：topmost 窗口 hide/show 会让 Windows 重检那个全屏应用，
 * 通知状态会瞬间翻回非全屏，于是又满足显示条件——一条 1/0 就翻的写法会自己抖起来。
 * 实测也看到 state 在 2 和 5 之间自己跳。
 *
 * 但**用户主动改设置不抖**：那是明确的指令，必须当场生效。
 */
export function createVisibilityPolicy(
  platform: Platform,
  settings: Settings,
  calm = 4,
): VisibilityPolicy {
  let current = settings
  let scenario: Scenario = 'none'
  let hidden = false
  let manualHidden = false
  let clear = 0

  function apply(wantVisible: boolean, debounced: boolean): void {
    if (wantVisible) {
      if (!hidden) {
        clear = 0
        return
      }
      if (debounced && ++clear < calm) return
      clear = 0
      hidden = false
      platform.show()
      return
    }
    clear = 0
    if (hidden) return
    hidden = true
    platform.hide()
  }

  return {
    get hidden() {
      return hidden
    },
    setScenario(s) {
      scenario = s
      apply(!manualHidden && decideVisibility(s, current), true)
    },
    setSettings(s) {
      current = s
      apply(!manualHidden && decideVisibility(scenario, s), false)
    },
    hideManually() {
      manualHidden = true
      apply(false, false)
    },
    showManually() {
      manualHidden = false
      apply(decideVisibility(scenario, current), false)
    },
    reveal() {
      if (manualHidden) return
      clear = 0
      if (!hidden) return
      hidden = false
      platform.show()
    },
  }
}

/**
 * 探测脚本要排掉的「系统自己的窗口」类名。**这份清单是判据本体**，所以它是导出的数组，
 * 而不是埋在 PowerShell 字符串里的一段——测试要拿同一个清单问不变量，抄两份就必然漂。
 *   · 桌面（Progman/WorkerW）永远铺满整屏 → 不排就永远判成全屏
 *   · 锁屏（LockApp，类名 Windows.UI.Core.CoreWindow）矩形正好铺满工作区
 *     → 不排就「宠物一启动就把自己藏掉」（实测踩过）
 *   · 任务栏、Alt+Tab、任务视图同理，它们出现时不该改变决定
 */
export const SHELL_CLASSES: readonly string[] = [
  'Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd',
  'MultitaskingViewFrame', 'XamlExplorerHostIslandWindow', 'ForegroundStaging',
  'Windows.UI.Core.CoreWindow', 'ApplicationFrameWindow',
]

/** PowerShell 那段排除判据的字面量（`n == "Progman" || n == "WorkerW" || …`），由上面那份清单生成。 */
const SHELL_TEST = SHELL_CLASSES.map((c) => `n == "${c}"`).join(' || ')

/**
 * 探测脚本。导出它只为能被测试真跑一次：脚本语法坏掉时 stderr 是被丢掉的，
 * 整个可见性功能会静默失效，所以必须有一条「真的能打出可解析的一行」的证据。
 */
export const PROBE_SCRIPT = (parentPid: number): string => `
$ErrorActionPreference='SilentlyContinue'
Add-Type -Namespace PetVis -Name Native -MemberDefinition '
[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
[DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, int flags);
[DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
[StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public int dwFlags; }
public static bool Shell(string n) {
  return ${SHELL_TEST};
}
public static string ForegroundClass() {
  var c = new System.Text.StringBuilder(64); GetClassName(GetForegroundWindow(), c, 64); return c.ToString();
}
public static bool Covers(IntPtr h) {
  if (h == IntPtr.Zero) return false;
  var c = new System.Text.StringBuilder(64); GetClassName(h, c, 64);
  if (Shell(c.ToString())) return false;
  RECT r;
  MONITORINFO mi = new MONITORINFO();
  mi.cbSize = System.Runtime.InteropServices.Marshal.SizeOf(typeof(MONITORINFO));
  bool captioned = IsZoomed(h) && (GetWindowLong(h, -16) & 0xC00000) == 0xC00000;
  if (captioned || !GetWindowRect(h, out r) || !GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return false;
  return r.Left <= mi.rcMonitor.Left && r.Top <= mi.rcMonitor.Top && r.Right >= mi.rcMonitor.Right && r.Bottom >= mi.rcMonitor.Bottom;
}
'
$parent = ${parentPid}
while ($true) {
  if (-not (Get-Process -Id $parent -ErrorAction SilentlyContinue)) { break }
  $s = 0
  [void][PetVis.Native]::SHQueryUserNotificationState([ref]$s)
  [Console]::Out.WriteLine(("{0} {1}" -f $s, [PetVis.Native]::Covers([PetVis.Native]::GetForegroundWindow())))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 500
}`

export interface VisibilityWatch {
  stop(): void
  setSettings(s: Settings): void
  hideManually(): void
  showManually(): void
}

/**
 * 起探测并执行策略。
 *
 * 脚本里唯一的外来值是父进程 PID——只可能是 number，由 `process.pid` 给，
 * 不接受调用方传字符串，就没有被拼进 PowerShell 源码的空间。
 */
export function startVisibilityWatch(platform: Platform, settings: Settings): VisibilityWatch {
  if (process.platform !== 'win32') {
    const policy = createVisibilityPolicy(platform, settings)
    return {
      stop: () => {},
      setSettings: (s) => policy.setSettings(s),
      hideManually: () => policy.hideManually(),
      showManually: () => policy.showManually(),
    }
  }

  const policy = createVisibilityPolicy(platform, settings)
  let child: ChildProcess | null = null
  let dying = false
  let lastScenario: Scenario | null = null

  try {
    const encoded = Buffer.from(PROBE_SCRIPT(process.pid), 'utf16le').toString('base64')
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
  } catch (e) {
    console.error('[visibility] 探测进程起不来，宠物不会隐藏但功能照常：', e)
    return {
      stop: () => {},
      setSettings: (s) => policy.setSettings(s),
      hideManually: () => policy.hideManually(),
      showManually: () => policy.showManually(),
    }
  }

  if (child.stdout) {
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (dying) return
      const sample = parseSample(line)
      if (sample === null) return
      const next = mapScenario(sample.state, sample.covers)
      if (next !== lastScenario) {
        // 第一拍也要打：否则「从头到尾没变过」和「日志根本没收到」长得一模一样
        const tag = lastScenario === null ? '起始' : '变为'
        lastScenario = next
        // 显隐是用户唯一看得见、我们又最难复现的行为。留一行痕迹，
        // 「它为什么不见了」这类报障才有第一手证据，不用靠猜。
        console.log(`[visibility] 场景${tag} ${next}（state=${sample.state} covers=${sample.covers}）`)
      }
      policy.setScenario(next)
    })
  }
  child.on('error', (e) => console.error('[visibility] 探测进程出错：', e.message))
  // 探测半路死掉时宠物可能正藏着：再也没有下一行把状态翻回来。
  // 让路失效至少比宠物消失好，所以当场放出来。
  child.on('close', () => {
    if (dying) return
    const wasHidden = policy.hidden
    policy.reveal()
    if (wasHidden) console.error('[visibility] 探测进程退出，宠物已恢复显示，本轮不再隐藏')
  })

  return {
    stop() {
      if (dying) return
      dying = true
      child?.kill()
      child = null
    },
    setSettings(s) {
      policy.setSettings(s)
    },
    hideManually() {
      policy.hideManually()
    },
    showManually() {
      policy.showManually()
    },
  }
}
