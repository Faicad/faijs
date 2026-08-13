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
Step -Label '1/3  npm run lint' -Block { npm run lint }

Step -Label '2/3  npm run typecheck' -Block { npm run typecheck }

Write-Host "==> 3/3  npx vitest run"
$start3 = Get-Date
$tmpVitest = [System.IO.Path]::GetTempFileName()
npx vitest run 2>&1 | Tee-Object -FilePath $tmpVitest
if ($LASTEXITCODE -ne 0) {
    if ($allMode) {
        $script:failures.Add('3/3  npx vitest run')
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
        $script:failures.Add('3/3  npx vitest run (stderr)')
    } else {
        exit 1
    }
}
Remove-Item $tmpVitest -ErrorAction SilentlyContinue
$elapsed3 = (Get-Date) - $start3
$total3 = (Get-Date) - $script:globalStart
Write-Host "    ($($elapsed3.TotalSeconds.ToString('0.0'))s / 累计 $($total3.TotalSeconds.ToString('0.0'))s)" -ForegroundColor DarkGray
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
