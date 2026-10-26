# Batch-compile SMLib + SM_API with emcc for the wasm size probe.
# tbb is not needed: all tbb code is gated behind SM_USE_TBB macros that we
# deliberately do not define (single-threaded wasm).
param([int]$Jobs = 8)
$ErrorActionPreference = "Continue"
$env:EMSDK_QUIET = "1"
. C:\emsdk\emsdk_env.ps1

$root = "C:\git\new\usd-brep"
$objDir = "$root\wasm-probe\obj"
New-Item -ItemType Directory -Force $objDir | Out-Null

$inc = @(
    "-I", "$root\source\SMLib\inc",
    "-I", "$root\source\SM_API\inc"
)
$def = @(
    "-DSM_NO_DEBUG_CODE", "-DSM_NO_GFX_OUTPUT_CODE",
    "-DSM_GRAPHICS_CALLBACKS=1", "-DNDEBUG", "-DNOMINMAX"
)
$flags = @("-std=c++17", "-sDISABLE_EXCEPTION_CATCHING=0", "-O2", "-c")

# Files known to be platform build artifacts (dll main / graphics glue) — skip.
$skip = @("SmDllMain.cpp", "SmGraphicsExtern.cpp", "StdAfx.cpp")

$sources = @(Get-ChildItem "$root\source\SMLib\src" -Filter "*.cpp") +
           @(Get-ChildItem "$root\source\SM_API\src" -Filter "*.cpp") |
    Where-Object { $skip -notcontains $_.Name }

Write-Host "compiling $($sources.Count) files with $Jobs jobs..."

$failures = [System.Collections.Concurrent.ConcurrentBag[string]]::new()
$sources | ForEach-Object -Parallel {
    $src = $_
    $objDirL = $using:objDir
    $incL = $using:inc
    $defL = $using:def
    $flagsL = $using:flags
    $bagL = $using:failures
    $out = Join-Path $objDirL ($src.BaseName + ".o")
    $r = & emcc.bat $src.FullName -o $out @incL @defL @flagsL 2>&1
    if ($LASTEXITCODE -ne 0) {
        $bagL.Add($src.Name)
        Write-Host "FAIL $($src.Name)"
        $r | Select-Object -First 6 | Write-Host
    } else {
        Write-Host "ok   $($src.Name)"
    }
} -ThrottleLimit $Jobs

Write-Host "failures: $($failures.Count)"
if ($failures.Count -gt 0) { $failures | ForEach-Object { Write-Host "  $_" } }
