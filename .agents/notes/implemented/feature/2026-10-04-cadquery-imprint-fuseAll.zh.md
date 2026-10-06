# Agent Note: 通过 `fuseAll` 实现 CadQuery 自由函数 `imprint`

Status: implemented

English | [中文](2026-10-04-cadquery-imprint-fuseAll.md)

## Problem

CadQuery 2.8.0 提供自由函数 `imprint(*shapes)`（`occ_impl/shapes.py:6774`），faijs 必须通过其 occt-wasm BREP 链支持它。occt-wasm 不直接暴露 CadQuery 内部使用的基础图元 `BOPAlgo_Builder`，因此 faijs 需要一个等价图元来在上游 parity 套件中复现 `imprint` 的可观测拓扑。

## Decision

使用 occt-wasm 的 `kernel.fuseAll`（`BRepAlgoAPI_Fuse`）实现 `imprint`。

对于 `test_imprint` 所覆盖的情形——不重叠（相触/相离）的实体——`BRepAlgoAPI_Fuse` 与 `BOPAlgo_Builder` 产生相同拓扑：实体保持分离，重合面被合并。`fuseAll` 是 occt-wasm 暴露的最接近的图元。

曾尝试双向 `split` + compound 的方案（见 `## Alternatives considered`），但它保留了重合面（f12），而不是将它们合并到 CadQuery 的 `.Faces()` 数量（11）。

## Ref STEP 面数差异

ref STEP 文件对 `imprint(b1, b2)` 显示 f12，而 CadQuery 的 `.Faces()` 返回 11。这是 STEP 导出产物：STEP 保留了 `.Faces()` 排除的内部/共享面。候选 STEP（faijs 生成的）同样保留这些面，因此拓扑比较匹配（f12 vs f12）。数值（vol、com、bbox）完全一致。

## 解锁了什么

12 个 `imprint` 阻塞变量中的 6 个：`test_imprint__{b1,b2,b3,res,res_glue_full,res_glue_partial}`。

## 仍被阻塞的内容

- 4 个 `test_imprinting` 变量——assembly 级 `imprint`（B5 范围，需要 Assembly API）。
- 2 个 `test_imprint__{b1_imp,b3_imp}`——需要 `History.images()`（G-C18）。

## 备选方案

- **直接使用 `BOPAlgo_Builder`**：正是 CadQuery 使用的图元，但 occt-wasm 不暴露它；BREP 后端无法使用。
- **双向 `split` + 复合**：通过 `BOPAlgo_Splitter` 将每个形状相对其它形状拆分，再复合碎片。这会保留重合面（f12 而非 f11），但与 CadQuery 的 `.Faces()` 数量（11）不符——`BOPAlgo_Builder` 会将其合并为 11。已回退到 `fuseAll`。
- **`kernel.fuseAll`（`BRepAlgoAPI_Fuse`）**（选用）：对于所支持的情形与 `BOPAlgo_Builder` 拓扑一致，且 occt-wasm 已暴露。

## 影响

解锁了 parity 测试中 12 个 `imprint` 阻塞变量中的 6 个。其余 `imprint`/`imprinting` 变量移至 B5（Assembly API）和 G-C18（`History.images()`）。STEP 面数差异作为导出产物处理，而非拓扑不匹配。