#!/usr/bin/env pwsh
param(
    [Parameter(Position = 0, HelpMessage = '"all" to log full output to ci.log. Default: direct console output.')]
    [string]$Mode
)

# NOTE: Must be 'Continue', NOT 'Stop'. The script checks $LASTEXITCODE explicitly
# after every npm/node call (see Step and the 4/9 watchdog loop). With 'Stop', Windows
# PowerShell 5.1 turns *any* stderr line from a native command (npm writes "npm error
# ..." to stderr on failure) into a terminating NativeCommandError. That exception
# jumps out of Step BEFORE $script:failures.Add($Label) runs — so a failing step is
# never recorded and the final summary wrongly prints "All CI checks passed". Keep
# 'Continue' and rely on the explicit $LASTEXITCODE checks below.
$ErrorActionPreference = 'Continue'
# StrictMode hosts: $LASTEXITCODE only exists after the first native command.
# Initialise it so the first `if ($LASTEXITCODE -ne 0)` check doesn't throw.
$LASTEXITCODE = 0

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

Step -Label '3/9  npm run build（core → draw → sketch → extra → sheetmetal）' -Block {
    # Ensure workspace junctions exist (npm workspaces may fail to create them on Windows)
    if (-not (Test-Path "node_modules/@faicad/faijs/package.json")) {
        Write-Host "    [ci] workspace junction missing — running npm install" -ForegroundColor Yellow
        npm install
    }
    # demo 以「workspace 内消费 dist」独立化：dev/e2e 通过 workspace 链接解析 @faicad/* 到各包 dist/。
    # 因此 demo e2e 前必须先把 demo 声明依赖的 @faicad/*（core/faijs-extra/sheetmetal）构建出 dist。
    # faijs-sketch 也在链上：cq-compat-compare 的 pretest 构建经 node_modules 解析
    # @faicad/faijs-sketch → dist，fresh checkout 无此步则 TS2307。
    # 根 build 已覆盖它们；dist 在 git 上被忽略，fresh checkout 全靠此步产出。
    npm run build
}

Write-Host "==> 4/9  test workspaces（每包独立硬预算；默认 5 分钟）"
$start3 = Get-Date
$tmpVitest = [System.IO.Path]::GetTempFileName()
# 硬看门狗: vitest 的 per-test testTimeout 无法中断同步原生死锁(事件循环被阻塞时
# 其计时器同样被冻结, 见 p23-cad-face)。每个测试工作区单跑, 外层套进程级看门狗:
# 任一处完不成 5 分钟预算即杀进程树并判失败, CI 绝不被一个死循环测试永久挂起。
$testBudgetMs = if ($env:FAIJS_TEST_BUDGET_MS) { [int]$env:FAIJS_TEST_BUDGET_MS } else { 300000 } # 5 分钟
# 单包预算覆盖：
# faijs-gears / faijs-fasteners 同为 BREP parity 大套件（gears 全套 >900s，CI 只跑其
# 轻量子集，见下方 $gearsSubset 注释；fasteners 全量实测 139s，600s 留足慢机余量）。
$testBudgetOverrides = @{
  '@faicad/faijs-fasteners'  = 600000
}
# faijs-gears 全套 BREP parity 测试 >900s（features.test.ts 单文件 240s+），历史上从未
# 进过 CI；这里只跑轻量但灵敏的核心子集：API 面装载自检（index）、齿廓数学层 vs cq_gears
# （profile，1e-9 级最灵敏信号）、新增 5 类纯数学装配量（new-gear-math）、裸齿轮实体体积
# 对比（spur-gear-build）。实测 3.86s / 159 passed。完整套件仍可 `npm test -w @faicad/faijs-gears` 单独跑。
$gearsSubset = 'src/index.test.ts src/profile.test.ts src/new-gear-math.test.ts src/spur-gear-build.test.ts'
$testPackages = @('@faicad/faijs','@faicad/faijs-sketch','@faicad/faijs-extra','@faicad/sheetmetal','@faicad/faijs-gears','@faicad/faijs-fasteners','@faicad/faijs-draw','@faicad/faijs-tests','@faicad/faijs-demo')
$stepFail = $false
foreach ($pkg in $testPackages) {
    $pkgBudget = if ($env:FAIJS_TEST_BUDGET_MS) { $testBudgetMs } elseif ($testBudgetOverrides.ContainsKey($pkg)) { $testBudgetOverrides[$pkg] } else { $testBudgetMs }
    Write-Host "    -- $pkg（budget=${pkgBudget}ms）"
    # faijs-gears 只跑轻量子集（在包目录内用包自己的 vitest.config.ts 跑）
    if ($pkg -eq '@faicad/faijs-gears') {
        node scripts/run-tests-with-watchdog.mjs --budget-ms $pkgBudget --cwd packages/faijs-gears -- npx vitest run $gearsSubset 2>&1 | Tee-Object -FilePath $tmpVitest -Append
    } else {
        node scripts/run-tests-with-watchdog.mjs --budget-ms $pkgBudget -- npm run test -w $pkg 2>&1 | Tee-Object -FilePath $tmpVitest -Append
    }
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

# publish-state smoke: pack + install + run (§8 of sketch plan)
Write-Host "    -- @faicad/faijs-sketch test:install（publish-state 冒烟）"
node scripts/run-tests-with-watchdog.mjs --budget-ms 600000 -- npm run test:install -w @faicad/faijs-sketch 2>&1 | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) {
    if ($allMode) {
        $script:failures.Add('4/9  @faicad/faijs-sketch test:install')
    } else {
        exit 1
    }
}

Step -Label '5/9  守卫：幽灵依赖 / workspaces 顺序 / 包族版本 lockstep / 包图无环 / 导出面 / P1 移植树 / 平台 import 隔离' -Block {
    node scripts/check-ghost-deps.mjs
    if ($LASTEXITCODE -ne 0) { return }
    node scripts/check-workspaces-order.mjs
    if ($LASTEXITCODE -ne 0) { return }
    node scripts/check-lockstep.mjs
    if ($LASTEXITCODE -ne 0) { return }
    npx madge --circular packages/core/src packages/faijs-extra/src
    if ($LASTEXITCODE -ne 0) { return }
    # 平台 import 隔离（narrowing plan Phase 8）：中立模块不得静态 import occt/brepkit 平台模块
    node scripts/check-platform-imports.mjs
    if ($LASTEXITCODE -ne 0) { return }
    # 导出面：10 个子路径必须全部可导入（快照脚本自身断言；有 error 即失败）
    node scripts/api-surface-snapshot.mjs
    if ($LASTEXITCODE -ne 0) { return }
    # core-decouple wrapup §4.1：brepjs 归零守卫（包名/路径零依赖）
    node scripts/check-core-no-brepjs.mjs
    if ($LASTEXITCODE -ne 0) { return }
    # M5：库源码语言审计（可发布库包 src/ 必须 100% TS，禁止手写 JS 发布库）
    node scripts/check-lib-src-language.mjs
    if ($LASTEXITCODE -ne 0) { return }
    # 测试文件禁止读取仓库外路径（兄弟仓库/绝对路径在 CI 上必然 ENOENT，见 37076464640）
    node scripts/check-test-fs-scope.mjs
    if ($LASTEXITCODE -ne 0) { return }
    # tsconfig paths 完整性：@faicad/* import 必须有显式映射，否则本地静默退回旧 dist、CI fresh checkout 报 TS2307
    node scripts/check-tsconfig-paths.mjs
}

Step -Label '6/9  demo e2e（dev server 模式，@faicad/* 走 workspace dist）' -Block {
    npm run test:e2e -w @faicad/faijs-demo
}

Step -Label '7/9  demo e2e:preview（CDN/importmap 产物路径）' -Block {
    npm run test:e2e:preview -w @faicad/faijs-demo
}

Step -Label '8/9  npm run doc-sync（文档规范检查）' -Block { npm run doc-sync }

Step -Label '9/9  npm pack（根包可打包性）' -Block {
    npm pack
}
}

# Execute — pipe all streams (6=&1) to console; in allMode also persist to ci.log.
# NOTE: Tee-Object writes UTF-16LE on PS 5.1 and UTF-8 (no BOM) on PS 7+, so the
# log encoding would silently depend on the host. Use an explicit UTF-8 StreamWriter
# instead so ci.log is always UTF-8 regardless of the PowerShell version.
if ($allMode) {
    $sw = [System.IO.StreamWriter]::new($script:ciLogPath, $false, [System.Text.UTF8Encoding]::new($false))
    try {
        & $ciMain *>&1 | ForEach-Object {
            $_                       # keep native stream rendering on console
            $sw.WriteLine([string]$_)
        }
    } finally {
        $sw.Dispose()
    }
} else {
    & $ciMain
}

$total = (Get-Date) - $script:globalStart
if ($script:failures.Count -gt 0) {
    $summary = New-Object System.Collections.Generic.List[string]
    $summary.Add('')
    $summary.Add('============================================')
    $summary.Add('  FAILED STEPS:')
    foreach ($f in $script:failures) {
        $summary.Add("    - $f")
    }
    $summary.Add('============================================')
    $summary.Add("==> CI checks completed with $($script:failures.Count) failure(s) (总耗时 $($total.TotalSeconds.ToString('0.0'))s)")
    foreach ($l in $summary) { Write-Host $l -ForegroundColor Red }
    if ($allMode) {
        # Summary lives OUTSIDE the captured pipeline above; persist it explicitly
        # so ci.log contains the final verdict (previously only on console).
        Add-Content -Path $script:ciLogPath -Value $summary -Encoding utf8
    }
    exit 1
} else {
    $msg = "==> All CI checks passed (总耗时 $($total.TotalSeconds.ToString('0.0'))s)"
    Write-Host $msg
    if ($allMode) {
        Add-Content -Path $script:ciLogPath -Value $msg -Encoding utf8
    }
}
