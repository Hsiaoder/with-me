# Canary test for keyboard focus. ASCII ONLY (WinPS 5.1 reads UTF-8 as ANSI and fails to parse).
#
# Question: after a real click on the pet, do keystrokes still reach the app that had focus?
# If they do, the pet never took keyboard focus. If they stop, something took it.
#
#   powershell -File spike/focus-canary.ps1 -PetX 800 -PetY 880 -AwayX 120 -AwayY 120
param(
  [Parameter(Mandatory = $true)][int]$PetX,
  [Parameter(Mandatory = $true)][int]$PetY,
  [int]$AwayX = 0,
  [int]$AwayY = 0
)

$code = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class K {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint f, UIntPtr e);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  public static IntPtr Owner(int x, int y) { POINT p = new POINT(); p.X = x; p.Y = y; return WindowFromPoint(p); }
  public static string Class(IntPtr h) { StringBuilder sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }
  public static void Click() {
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(150);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
  }
  public static void Type(string s) {
    foreach (char c in s) {
      byte vk = (byte)char.ToUpper(c);
      keybd_event(vk, 0, 0, UIntPtr.Zero);
      keybd_event(vk, 0, 2, UIntPtr.Zero);
      System.Threading.Thread.Sleep(40);
    }
  }
}
'@
Add-Type -TypeDefinition $code
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase

function Find-Window($procId) {
  return [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
    [System.Windows.Automation.TreeScope]::Children,
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $procId)))
}

function Text-Notepad {
  try {
    $p = Get-Process notepad -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $p) { return '(no notepad)' }
    $w = Find-Window $p.Id
    if (-not $w) { return '(no window)' }
    $ed = $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
      (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Edit)))
    if (-not $ed) { return '(no edit)' }
    $v = $ed.Current.Value
    if ($v.Length -gt 40) { $v = $v.Substring($v.Length - 40) }
    return ($v -replace "`r|`n", '')
  } catch { return '(read failed)' }
}

Start-Process notepad
Start-Sleep -Seconds 2
$np = Get-Process notepad | Select-Object -First 1
$w = Find-Window $np.Id
$r = $w.Current.BoundingRectangle
$nx = [int]($r.X + $r.Width / 2)
$ny = [int]($r.Y + [Math]::Max(80, $r.Height / 2))
"notepad rect=$r  click target = $nx,$ny"

function Step($label, $x, $y, $keys, $clickFirst) {
  [K]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 250
  if ($clickFirst) { [K]::Click; Start-Sleep -Milliseconds 500 }
  $owner = [K]::Class([K]::Owner($x, $y))
  [K]::Type($keys)
  Start-Sleep -Milliseconds 500
  "  [$label] clicked=$clickFirst underCursor=$owner typed=$keys -> notepad: $(Text-Notepad)"
}

Step 'A click notepad = baseline' $nx $ny 'AAA' $true
Step 'B hover notepad, no click' $nx $ny 'bbb' $false
Step 'C REAL CLICK ON PET, then type' $PetX $PetY 'ccc' $true
Step 'D after pet click, hover notepad, type' $nx $ny 'ddd' $false
if ($AwayX -ne 0) { Step 'E click elsewhere as control' $AwayX $AwayY 'eee' $true }
Step 'F click notepad again' $nx $ny 'fff' $true

Stop-Process -Name notepad -Force -ErrorAction SilentlyContinue
'READ: if notepad stops growing after a step, that step took keyboard focus away.'
