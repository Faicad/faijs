# Agent Note: 宿主侧 TopoRef 集成（M5）——捕获胶水、命名缓存与 op 引用

Status: implemented

[English](2026-08-31-topology-naming-host-integration.md) | 中文

## Problem

faijs 引擎随 TopoRef 工作产出 `ExecutionResult.naming`（每 part 命名行），但 3d_editor 宿主没有消费它的路径。装配把 `faceId`、钻孔把 `faceNormal` 持久化进 `.faijs` 脚本——两者都是快照/序号式引用，扛不住上游参数改动的重放，且 `faceId` 引擎侧已完全不读。宿主需要一个把「拾取的面行」在点击/提交时映射成 `FaceTopoRef` 的胶水模块、一个在 ScriptEngine 内部于「已经消费 topology 结果」的同一位置缓存命名表的落点，以及把 Feature 代码生成改为输出 TopoRef 字面量而非旧序号/快照字段。

## Decision

宿主把命名面从 `@faicad/faijs/browser`（`captureTopoRef`、`FaceTopoRef`、`EdgeTopoRef`、`PartNaming`）按 A/B/C 契约消费；宿主契约测试同步更新符号清单。

- 新增 `capture-topo-ref.ts` 胶水（位于 `src/engine/topology/`，而非 `src/lib/`——lib 层被禁止 import stores/engine），把 `scopedId + faceRowIndex` → 命名行 → `FaceTopoRef`。它经 `terminalToScopedId` 反查终端 part 名，从引擎最近一次 `ExecutionResult.naming` 缓存取行，并捕获 `TopoRefError`。无行（无命名上下文）时返回 `null`，调用方退回 legacy 几何快照——绝不静默拿序号硬取。`setTestOverrideNaming` 注入支持单测。
- ScriptEngine 在「已经在消费 `result.topology`」的同一位置（`commitSceneResult`、`_appendExecute`）缓存命名 map（`getLastExecutionNaming`），保证命名与拓扑同生命周期缓存。
- 对 mesh 模式的 primitive（无 BREP solid，`collectResult` 里没有 per-terminal `buildBrepTopology`），宿主在 primitive 创建与拓扑重建处调用 `runtime.setTopology(partName, 'primitive', buildSelectorRuntimeData(...))`，让 `SelectorRuntime.faces` 驱动的 `faceHints` 生效，点击时 `faceNaming` 行可解析。
- 装配 `confirmAssemble` 在捕获成功时把 `FaceConstraint.fixedFace/movingFace` 构造成 `{ topoRef: FaceTopoRef }`，否则回退 legacy `{ surfaceType, center, normal }` 快照；持久化 `faceId` 字段移除，绝不再写进脚本。预览求解器不变（仍从几何数据求解）。
- 钻孔：点击处理器从拾取面（triangle → `faceIds` → 面行）捕获 `clickFace = faceTopoRefFromRow(targetScopedId, faceRowIndex)`，存入 `drill-store.clickFace`；drill 特征代码生成在存在时写 `face: FaceTopoRef`。由于钻孔轴向是「点击点方向」，代码生成同时保留 `faceNormal`（射线拾取到的精确点击法向），引擎以该快照为权威轴向，`face` 引用作为持久化身份引用、并在无 `faceNormal` 时兜底。理由：曲面（如圆柱侧面）不存在能还原点击点方向的单一法向——引擎也没有点→曲面投影 API，`cylinder:lateral` 行的 hint 法向只是柱轴——仅凭 face 引用无法恢复用户拾取的径向钻孔轴。`position` 保留；backfill 先读 `faceNormal` 再读 face hint。
- `packages/stdlib/src/topo-resolve.ts` 复用同样 `resolveFaceGeometry` 的法向供历史路径使用，因此仅含 `face`（平面面、手写脚本）的脚本仍能在执行期派生法向。

## Alternatives considered

- **把捕获胶水放 `src/lib/topology/`。** 拒绝：eslint 层级边界禁止 `lib → stores/engine` import；胶水同时需要 `ScriptEngine.naming` 与 `script-store`，因此移到 `src/engine/topology/`。
- **永久持久化引擎计算出的几何快照。** 拒绝：§6.2 的核心正是装配/钻孔引用要能在跨重放经受参数改动；快照做不到；且引擎已能在执行期从 `FaceTopoRef` 派生面几何。
- **无命名数据也一律写 `face`。** 拒绝：没有拓扑运行的 mesh part 必须继续可用；legacy `faceNormal` 快照是「无命名上下文」的诚实兜底。
- **从 `topology-store`/第四个 Map 桶读命名。** 拒绝：现有的按来源 runtime Map 不改；命名随 ScriptEngine 结果缓存在 `result.topology` 同生命周期。

## 影响

- `faceId` 从装配/钻孔的持久化面引用写路径移除；引擎仍解析历史脚本里仍带 `faceId`/`faceNormal` 键的。
- mesh 模式 primitive 的钻孔/装配引用经 `setTopology` 馈入的 `faceHints` 解析，mesh part 在 BREP 之外也能做执行期法向推导。
- `clickFace` 运行时推导，不进入 undo/命名序列化面。
- 宿主 build、typecheck、lint、node 单测套件、jsdom 组件套件全绿；契约白名单补上命名面符号。

## 验证

新增测试：`faceTopoRefFromRow`/`edgeTopoRefFromRow` 单测（完整引用、mesh hint-only 行、无行、越界、未知 scopedId）、装配 `confirmAssemble` 测试（有命名数据时写出 `FaceTopoRef`，否则为 `faceId`/center/normal 快照形态）、drill `recordFeature` 测试（有 `clickFace` 同时写 `face` 与 `faceNormal`，无则只写 `faceNormal`）。引擎回归：`topology-naming` 集成测试验证 drill 同时带 `face` 与 `faceNormal` 时在 BREP 链上执行不报错。node 全量（1877）+ jsdom（348）+ 拓扑/装配 e2e 全绿。