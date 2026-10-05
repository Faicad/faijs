# Agent Note：occt-wasm 升级 3.8.4 → 5.6.0 及 imprint 一致性缺口

Status: implemented

[English](2026-10-05-occt-wasm-upgrade-3-8-to-5-6-implemented.md) | 中文

## Problem

`occt-wasm` 之前pin在 `3.8.4`。升级到 `5.6.0` 很有必要，让内核更接近当前 OCCT
（XCAF 富化的 `desc`/`partNumber` 字段始终`找`不到也和这个有关，见缺口笔记）。
由于它是 BREP 链唯一的 OCCT 布尔/general-fuse 面，升级既是 API 形态也是行为变化，
落地前必须在全库范围验证。

## Decision

把工作区统一安装到单个 `occt-wasm@5.6.0`。

- 根 `package.json` pin 住 `overrides: { "occt-wasm": "5.6.0" }`（精确版本、无 caret）。
  每个包的 range 都升到 `^5.6.0`（`core` peer、`cq-compat-compare`、`faijs-cadquery`、
  `faijs-fasteners`、`faijs-gears`、`faijs-sketch`、`faijs-viewer` deps + dev、
  `faijs-freecad` dev，以及 `demo` CDN `importmap` + wasm URL 手同步为 `5.6.0`）。
- `package-lock.json` 通过**删除 lock 再重装**重生成（旧 lock 即便更新的 range 也会把
  `node_modules/occt-wasm` 留在 `3.8.4`）。`npm ls occt-wasm` 证实只有一个 `5.6.0` 实例。
- 唯一**类型层**破坏是 `getBoundingBox`：新 API 保留基础 `(shape, useTriangulation: boolean)`
  重载、又新增一个 options 重载，因此 `occt-primitives.ts` 现在用 `useBounding ?? false` 调用。
- `getBoundingBox` 修复 + 版本号变更属于**声明一致性**改动，不算 lockstep 升级 ——
  occt-wasm 是第三方依赖，豁免于 `check-lockstep`。

## 测试中记录的行为差异

- 对已倒角输出再次 `fillet` **现在成功**（5.6.0 修好了 re-fillet/`TopoDS::Solid·Fail` 阻塞）。
  旧的 `p1-workplane-ops.test.js` GOTCHA pin 的是“应拒绝”，已更新为断言 re-fillet 解析成功
  且得到一个严格更小的 solid。
- `imprint`（映射到 `fuseAll` / `BRepAlgoAPI_Fuse`）现在把两个共面接触的 solid **粘合成一个**
  （3.8.4 是两个）。体积不变；solid/面数偏离 CadQuery 2.8.0（其 `imprint` 映射到
  `BOPAlgo_Builder` keep-cells）。测试期望更新为 5.6.0 结果（`b1,b2` → 1 solid、10 个面；
  部分接触的 `b1,b3` → 1 solid、11 个面）。

## Alternatives considered

- **保留 CadQuery `imprint` parity（保持两个接触 solid）** —— 用户最初的选择，但在
  5.6.0 的 JS 面**无法实现**：5.6.0 只暴露 `fuseAll`/`booleanOp`（Fuse/Cut/Common）、
  `split`（`BOPAlgo_Splitter`）、`intersectionCells`（`BOPAlgo_CellsBuilder`）和
  `unifySameDomain`；**没有** `BOPAlgo_Builder` keep-cells（general-fuse）原语。
  复现“2 solid + 1 个统一面”要么得加上游 occt-wasm 绑定、要么用脆弱的 JS 近似。
  按用户决策**记为缺口、不实装**；parity 偏差记录在测试与 `workplane.ts` 的 JSDoc 中。
- **保留 `3.8.4`**：拒绝 —— 升级的目的就是离开陈旧 OCCT、靠近当前内核。
- **把 root `overrides` 改回 `^5.6.0`**：拒绝（精确 pin 更简单且可用；移除）。

## Consequences

- 所有 `core`（225 文件 / 3003 tests）、`faijs-tests`（55 文件 / 588）、`faijs-cadquery`
  （598）测试套件全部干净通过，无 stderr。
- `faijs-freecad` 有一个 `sketch-empty-geoms` 失败，但**与升级无关**：它依赖外部 fixture
  `D:/Faicad/FreeCAD-library/Electrical Parts/Endstop/endstop-v1-2-makerbot.fcstd`，
  本机不存在。无论 occt-wasm 版本如何它都会失败。
- `imprint` 的 solid 合并 parity 偏差是**已知缺口** —— 上游 `occt-wasm`
  `BOPAlgo_Builder`(keep-cells) 绑定可恢复 CadQuery 2.8.0 parity，本轮不接线。