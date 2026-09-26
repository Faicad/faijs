# Agent Note：clone op 通过能力路由开放给 brepkit

English | [中文](2026-09-26-clone-brepkit-capability-routing.md)

## 问题

`clone` 声明 `engines: ['occt']`，在 brepkit 上执行前即被拒绝，报 `requires engine occt`。用户要求必须支持 brepkit，理由是内核基础能力具备（brepkit 适配器 A 批已补 `copyShape`），差异只在拓扑/命名扩展。

## 调查：identity 命名契约

- **identity 命名 = 基于 ordinal 的 1:1 映射**，不是 face hash。跨节点回走用序号键（`identityEvolution` 映 o→[o]）；hash 仅在 root 锚定和落地时做 ordinal↔hash 换算。
- **真正的断点是 roleTable 传播，不是引擎身份。** `cloneBrep` 是生成式 selfhost 投影，返回裸 handle。`defineOp.wrapBrepOne → fromHandle → fromBrep` **不**挂 faceEvolution、不传播 roleTable。手写的 `placeBrep` 才显式调 `propagateAllOrigins` + `identityEvolution` + `identityHashEvolution`。
- **这是引擎中立的。** 探针（`box → clone → edgeRef(clone,1) → fillet`）确认：occt 上 `edgeRef(clone,1)` 本来就报 `nameless shape`（input shape has no role table）。brepkit 上移除引擎白名单后，报完全相同的错误。不崩溃、不静默选错面。

## 决策

在 `api/surface/arg-spec.ts` 中把 `engines: ['occt']` 替换为 `capabilities: ['copyShape']`。通过 `gen-l3-surface.ts` 重新生成 `api/generated/topology.ts`。声明如实：`cloneBrep` 只调 `kernel.copyShape`，brepkit 适配器已声明该能力（engine-switch-p3 守卫验证通过）。

## 备选方案

- **保持 `engines:['occt']`**——否决：用户要求 brepkit 支持，且底层内核能力（`copyShape`）已在 brepkit 适配器存在。
- **立即在 `cloneBrep` 中传播 roleTable**——延后：依赖「brepkit `copySolid` 保持面枚举序」这一尚未验证的假设；过早做有静默选错面的风险（见诚实限制）。

## 后果

- clone 在 occt + brepkit 2.129.15/3.4.18/4.0.32 上全部通过，bbox [20,10,5] 四引擎精确一致。
- `edgeRef(clone,n)` / `faceRef(clone,n)` 在两引擎上都干净报 `nameless shape`——优雅降级，非 brepkit 特有缺口。
- occt 行为零回退。

## 诚实限制

clone 产物在两引擎上均无面身份。要让 clone 产物可被选边，`cloneBrep` 需像 `placeBrep` 那样传播 roleTable。这依赖「brepkit `copySolid` 保持面枚举序」这一尚未验证的假设——贸然做有静默选错面的风险，故延后。
