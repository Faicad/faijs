# Agent Note: L1 `getLength` 归一化为「唯一 edge 弧长之和」

Status: implemented

[English](2026-10-02-l1-getlength-unique-edge-normalization.md) | 中文

## Problem

`BrepEngineApi.getLength(shape)` 是一个 L1 方法、两个引擎在背后，而在实体上两者相差一个数量级：对 20×10×5 盒，occt 返回 280，brepkit 返回 20。两者都不是该实体的边总长。

- **occt** 裸透传到 `BRepGProp::LinearProperties`，其默认 `SkipShared=false` 按**面**遍历、把每条共享边按相邻面各计一次，于是实体得到的是各面周长之和（280 = 2×140），不是弧长。这是 OCC 原生默认：真 OCC（OCP）与 opencascade.js 1.1.1 对单位盒都给 24，只有 `SkipShared=true` 才给 12。occt-wasm 是忠实复刻，不是 bug。
- **brepkit** 用「先探 `getEdgeCurveType`、失败再 `wireLength`」分发；第一支对 solid、face、wire 也都成立，于是返回**首条边**的长度，随构建历史漂移（一个盒 20、另一个盒 10；两边的 wire 真长 15 却给 20）。

两处文档注释断言了引擎并不具备的行为。`api/measurement/index.ts` 宣称「两引擎同口径」。`faijs-cadquery/src/shape-class.ts` 宣称存在 `Shape.Length()` 方法，而它在 CadQuery 2.8.0 中并不存在——`Length` 只定义在 `Mixin1D`（Edge/Wire），`Solid.Length` 抛 `AttributeError`。

## Decision

`getLength(shape)` 的语义 := **shape 中所有唯一 edge 的弧长之和**，两个适配器按同一实现。对 edge 即其自身弧长；对 wire 为其边之和；对 face 为其边界；对 solid 为全部边；对 compound 为各子实体之和。20×10×5 盒的目标值：solid 140、face 30、wire 15、两盒 compound 152——两引擎相同。

- occt 适配器：用 wasm arena 的 `checkpoint()` / `releaseSince(mark)` 括住一次 `getSubShapes(shape, 'edge')` 遍历，逐条累加 `getLength`。
- brepkit 适配器：把 `api.getSubShapes(shape, 'edge')` 经 `api.curveLength` 累加。
- brepkit 的 `getSubShapes(compound, 'edge')` 目前返回空表；补上缺失的 `'edge'` 分支，避免 compound 被静默报成 0。
- faijs-cadquery 的 `lengthOf` 读的是裸 occt kernel 而非 L1 适配器，故在 class 层做同一归一化；`shape-class.test.ts` 钉住 `lengthOf(unitBox) == 12`。

对 edge 与 wire，该值与 CadQuery 的 `Edge.Length()` / `Wire.Length()` 逐位相等，parity 不破。对 face、solid、compound，它是 CadQuery 未定义形态上的一处扩展，其值等于 CadQuery 用户手写 `sum(e.Length() for e in shape.Edges())` 的结果。

## Alternatives considered

- **把论域收紧为 edge/wire，其它抛错。** 更贴 CadQuery 的类设计（`Length` 挂在 `Mixin1D`），但它迫使两个适配器都新增形态分发 + 新错误码，把一段求和塞进每个上层消费者（`measurement.length`、`lengthOf`、vendored `measureLength`），并把 `getLength(solid)` 由数字变成抛错——破坏性变更。而归一化路径已满足 L1 的根本要求（两引擎一致），且不引入破坏。
- **保持内核原样。** 等于接受「同一个 L1 方法在一个引擎返 280、另一个返 20」，与 D5（「核心面只进双方都有的」）及 measurement op 的既有契约直接矛盾。

## Verification

- 盒夹具（20×10×5）实测由原始口径 → 归一化后：occt 280 → 140，brepkit 20 → 140；两盒 compound 304 / 20 → 152（两引擎同值）；两引擎的 `Σ face getLength` 都 = 280（逐面总和一致，故单个面只差枚举顺序）。
- `packages/core/src/brep/engine/getlength-domain.probe.test.ts` 对两引擎断言上述各值；`measurement-script.test.ts` 与 `api/generated/measurement.test.ts` 以 140 通过；faijs-cadquery 全量 383/383，`shape-class.test.ts` 钉住 `lengthOf(unitBox) == 12`；typecheck 无新增错误。
- 全量 core 运行中另有与本次无关的既有失败：13 项 brepkit 多版本测试（被 gitignore 的 `_test-kernels/` 包在本环境缺失）与 1 项 `fontRegistry.node-esm` 的 spawn `EBUSY`。

## Consequences

- 所有 L1 `getLength` 消费者——sketch 线长、`measurement` 脚本 op、vendored `measureLength`、faijs-cadquery 的 `lengthOf`——现在都取唯一 edge 之和；实体与复合体由旧的重复计数（280）改为单次计数（140）。
- `getLength(solid)` 由 O(1) 变为 O(E) 次内核调用；非热路径。
- brepkit 的 `getSubShapes(compound,'edge')` 现在返回真实边。唯一另一条消费路径是 `brep-topology.ts` 的 `getEdges(shape)`，它在 compound 上从「空」变为「有边」，与 occt 早已返回的结果一致。
- `api/generated/measurement.ts` 无需改动：它经 `getBrepApi().getLength` 自动跟随。
