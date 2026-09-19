<#
.SYNOPSIS
  Publish all publishable faijs monorepo packages to npm (fixed lockstep version).

.DESCRIPTION
  Topological order, per package: version-consistency check -> (optional) full CI
  -> (build) -> npm pack --dry-run white-list assertion (E2) -> npm publish
  -> npm view verification -> emit a publish record.

  Publish scope (see docs/plans/2026-09-19-npm-publish-plan.md section 2):
    @faicad/faijs (core) -> @faicad/cq-compat -> @faicad/fai-cq-gears
    -> @faicad/fai-cq-warehouse -> @faicad/sheetmetal
  (@faicad/gear-lib-demo excluded per Q2; mini_lathe moved out per Q3.)

.PARAMETER DryRun
  Only run checks/build/pack-assert; do NOT actually publish (recommended default;
  real publish needs an npm account + 2FA).

.PARAMETER Tag
  npm dist-tag, default "latest". For first release use "next", promote after smoke.

.PARAMETER SkipCI
  Skip "npm run ci" (use for local dry-run verification).

.PARAMETER SkipBuild
  Skip per-package build (use when already built manually).

.PARAMETER Provenance
  Add --provenance (needs an OIDC CI environment; not for local).

.EXAMPLE
  .\scripts\publish-all.ps1 -DryRun -SkipCI        # local dry run, no publish
  .\scripts\publish-all.ps1 -Tag next             # first release to "next" tag
#>

param(
  [switch]$DryRun,
  [string]$Tag = 'latest',
  [switch]$SkipCI,
  [switch]$SkipBuild,
  [switch]$Provenance
)

$ErrorActionPreference = 'Stop'

# Resolve npm invoker (default "npm"; sandbox/CI may override via env vars to a
# managed node + npm-cli.js).
if ($env:NPM_CLI_NODE -and $env:NPM_CLI_PATH) {
  $npm = { & $env:NPM_CLI_NODE $env:NPM_CLI_PATH @args }
} else {
  $npm = { & npm @args }
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Run-Npm {
  param([string]$Dir, [Parameter(ValueFromRemainingArguments = $true)][string[]]$Cmd)
  Push-Location $Dir
  try { & $npm @Cmd 2>&1 | ForEach-Object { Write-Host $_ } ; if ($LASTEXITCODE -ne 0) { throw "npm exit code $LASTEXITCODE" } }
  finally { Pop-Location }
}

# Publishable packages in topological order (matches section 2).
$Packages = @(
  @{ Name = '@faicad/faijs';           Path = 'packages/core' },
  @{ Name = '@faicad/cq-compat';        Path = 'packages/cq-compat' },
  @{ Name = '@faicad/fai-cq-gears';     Path = 'packages/fai_cq_gears' },
  @{ Name = '@faicad/fai-cq-warehouse'; Path = 'packages/fai_cq_warehouse' },
  @{ Name = '@faicad/sheetmetal';       Path = 'packages/sheetmetal' }
)

# Step 1: version consistency (lockstep hard constraint).
$versions = @{}
foreach ($p in $Packages) {
  $pkgJson = Join-Path (Join-Path $RepoRoot $p.Path) 'package.json'
  if (-not (Test-Path $pkgJson)) { throw "package.json not found: $pkgJson" }
  $pj = Get-Content $pkgJson -Raw | ConvertFrom-Json
  if (-not $pj.version) { throw "Cannot read version from $pkgJson" }
  $versions[$p.Name] = $pj.version
}
$uniq = @($versions.Values | Sort-Object -Unique)
if ($uniq.Count -ne 1) {
  Write-Error "Version mismatch, abort publish: $(ConvertTo-Json $versions -Compress)"
}
$Version = $uniq[0]
Write-Host "OK [1/5] version consistency: all packages = $Version" -ForegroundColor Green

# Step 2: full CI (optional).
# The repo CI entry is scripts/ci.ps1 (documented in AGENTS.md); the root
# package.json has no "ci" script, so invoke the script directly instead of
# `npm run ci` (which would fail with "Missing script: ci").
if (-not $SkipCI) {
  Write-Host "-> [2/5] running repo CI ..." -ForegroundColor Cyan
  $ciPs1 = Join-Path $RepoRoot 'scripts/ci.ps1'
  $ciSh = Join-Path $RepoRoot 'scripts/ci.sh'
  $pwshCmd = Get-Command pwsh -ErrorAction SilentlyContinue
  if ($pwshCmd) {
    & $pwshCmd.Source -NoProfile -File $ciPs1
  } elseif (Test-Path $ciSh) {
    & sh $ciSh
  } else {
    throw 'CI entry not found: neither scripts/ci.ps1 (requires pwsh) nor scripts/ci.sh'
  }
  if ($LASTEXITCODE -ne 0) { throw "CI failed (exit $LASTEXITCODE); aborting publish" }
  Write-Host "   OK CI passed" -ForegroundColor Green
}

# E2: tarball white-list assertion.
$DenyPatterns = @(
  '(^|/)src/', '(^|/)tests?/', '(^|/)__tests__/', '(^|/)out/',
  '(^|/)fixtures/', '(^|/)scripts/', 'out-', 'probe-', 'node_modules/',
  '\.test\.', '\.spec\.', '\.fai\.js$', '\.brp$', '\.step$', '\.log$'
)
function Assert-Tarball {
  param([string]$JsonText, [string]$PkgName)
  $m = [regex]::Match($JsonText, '\[.*\]|\{.*\}', [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if (-not $m.Success) { throw "Cannot parse npm pack output as JSON: $JsonText" }
  $data = $m.Value | ConvertFrom-Json
  if ($data -is [System.Array]) { $data = $data[0] }
  $files = $data.files.path

  $bad = @()
  foreach ($f in $files) {
    foreach ($d in $DenyPatterns) { if ($f -match $d) { $bad += $f ; break } }
  }
  if ($bad.Count -gt 0) { throw "[$PkgName] tarball contains forbidden files (R-N2 leak/volume risk): $($bad -join ', ')" }
  if (-not ($files -contains 'package.json')) { throw "[$PkgName] tarball missing package.json" }
  if (-not ($files -match '^dist/')) { throw "[$PkgName] tarball has no dist/ content (empty? build first)" }
  Write-Host "   OK [E2] white-list passed ($($files.Count) files, $([math]::Round($data.unpackedSize/1024, 1)) KB)" -ForegroundColor Green
}

# Step 3: build + pack-assert + (publish + verify).
$record = [ordered]@{
  version     = $Version
  dryRun      = [bool]$DryRun
  publishedAt = (Get-Date -UFormat '%Y-%m-%dT%H:%M:%S%z')
  packages    = @()
}

foreach ($p in $Packages) {
  $dir = Join-Path $RepoRoot $p.Path
  Write-Host "-> [3/5] processing $($p.Name) ..." -ForegroundColor Cyan

  if (-not $SkipBuild) {
    Write-Host "   -> build ..." -ForegroundColor DarkGray
    Run-Npm $dir run build
  }

  Write-Host "   -> pack --dry-run ..." -ForegroundColor DarkGray
  # Must run pack from inside the package dir with '.' — running `npm pack <path>`
  # from the workspace root makes npm parse the path as a package *spec* (any '/'
  # triggers GitHub shorthand resolution and a bogus `git ls-remote`).
  Push-Location $dir
  try {
    # Capture stderr too: on failure npm's message must surface, not be swallowed.
    $packJson = & $npm pack --dry-run --json . 2>&1 | Out-String
    $packExit = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if ($packExit -ne 0) { throw "[$($p.Name)] npm pack failed (exit $packExit):`n$packJson" }
  Assert-Tarball $packJson $p.Name

  if (-not $DryRun) {
    $pubArgs = @('publish', '--access', 'public')
    if ($Tag -ne 'latest') { $pubArgs += '--tag'; $pubArgs += $Tag }
    if ($Provenance) { $pubArgs += '--provenance' }
    Write-Host "   -> publish (tag=$Tag) ..." -ForegroundColor DarkGray
    Push-Location $dir
    try {
      & $npm @pubArgs 2>&1 | ForEach-Object { Write-Host $_ }
    } finally {
      Pop-Location
    }
    if ($LASTEXITCODE -ne 0) { throw "[$($p.Name)] publish failed" }
    $published = & $npm view "$($p.Name)@$Version" version 2>$null
    if ($published -ne $Version) { throw "[$($p.Name)] post-publish npm view mismatch: want $Version got $published" }
    Write-Host "   OK published and verified $($p.Name)@$Version" -ForegroundColor Green
  }

  $record.packages += [ordered]@{ name = $p.Name; version = $Version; dryRun = [bool]$DryRun }
}

# Step 5: publish record.
$recordPath = Join-Path $RepoRoot "out-publish-$(Get-Date -UFormat '%Y%m%d-%H%M%S').json"
$record | ConvertTo-Json -Depth 5 | Set-Content $recordPath
Write-Host "OK [5/5] publish record: $recordPath" -ForegroundColor Green
if ($DryRun) { Write-Host "(DRY-RUN: not published. Remove -DryRun after npm account + 2FA are ready.)" -ForegroundColor Yellow }
