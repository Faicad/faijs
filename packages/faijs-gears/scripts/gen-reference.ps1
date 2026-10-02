# gen-reference — A 侧参考生成（CadQuery + cq_gears）的 PowerShell 转调壳
#
# 实际逻辑全在 gen-reference.py；本脚本只负责定位 Python interpreter 后透传参数。
# interpreter 优先级（与方案 §2.7 一致）：
#   1. 环境变量 FAI_CQ_PYTHON
#   2. C:\Users\ylt\cadquery-env\Scripts\python.exe（本机 cadquery 2.8.0 环境）
#
# 用法（参数与 gen-reference.py 完全一致）：
#   pwsh -NoProfile scripts/gen-reference.ps1                     # 默认 --set spike
#   pwsh -NoProfile scripts/gen-reference.ps1 --set regression --out fixtures/reference
#   pwsh -NoProfile scripts/gen-reference.ps1 --set pairs --ids bp-basic

$ErrorActionPreference = 'Stop'

$py = $env:FAI_CQ_PYTHON
if (-not $py) {
    $defaultPy = 'C:\Users\ylt\cadquery-env\Scripts\python.exe'
    if (Test-Path $defaultPy) { $py = $defaultPy }
    else { $py = 'python' }  # 兜底：PATH 里的 python
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& $py (Join-Path $scriptDir 'gen-reference.py') @args
exit $LASTEXITCODE
