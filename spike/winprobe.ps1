# Which window owns a screen point, and does a real click land there?
# ASCII only: Windows PowerShell 5.1 reads UTF-8 .ps1 as ANSI and mangles non-ASCII.
param(
  [Parameter(Mandatory = $true)][string]$Action,
  [int]$X = 0,
  [int]$Y = 0
)

$code = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Win {
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("user32.dll")] public static extern bool GetCursorInfo(out CURSORINFO i);
  [DllImport("user32.dll")] public static extern IntPtr LoadCursor(IntPtr h, int id);
  [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO {
    public uint cbSize; public uint flags; public IntPtr hwndActive; public IntPtr hwndFocus;
    public IntPtr hwndCapture; public IntPtr hwndMenuOwner; public IntPtr hwndMoveSize;
    public IntPtr hwndCaret; public RECT rcCaret; public IntPtr hCursor;
  }
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint tid, out GUITHREADINFO i);
  [StructLayout(LayoutKind.Sequential)] public struct CURSORINFO { public uint cbSize; public uint flags; public IntPtr hCursor; public POINT ptScreenPos; }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public static IntPtr Owner(int x, int y) { POINT p = new POINT(); p.X = x; p.Y = y; return WindowFromPoint(p); }
  public static string Class(IntPtr h) { StringBuilder sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }
}
'@
Add-Type -TypeDefinition $code

if ($Action -eq 'fg') {
  $h = [Win]::GetForegroundWindow()
  $r = New-Object Win+RECT
  [Win]::GetWindowRect($h, [ref]$r) | Out-Null
  $pid2 = [uint32]0
  [Win]::GetWindowThreadProcessId($h, [ref]$pid2) | Out-Null
  $name = (Get-Process -Id $pid2 -ErrorAction SilentlyContinue).ProcessName
  "fg rect=[$($r.Left),$($r.Top),$($r.Right),$($r.Bottom)] proc=$name class=$([Win]::Class($h))"
  $cx = [int](($r.Left + $r.Right) / 2); $cy = [int](($r.Top + $r.Bottom) / 2)
  "fgcenter=$cx,$cy"
}

if ($Action -eq 'move') { [Win]::SetCursorPos($X, $Y) | Out-Null }
if ($Action -eq 'click') {
  [Win]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)   # LEFTDOWN
  [Win]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)   # LEFTUP
}
if ($Action -eq 'owner') {
  if ($X -eq 0 -and $Y -eq 0) { $cp = New-Object Win+POINT; [Win]::GetCursorPos([ref]$cp) | Out-Null; $X = $cp.X; $Y = $cp.Y }
  $h = [Win]::Owner($X, $Y)
  $pid2 = [uint32]0
  [Win]::GetWindowThreadProcessId($h, [ref]$pid2) | Out-Null
  $name = try { (Get-Process -Id $pid2 -ErrorAction SilentlyContinue).ProcessName } catch { '?' }
  "owner=0x$('{0:x}' -f $h.ToInt64()) class=[$([Win]::Class($h))] pid=$pid2 proc=$name"
}
if ($Action -eq 'cursor') {
  # 光标形状是「拥有这个点的线程最后设的 shape」。GetCursorInfo 只回调用线程自己的，
  # 所以要先 AttachThreadInput 到目标线程，读到的才是屏幕上真那颗。
  if ($X -eq 0 -and $Y -eq 0) { $cp = New-Object Win+POINT; [Win]::GetCursorPos([ref]$cp) | Out-Null; $X = $cp.X; $Y = $cp.Y }
  $h = [Win]::Owner($X, $Y)
  $dummyPid = [uint32]0
  $tid = [Win]::GetWindowThreadProcessId($h, [ref]$dummyPid)
  $self = (Get-Process -Id $PID).MainThread.Id
  [Win]::AttachThreadInput($self, $tid, $true) | Out-Null
  $ci = New-Object Win+CURSORINFO
  $ci.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($ci)
  [Win]::GetCursorInfo([ref]$ci) | Out-Null
  [Win]::AttachThreadInput($self, $tid, $false) | Out-Null
  $gti = New-Object Win+GUITHREADINFO
  $gti.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($gti)
  [Win]::GetGUIThreadInfo($tid, [ref]$gti) | Out-Null
  $arrow = [Win]::LoadCursor([IntPtr]::Zero, 32512)
  $hand = [Win]::LoadCursor([IntPtr]::Zero, 32649)
  $hc = $ci.hCursor
  $shape = if ($hc -eq $arrow) { 'arrow' } elseif ($hc -eq $hand) { 'hand' } else { "other(0x{0:x},tid说0x{1:x})" -f $hc.ToInt64(), $gti.hCursor.ToInt64() }
  "cursor=$shape owner=0x$('{0:x}' -f $h.ToInt64()) class=[$([Win]::Class($h))] tid=$tid"
}
if ($Action -eq 'pos') { $cp = New-Object Win+POINT; [Win]::GetCursorPos([ref]$cp) | Out-Null; "pos=$($cp.X),$($cp.Y)" }
