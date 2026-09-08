# @faicad/mini-lathe

English | [中文](README.zh.md)

CadQuery [mini_lathe](https://github.com/yuan-xy/mini_lathe.git) project ported to `.fai.js` scripts, using `@faicad/cq-compat` as the CadQuery compatibility layer.

## Structure

```
src/
  parts/
    bottom_plate.fai.js
    middle_bottom.fai.js
    middle_top.fai.js
    top_plate.fai.js
    axk.fai.js
    slide_top.fai.js
    slide_mid.fai.js
  assembly.fai.js       # full assembly with 6 parts + 8 constraints + colors
scripts/
  export-all.ps1        # export all parts + assembly to STEP
out/                    # generated STEP files (gitignored)
```

## Usage

Export a single part:

```bash
npx tsx ../../packages/core/scripts/faijs-cli.ts run src/parts/bottom_plate.fai.js --out out/bottom_plate.step --mode brep
```

Export everything:

```bash
pwsh -NoProfile scripts/export-all.ps1
```

## Notes

- Only BREP mode is supported (mesh mode throws `E_MESH_UNSUPPORTED` for compat ops).
- `handle.py`, `misc.py`, `my_keycap.py` are not ported (depend on `cq_warehouse`, `loft`, `makeSphere`, `shell([faces],t)`).
- The assembly uses `cq.buildAssembly` which wraps `cad.assembly` with brepjs constraint solving.
- Colors are per-member via `memberColors`; explosion view is handled by the UI layer (3d_editor), not faijs.
