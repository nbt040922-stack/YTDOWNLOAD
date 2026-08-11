param(
  [string]$AppPath,
  [string]$VideoUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  [switch]$SkipNetwork
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $AppPath) { $AppPath = Join-Path $projectRoot 'dist\win-unpacked\YTD Pro v5.exe' }
$AppPath = (Resolve-Path -LiteralPath $AppPath).Path
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('ytdownload-fresh-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$statePath = Join-Path $testRoot 'runtime\bootstrap-state.json'
$savedPath = $env:PATH
$process = $null

try {
  $env:PATH = "$env:SystemRoot\System32"
  $process = Start-Process -FilePath $AppPath -ArgumentList "--user-data-dir=$testRoot" -WindowStyle Hidden -PassThru
  for ($attempt = 0; $attempt -lt 30 -and -not (Test-Path -LiteralPath $statePath); $attempt++) {
    Start-Sleep -Seconds 2
  }
  if (-not (Test-Path -LiteralPath $statePath)) { throw 'First-run bootstrap did not complete.' }
  $state = Get-Content -Raw -Encoding UTF8 -LiteralPath $statePath | ConvertFrom-Json
  if (-not $state.ok) { throw 'First-run bootstrap diagnostics failed.' }
  if ($process.HasExited) { throw 'Application exited during first-run bootstrap.' }
  Start-Sleep -Seconds 3
  Stop-Process -Id $process.Id -Force
  $process.WaitForExit()
  $process = $null

  $runtime = Join-Path $testRoot 'runtime'
  $ytDlp = Join-Path $runtime 'yt-dlp.exe'
  $deno = Join-Path $runtime 'deno.exe'
  $ffmpeg = Join-Path $runtime 'ffmpeg.exe'
  foreach ($binary in @($ytDlp, $deno, $ffmpeg)) {
    if (-not (Test-Path -LiteralPath $binary)) { throw "Missing runtime binary: $binary" }
  }

  $downloadPath = $null
  if (-not $SkipNetwork) {
    $metadata = & $ytDlp '--encoding' 'utf-8' '--js-runtimes' "deno:$deno" '--remote-components' 'ejs:github' '--no-playlist' '--dump-json' $VideoUrl
    if ($LASTEXITCODE -ne 0) { throw 'Public metadata test failed.' }
    $metadata | ConvertFrom-Json | Out-Null

    $outputDirectory = Join-Path $testRoot 'download'
    New-Item -ItemType Directory -Path $outputDirectory | Out-Null
    $lines = & $ytDlp '--encoding' 'utf-8' '--js-runtimes' "deno:$deno" '--remote-components' 'ejs:github' '--ffmpeg-location' $ffmpeg '--output' (Join-Path $outputDirectory '%(title)s.%(ext)s') '--no-part' '-f' 'bestvideo+bestaudio/best' '--merge-output-format' 'mp4' '--no-playlist' '--no-simulate' '--print' 'after_move:__YTD_FINAL_PATH__:%(filepath)s' $VideoUrl 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Public download test failed.' }
    $finalLine = $lines | Where-Object { $_ -like '*__YTD_FINAL_PATH__:*' } | Select-Object -Last 1
    if (-not $finalLine) { throw 'yt-dlp did not report the exact final path.' }
    $downloadPath = ([string]$finalLine).Substring(([string]$finalLine).IndexOf('__YTD_FINAL_PATH__:') + 19)
    if (-not (Test-Path -LiteralPath $downloadPath)) { throw 'Downloaded file does not exist.' }

    $savedErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $streams = & $ffmpeg '-hide_banner' '-i' $downloadPath 2>&1
    $ErrorActionPreference = $savedErrorAction
    if (-not ($streams | Where-Object { $_ -match 'Stream #.*Video:' }) -or -not ($streams | Where-Object { $_ -match 'Stream #.*Audio:' })) {
      throw 'Merged output does not contain both video and audio.'
    }
  }

  [pscustomobject]@{
    Result = 'PASS'
    UserData = $testRoot
    Bootstrap = $state.ok
    RuntimeSource = $state.engines.ytdlp.recovery_source
    NetworkTest = -not $SkipNetwork
    Download = $downloadPath
    PATH = $env:PATH
  }
} finally {
  if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
  $env:PATH = $savedPath
}
