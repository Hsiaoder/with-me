@echo off
rem with-me source-package launcher. All messages come from tools\run.ps1.
cd /d "%~dp0"
set "QUIET="
if /i "%~1"=="--quiet" set "QUIET=-Quiet"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\run.ps1" %QUIET%
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo with-me failed to start. See the message above.
  if not defined QUIET pause
)
exit /b %RC%
