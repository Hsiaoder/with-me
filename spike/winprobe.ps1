# What does the OS think is under the cursor right now?
#   hit    = the window that would receive a click at that point
#   focus  = the window that receives keystrokes and the mouse WHEEL
#   pet    = whether our transparent overlay is currently holding the mouse
#            (GRAB = clicks and wheel for the whole screen land on us)
#
# ASCII ONLY in this file: Windows PowerShell 5.1 reads UTF-8 as ANSI and the mangled
# bytes break the parser. Labels are produced at runtime with UTF-8 output encoding.
#
#   powershell -File spike/winprobe.ps1 point          # one-shot at the cursor
#   powershell -File spike/winprobe.ps1 watch -Y 120   # 12s, ~5 samples/sec
#   powershell -File spike/winprobe.ps1 onclick -Y 300 # 30s, one line per click
param(
  [Parameter(Mandatory = $true)][string]$Action,
  [int]$X = 0,
  [int]$Y = 0
)

$code = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Diagnostics;

public static class Win {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct CURSORINFO { public uint cbSize; public uint flags; public IntPtr hCursor; public POINT ptScreenPos; }

  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern short GetKeyState(int vk);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int idx);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr extra);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("user32.dll")] public static extern bool GetCursorInfo(out CURSORINFO i);
  [DllImport("user32.dll")] public static extern IntPtr LoadCursor(IntPtr h, int id);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  public delegate bool EnumProc(IntPtr h, IntPtr extra);

  public const int WS_EX_TRANSPARENT = 0x00000020;   // click-through on
  public const int WS_EX_NOACTIVATE = unchecked((int)0x08000000);  // clicks cannot activate

  public static IntPtr Owner(int x, int y) { POINT p = new POINT(); p.X = x; p.Y = y; return WindowFromPoint(p); }
  public static string Class(IntPtr h) { StringBuilder sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }
  public static int ExStyle(IntPtr h) { return GetWindowLong(h, -20) & unchecked((int)0xFFFFFFFF); }
  public static string Proc(uint pid) { try { return Process.GetProcessById((int)pid).ProcessName; } catch { return "?"; } }

  // Our overlay is the electron top-level window carrying WS_EX_NOACTIVATE.
  public static IntPtr FindPet() {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, e) => {
      if (Class(h) != "Chrome_WidgetWin_1") return true;
      uint p; GetWindowThreadProcessId(h, out p);
      if (Proc(p) != "electron") return true;
      if ((ExStyle(h) & WS_EX_NOACTIVATE) == 0) return true;
      found = h;
      return false;
    }, IntPtr.Zero);
    return found;
  }

  public static string State(int x, int y) {
    IntPtr o = Owner(x, y);
    uint op; GetWindowThreadProcessId(o, out op);
    IntPtr f = GetForegroundWindow();
    uint fp; GetWindowThreadProcessId(f, out fp);
    IntPtr pet = FindPet();
    string ps = "none";
    if (pet != IntPtr.Zero) ps = ((ExStyle(pet) & WS_EX_TRANSPARENT) != 0) ? "PASSTHROUGH" : "GRAB";
    return "@" + x + "," + y +
           "  \u70b9\u51fb\u843d\u5728=" + Proc(op) + "[" + Class(o) + "]" +
           "  \u952e\u76d8/\u6eda\u8f6e=" + Proc(fp) +
           "  \u684c\u5ba0=" + ps;
  }

  // GetCursorInfo reports the calling thread, so attach to the thread owning the point
  // to read the shape that is actually on screen.
  public static string Shape(int x, int y) {
    IntPtr o = Owner(x, y);
    uint p; uint tid = GetWindowThreadProcessId(o, out p);
    uint self = GetCurrentThreadId();
    AttachThreadInput(self, tid, true);
    CURSORINFO ci = new CURSORINFO();
    ci.cbSize = (uint)Marshal.SizeOf(typeof(CURSORINFO));
    GetCursorInfo(out ci);
    AttachThreadInput(self, tid, false);
    if (ci.hCursor == LoadCursor(IntPtr.Zero, 32512)) return "arrow";
    if (ci.hCursor == LoadCursor(IntPtr.Zero, 32649)) return "hand";
    return "other";
  }
}
'@
Add-Type -TypeDefinition $code

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Get-Here {
  $p = New-Object Win+POINT
  if ($X -eq 0 -and $Y -eq 0) { [void][Win]::GetCursorPos([ref]$p) } else { $p.X = $X; $p.Y = $Y }
  return $p
}

switch ($Action) {
  'point' {
    $p = Get-Here
    [Win]::State($p.X, $p.Y) + '  cursor=' + [Win]::Shape($p.X, $p.Y)
  }
  'move' {
    [void][Win]::SetCursorPos($X, $Y)
  }
  'click' {
    [Win]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    [Win]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  }
  'watch' {
    # Sampling from one process: starting PowerShell per sample re-compiles the C# above
    # and costs ~1s, coarser than the events we chase. -Y is seconds x 10 (-Y 120 = 12s).
    $end = (Get-Date).AddSeconds($Y / 10)
    $t0 = Get-Date
    while ((Get-Date) -lt $end) {
      $p = Get-Here
      '[' + [int](((Get-Date) - $t0).TotalMilliseconds) + 'ms] ' +
        [Win]::State($p.X, $p.Y) + '  cursor=' + [Win]::Shape($p.X, $p.Y)
      Start-Sleep -Milliseconds 200
    }
  }
  'onclick' {
    # Edge-detect the left button rather than sample on a timer: the question is what was
    # under the click just made, and a timed sample misses it. UIA adds the control name,
    # which a window class alone cannot tell apart (link vs button vs text).
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Add-Type -AssemblyName WindowsBase
    $end = (Get-Date).AddSeconds($Y / 10)
    $down = $false
    $n = 0
    'listening - click around, also on the pet.  Ctrl+C stops early.'
    while ((Get-Date) -lt $end) {
      # GetKeyState reports the state as seen by THIS thread's message queue, so it never
    # sees clicks going to other windows. GetAsyncKeyState is the real global state.
    $isDown = (([Win]::GetAsyncKeyState(0x01) -band 0x8000) -ne 0)
      if ($isDown -and -not $down) {
        $n++
        $p = Get-Here
        $ctrl = ''
        try {
          $pt = New-Object System.Windows.Point([double]$p.X, [double]$p.Y)
          $e = [System.Windows.Automation.AutomationElement]::FromPoint($pt)
          if ($e) {
            $nm = $e.Current.Name
            if ($nm.Length -gt 24) { $nm = $nm.Substring(0, 24) + '...' }
            $ctrl = '  control=[' + $nm + '] ' + ($e.Current.ControlType.ProgrammaticName -replace 'ControlType\.', '')
          }
        } catch { $ctrl = '  control=n/a' }
        '#' + $n + ' ' + [Win]::State($p.X, $p.Y) + $ctrl
      }
      $down = $isDown
      Start-Sleep -Milliseconds 10
    }
    'clicks seen: ' + $n
  }
  'follow' {
    # Edge-triggered and endless: a scrolling timer dump is hard to read, but "the line
    # only appears when something actually changed" is readable while you work.
    #   hit    = which window a click here would land on
    #   focus  = which window gets keys and the mouse wheel
    #   pet    = GRAB (overlay holds the whole screen's mouse) / PASSTHROUGH
    #   cursor = the shape on screen at that point (arrow / hand / other)
    $prev = ''
    while ($true) {
      $p = Get-Here
      $full = [Win]::State($p.X, $p.Y) + '  cursor=' + [Win]::Shape($p.X, $p.Y)
      # State() starts with "@x,y"; drop that part when deciding whether anything changed,
      # otherwise every mouse move counts as a change and the window just scrolls.
      $key = $full.Substring($full.IndexOf(' ') + 1)
      if ($key -ne $prev) {
        $prev = $key
        '[' + (Get-Date).ToString('HH:mm:ss.fff') + '] ' + $full
      }
      Start-Sleep -Milliseconds 120
    }
  }
  default {
    'unknown action: ' + $Action + '  (point / move / click / watch / onclick / follow)'
  }
}
