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
# monorepo（P1-P6.5）：根 lint 已覆盖 src + packages/*/src；typecheck/test 经 --workspaces 逐包跑。
Step -Label '1/9  npm run lint' -Block { npm run lint }

Step -Label '2/9  npm run typecheck（根 + workspaces）' -Block {
    npm run typecheck
    if ($LASTEXITCODE -ne 0) { return }
    npm run typecheck --workspaces --if-present
}

Step -Label '3/9  npm run build（core → 门面）' -Block {
    # Ensure workspace junctions exist (npm workspaces may fail to create them on Windows)
    if (-not (Test-Path "node_modules/@faicad/faijs-core/package.json")) {
        Write-Host "    [ci] workspace junction missing — running npm install" -ForegroundColor Yellow
        npm install
    }
    npm run build
}

Write-Host "==> 4/9  test workspaces（每包独立 5 分钟硬预算）"
$start3 = Get-Date
$tmpVitest = [System.IO.Path]::GetTempFileName()
# 硬看门狗: vitest 的 per-test testTimeout 无法中断同步原生死锁(事件循环被阻塞时
# 其计时器同样被冻结, 见 p23-cad-face)。每个测试工作区单跑, 外层套进程级看门狗:
# 任一处完不成 5 分钟预算即杀进程树并判失败, CI 绝不被一个死循环测试永久挂起。
$testBudgetMs = if ($env:FAIJS_TEST_BUDGET_MS) { [int]$env:FAIJS_TEST_BUDGET_MS } else { 300000 } # 5 分钟
$testPackages = @('@faicad/faijs-core','@faicad/gear-lib-demo','@faicad/sheetmetal','@faicad/faijs-tests')
$stepFail = $false
foreach ($pkg in $testPackages) {
    Write-Host "    -- $pkg（budget=${testBudgetMs}ms）"
    node scripts/run-tests-with-watchdog.mjs --budget-ms $testBudgetMs -- npm run test -w $pkg 2>&1 | Tee-Object -FilePath $tmpVitest -Append
    if ($LASTEXITCODE -ne 0) {
        $stepFail = $true
        if ($allMode) {
            $script:failures.Add("4/9  $pkg tests")
        }
    }
}
if ($stepFail) {
    if (-not $allMode) { exit 1 }
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
        $script:failures.Add('4/9  npm run test --workspaces (stderr)')
    } else {
        exit 1
    }
}
Remove-Item $tmpVitest -ErrorAction SilentlyContinue
$elapsed3 = (Get-Date) - $start3
$total3 = (Get-Date) - $script:globalStart
Write-Host "    ($($elapsed3.TotalSeconds.ToString('0.0'))s / 累计 $($total3.TotalSeconds.ToString('0.0'))s)" -ForegroundColor DarkGray

Step -Label '5/9  守卫：幽灵依赖 / workspaces 顺序 / 包图无环 / 导出面 / P1 移植树' -Block {
    node scripts/check-ghost-deps.mjs
    if ($LASTEXITCODE -ne 0) { return }
    node scripts/check-workspaces-order.mjs
    if ($LASTEXITCODE -ne 0) { return }
    npx madge --circular packages/core/src packages/gear-lib-demo/src
    if ($LASTEXITCODE -ne 0) { return }
    # 导出面：10 个子路径必须全部可导入（快照脚本自身断言；有 error 即失败）
    node scripts/api-surface-snapshot.mjs
    if ($LASTEXITCODE -ne 0) { return }
    # P1：vendored/brepjs 移植树——D9 独立严格编译 + D8 层边界
    npx tsc --noEmit -p packages/core/tsconfig.vendored.json
    if ($LASTEXITCODE -ne 0) { return }
    node scripts/check-layer-boundaries.mjs
    if ($LASTEXITCODE -ne 0) { return }
    # P10-④：U8 品牌守卫（用户可见面零 brepjs，E6）
    node scripts/check-vendored-branding.mjs
}

Step -Label '6/9  demo e2e（dev server 模式，M7 链路）' -Block {
    npm run test:e2e -w @faicad/faijs-demo
}

Step -Label '7/9  demo e2e:preview（CDN/importmap 产物路径）' -Block {
    npm run test:e2e:preview -w @faicad/faijs-demo
}

Step -Label '8/9  npm run doc-sync（文档规范检查）' -Block { npm run doc-sync }

Step -Label '9/9  npm pack（3d_editor tarball）' -Block {
    npm pack
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
