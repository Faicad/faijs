# Agent Note：本地 CI 门禁读到的是影子 $LASTEXITCODE；前置步骤与预算改为与 GitHub 工作流同源

Status: implemented

[English](2026-11-11-local-ci-gate-exitcode-and-prerequisite-parity.md) | 中文

## Problem

`scripts/ci.ps1` 以 `==> All CI checks passed (总耗时 1580.9s)` 结束了一轮，而其中**五个阶段实际
已经失败**：workspaces typecheck（新测试文件里的 TS2345/TS2352）、两次 watchdog 杀进程
（`@faicad/faijs` 600s 时仅完成 304/454 个测试文件；`@faicad/faijs-tests` 300s 时完成 84/86）、
`check-op-dims`、API 覆盖门禁（`CadRuntime: missing [consumeRule]`），以及两个 demo e2e 步骤
（`browserType.launch: Executable doesn't exist`）。它们一个都没进 `$script:failures`。

根因是脚本作用域里的 `$LASTEXITCODE = 0`。`$LASTEXITCODE` 是**全局**变量，由原生命令写入；在脚本
里用不带作用域限定的名字赋值，会造出一个脚本作用域的影子变量，原生命令永远不更新它，于是每一处
`if ($LASTEXITCODE -ne 0)` 读到的都是初始的 0。`pwsh -File ci.ps1` 恰好掩盖了这个 bug——`-File`
模式下的脚本体会在全局作用域执行，不带限定的赋值本来就落在 `$global:` 上。也就是说，门禁是否生效
取决于**怎么调用脚本**（`& ./scripts/ci.ps1` → 完全失效，`pwsh -File` → 正常）。

另外两类失败根本不是代码问题，而是本地与远端的前置步骤漂移：`ci.yml` 有
`node scripts/fetch-test-kernels.mjs`（多版本 brepkit 内核，gitignored）与
`npx playwright install chromium`，`ci.ps1` 两个都没有。这就是那 16 条 brepkit 断言与 50 条 demo
e2e 断言"本地红、GitHub 绿"的原因。

## Decision

1. `ci.ps1` 首次赋值改为 `$global:LASTEXITCODE = 0`，所有读取改为 `$global:LASTEXITCODE`。门禁不再
   依赖调用方式。
2. `ci.ps1` 按与 `ci.yml` 相同的顺序跑相同的前置步骤：brepkit 内核在 3/8 阶段紧跟 build 之后下载；
   demo 阶段在 `test:e2e` 之前安装 chromium。两步都幂等。
3. 单包 watchdog 预算改为**实测标定，不再估**：`@faicad/faijs` 1500s（4 核机器上全套约 910s：600s
   内完成 304/454 个文件，剩余 150 个单独跑 310s、639 条断言通过）、`@faicad/faijs-tests` 600s、
   `@faicad/faijs-fasteners` 600s。同一张表镜像进 `ci.yml`——它之前给 `@faicad/faijs` 的是 300s
   缺省值，比本地更紧。

## Alternatives considered

- **用 `$?` 代替 `$LASTEXITCODE`**：`$?` 只反映最后一条语句，且会被 `Step` 里的 `Write-Host` 重置；
  不采纳。
- **保留初始化，只在判断处读 `$global:LASTEXITCODE`**：能用，但那行注释会继续邀请同一个 bug 回来；
  现在赋值与读取都走 `$global:`。
- **把 `pwsh -File` 写成唯一受支持的调用方式**：那样用 `& ./scripts/ci.ps1` 的人仍然得到假绿，而
  出问题的那份日志正是这样跑出来的。修因，不修调用点。
- **用 `FAIJS_TEST_BUDGET_MS` 统一抬高预算**：一个全局覆盖值表达不了三种体量的包；仍以单包表为准，
  并镜像进 `ci.yml`。
- **给多版本 brepkit 测试加 `skipIf(内核缺失)`**：batchB/batchD/intersect 已经是跳过，batchA/
  batchC/clone/parity 是硬失败。全都改成跳过，等于把这份日志背后的漂移藏起来。这条不对称先保留，
  在此登记为待统一项，而不是悄悄抹平。

## Consequences

本地与远端从此检查同一批东西，本地绿才有意义。代价是诚实的：一轮本地 CI 约 35–40 分钟（本来也是
这么久，只是过去对结果说了谎），且 fresh clone 后首轮要多下约 195 MB Chromium 加两个 brepkit tgz。

`@faicad/faijs` 在 4 核机器上要用掉 1500s 预算里的约 910s；明显更慢的机器仍会触发 watchdog。这是刻
意的：预算是死锁探测器，不是性能目标。任一侧新增步骤或调整预算时，必须在同一个提交里同步另一侧——
`ci.yml` 的头部注释早就提出了这个要求。
