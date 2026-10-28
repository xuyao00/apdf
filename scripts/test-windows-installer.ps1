param(
  [Parameter(Mandatory=$true)][string]$Baseline,
  [Parameter(Mandatory=$true)][string]$Candidate,
  [Parameter(Mandatory=$true)][string]$ArmInstaller,
  [Parameter(Mandatory=$true)][string]$CandidateVersion,
  [switch]$DiagnosePublished
)
$ErrorActionPreference = 'Stop'
if ($env:CI -ne 'true') { throw 'This installer test is intended for disposable CI Windows runners.' }
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\aPDF-installer-ci'
$appExe = Join-Path $installDir 'aPDF.exe'
$library = Join-Path $env:APPDATA 'apdf'
New-Item -ItemType Directory -Force $library | Out-Null
$sentinel = Join-Path $library 'installer-test.txt'
Set-Content $sentinel 'Preserve saved library data'

function Run-Installer([string]$File, [int]$Timeout = 120) {
  Write-Host "Running $File"
  $process = Start-Process -FilePath (Resolve-Path $File) -ArgumentList '/S', '/currentuser', "/D=$installDir" -PassThru
  if (-not $process.WaitForExit($Timeout * 1000)) {
    $process.Kill($true)
    Write-Host 'Installer exceeded timeout and its process tree was stopped.'
    return -1
  }
  $process.Refresh()
  Write-Host "Installer exit code: $($process.ExitCode)"
  return $process.ExitCode
}
function Assert-Installed([string]$Version) {
  foreach ($file in @($appExe, (Join-Path $installDir 'resources\app.asar'))) {
    if (-not (Test-Path $file)) { throw "Installed application is missing: $file" }
  }
  $actual = [Diagnostics.FileVersionInfo]::GetVersionInfo($appExe).ProductVersion
  if ($actual -ne $Version) { throw "Expected installed version $Version, got $actual" }
  if ((Get-Content $sentinel -Raw).Trim() -ne 'Preserve saved library data') { throw 'Upgrade changed user library data.' }
  Write-Host "Verified installed aPDF $actual and preserved user data."
}

if ((Run-Installer $Baseline) -ne 0) { throw 'Baseline installation failed.' }
Assert-Installed '0.1.0'
if ($DiagnosePublished) {
  if ((Run-Installer $Candidate) -ne 0) { throw 'Published x64 upgrade failed.' }
  Assert-Installed $CandidateVersion
  $wrongExit = Run-Installer $ArmInstaller 30
  Write-Host "Published ARM installer on x64: exit=$wrongExit; app remains=$(Test-Path $appExe)"
  Get-ChildItem $installDir -ErrorAction SilentlyContinue | Select-Object -First 15 Name,Length | Format-Table
} else {
  $originalHash = (Get-FileHash $appExe -Algorithm SHA256).Hash
  $wrongExit = Run-Installer $ArmInstaller 30
  if ($wrongExit -ne 1633) { throw "Wrong-architecture installer should exit with 1633, got $wrongExit" }
  Assert-Installed '0.1.0'
  if ((Get-FileHash $appExe -Algorithm SHA256).Hash -ne $originalHash) { throw 'Wrong-architecture installer changed the installed app.' }
  if ((Run-Installer $Candidate) -ne 0) { throw 'Candidate x64 upgrade failed.' }
  Assert-Installed $CandidateVersion
  "APDF_PACKAGED_EXEC=$appExe" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
}
