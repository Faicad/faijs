# op 自有化盘点清单（Phase 0 活文档，Phase 3 逐 op 更新）

状态：实施中（Phase 0 产物）
依据：`docs/plans/2026-09-25-core-decouple-brepjs-plan.md` §5.4（35 个 compat op 逐 op
自有化，core 直连 occt 引擎）；本清单为方案 Phase 0 第 2 项要求的执行中活文档。

口径：**35 个 compat op** = `api/surface/capability-map.json` entries（35）=
`api/surface/arg-spec.ts` 中 `kind: 'brep-op'` 条目（35）三方一致（2026-09-25 实测）。
另有脚本面 op 49 个（本就 core 自有实现，不属本清单）。

## 0. 用户裁决（2026-09-25 已拍板，直接决定本清单动作）

1. **逐 op 重写**（不移植 vendored op 编排层）——每个 op 直连 core `BrepEngineApi`，
   形态对齐 `api/brep-mirror/*` 先例；vendored 参考实现只作语义参考，照抄不 import。
2. 10 个零引用 generated 分片**直接删除**（公开面收缩）；`brepjsCompat` 命名空间同删。
3. sheetmetal 9 出口补进 core **公开导出**。
4. cq-compat **改写**，core 删除 `l3-bridge` 对外借入面。

## 1. 自有化范式（照 `api/brep-mirror/threadFns.ts` 写，勿另立形态）

- 文件头 `@platform occt` 自证 + op 声明 `engines: ['occt']`（守卫
  `check-platform-imports.mjs` 规则 2）。
- 保留 brepjs 参考实现的**核心算法与默认公差**；内核调用改为 core 引擎方法
  （`BrepEngineApi`）或平台原生面（`getOcctKernel()`，occt-only 能力）。
- 不用 BlueprintSketcher / DisposalScope / Result——kernel 直调 + `BrepHandle` +
  抛异常（`threadFns.ts` 头部差异注明的既有范式）。
- 能力声明重推：capability-map 该 op 条目改为「core 自有实现调用的内核方法集合」
  （静态分派语义不变，禁运行时回退）。

## 2. 总表（35 op 全量，G 分组按方案 §5.4，**sweep 为方案 G 表漏列项，补入 G3**）

| # | op | G 组 | generated 分片 | vendored 参考实现（brepjs src） | 当前 kernelMethods（capability-map 实测） |
|---|---|---|---|---|---|
| 1 | torus | G1 | topology | topology/primitiveFns.ts#torus | dispose, makeTorus |
| 2 | ellipsoid | G1 | topology | topology/primitiveFns.ts#ellipsoid | dispose, makeEllipsoid, translateWithHistory |
| 3 | mirror | G1 | topology | topology/api.ts#mirror | dispose, mirrorWithHistory |
| 4 | clone | G1 | topology | topology/api.ts#clone | copyShape, dispose |
| 5 | applyMatrix | G1 | topology | topology/api.ts#applyMatrix | dispose, generalTransformNonOrthogonal, generalTransformWithHistory, hashCode, iterShapes, surfaceCenterOfMass, surfaceNormal, surfaceType, uvBounds |
| 6 | locate | G1 | topology | topology/api.ts#locate | composeTransform, dispose, hashCode, locate |
| 7 | section | G1 | topology | topology/api.ts#section | dispose, isNull, section |
| 8 | heal | G1 | topology | topology/api.ts#heal | dispose, healFace, healSolid, healWire, isValid, shapeType |
| 9 | simplify | G1 | topology | topology/api.ts#simplify | dispose, simplify |
| 10 | autoHeal | G1 | topology | topology/healingFns.ts#autoHeal | dispose, fixSelfIntersection, healFace, healSolid, healWire, isValid, iterShapes, sew, shapeType |
| 11 | fixShape | G1 | topology | topology/healingFns.ts#fixShape | fixShape |
| 12 | healSolid | G1 | topology | topology/healingFns.ts#healSolid | dispose, healSolid, isValid, shapeType |
| 13 | fixSelfIntersection | G1 | topology | topology/healingFns.ts#fixSelfIntersection | dispose, fixSelfIntersection, shapeType |
| 14 | makeBaseBox | G1 | sketching | sketching/shortcuts.ts#makeBaseBox | addHolesInFace, buildEdgeOnSurface, buildExtrusionLaw, copyShape, curveParameters, curvePointAtParam, curveTangent, dispose, downcast, extrude, isNull, loftAdvanced, makeFace, makeFaceOnSurface, makeVertex, makeWireFromMixed, mirror, revolveVec, shapeType, simplePipe, surfaceType, sweepPipeShell |
| 15 | fuse | G2 | topology | topology/booleanFns.ts#fuse | dispose, fuse, fuseWithHistory, isNull |
| 16 | split | G2 | topology | topology/api.ts#split | dispose, isNull, split |
| 17 | pocket | G2 | operations | operations/compoundOpsFns.ts#pocket | addHolesInFace, cut, cutWithHistory, dispose, downcast, extrude, isNull, makeFace, surfaceCenterOfMass, surfaceNormal, surfaceType, translateWithHistory, uvBounds |
| 18 | drill | G2 | operations | operations/compoundOpsFns.ts#drill | boundingBox, cut, cutWithHistory, dispose, isNull, makeCylinder |
| 19 | boss | G2 | operations | operations/compoundOpsFns.ts#boss | addHolesInFace, dispose, downcast, extrude, fuse, fuseWithHistory, isNull, makeFace, surfaceCenterOfMass, surfaceNormal, surfaceType, translateWithHistory, uvBounds |
| 20 | mirrorJoin | G2 | operations | operations/compoundOpsFns.ts#mirrorJoin | dispose, fuse, fuseWithHistory, isNull, mirrorWithHistory |
| 21 | convexHull | G2 | operations | operations/convexHullFns.ts#convexHull | dispose, hullFromPoints, shapeType |
| 22 | extrude | G3 | operations | operations/api.ts#extrude | dispose, downcast, extrude, isNull |
| 23 | revolve | G3 | operations | operations/api.ts#revolve | dispose, isNull, revolveVec, shapeType |
| 24 | **sweep** | G3 | operations | operations/extrudeFns.ts#sweep | dispose, shapeType, simplePipe, sweepPipeShell |
| 25 | complexExtrude | G3 | operations | operations/extrudeFns.ts#complexExtrude | buildExtrusionLaw, dispose, shapeType, simplePipe, sweepPipeShell |
| 26 | twistExtrude | G3 | operations | operations/extrudeFns.ts#twistExtrude | buildExtrusionLaw, dispose, shapeType, simplePipe, sweepPipeShell |
| 27 | rotate | G3 | topology | topology/api.ts#rotate | dispose, rotateWithHistory |
| 28 | offset | G3 | topology | topology/api.ts#offset | dispose, offsetWithHistory, shapeType |
| 29 | shell | G3 | topology | topology/api.ts#shell | dispose, shapeType, shell, shellWithHistory |
| 30 | linearPattern | G4 | operations | operations/patternFns.ts#linearPattern | dispose, fuseAll, hashCode, isNull, iterShapes, linearPattern, section, surfaceCenterOfMass, surfaceNormal, surfaceType, uvBounds |
| 31 | circularPattern | G4 | operations | operations/patternFns.ts#circularPattern | circularPattern, dispose, fuseAll, hashCode, isNull, iterShapes, section, surfaceCenterOfMass, surfaceNormal, surfaceType, uvBounds |
| 32 | gridPattern | G4 | operations | operations/patternFns.ts#gridPattern | dispose, fuseAll, gridPattern, hashCode, isNull, iterShapes, linearPattern, section, surfaceCenterOfMass, surfaceNormal, surfaceType, uvBounds |
| 33 | rectangularPattern | G4 | operations | operations/compoundOpsFns.ts#rectangularPattern | dispose, fuse, fuseAll, fuseWithHistory, hashCode, isNull, iterShapes, section, surfaceCenterOfMass, surfaceNormal, surfaceType, translateWithHistory, uvBounds |
| 34 | roof | G4 | operations | operations/roofFns.ts#roof | buildTriFace, dispose, fixShape, isValid, sew, sewAndSolidify |
| 35 | thread | G4 | operations | operations/threadFns.ts#thread | dispose, loftAdvanced, makeLineEdge, makeVertex, makeWireFromMixed, shapeType |

（G5 = 平台手写 op 层 `api/{loft,revolve,sweep,thicken,replicate}.ts` 的 BREP 实现改直连，
非 compat op，由 §5.3 处理，不入上表；sweep 跨 G3/G5 两条线，上表第 24 行是 compat
op 面，api/sweep.ts 手写面走 §5.3。）

## 3. 关键核对（2026-09-25 实测）

1. **G 表补漏**：方案 §5.4 的 G 分组未单列 sweep（generated compat op 与手写平台 op
   并存），本清单按 35 op 全量收录（第 24 行）。
2. **thread 去重**：vendored compat op 与 core 既有 `api/brep-mirror/threadFns.ts`
   两份实现 → 自有化收敛为一处（以 core 版为准；capability-map 的 thread 条目当前
   仍记 vendored 方法，自有化后重推）。
3. **revolve 两面对齐**：`api/revolve.ts` 手写版带 roleTable；`api/index.ts:76` 取
   generated compat op（无 roleTable，即文件头记录的 nameless shape 缺陷）→ 自有化后
   两面对齐到同一手写实现。
4. **extrude 去委托**：`api/extrude.ts:26` 把长度形态委托给 generated compat op →
   自有化后去掉委托。
5. **hull 闭包**：convexHull 需要 core 引擎当前唯一 vendored 依赖
   `hullFromPoints`（`occt-primitives.ts:110` 的 `OcctWasmAdapter.fromKernel` 唯一
   用途）——§5.1 最小闭包移植须早于 Phase 3 G2 的 convexHull。
6. **occt-only 能力对照**：capability-map 的 kernelMethods 是 vendored `KernelAdapter`
   方法名；core 侧契约是 `BrepEngineApi`（`brep/engine/primitives.ts`，判据真源
   `api/surface/engine-method-map.json`）。逐 op 自有化时把「vendored 方法名」翻译为
   「core 引擎方法或 occt 原生面（`getOcctKernel()`）」——例如 makeTorus→BrepEngineApi.makeTorus、
   fuse/fuseWithHistory→fuse（+演化面）、mirrorWithHistory→mirror、healFace/healSolid/healWire→
   occt 原生 heal 族（BrepEngineApi 无中立名，走平台面 + engines:['occt']）、
   sweepPipeShell→occt 原生 BRepOffsetAPI_MakePipeShell、hullFromPoints→BrepEngineApi.hullFromPoints。
   逐 op 翻译表在 Phase 3 每批开工前填写下表（TODO 占位，批内完成）。

## 4. 语义保留点清单（每个 op 自有化时逐项核对，不放宽断言）

- [ ] 参数面与 `formClass`（schema 不变；`arg-spec.ts` 条目不改）
- [ ] 内核方法选择与**默认公差**（照抄 brepjs fns）
- [ ] keep/history 语义（filletWithHistory / fuseWithHistory / cutWithHistory /
      mirrorWithHistory / rotateWithHistory / offsetWithHistory / shellWithHistory /
      translateWithHistory / generalTransformWithHistory 等 *WithHistory 族的演化面）
- [ ] 命名/角色表（naming：kernel via byAdjacency / unmodeled；roleTable 如 revolve）
- [ ] Result→错误码映射（`ok/err`、语句边界 unwrap、`E_*` 错误码）
- [ ] borrow/adopt 所有权（Shape 句柄 ⇄ vendored ShapeHandle 零拷贝互操作；自有化后
      全部走 core 句柄，无需借入）
- [ ] 静态分派不变：capability-map 条目重推且 `entries` 数保持 35（禁运行时回退）

## 5. 测试策略

- 基线：每个 op 的既有测试（core `api/*.test.ts` + `packages/tests` e2e）**断言不放宽**；
  逐 op 跑完该 op 全部既有测试再进下一 op。
- parity：`brep/engine/measurement-parity.test.ts` 与 `packages/tests` 的
  p3/p5-vendored-surface 套件（45 文件）在 Phase 5 删包前做一次全量对拍；
  其中断言在自有实现下仍成立的用例**先改写成 core 侧测试**再删原文件（§5.9 第 1 条）。
- 新测试：每个自有化 op 若发现既有测试未覆盖的语义点（如默认公差、keep/history），
  随自有化补 `*.test.ts`（关键验证落测试铁律）。

## 6. Phase 3 分批顺序（由简到繁，每批完成即增量删 vendored import）

- **G1（14）**：applyMatrix → clone → locate → heal → healSolid → fixShape →
  autoHeal → fixSelfIntersection → simplify → makeBaseBox → torus → ellipsoid →
  section → mirror
- **G2（7）**：fuse → split → convexHull（依赖 §5.1 hull 闭包）→ pocket → drill →
  boss → mirrorJoin
- **G3（8）**：extrude → rotate → offset → shell → revolve（roleTable 对齐）→
  sweep → complexExtrude → twistExtrude
- **G4（6）**：linearPattern → circularPattern → gridPattern → rectangularPattern →
  roof → thread（收敛到 core 版）
- **G5（5）**：loft / revolve / sweep / thicken / replicate 的 BREP 实现直连
  （§5.3；shell 外壳保留，内部换 core 直连）

## 7. 待补（Phase 3 批内填）

- 逐 op 的「vendored 方法名 → core 引擎方法/occt 原生面」翻译表（§3.6 格式）
- 逐 op 的既有测试清单（跑之前用 `grep '\b<op>\b'` 定位）
- 各 op 语义保留点勾选结果（§4 清单）

## 8. 执行状态（2026-09-25 晚，§5.5/§5.6 已落地）

- **§5.5 第 1 条**：arg-spec 死分片收口——kernel 57 + gear 17 + 2d 45 + io 28 +
  ns 9 + text 8 + query 24 + type 204 + core pure 67 + topology pure 9 = 全 skip；
  generated 目录除 operations/sketching 外全零 vendored（本段后 operations/sketching 亦归零）。
- **§5.5 第 2 条**：测量/拓扑 query 自有化——7 measurement selfhost
  （measureVolumeProps/measureSurfaceProps/measureLinearProps/measureVolume/
  measureArea/measureLength/inspectMassProps）+ isValid/isSameShape/getBounds
  selfhost（getBrepApi 直连）；10 个无 L1 等价（distance×2/curvature×2/
  interference×2/inspect×3）置 skip。**generated 全零 vendored import**。
- **§5.6 装配自有化**：新增 core 自有 4 模块——solvers/quat.ts（78 行）、
  solvers/chain-solver.ts（385 行，vendored solverAdapter 逐字对齐）、
  solvers/assembly-tree.ts（130 行）、solvers/joints-kinematics.ts
  （jointFns+ikFns 890 行合一）；SolverEntity/SolverConstraint/SolverResult
  迁 solvers/types.ts；solve/preview/entities/lower/pose/joints + 3 测试 import
  全改 core；operations 11 + sketching 1 vendored pure 置 skip。
  **验收**：缺省 chain 钉住测试新增；parity 对拍 8/8；core 151/151；
  装配 40/40；cq-compat 154/154；build 383 files。
- **§5.7 前置（部分）**：cq-compat-assembly 提升视图测试改真实 Shape 直通；
  view-projection 借入经实测确认必须保留 l3-bridge 对象包装（裸 brepOf 句柄
  喂不进 vendored drawProjection——WeakMap 键/shape.type 读取），§5.7
  disposal 自有化后再内联。
