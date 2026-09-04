# Agent Note: compat arena 句柄泄漏 —— 释放 getSubShapes 查询句柄

Status: implemented

[English](2026-09-04-compat-arena-handle-leak.md) | 中文

## Problem

`@faicad/faijs-tests` compat e2e ⑦（sheetmetal-flow / mech-lib-flow）断言重复相同 `execute()` 保持 occt-kernel 存活 arena 有界；实测 `shapeCount` 一批内增长 +2484（≈ +621/次），且独立 auto 模式 runtime 下裸 `cad.box({ size: 20 })` 每次重复执行线性增长 +54…+69。`shapeCount` 计的是内核存活 shape 数而非创建数（occt-wasm `getShapeCount`），所以增长是真实句柄泄漏，不是计数口径问题。该泄漏早于复现工作区（HEAD e882b77 即存在，且在干净引擎树上重放也无法消除），属引擎自身，而非任何工作区改动引入。

## Decision

泄漏点是 `kernel.getSubShapes()`/`subShapeHashes()` 查询句柄：`getSubShapes` 把每个子形分配为独立 arena 槽位，引擎调用方只读槽内几何/查询量却从不释放。修复方式为：对「仅作临时查找」的查询结果，在创建处立即释放——

- `occt-kernel/topologyExt.ts` — `buildSelectorManifest`：所有 `getSubShapes` 的 face/edge/solid/shell 向量（顶层、逐面、逐 shape entry）全部登记进 `transient` 列表，并在构建核心外层 `finally` 批量释放。manifest 输出只含纯数据（polyline、hash、ordinal），没有任何已释放句柄逃逸。
- `topology/naming/roles.ts` — `assignRoles`：`getSubShapes(shape, 'face')` 的句柄经 `captureFaceHint` 读取后在 `finally` 释放；role 键基于 hash/ordinal，不会带出悬垂句柄。
- `occt-kernel/meshReconstruct.ts` — `reconstructSolidFromMesh`：`getSubShapes(imported, 'face')` 的面向量在面缝合循环后从未释放；现在（连同未返回的 `fixShape` 中间 solid）在每条退出路径上统一释放。

显式所有权规则：凡 `getSubShapes` 结果只用于几何查询（center/normal/types/hash/ordinal/`isSame` 匹配）且从不作为活句柄交给调用方，则该函数在返回前必须释放这些句柄；刻意导出给消费者的查询结果（如 `api/topo-resolve.ts` 构造的 `ResolutionContext`，其 `faces`/`edges` 携带供 `resolveFaceGeometry`/`chamfer` 使用的活句柄）不能在建内释放——否则调用方到手即悬垂。

## Alternatives considered

- **把释放下沉到 occt-wasm / 内核封装层。** 拒绝：wasm 是 vendored 的，封装层是共享底表面；泄漏本质是调用方契约问题，应在分配子形状向量的调用方处强制。
- **同样修 `topo-resolve.ts` / `chamfer.ts`。** 本次未修：这些函数把活句柄导出进消费方持有的 `ResolutionContext`（消费者调 `isSame`、把句柄传给 `chamferDistAngle` 等）；在 builder 内释放会破坏调用方。那里存在一个独立的、更轻的后续追踪（消费侧释放 context 的句柄），不属于本报告泄漏及其复现范围。
- 让失败的断言静默、放宽阈值。拒绝：阈值证明了真实泄漏，断言的价值正是抓住无界 arena。
- 把探针脚本留在仓库。拒绝：探针是一次性诊断，归因现已落进本 note 与回归测试。

## Consequences

- `topologyExt.ts`、`roles.ts`、`meshReconstruct.ts` 现在归还它们分配的临时子形状槽位；重复相同执行不再使存活 arena 增长。
- 回归闸门：`packages/core/src/cad-runtime/arena-bounded.test.ts` 重复裸 `cad.box` ×10，断言存活 `shapeCount` 相对预热基线 ≤ 100（修复前每次 +54，10 次 ≈ +540，确定性越界）。既有 e2e ⑦ 断言（sheetmetal-flow/mech-lib-flow，≤ 200 / ≤ 400）与 compat-op ④ arena 对比检查现已全绿。
- 较慢路径（mesh→STEP 重建）不再每次重建泄漏一面向量。
- 已知遗留：chamfer 的 `ResolutionContext` 活句柄在 BREP 边路径上的释放属另一个「消费侧持有」问题，作为独立问题记录，不在本次处理。

## Verification

- `packages/core`：`cad-runtime` + `api` 套件（269 测试）与 `occt-kernel`、`brep-topology`、`brep/export/step-export`、`topology/naming` 全绿；新增 `arena-bounded.test.ts` 绿。
- `packages/tests`：`compat-e2e`（sheetmetal-flow + mech-lib-flow 含 ⑦ arena 断言、aluminum-enclosure、lib-error、shape-borrow）与 `compat-op` 共 34 测试全绿；⑦ 不再越界。
- mech-lib `b7-no-face-evolution`（同样喂给 `buildAssemblySelectorManifest`）绿。
- 目标度量：重复 `cad.box` execute 的 live arena 增量已持平（第二次及后续重复 0 额外槽位）。