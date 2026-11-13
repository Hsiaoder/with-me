Option Explicit
' with-me silent launcher.
' If the Electron runtime is not installed yet, hand off to run.ps1 with a visible
' console so the first-run download is not invisible.
Dim fso, sh, base, exe, rc
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
exe = base & "\.runtime\node_modules\electron\dist\electron.exe"
sh.CurrentDirectory = base

If fso.FileExists(exe) Then
  rc = sh.Run("powershell -NoProfile -ExecutionPolicy Bypass -File """ & base & "\tools\run.ps1"" -Quiet", 0, True)
  If rc <> 0 Then
    MsgBox "with-me failed to start (exit code " & rc & ")." & vbCrLf & vbCrLf & _
           "Double-click run.cmd to see the details.", 16, "with-me"
  End If
Else
  sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -File """ & base & "\tools\run.ps1""", 1, False
End If
