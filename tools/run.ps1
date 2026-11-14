# with-me 源码包启动器。
#
# 只做四件事：确认 Node、装 Electron 运行时（只一次）、装 skins-inbox 里的皮肤、启动。
# 运行时只装 electron 一个包，不碰项目根的 devDependencies；electron 45 没有 postinstall，
# 二进制由包内 install.js 下载，见下面第 3 节。
# 刻意不跑 npm install：devDependencies 里的 ffmpeg-static / playwright 会联网下二进制，
# 跟运行无关，也正是源码包这条路最容易失败的地方。
#
# 存档与皮肤默认落在包内 userdata\（用 PET_USER_DATA 指定），删掉它就是全新状态。
param([switch]$Quiet)

$ErrorActionPreference = 'Stop'
$base = Split-Path -Parent $PSScriptRoot

function Stop-WithError([string]$message) {
  Write-Host ''
  Write-Host "[失败] $message" -ForegroundColor Red
  if (-not $Quiet) { Read-Host '按回车关闭' | Out-Null }
  exit 1
}

# ---- 1. 前置检查 ----
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Stop-WithError '没有找到 Node.js。请先安装 22 或更高版本：https://nodejs.org/zh-cn（装完重新打开这个窗口）'
}
$nodeVersion = (& node -p "process.versions.node").Trim()
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 22) {
  Stop-WithError "Node 版本太低：当前 v$nodeVersion，需要 22 或更高。https://nodejs.org/zh-cn"
}

$entry = Join-Path $base 'dist\main\index.js'
if (-not (Test-Path -LiteralPath $entry)) {
  Stop-WithError '包里缺少 dist\main\index.js。请下载 Release 里的 with-me-<版本>-source.zip，不要用 GitHub 自动生成的 Source code 压缩包。'
}

# ---- 2. 数据目录 ----
# 默认包内 userdata：整个目录就是完整安装，删掉 userdata 即恢复出厂。
if (-not $env:PET_USER_DATA) {
  $env:PET_USER_DATA = Join-Path $base 'userdata'
}
$dataDir = $env:PET_USER_DATA
try {
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
} catch {
  # 解压到 Program Files 之类不可写的位置时，退回 %APPDATA%\with-me
  Write-Host '[提示] 包目录不可写，存档改放 %APPDATA%\with-me'
  $env:PET_USER_DATA = $null
  $dataDir = $null
}

# ---- 3. Electron 运行时 ----
# electron 45 起，它自己的 package.json 里已经没有 postinstall 了：npm 装完只是一个壳，
# 真正的二进制由包内 install.js 现下（node_modules/electron/index.js 也是这么懒加载的）。
# 所以分两步：npm install 拉依赖，再确认 electron.exe；没有就显式跑 install.js。
$runtime = Join-Path $base '.runtime'
$electronExe = Join-Path $runtime 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath $electronExe)) {
  # 版本取 package-lock 里锁定的那个，而不是 package.json 的 ^45.2.1：
  # 后者会解析成更新的小版本，和安装包/CI 用的不是同一个 Electron。
  $pkgPath = (Join-Path $base 'package.json') -replace '\\', '/'
  $lockPath = (Join-Path $base 'package-lock.json') -replace '\\', '/'
  $version = (& node -p "(() => { try { const v = require('$lockPath').packages['node_modules/electron'].version; if (v) return v } catch {} try { return require('$pkgPath').devDependencies.electron.replace(/^[^0-9]*/, '') } catch {} return '45.2.1' })()").Trim()
  if (-not $version) { $version = '45.2.1' }

  Write-Host "首次运行：正在准备 Electron $version 运行时（下载约 110MB，解压后约 350MB，只需一次）..."
  $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
  $env:npm_config_electron_mirror = 'https://npmmirror.com/mirrors/electron/'

  Push-Location $base
  try {
    & npm install --prefix $runtime --no-audit --no-fund --loglevel=error "electron@$version"
  } finally {
    Pop-Location
  }
  if ($LASTEXITCODE -ne 0) {
    Stop-WithError "Electron 依赖安装失败（npm 退出码 $LASTEXITCODE）。检查网络后重试，或者改用 Release 里的 portable.zip。"
  }

  if (-not (Test-Path -LiteralPath $electronExe)) {
    $electronInstaller = Join-Path $runtime 'node_modules\electron\install.js'
    if (-not (Test-Path -LiteralPath $electronInstaller)) {
      Stop-WithError 'Electron 依赖装上了但缺少 install.js：.runtime 不完整，或被安全软件清掉了。删掉 .runtime 再启动一次。'
    }
    Write-Host '正在下载 Electron 二进制（没有进度条，慢的时候会停一两分钟）...'
    & node $electronInstaller
    if ($LASTEXITCODE -ne 0) {
      Stop-WithError "Electron 二进制下载失败（退出码 $LASTEXITCODE）。常见原因：网络或代理不通、镜像不可达、安全软件拦截。也可以改用 Release 里的 portable.zip。"
    }
  }

  if (-not (Test-Path -LiteralPath $electronExe)) {
    Stop-WithError 'Electron 装完了但找不到 electron.exe。删掉 .runtime 目录再启动一次；还是不行就改用 portable.zip。'
  }
}

# ---- 4. 皮肤投递口：skins-inbox 里有 zip 就装上 ----
$installer = Join-Path $PSScriptRoot 'install-skins.ps1'
if (Test-Path -LiteralPath $installer) {
  if ($dataDir) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $installer -Quiet -DataDir $dataDir
  } else {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $installer -Quiet
  }
}

# ---- 5. 启动 ----
Write-Host '启动 with-me ...'
$appArg = '"' + $base + '"'
Start-Process -FilePath $electronExe -ArgumentList $appArg -WorkingDirectory $base
exit 0
