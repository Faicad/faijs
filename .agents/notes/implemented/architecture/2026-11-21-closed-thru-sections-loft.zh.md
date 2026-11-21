# Agent Note：`cad.loft` 的闭合 ThruSections

Status: implemented

[English](2026-11-21-closed-thru-sections-loft.md) | 中文

## 问题

`sand3d` 的 `loft(..., loop=True)` 等闭合截面放样，需要首尾截面相接、**没有端盖**的 ThruSections 曲面。faijs 只暴露 `LoftOptions { ruled, endPoint }`；把首截面追加到末尾再放样成 solid 会在首尾各封一个端盖，重合处变成内部隔板，而不是环。

## 决策

1. 新增 `BrepEngineApi.loftShell(sections, ruled)`：中立的“放样为壳”步骤。occt 映射 `loft(wires, isSolid=false, ruled)`；brepkit 与 smlib 显式失败。
2. 新增 `LoftOptions.closed`。实现先追加首截面，调 `loftShell`，再 `sew([shell], 1e-6)` 与 `makeSolid(sealed)`。
3. `closed` 与 `endPoint` 互斥；至少 3 个截面（`E_LOFT_CLOSED_ENDPOINT` / `E_LOFT_CLOSED_SECTIONS`）。
4. 文档写明 closed loft 是 occt-only；brepkit 宿主会看到 `loftShell` 的显式失败，而不是静默换成另一种实体。

## 备选方案

**追加首截面后放样 solid，再删端盖。** 没有 loft history 就无法定位端盖；重合端盖可能已经是内部面，按几何删除是猜测。不采纳。

**在调用方近似成环**（重复首截面 + 接缝端盖）。产物拓扑不同，违反“绝不产出语义不同的近似代码”。不采纳。

**新增独立 op `cad.loftClosed`。** `LoftOptions.closed` 保持公开面小、复用现有参数校验；occt-only 限制由 `loftShell` 报。采纳。

## 后果

- 闭合放样至少 3 个截面，且不能与 `endPoint` 组合。
- brepkit/smlib 宿主显式失败。
- `packages/core/test/api/loft-closed.test.ts` 钉住 4 截面环（bbox X/Y ±12、Z ±2、体积 > 0）与少于 3 截面的拒绝。
- `cad.loft` 的基础 `{ruled, endPoint}` 行为与既有测试不变。