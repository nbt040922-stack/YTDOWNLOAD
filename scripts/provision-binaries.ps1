param(
  [string]$SourceDirectory,
  [switch]$Refresh
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$fallbackDirectory = Join-Path $projectRoot 'resources\bin\fallback'
if (-not $SourceDirectory) { $SourceDirectory = Join-Path $projectRoot 'resources\bin' }

New-Item -ItemType Directory -Force -Path $fallbackDirectory | Out-Null
$engines = @(
  @{ Name = 'yt-dlp.exe'; Args = @('--version') },
  @{ Name = 'deno.exe'; Args = @('--version') },
  @{ Name = 'ffmpeg.exe'; Args = @('-version') }
)

foreach ($engine in $engines) {
  $target = Join-Path $fallbackDirectory $engine.Name
  $source = Join-Path $SourceDirectory $engine.Name
  if (($Refresh -or -not (Test-Path -LiteralPath $target)) -and (Test-Path -LiteralPath $source)) {
    Copy-Item -LiteralPath $source -Destination $target -Force
  }
  if (-not (Test-Path -LiteralPath $target)) {
    throw "Missing $($engine.Name). Supply an approved binary with -SourceDirectory."
  }

  $output = & $target @($engine.Args) 2>&1
  if ($LASTEXITCODE -ne 0) { throw "$($engine.Name) failed its version check." }
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash
  [pscustomobject]@{
    Binary = $engine.Name
    Version = [string]($output | Select-Object -First 1)
    SHA256 = $hash
    Path = $target
  }
}
