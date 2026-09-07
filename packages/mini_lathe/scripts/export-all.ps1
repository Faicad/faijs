# Export all mini_lathe parts and assembly to STEP
# Usage: pwsh -NoProfile scripts/export-all.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$cli = Join-Path $root "..\..\packages\core\scripts\faijs-cli.ts"
$outDir = Join-Path $root "out"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Force $outDir | Out-Null }

$parts = @("bottom_plate", "middle_bottom", "middle_top", "top_plate", "axk", "slide_top", "slide_mid")
foreach ($p in $parts) {
    $src = Join-Path $root "src\parts\$p.fai.js"
    $dst = Join-Path $outDir "$p.step"
    Write-Host "Exporting $p ..."
    npx tsx $cli run $src --out $dst --mode brep
}

Write-Host "Exporting assembly ..."
npx tsx $cli run (Join-Path $root "src\assembly.fai.js") --out (Join-Path $outDir "mini_lathe.step") --mode brep
Write-Host "All done."
