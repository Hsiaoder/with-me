# 查宠物窗口此刻可见与否。node 每 600ms 调一次，输出单行 found=… visible=…。
#
# 标题必须写死：PowerShell 把脚本块转成委托后，块里读不到函数的参数变量，
# 连 $script: 也取不到（上一版用 $Title 比较，窗口明明在却永远报 found=False）。
# 字面量可以——同一个仓库里的 spike/zwalk.ps1 就是这么找到窗口的。
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class PW {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
}
'@
$script:found = $false
$script:vis = $false
$cb = [PW+EnumProc] {
  param($h, $l)
  $sb = New-Object System.Text.StringBuilder 200
  [void][PW]::GetWindowText($h, $sb, 200)
  if ($sb.ToString() -eq 'with-me') {
    $script:found = $true
    $script:vis = [PW]::IsWindowVisible($h)
    return $false
  }
  return $true
}
[void][PW]::EnumWindows($cb, [IntPtr]::Zero)
Write-Output ("found=" + $script:found + " visible=" + $script:vis)
