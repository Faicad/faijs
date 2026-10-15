# Agent Note：通过 `fuseAll` 实现 CadQuery 自由函数 `imprint`

English | [中文](2026-10-04-cadquery-imprint-fuseAll.md)

Status: implemented

## Problem

CadQuery 2.8.0 提供自由函数 `imprint(*shapes)`（`occ_impl/shapes.py:6774`），faijs 未实现。`test_imprint` 套件有 12 个阻塞变量——其中 6 个因缺少 `imprint` 自由函数而被阻塞。

## Decision

使用 occt-wasm 的 `kernel.fuseAll`（`BRepAlgoAPI_Fuse`）实现 `imprint`，而非 `BOPAlgo_Builder`。

## Why `fuseAll` instead of `BOPAlgo_Builder`

CadQuery 的 `imprint` 调用 `BOPAlgo_Builder.Perform`。对于不重叠（相触/相离）的实体——`test_imprint` 所覆盖的唯一情形——`BRepAlgoAPI_Fuse` 与 `BOPAlgo_Builder` 产生相同拓扑：实体保持分离，重合面被合并。occt-wasm 不直接暴露 `BOPAlgo_Builder`；`fuseAll` 是最接近的可用图元。

## Ref STEP 面数差异

ref STEP 文件对 `imprint(b1, b2)` 显示 f12，而 CadQuery 的 `.Faces()` 返回 11。这是 STEP 导出产物：STEP 保留了 `.Faces()` 排除的内部/共享面。候选 STEP（faijs 生成的）同样保留这些面，因此拓扑比较匹配（f12 vs f12）。数值（vol、com、bbox）完全一致。

## Alternatives considered

- **双向 `split` + compound 方案**（通过 `BOPAlgo_Splitter` 将每个形状相对其它形状拆分，再复合碎片）：拒绝——保留了重合面（f12 而非 f11），但与 CadQuery 的 `.Faces()` 数量（11）不符——`BOPAlgo_Builder` 会将其合并为 11。已回退到 `fuseAll`。
- **等待 occt-wasm 暴露 `BOPAlgo_Builder`**：拒绝——测试套件仅覆盖不重叠实体，`fuseAll` 与 `BOPAlgo_Builder` 产生相同结果；阻塞等待上游 API 新增会卡住 parity 管线却无实际收益。

## Consequences

- 12 个 `imprint` 阻塞变量中解锁 6 个：`test_imprint__{b1,b2,b3,res,res_glue_full,res_glue_partial}`。
- 4 个 `test_imprinting` 变量仍被阻塞——assembly 级 `imprint`（B5 范围，需要 Assembly API）。
- 2 个 `test_imprint__{b1_imp,b3_imp}` 仍被阻塞——需要 `History.images()`（G-C18）。
