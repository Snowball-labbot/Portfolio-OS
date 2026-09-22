param([string]$Python = "python")

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
& $Python (Join-Path $PSScriptRoot "check-release-safety.py")
& (Join-Path $PSScriptRoot "build-runtime.ps1") -Python $Python

$PluginVendor = Join-Path $Root "plugins\dsh-portfolio-os\vendor"
$ResolvedRoot = [IO.Path]::GetFullPath($Root)
$ResolvedVendor = [IO.Path]::GetFullPath($PluginVendor)
if (-not $ResolvedVendor.StartsWith($ResolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to stage Runtime outside the repository"
}
if (Test-Path -LiteralPath $ResolvedVendor) {
  Remove-Item -LiteralPath $ResolvedVendor -Recurse -Force
}
New-Item -ItemType Directory -Path $ResolvedVendor | Out-Null
Copy-Item -LiteralPath (Join-Path $Root "runtime-package\bin\portfolio-os-runtime") -Destination $ResolvedVendor -Recurse

& $Python (Join-Path $PSScriptRoot "check-release-safety.py")

Push-Location (Join-Path $Root "runtime-package")
try { npm pack } finally { Pop-Location }

Push-Location (Join-Path $Root "plugins\dsh-portfolio-os")
try {
  npm test
  npm pack
} finally { Pop-Location }

$Artifacts = @(
  Get-ChildItem (Join-Path $Root "runtime-package\*.tgz") -File
  Get-ChildItem (Join-Path $Root "plugins\dsh-portfolio-os\*.tgz") -File
)
$Checksums = foreach ($Artifact in $Artifacts) {
  $Hash = (Get-FileHash -LiteralPath $Artifact.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  "$Hash  $($Artifact.Name)"
}
$Checksums | Set-Content -LiteralPath (Join-Path $Root "RELEASE-SHA256SUMS.txt") -Encoding ascii
