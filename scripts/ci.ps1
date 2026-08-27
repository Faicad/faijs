#!/usr/bin/env pwsh
param(
    [Parameter(Position = 0, HelpMessage = '"all" to log full output to ci.log. Default: direct console output.')]
    [string]$Mode
)

$ErrorActionPreference = 'Stop'

# Decode external (Node) command stdout as UTF-8 instead of the system
# default GBK/CP936. Without this, vitest/eslint/tsc output is mis-decoded
# as GBK and re-encoded into ci.log as mojibake.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ROOT = Split-Path -Parent $PSScriptRoot
Set-Location $ROOT

# Determine mode
$allMode = $false
if ($PSBoundParameters.ContainsKey('Mode')) {
    if ($Mode -ne 'all') {
        Write-Host "ERROR: Mode must be 'all', got '$Mode'" -ForegroundColor Red
        exit 1
    }
    $allMode = $true
}

if ($allMode) {
    $script:ciLogPath = Join-Path $ROOT 'ci.log'
}

$script:globalStart = Get-Date
$script:failures = [System.Collections.Generic.List[string]]::new()

function Step {
    param([string]$Label, [ScriptBlock]$Block)
    $start = Get-Date
    Write-Host "==> $Label"
    & $Block
    if ($LASTEXITCODE -ne 0) {
        if ($allMode) {
            $script:failures.Add($Label)
        } else {
            exit $LASTEXITCODE
        }
    }
    $elapsed = (Get-Date) - $start
    $total = (Get-Date) - $script:globalStart
    Write-Host "    ($($elapsed.TotalSeconds.ToString('0.0'))s / 累计 $($total.TotalSeconds.ToString('0.0'))s)" -ForegroundColor DarkGray
}

$ciMain = {
Step -Label '1/5  npm run lint' -Block { npm run lint }

Step -Label '2/5  npm run typecheck' -Block { npm run typecheck }

Step -Label '3/5  npm run build (tsc → dist)' -Block { npm run build }

Write-Host "==> 4/5  npx vitest run"
$start3 = Get-Date
$tmpVitest = [System.IO.Path]::GetTempFileName()
npx vitest run 2>&1 | Tee-Object -FilePath $tmpVitest
if ($LASTEXITCODE -ne 0) {
    if ($allMode) {
        $script:failures.Add('4/5  npx vitest run')
    } else {
        exit $LASTEXITCODE
    }
}
# Check for stderr — ANY stderr output fails CI (zero tolerance).
# Rule: If a test intentionally triggers an error condition, it must
# spy on console.warn/error within that test and assert the message
# was captured. Global suppression of stderr is prohibited.
$stderrLines = [System.Collections.Generic.List[string]]::new()
$inStderr = $false
Get-Content $tmpVitest | ForEach-Object {
    if ($_ -match '^stderr \|') {
        $inStderr = $true
        $stderrLines.Add($_)
    } elseif ($inStderr) {
        if ($_ -match '^\s') {
            $stderrLines.Add($_)
        } else {
            $inStderr = $false
        }
    }
}
if ($stderrLines.Count -gt 0) {
    Write-Host "`nERROR: Tests produced stderr output — all test stderr must be resolved." -ForegroundColor Red
    $stderrLines | ForEach-Object { Write-Host $_ }
    if ($allMode) {
        $script:failures.Add('4/5  npx vitest run (stderr)')
    } else {
        exit 1
    }
}
Remove-Item $tmpVitest -ErrorAction SilentlyContinue
$elapsed3 = (Get-Date) - $start3
$total3 = (Get-Date) - $script:globalStart
Write-Host "    ($($elapsed3.TotalSeconds.ToString('0.0'))s / 累计 $($total3.TotalSeconds.ToString('0.0'))s)" -ForegroundColor DarkGray

Step -Label '5/5  npm pack + demo e2e (playwright)' -Block {
    # demo 依赖 npm pack 的 tarball（demo/package.json → file:../faicad-faijs-0.1.0.tgz），
    # 必须先打包，npm ci 才能解析 file: 依赖
    npm pack
    if ($LASTEXITCODE -ne 0) { return }
    $demoDir = Join-Path $ROOT 'demo'
    Push-Location $demoDir
    try {
        # demo has its own package.json/lockfile; always install fresh so the
        # newly packed tarball (file:../faicad-faijs-*.tgz) is picked up even
        # when a stale node_modules already exists locally (npm ci cleans it)
        npm ci
        if ($LASTEXITCODE -ne 0) { return }
        # Playwright browsers (idempotent: skips if already downloaded)
        npx playwright install chromium
        if ($LASTEXITCODE -ne 0) { return }
        npm run test:e2e
        if ($LASTEXITCODE -ne 0) { return }
        # build 产物的 CDN 加载验证（vite preview + jsdelivr importmap）
        npm run test:e2e:preview
    } finally {
        Pop-Location
    }
}
}

# Execute — pipe all streams (6=&1) to Tee-Object in allMode for log capture
if ($allMode) {
    & $ciMain *>&1 | Tee-Object -FilePath $script:ciLogPath
} else {
    & $ciMain
}

$total = (Get-Date) - $script:globalStart
if ($script:failures.Count -gt 0) {
    Write-Host "`n============================================" -ForegroundColor Red
    Write-Host "  FAILED STEPS:" -ForegroundColor Red
    foreach ($f in $script:failures) {
        Write-Host "    - $f" -ForegroundColor Red
    }
    Write-Host "============================================" -ForegroundColor Red
    Write-Host "==> CI checks completed with $($script:failures.Count) failure(s) (总耗时 $($total.TotalSeconds.ToString('0.0'))s)" -ForegroundColor Red
    exit 1
} else {
    Write-Host "==> All CI checks passed (总耗时 $($total.TotalSeconds.ToString('0.0'))s)"
}
