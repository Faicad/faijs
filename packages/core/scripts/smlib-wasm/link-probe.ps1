# Link the SMLib+SM_API wasm probe: whole-archive (full API surface), then
# wasm-opt and brotli, reporting sizes.
$ErrorActionPreference = "Stop"
$env:EMSDK_QUIET = "1"
. C:\emsdk\emsdk_env.ps1
$root = "C:\git\new\usd-brep"
$out = "$root\wasm-probe\out"
New-Item -ItemType Directory -Force $out | Out-Null

$objs = Get-ChildItem "$root\wasm-probe\obj" -Filter "*.o" | Sort-Object Name | ForEach-Object { $_.FullName }
Write-Host "linking $($objs.Count) objects..."

& emcc.bat $objs -o "$out\smlib.js" `
    -fwasm-exceptions -msimd128 -mtail-call -O3 `
    -sINITIAL_MEMORY=134217728 -sMAXIMUM_MEMORY=4294967296 `
    -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=5242880 `
    -sEVAL_CTORS=2 --no-entry `
    "-Wl,--whole-archive"
if ($LASTEXITCODE -ne 0) { throw "link failed" }
Write-Host "linked."

& C:\emsdk\upstream\bin\wasm-opt.exe "$out\smlib.wasm" --all-features -O4 --strip-debug --strip-producers --converge --gufa `
    -o "$out\smlib_opt.wasm"
if ($LASTEXITCODE -ne 0) { throw "wasm-opt failed" }

node "$root\wasm-probe\brotli-report.cjs"
