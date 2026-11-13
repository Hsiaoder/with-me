# 把 skins-inbox\*.zip 装进用户皮肤目录。
#
# 这是给「源码包」用户的投递口：皮肤包仍然是单独下载的 Release 资产，
# 源码包里一个字节都不带（CC BY-NC-SA 素材不混进 GPL 主程序，见 NOTICE.md）。
#
# 目录规则与程序内导入一致：装到 <userData>\skins\<皮肤 id>\
# 只做「整目录落盘」，manifest 的语义校验留给程序加载皮肤时做（坏了会出红色错误框）。
param([switch]$Quiet, [string]$DataDir)

$ErrorActionPreference = 'Stop'
$base = Split-Path -Parent $PSScriptRoot
$inbox = Join-Path $base 'skins-inbox'

if (-not (Test-Path -LiteralPath $inbox)) { exit 0 }
$zips = @(Get-ChildItem -LiteralPath $inbox -Filter '*.zip' -File)
if ($zips.Count -eq 0) { exit 0 }

$dataDir = if ($DataDir) { $DataDir } elseif ($env:PET_USER_DATA) { $env:PET_USER_DATA } else { Join-Path $base 'userdata' }
$skinsRoot = [System.IO.Path]::GetFullPath((Join-Path $dataDir 'skins'))
New-Item -ItemType Directory -Force -Path $skinsRoot | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Say([string]$text) {
  if (-not $Quiet) { Write-Host $text }
}

foreach ($zip in $zips) {
  Say "发现皮肤包：$($zip.Name)"
  $archive = $null
  $tmp = $null
  $installed = $false
  try {
    $archive = [System.IO.Compression.ZipFile]::OpenRead($zip.FullName)
    # 只认文件项，目录项的名字是空的（或带结尾斜杠）
    $entries = @($archive.Entries | Where-Object { $_.Name -ne '' })
    if ($entries.Count -eq 0) { throw '包是空的' }

    $names = @($entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    $roots = @($names | ForEach-Object { $_.Split('/')[0] } | Sort-Object -Unique)
    if ($roots.Count -ne 1) { throw '顶层必须只有一个目录：把皮肤文件夹整个压缩，别把文件散在根上' }

    $id = [string]$roots[0]
    if ($id -cnotmatch '^[a-z][a-z0-9_-]{0,63}$') {
      throw "皮肤目录名不合法：$id（只允许小写字母、数字、_、-）"
    }
    if (-not ($names -contains "$id/manifest.json")) { throw "包里找不到 $id/manifest.json" }

    $tmp = Join-Path $skinsRoot ('.inbox-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    $prefix = "$id/"
    for ($i = 0; $i -lt $entries.Count; $i++) {
      $rel = $names[$i]
      if (-not $rel.StartsWith($prefix, [StringComparison]::Ordinal)) { continue }
      $rel = $rel.Substring($prefix.Length)
      if ($rel -eq '') { continue }
      if ($rel.Contains('..')) { throw "包里含非法路径：$($entries[$i].FullName)" }
      $dest = [System.IO.Path]::GetFullPath((Join-Path $tmp $rel))
      if (-not $dest.StartsWith($tmp + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::Ordinal)) {
        throw "包里含非法路径：$($entries[$i].FullName)"
      }
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entries[$i], $dest, $true)
    }

    $target = [System.IO.Path]::GetFullPath((Join-Path $skinsRoot $id))
    if (-not $target.StartsWith($skinsRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::Ordinal)) {
      throw "目标路径越界：$target"
    }
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    Move-Item -LiteralPath $tmp -Destination $target
    $tmp = $null

    $label = $id
    try { $label = [string](Get-Content -LiteralPath (Join-Path $target 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).name } catch { }
    if (-not $label) { $label = $id }
    Say "[完成] 已装皮肤：$label（目录 $id）"
    $installed = $true
  } catch {
    Say "[失败] $($zip.Name) 装不上：$($_.Exception.Message)"
    Say '       这个包没动过，还留在 skins-inbox 里；修好再启动一次。'
  } finally {
    if ($archive) { $archive.Dispose() }
    if ($tmp -and (Test-Path -LiteralPath $tmp)) { Remove-Item -LiteralPath $tmp -Recurse -Force }
    if ($installed) {
      try { Remove-Item -LiteralPath $zip.FullName -Force }
      catch { Say "[提示] zip 删不掉（可能被占用），不影响使用：$($zip.Name)" }
    }
  }
}

exit 0
