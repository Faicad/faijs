<#
.SYNOPSIS
  Publish all publishable faijs monorepo packages to npm (fixed lockstep version).

.DESCRIPTION
  Topological order, per package: version-consistency check -> (optional) full CI
  -> (build) -> npm pack --dry-run white-list assertion (E2) -> npm publish
  -> npm view verification -> emit a publish record.

  Publish scope (see docs/plans/2026-09-19-npm-publish-plan.md section 2):
    @faicad/faijs (core) -> @faicad/faijs-extra -> @faicad/cq-compat
    -> @faicad/fai-cq-gears -> @faicad/fai-cq-warehouse -> @faicad/sheetmetal
  (@faicad/gear-lib-demo excluded per Q2; the mini lathe sample project moved out of the repo.)

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
  [switch]$Provenance,
  [string]$Otp,
  [int]$From = 1
)

$ErrorActionPreference = 'Stop'

# Resolve npm invoker (default "npm"; sandbox/CI may override via env vars to a
# managed node + npm-cli.js). Windows note: resolve to npm.cmd, not the
# PowerShell shim (npm.ps1) — invoking `& npm run build` from pwsh with only the
# node dir on PATH can land on the .ps1 shim which drops script args, printing
# the npm help text instead of running the script.
if ($env:NPM_CLI_NODE -and $env:NPM_CLI_PATH) {
  $npm = { & $env:NPM_CLI_NODE $env:NPM_CLI_PATH @args }
} elseif ($IsWindows -or $env:OS -eq 'Windows_NT') {
  $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npmCmd) { $npmCmd = Get-Command npm -ErrorAction SilentlyContinue }
  if (-not $npmCmd) { throw 'npm not found on PATH' }
  $npmExe = $npmCmd.Source
  $npm = { & $npmExe @args }
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
# The editor extension library has core as a peer, so it follows core. The family
# publishes under ONE lockstep version (step 1 below): a package that needs a
# different version line cannot live in this list.
$Packages = @(
  @{ Name = '@faicad/faijs-brepjs';    Path = 'packages/brepjs' },
  @{ Name = '@faicad/faijs';           Path = 'packages/core' },
  @{ Name = '@faicad/faijs-extra';     Path = 'packages/faijs-extra' },
  @{ Name = '@faicad/faijs-fcstd';     Path = 'packages/fcstd' },
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

# Step 1b: @faicad/* dependency lockstep guard — a publishable package whose dep
# range still points at an older line (e.g. "^0.14.0" while lockstep is 0.16.x)
# makes the CDN build resolve a stale package and break the graph. Fail BEFORE
# publishing anything.
Write-Host "-> [1b/5] checking @faicad/* dep lockstep ..." -ForegroundColor Cyan
node (Join-Path $PSScriptRoot 'check-dep-lockstep.mjs')
if ($LASTEXITCODE -ne 0) { throw "dep lockstep check failed; aborting publish" }
Write-Host "   OK [1b/5] dep lockstep passed" -ForegroundColor Green

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
  if ($Packages.IndexOf($p) -lt ($From - 1)) {
    Write-Host "-- skipping $($p.Name) (-From $From)" -ForegroundColor DarkGray
    continue
  }
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
    $pubArgs += '--registry'; $pubArgs += 'https://registry.npmjs.org/'
    if ($Otp) { $pubArgs += '--otp'; $pubArgs += $Otp }
    Write-Host "   -> publish (tag=$Tag) ..." -ForegroundColor DarkGray
    Push-Location $dir
    try {
      & $npm @pubArgs 2>&1 | ForEach-Object { Write-Host $_ }
    } finally {
      Pop-Location
    }
    if ($LASTEXITCODE -ne 0) { throw "[$($p.Name)] publish failed" }
    # Verification is deferred: the npm CDN takes minutes to serve fresh docs,
    # and blocking the loop here aborts the remaining packages. All packages
    # are published first; verification runs at the end (Step 4) and only
    # warns — it must never abort an already-completed publish run.
  }

  $record.packages += [ordered]@{ name = $p.Name; version = $Version; dryRun = [bool]$DryRun }
}

# Step 4: post-publish verification (AFTER all packages are published; warn-only).
# The npm CDN takes minutes to serve fresh docs for newly published versions —
# both the packument and the version-specific endpoint. By now (all packages
# published) propagation has had time to settle, and a remaining lag is still
# not a publish failure, so mismatches only warn. curl.exe is used because
# Invoke-RestMethod hangs >90s under .NET HttpClient on these endpoints.
if (-not $DryRun) {
  Write-Host "-> [4/5] verifying published packages ..." -ForegroundColor Cyan
  foreach ($p in $Packages) {
    if ($Packages.IndexOf($p) -lt ($From - 1)) { continue }
    $encoded = [uri]::EscapeDataString($p.Name)
    $verUrl = "https://registry.npmjs.org/$encoded/$Version"
    $published = $null
    for ($attempt = 1; $attempt -le 5; $attempt++) {
      $json = & curl.exe -s --max-time 30 -H 'Accept-Encoding: identity' $verUrl 2>$null
      if ($LASTEXITCODE -eq 0 -and $json) {
        try {
          $resp = $json | ConvertFrom-Json
          if ($resp.name -eq $p.Name -and $resp.version -eq $Version) { $published = $Version; break }
        } catch { }
      }
      Start-Sleep -Seconds 5
    }
    if ($published -eq $Version) {
      Write-Host "   OK verified $($p.Name)@$Version" -ForegroundColor Green
    } else {
      Write-Warning "[$($p.Name)] could not verify $Version on the registry yet (CDN lag); publish itself reported success. Check later: npm view $($p.Name) version"
    }
  }
}

# Step 5: publish record.
$recordPath = Join-Path $RepoRoot "out-publish-$(Get-Date -UFormat '%Y%m%d-%H%M%S').json"
$record | ConvertTo-Json -Depth 5 | Set-Content $recordPath
Write-Host "OK [5/5] publish record: $recordPath" -ForegroundColor Green
if ($DryRun) { Write-Host "(DRY-RUN: not published. Remove -DryRun after npm account + 2FA are ready.)" -ForegroundColor Yellow }
