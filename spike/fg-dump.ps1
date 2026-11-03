$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class FG {
  public struct R { public int L, T, Rt, B; }
  public struct M { public int Size; public R Mon, Work; public int Flags; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, int flags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr m, ref M mi);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);
}
'@
$s = 0
[void][FG]::SHQueryUserNotificationState([ref]$s)
$f = [FG]::GetForegroundWindow()
$pid2 = 0
[void][FG]::GetWindowThreadProcessId($f, [ref]$pid2)
$cn = New-Object System.Text.StringBuilder 80
[void][FG]::GetClassName($f, $cn, 80)
$tt = New-Object System.Text.StringBuilder 120
[void][FG]::GetWindowText($f, $tt, 120)
$r = New-Object FG+R
[void][FG]::GetWindowRect($f, [ref]$r)
$mi = New-Object FG+M
$mi.Size = [System.Runtime.InteropServices.Marshal]::SizeOf($mi)
[void][FG]::GetMonitorInfo([FG]::MonitorFromWindow($f, 2), [ref]$mi)
$style = [FG]::GetWindowLong($f, -16)
Write-Output ("state=" + $s)
Write-Output ("fg class=[" + $cn.ToString() + "] title=[" + $tt.ToString() + "] pid=" + $pid2 + " name=" + (Get-Process -Id ([int]$pid2) -ErrorAction SilentlyContinue).ProcessName)
Write-Output ("fg rect=" + $r.L + "," + $r.T + " " + $r.Rt + "," + $r.B)
Write-Output ("monitor=" + $mi.Mon.L + "," + $mi.Mon.T + " " + $mi.Mon.Rt + "," + $mi.Mon.B)
Write-Output ("workarea=" + $mi.Work.L + "," + $mi.Work.T + " " + $mi.Work.Rt + "," + $mi.Work.B)
Write-Output ("IsZoomed=" + [FG]::IsZoomed($f) + " style=0x" + ('{0:X8}' -f $style) + " captionBits=" + (($style -band 0xC00000) -eq 0xC00000))
Write-Output ("coversMonitorGeometry=" + (($r.L -le $mi.Mon.L) -and ($r.T -le $mi.Mon.T) -and ($r.Rt -ge $mi.Mon.Rt) -and ($r.B -ge $mi.Mon.B)))
