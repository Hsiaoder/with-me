/**
 * 「现在有没有播放器在放东西」——探测子进程只报事实，判断留在 TypeScript 这边。
 *
 * 数据源是 Windows 的系统媒体控制（SMTC / GSMTC）：凡是用系统媒体浮层的应用
 * （网易云、QQ音乐、Spotify、浏览器里放的音乐/视频、支持 SMTC 的播放器…）
 * 都会在里面登记一个会话，会话状态是 `Playing` 就算在放。
 * **宠物自己的台词语音也会登记会话**：Chromium 给页面里的 <audio> 建的就是 SMTC 会话，
 * AUMID 等于 app.setAppUserModelId 设的那个值。所以脚本必须按 AUMID 把自己排掉，
 * 否则每说一句就把自己掐掉（2026-11-14 实测：语音放一半断掉，日志里是 [media] 开始播放）。
 *
 * 这一层只做两件事：解析子进程吐的那一行、提供那段脚本。
 * 「据此怎么加动画权重」是 shared/animation.ts 的事。
 */

export type MediaSample = { playing: boolean; app: string }

/**
 * 解析探测子进程的一行：`0` 或 `1 <AUMID>`。
 *
 * 认不出返回 null（调用方保持上一次状态）。AUMID 里可能带空格，所以只按第一个
 * 空格切，后面整段都算 app。截到 120 字只是防脏数据，不参与任何判断。
 */
export function parseMediaSample(line: string): MediaSample | null {
  const t = line.trim()
  if (t === '') return null
  if (t === '0') return { playing: false, app: '' }
  const m = /^1 (.+)$/.exec(t)
  if (m === null) return null
  return { playing: true, app: (m[1] as string).slice(0, 120) }
}

/**
 * 探测脚本（纯 ASCII：WinPS 5.1 读带中文的 .ps1 会解坏，见 visibility.ts 顶部）。
 *
 * 结构和可见性探测同一条路子：常驻、父进程没了自己退、只往 stdout 打一行。
 * 唯一的外来值是父进程 PID（number，来自 process.pid），不接受字符串，
 * 就没有被拼进 PowerShell 源码的空间。
 *
 * 一秒一次：这里不需要跟手，而 WinRT 枚举会话并不便宜。
 * 起不来（没有媒体服务 / WinRT 不可用）就直接退出，主进程按「没有音乐」处理。
 */
export const MEDIA_PROBE_SCRIPT = (parentPid: number): string => `
$ErrorActionPreference='SilentlyContinue'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*'
})[0]
function Await($op, $type) {
  $m = $asTask.MakeGenericMethod($type)
  $task = $m.Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
try {
  $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
} catch { exit 1 }
if (-not $mgr) { exit 1 }
$parent = ${parentPid}
while ($true) {
  if (-not (Get-Process -Id $parent -ErrorAction SilentlyContinue)) { break }
  $app = ''
  $own = $env:PET_OWN_AUMID
  try {
    foreach ($s in $mgr.GetSessions()) {
      $id = [string]$s.SourceAppUserModelId
      if ($own -and $id -eq $own) { continue }
      $info = $s.GetPlaybackInfo()
      if ($info -and ("$($info.PlaybackStatus)" -eq 'Playing')) { $app = $id; break }
    }
  } catch { $app = '' }
  if ($app) { [Console]::Out.WriteLine(('1 ' + $app)) } else { [Console]::Out.WriteLine('0') }
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 1000
}
`
