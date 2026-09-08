# @faicad/mini-lathe

[English](README.md) | 中文

CadQuery [mini_lathe](https://github.com/yuan-xy/mini_lathe.git) 项目移植为 `.fai.js` 脚本，以 `@faicad/cq-compat` 作为 CadQuery 兼容层。

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

导出单个零件：

```bash
npx tsx ../../packages/core/scripts/faijs-cli.ts run src/parts/bottom_plate.fai.js --out out/bottom_plate.step --mode brep
```

导出全部：

```bash
pwsh -NoProfile scripts/export-all.ps1
```

## Notes

- 仅支持 BREP 模式（mesh 模式下 compat op 抛 `E_MESH_UNSUPPORTED`）。
- `handle.py`、`misc.py`、`my_keycap.py` 未移植（依赖 `cq_warehouse`、`loft`、`makeSphere`、`shell([faces],t)`）。
- 装配使用 `cq.buildAssembly`，内部以 `cad.assembly` 封装 brepjs 约束求解。
- 颜色按成员经 `memberColors` 设置；爆炸视图由 UI 层（3d_editor）处理，不在 faijs 内。
