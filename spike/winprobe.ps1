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
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int idx);
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint tid, out GUITHREADINFO i);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr extra);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr extra);
  public static System.Collections.Generic.List<IntPtr> Top { get; private set; }
  public static void Collect() {
    Top = new System.Collections.Generic.List<IntPtr>();
    EnumWindows((h, e) => { Top.Add(h); return true; }, IntPtr.Zero);
  }
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

if ($Action -eq 'exstyle') {
  # The overlay relies on WS_EX_NOACTIVATE (0x08000000) so clicking it cannot activate.
  # If some call cleared that bit, clicking the pet steals focus from the app underneath,
  # and wheel messages go to the focused window: symptom is scrolling stops until you click.
  # Filter by process *name* here: the caller's pid can be a launcher wrapper, not the
  # browser process that actually owns the HWND.
  [Win]::Collect()
  $want = Get-Process electron -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }
  foreach ($h in [Win]::Top) {
    $p = [uint32]0
    [Win]::GetWindowThreadProcessId($h, [ref]$p) | Out-Null
    if ($want -notcontains [int]$p) { continue }
    if ([Win]::Class($h) -ne 'Chrome_WidgetWin_1') { continue }
    $ex = [Win]::GetWindowLong($h, -20) -band 0xFFFFFFFF
    $noact = if ($ex -band 0x08000000) { 'YES' } else { 'NO  <-- activatable' }
    $trans = if ($ex -band 0x20) { 'YES' } else { 'no' }
    $layer = if ($ex -band 0x80000) { 'YES' } else { 'no' }
    "hwnd=0x$('{0:x}' -f $h.ToInt64()) pid=$p exstyle=0x$('{0:x8}' -f $ex) NOACTIVATE=$noact TRANSPARENT=$trans LAYERED=$layer"
  }
}
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
  # Cursor shape is what the thread owning the point last set. GetCursorInfo only reports
  # the calling thread, so attach to the target thread first to read the real one.
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
  $shape = if ($hc -eq $arrow) { 'arrow' } elseif ($hc -eq $hand) { 'hand' } else { "other(0x{0:x},tid 0x{1:x})" -f $hc.ToInt64(), $gti.hCursor.ToInt64() }
  "cursor=$shape owner=0x$('{0:x}' -f $h.ToInt64()) class=[$([Win]::Class($h))] tid=$tid"
}
if ($Action -eq 'pos') { $cp = New-Object Win+POINT; [Win]::GetCursorPos([ref]$cp) | Out-Null; "pos=$($cp.X),$($cp.Y)" }
