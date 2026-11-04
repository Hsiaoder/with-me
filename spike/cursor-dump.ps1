# 把真实鼠标挪到 (X,Y)，量当前系统光标，并把光标位图存成 PNG。
# 存在的理由：CSS 里写了 cursor 不等于系统真的换了光标——覆盖层是透明 + 可穿透的，
# 穿透开着时这扇窗收不到 WM_SETCURSOR。只有 GetCursorInfo 是操作系统口径。
# 参数走环境变量：`-File a.ps1 30 30` 的实参绑定在这里实测拿不到值（$X/$Y 是空的），
# 而读不到坐标的探针会假装量到了箭头，比报错更坏。
# 输出全 ASCII：Windows PowerShell 的控制台编码会把中文打成乱码，读数就不可信了。
$x = [int]$env:CURSOR_X
$y = [int]$env:CURSOR_Y
$out = $env:CURSOR_OUT

Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
public struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public Point ptScreenPos; }
public struct ICONINFO { public bool fIcon; public int xHotspot; public int yHotspot; public IntPtr hbmMask; public IntPtr hbmColor; }
public static class Cur {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point p);
  [DllImport("user32.dll")] public static extern bool GetCursorInfo(out CURSORINFO ci);
  [DllImport("user32.dll")] public static extern bool GetIconInfo(IntPtr h, out ICONINFO ii);
}
'@

# Windows 只在**下一次鼠标移动**被处理时才换光标：直接挪到位就采样，量到的是
# 上一个位置的光标（实测过，命中区读到箭头、离开后反而读到手形）。所以在目标
# 位置内部抖一格再读——位移只有 1px，不会离开这块区域。
[void][Cur]::SetCursorPos($x, $y)
Start-Sleep -Milliseconds 80
[void][Cur]::SetCursorPos($x + 1, $y)
Start-Sleep -Milliseconds 240

$gp = New-Object System.Drawing.Point
[void][Cur]::GetCursorPos([ref]$gp)

$ci = New-Object CURSORINFO
$ci.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($ci)
[void][Cur]::GetCursorInfo([ref]$ci)

$line = "aim=$x,$y actual=$($gp.X),$($gp.Y) visible=$($ci.flags) h=$($ci.hCursor.ToInt64())"

$ii = New-Object ICONINFO
if ([Cur]::GetIconInfo($ci.hCursor, [ref]$ii)) {
  $ptr = if ($ii.hbmColor -ne [IntPtr]::Zero) { $ii.hbmColor } else { $ii.hbmMask }
  $bmp = [System.Drawing.Bitmap]::FromHbitmap($ptr)
  $line += " size=$($bmp.Width)x$($bmp.Height) hot=$($ii.xHotspot),$($ii.yHotspot) color=$($ii.hbmColor -ne [IntPtr]::Zero)"
  if ($out) { $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png) }
  $bmp.Dispose()
}
Write-Output $line
