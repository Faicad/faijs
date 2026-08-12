# fix-imports.ps1 — 批量修复 faijs 项目内所有 import 路径
# 将 @faijs/*, @/brep/*, @/cad-runtime/*, @/engine/*, @/lib/*, @/stores/*, @/config/*, @/assets/* 
# 替换为正确的相对路径

$root = "c:\my\Faicad\faijs\src"
$files = Get-ChildItem -Recurse -File -Path $root -Include "*.ts", "*.tsx"

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw -Encoding UTF8
    $original = $content
    $rel = $file.FullName.Substring($root.Length).Replace('\', '/')
    $dir = $rel.Substring(0, $rel.LastIndexOf('/'))
    
    # 计算到各层级的相对前缀
    # dir 示例: /faijs, /brep/ops, /cad-core, /node-host, /cad-runtime, /boolean, /sdf, /occt, /primitives, /primitives/screw, /primitives/text, /components/drill-hole, /components/engraving/knurl, /lib
    $depth = ($dir -split '/' | Where-Object { $_ -ne '' }).Count
    $prefix = '../' * $depth
    if ($prefix -eq '') { $prefix = './' }
    
    # 1. @faijs/* → ../faijs/* (or ./faijs/* if in root)
    $content = $content -replace "from '`@faijs/([^']+)'", "from '$($prefix)faijs/`$1'"
    
    # 2. @/brep/* → relative to brep/
    $content = $content -replace "from '`@/brep/([^']+)'", "from '$($prefix)brep/`$1'"
    
    # 3. @/cad-runtime/* → relative to cad-runtime/
    $content = $content -replace "from '`@/cad-runtime/([^']+)'", "from '$($prefix)cad-runtime/`$1'"
    
    # 4. @/engine/cad-core/* and @/engine/cad-core → relative to cad-core/
    $content = $content -replace "from '`@/engine/cad-core/([^']+)'", "from '$($prefix)cad-core/`$1'"
    $content = $content -replace "from '`@/engine/cad-core'", "from '$($prefix)cad-core'"
    
    # 5. @/engine/boolean/csg-core → ../boolean/csg-core
    $content = $content -replace "from '`@/engine/boolean/csg-core'", "from '$($prefix)boolean/csg-core'"
    
    # 6. @/engine/boolean/deriveNormals → ../boolean/deriveNormals
    $content = $content -replace "from '`@/engine/boolean/deriveNormals'", "from '$($prefix)boolean/deriveNormals'"
    
    # 7. @/engine/boolean/extrude-helpers → ../boolean/extrude-helpers
    $content = $content -replace "from '`@/engine/boolean/extrude-helpers'", "from '$($prefix)boolean/extrude-helpers'"
    
    # 8. @/engine/boolean/csg → ../boolean/csg-backend (redirect to csg-backend)
    $content = $content -replace "from '`@/engine/boolean/csg'", "from '$($prefix)boolean/csg-backend'"
    
    # 9. @/engine/primitives/geometry → ../primitives/geometry
    $content = $content -replace "from '`@/engine/primitives/geometry'", "from '$($prefix)primitives/geometry'"
    
    # 10. @/engine/primitives/svg-extrude → ../primitives/svg-extrude
    $content = $content -replace "from '`@/engine/primitives/svg-extrude'", "from '$($prefix)primitives/svg-extrude'"
    
    # 11. @/engine/primitives/svg-extrude/parse-svg-size → ../primitives/parse-svg-size
    $content = $content -replace "from '`@/engine/primitives/svg-extrude/parse-svg-size'", "from '$($prefix)primitives/parse-svg-size'"
    
    # 12. @/engine/primitives/screw/screw → ../primitives/screw/screw
    $content = $content -replace "from '`@/engine/primitives/screw/screw'", "from '$($prefix)primitives/screw/screw'"
    
    # 13. @/engine/primitives/screw/screw-db → ../primitives/screw/screw-db
    $content = $content -replace "from '`@/engine/primitives/screw/screw-db'", "from '$($prefix)primitives/screw/screw-db'"
    
    # 14. @/engine/primitives/primitiveToCad → ../primitives/primitiveToCad
    $content = $content -replace "from '`@/engine/primitives/primitiveToCad'", "from '$($prefix)primitives/primitiveToCad'"
    
    # 15. @/engine/primitives/text/cjk → ../primitives/text/cjk
    $content = $content -replace "from '`@/engine/primitives/text/cjk'", "from '$($prefix)primitives/text/cjk'"
    
    # 16. @/engine/sdf/sdf-core → ../sdf/sdf-core
    $content = $content -replace "from '`@/engine/sdf/sdf-core'", "from '$($prefix)sdf/sdf-core'"
    
    # 17. @/engine/sdf/sdf-runner → ../sdf/sdf-runner
    $content = $content -replace "from '`@/engine/sdf/sdf-runner'", "from '$($prefix)sdf/sdf-runner'"
    
    # 18. @/lib/step-converter/occtWasmKernel → ../occt/occtKernel
    $content = $content -replace "from '`@/lib/step-converter/occtWasmKernel'", "from '$($prefix)occt/occtKernel'"
    
    # 19. @/lib/step-converter/meshReconstruct → ../occt/meshReconstruct
    $content = $content -replace "from '`@/lib/step-converter/meshReconstruct'", "from '$($prefix)occt/meshReconstruct'"
    
    # 20. @/lib/runtime-env → ../lib/runtime-env
    $content = $content -replace "from '`@/lib/runtime-env'", "from '$($prefix)lib/runtime-env'"
    
    # 21. @/engine/components/drill-hole/DrillHoleCore → ../components/drill-hole/DrillHoleCore
    $content = $content -replace "from '`@/engine/components/drill-hole/DrillHoleCore'", "from '$($prefix)components/drill-hole/DrillHoleCore'"
    
    # 22. @/engine/components/engraving/EngravingCore → ../primitives/text-geometry
    $content = $content -replace "from '`@/engine/components/engraving/EngravingCore'", "from '$($prefix)primitives/text-geometry'"
    
    # 23. @/engine/primitives/text/cjk → ../primitives/text/cjk (already handled above)
    
    # 24. @/stores/drill-store → ../components/drill-hole/drill-types
    $content = $content -replace "from '`@/stores/drill-store'", "from '$($prefix)components/drill-hole/drill-types'"
    
    # 25. @/engine/version-store/FileBlobStore → remove (browser-only, will handle in code)
    # This is handled by removing io.ts
    
    # 26. @/engine/script-engine/replay-validator → will handle test separately
    
    # 27. @/config/file-formats → inline type (will handle in code)
    
    # 28. @/engine/formatLoaders → remove (browser-only)
    
    # 29. @/stores/model-store → remove (browser-only)
    
    # 30. @/engine/boolean/csg-worker → remove (browser-only)
    
    if ($content -ne $original) {
        Set-Content $file.FullName -Value $content -Encoding UTF8 -NoNewline
        Write-Host "Fixed: $($file.FullName.Substring($root.Length))"
    }
}

Write-Host "Done."
