param(
  [string]$Python = "python",
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not $SkipInstall) {
  npm ci
  & $Python -m pip install --upgrade pip
  & $Python -m pip install -r backend/requirements-marketplace.txt pyinstaller
}

npm run build
& $Python -m PyInstaller --noconfirm --clean portfolio-os-runtime.spec

$RuntimeBin = Join-Path $Root "runtime-package\bin"
if (Test-Path -LiteralPath $RuntimeBin) {
  Remove-Item -LiteralPath $RuntimeBin -Recurse -Force
}
New-Item -ItemType Directory -Path $RuntimeBin | Out-Null
Copy-Item -LiteralPath (Join-Path $Root "dist\portfolio-os-runtime") -Destination $RuntimeBin -Recurse

Write-Host "Runtime package staged at $RuntimeBin"
