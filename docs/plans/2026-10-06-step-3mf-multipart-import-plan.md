# 统一 faijs 脚本加载路径 + STEP/3MF 多零件导入方案

**状态**：P0 已实施（faijs 侧契约落地，2026-10-06 晚），P1 待实施（3d_editor 单一通道，最大改动面，需单独评审）
**日期**：2026-10-06（v2 重写：单一加载通道 + 多零件 + 显示/导出契约边界）
**范围**：本仓 `faijs`（`packages/core`、`packages/faijs-extra`）+ 相邻仓 `../3d_editor`（`packages/app`、`packages/shared`）

## 1. 需求

用户原话（2026-10-06 追加）：

> 我早已强调，一切都必须走faijs脚本，所以用户打开一个3d文件，应该是走cad.load，然后3d_editor先执行faijs脚本，然后拿到代码执行后的数据进行统一处理。
>
> 还有STEP 多零件，与occt-wasm 5.6.0 的 fuseAll有什么关系……我记得之前是让faijs的cad.load只返回step文件的第一个零件，作为临时方案，和这个fuseAll没有关系。

需求拆解：

| 编号 | 需求 | 验收口径 |
|---|---|---|
| R0 | **单一 faijs 脚本加载通道（红线）** | 用户打开任意 3d 文件 = 记录 `cad.load({ file })` → 执行 faijs 脚本 → 3d_editor **只**消费执行结果（几何 / 结构 / 拓扑 / 单位 / 材质 / Bambu 视图）。删除 3d_editor 显示通道自解析（`formatLoaders` 直调 `loadBrep`/`parseThreemf` 渲染、`ModelGroup` 直接渲染 `loadFormat` 产物）。每个文件只被解析一次。 |
| R1 | STEP 返回多零件装配结构 | 一个 STEP 文件导入后全部零件可见，装配层级（子装配/零件）作为结构数据可被宿主消费 |
| R2 | 3MF 返回多盘多零件结构 | 一个 3MF 文件导入后全部对象/零件可见，Bambu 多盘按盘分组布局 |
| R3 | `../3d_editor` 正确加载显示 | 场景树 N 个 part、画面渲染 N 个 mesh、多盘布局与 print/assembly/import 视图切换恢复；且首帧几何 = faijs 执行结果三角化（不再存在第二套"宿主几何"） |
| R4 | 走 faijs 脚本加载路径 | `cad.load({ file })` 是唯一导入入口，不新增并行的宿主解析路径（由 R0 收口） |
| R5 | 显示/导出契约边界（衔接草图） | 执行结果能区分"可导出几何"与"仅显示几何"（草图仅显示不导出，其方案由另一 agent 负责）；本案只定义数据位与消费边界，不重复设计 |

## 2. 现状与根因

### 2.1 两条并行通道——错误源头确认

`../3d_editor` 当前导入一个文件同时走两条通道，**各自解析同一份文件**：

- **显示通道（导入即所见）**：`useFileUpload` → `loadFormat()`（`packages/app/src/engine/formatLoaders.ts:223`）→ `LoaderResult.meshes` → `ModelGroup` 直接渲染。STEP 分支直调 faijs **lib 层** `loadBrep` 自建 mesh 并自行 `release` solid（`formatLoaders.ts:341-374`）；3MF 分支直调 `parseThreemf` 自建 group（`formatLoaders.ts:267-269`）。**这条路径不进入 faijs 脚本执行**，产出的是"宿主几何"——与脚本通道的"faijs 几何"是两套数据，正是「拓扑数据所使用的 mesh 必须是用户看到的 mesh」红线（3d_editor AGENTS.md 规则 1）的风险点。
- **脚本通道（几何真源）**：`ModelGroup` 挂载后 `ScriptEngine.recordLoadFromRef()`（`ScriptEngine.ts:527`）向画布插入一行 `const part0 = await cad.load({ file: '…' })`（`features/load.ts:45`）→ worker 执行 faijs `load` op → 产物经 `executeScript`（`executeScript.ts:259`）→ `SceneMutator.createPart`（`scene-mutator.ts:175`）入 store / VersionStore。

### 2.2 五处收敛——根因清单（**与 fuseAll 无关**）

从「最先发生」到「最靠近画面」排列：

| 层 | 位置 | 收敛行为 |
|---|---|---|
| ① faijs BREP（STEP） | `packages/core/src/brep/brep-ops.ts:844` | `loadBrep` 遇多 solid 只取 `solids[0]`，回传 `multiSolidCount` |
| ② faijs mesh（3MF） | `packages/core/src/mesh/io.ts:143` | `importFile` 只取 `archive.objects[0]`，回传 `multiPartCount` |
| ③ faijs load op | `packages/faijs-extra/src/ops/load.ts:95` | 两条分支都只返回单一 Shape，登记「多零件降级」pending |
| ④ 3d_editor 显示通道 | `formatLoaders.ts:341`（STEP 单 compound）、`ModelGroup.tsx:403`（3MF `slice(0, 1)`） | 宿主侧再收敛一次 |
| ⑤ 3d_editor 脚本通道 | `scene-mutator.ts:188`（`innerId` 恒为 `'o1'`）、`features/load.ts:45`（无 `partIndex`） | 一条 `cad.load` 语句只产出 1 个 part |

**明确排除**：occt-wasm 5.6.0 的 `fuseAll` 将接触实体粘成一个，是另一项已记录的布尔/imprint parity gap（`2026-10-05-occt-wasm-upgrade-3-8-to-5-6-plan.md`，与 CadQuery 2.8.0 的偏差），**与本问题无关**。多零件回归的根因就是 ①-⑤ 的主动收敛——"cad.load 只返回第一个零件"正是当时的临时方案，不是内核融合。对 cube5.step 的实测也印证：导入结果只含 cube（6 个法向、无曲面），若被 fuseAll 融合会呈现曲面与更多法向。

### 2.3 多零件能力其实都还在，只是被收敛

这不是「能力缺失」，而是「能力被主动收窄」。相关基础设施完整保留：

- **3MF**：`parseThreemf` 按 `<build><item>` 逐个产出 `ThreemfObject`（`threemf-loader.ts:194`），transform 已烘焙进 positions；Bambu 层 `parseBambu3mfFromEntries` 已解析 `plates` / `buildItems` / `assembleTransforms` / `importTransforms` / `filamentColors`（`threemf-bambu.ts:109`）。
- **STEP**：`importAssemblyFromStep` 返回完整 XCAF 装配树 `AssemblyPartNode[]`（`occtKernel.ts:308`，含 `labelPath`/`name`/`isAssembly`/`children`/`color`/`prototypeKey`，每 leaf 的 `shapeHandle` 已烘焙 location）；`collectLeafParts` 可取全部叶零件（`occtKernel.ts:473`）；`importStepMultiPart` 已能逐 leaf 返回 `{ shape, solid, name, color }`（`highLevelApi.ts:61`）且从 `@faicad/faijs/browser` 导出（`browser.ts:70`）——3d_editor 已不再调用它。
- **3d_editor 渲染**：多盘分组布局（`ModelGroup.tsx:631`）、print/assembly/import 视图 delta（`ModelGroup.tsx:439`）、多盘场景树（`ModelGroup.tsx:774`）全部在位，`PartInfo` 已含 `plateId`/`objectId`（`shared/types.ts:274`），`SceneTreeNode` 已支持 `children` 与 `nodeType: 'container'`（`shared/types.ts:144`）。

### 2.4 显示/导出统一处理与草图引入后的契约缺口（衔接另一 agent）

faijs 的 Shape 数据模型历史上同时驱动显示（渲染 mesh）与导出（STEP/3MF）。草图功能引入后出现新需求：草图几何需要在 canvas 显示，但**不参与导出**——即"执行结果里的几何不全都可导出"。该问题的落地由另一 agent 的方案负责；本案只在加载路径的消费边界处定义判别位（§5.5 `ImportPart.exportable` + 「场景树可导出集合」约定），避免两个方案在"执行结果消费"处互相假设。

## 3. 目标与非目标

**目标**：R0–R5。

**非目标（本期不做）**：

- 3MF 的 `<components>` 复合对象与 sub-model 外部文件展开（`threemf-loader.ts:22` 已声明不覆盖，维持现状）。
- STEP 装配层级在 3d_editor 场景树中渲染为多级嵌套（本期先平铺 N 个 part，装配层级作为 `ImportModel.assembly` 结构数据随返回，供 P3 场景树展开）。
- IGES（occt-wasm 未链接 TKDEIGES，白名单不含；维持报错）。
- 导入结果回写 `.fai.js`（装配导入仍是 `cad.load({ file })` 一行，资产外置）。
- 导出多零件 STEP/3MF 往返（另案）。
- 草图显示/导出分离的完整设计（另一 agent）。

## 4. 设计原则

1. **单一通道（R0 红线）**：宿主渲染与结构消费只读 faijs 脚本执行结果；每个文件只解析一次（faijs 侧）。3d_editor 不再保留并行的自解析渲染路径。
2. **单零件零回归**：单 solid STEP、单 build item 3MF、STL 的行为与返回类型完全不变——`cad.load` 仍返回可直接接特征链的 Shape。
3. **确定性**：零件枚举序 = 文件声明序（3MF `<build><item>` 序 / STEP XCAF DFS 序），不使用 Map 迭代序、时间戳、随机身份；同文件重复导入得到同一零件顺序。
4. **单一真源**：几何 = 执行结果三角化（G0，进 VersionStore）；结构 = `ImportModel`；拓扑 = `result.topology`；材质 = `shape.appearance`/originals。**不存在第二份"宿主几何"**。
5. **双链路各自完整**：mesh 是正式数据；BREP 链上每个零件持独立 solid 句柄，逐 part 可精确运算。
6. **不做运行时回退**：多零件是静态判定（文件声明的对象/实体数），不是 try-catch 后的降级。
7. **显示/导出判别位**：执行结果几何默认可导出；仅显示几何（草图）显式标记（与草图方案衔接）。

## 5. faijs 侧设计

### 5.1 新增导入模型结构 `ImportModel`

在 `packages/core/src/mesh/` 新增类型（建议 `import-model.ts`，经 `@faicad/faijs/mesh/import-model` 导出），描述「一次导入」的完整产物：

```ts
export interface ImportPart {
  /** 零件在本次导入中的序号（0 起，等于 load 返回 compound.children 的下标） */
  index: number
  /** 零件名（STEP XCAF label / 3MF <object name>；无则回退 `imported:<index>`） */
  name: string
  /** 显示色 sRGB 0..1（STEP STYLED_ITEM / 3MF basematerials） */
  color?: [number, number, number]
  /** 3MF <object id>（Bambu 视图变换查表键） */
  objectId?: string
  /** Bambu 盘号（多盘分组依据） */
  plateId?: number
  /** Bambu 挤出机序号（1 起） */
  extruder?: number
  /** 零件级说明性元数据（复用 ShapeMeta） */
  meta?: ShapeMeta
  /** 是否可导出（R5 边界）：默认 true；仅显示几何（草图等）由草图方案置 false */
  exportable?: boolean
}

export interface ImportAssemblyNode {
  name: string
  /** 叶节点：指向 parts 下标 */
  partIndex?: number
  /** 装配/合成节点：子节点（DFS 序与 parts 顺序一致） */
  children?: ImportAssemblyNode[]
}

export interface ImportModel {
  format: 'step' | '3mf' | 'stl' | 'brep'
  /** 文件声明单位（元数据；坐标已是基准值） */
  unit: UnitName | null
  fileMeta?: FileMeta
  /** 零件表，顺序与 load 返回 compound.children 一致（单零件时长度 1） */
  parts: ImportPart[]
  /** STEP 装配层级（XCAF 树）；无装配结构时省略 */
  assembly?: ImportAssemblyNode
  /** Bambu 显示视图数据（仅 3MF）：多盘布局 / print·assembly·import 视图 delta。
   *  显示通道删除后宿主不再解析 3mf archive，视图数据必须由 faijs 结果承载（v2 修订）。 */
  bambuViews?: {
    plates: number[]
    assembleTransforms?: Record<string, Transform>
    importTransforms?: Record<string, Transform>
  }
}
```

`ImportModel` 是**非几何**结构数据，与现有 `compounds` / `detectedUnits` 同层，不进 `.fai.js`、不参与几何运算、不影响确定性（内容由文件决定）。

### 5.2 `cad.load` 返回契约

| 输入 | 返回 | 说明 |
|---|---|---|
| STL / 单 solid STEP / 单 build item 3MF | `SolidShape` | 现状不变，可接特征链 |
| 多 solid STEP / 多 build item 3MF | `CompoundShape`（`kind: 'compound'`，`children: Shape[]`） | children 顺序 = 文件声明序（与 `ImportModel.parts.index` 一一对应） |

无论单/多零件，load op 都通过 pending 通道登记 `ImportModel`（单零件时 `parts` 长度 1），引擎执行后收编进 `ExecutionResult`。

多零件 compound 的 children 为**匿名几何**（无变量名），因此不走现有 `ExecutionResult.compounds`（该字段语义是「具名成员变量」）；零件身份由 `ExecutionResult.importModels` 承载，几何由 `outputs.get(terminalName).children` 承载。

脚本层访问单个零件：`const m = await cad.load({ file: 'x.step' })` 后，`m.children[i]` 即第 i 个零件（保持 JS 数组语义）；单零件文件 `m` 本身就是 Shape。

### 5.3 STEP 装配导入

新增 core 函数（建议 `loadBrepAssembly`，与 `loadBrep` 同文件/同入口）：

1. 调用 `importAssemblyFromStep(buffer)` 得到 `AssemblyPartNode[]`（装配树，含层级、名称、颜色、已烘 location 的 solid 句柄）。
2. DFS 遍历，对每个叶节点用 `solidToShape(kernel, leaf.shapeHandle, …)` 三角化并 `fromBrep` 绑定 solid 句柄（进入 brepChain，逐 part 可精确运算）。
3. 按 DFS 序构造 `ImportPart[]`（`name` 取 XCAF label，`color` 取 label/STEP STYLED_ITEM 色），并同步构造 `ImportAssemblyNode` 树（`partIndex` 指向叶零件；`syntheticGroup` 的虚拟子节点如实表达为合成节点）。
4. 释放非叶/装配节点的句柄——**实现校正（P0）**：`walkLabel` 已保证装配节点 `shapeHandle=null`、`syntheticGroup` 的 compound 已释放、单 solid 叶的 `getSubShapes` 引用副本已释放，因此 `loadBrepAssembly` **不额外调用 `releaseAssemblyTree`**；叶句柄随各 part 返回，调用方经 `fromBrep` 绑定后归 brepChain 管理。
5. 若文件无装配结构（`importAssemblyFromStep` 只返回单个叶），退回 §5.2 的单零件路径——行为与现状一致。多根文件（多个顶层 PRODUCT）合成虚拟根 `{ name: 'imported' }`（确定性结构名，非零件身份）。

多 solid 但非装配（单一产品内含多 MANIFOLD_SOLID_BREP）的情形已被 `walkLabel` 处理为 `syntheticGroup`（`occtKernel.ts:411`），方案沿用其产物，不额外判定。

**P0 实现补充**：`loadBrepAssembly(kernel, buffer)` 签名不含 brepChain/stmtId（与 load op 现状一致，meshShapeCache 归引擎侧）。实体校验（与 load op「要求导入物含实体」契约一致）：每个 leaf 经 `leafHasSolid`（`isSolid` 或 `getSubShapes('solid')` 非空，引用句柄立即 release）过滤，全部无实体则报错——wireframe STEP 文件行为不变（报错，不静默回退）。

### 5.4 3MF 多盘多零件导入

`importFile`（`mesh/io.ts:133`）扩展返回全部对象：

- `ImportFileResult` 新增 `parts: Shape[]`（全部 `<build><item>` 对象，顺序 = 声明序）；`shape` 字段保留为 `parts[0]`（单零件兼容，过渡期）。
- load op 收到 `parts.length > 1` 时构造 `CompoundShape` + `ImportModel`；`parts.length === 1` 时走单零件路径。
- Bambu 层：load op 在 `archive.extraEntries` 存在 Bambu 配置时，为每个对象补齐 `objectId` / `plateId` / `extruder`（数据来自 `parseBambu3mfFromEntries` 的 `objects` / `parts` 表，二者已解析），并把 `assembleTransforms` / `importTransforms` / `plates` 装入 `ImportModel.bambuViews`（v2 修订：视图数据随执行结果返回，宿主不再解析 archive）。

### 5.5 `ExecutionResult` 扩展

`ExecutionResult`（`runtime.ts:123`）新增：

```ts
/** 导入模型结构（键 = load 语句终端 PartName）：零件表 + 装配层级 + 文件元数据。
 *  单零件导入同样登记（parts 长度 1）。 */
importModels?: Map<PartName, ImportModel>
```

配套 pending 通道（与 `setPendingMultiPartCount` 同模式，`runtime-state.ts:590`）：`setPendingImportModel(partName, model)` / `takePendingImportModels()`；在 `direct-executor.ts:714` 的语句执行后收编点与 `runtime.ts:1086` 的结果组装点各加一处映射。

**R5 边界（衔接草图方案）**：`ImportModel.parts` 是"可导出零件"的枚举源；`ImportPart.exportable=false` 的零件只显示、不进场景树的可导出集合、不参与导出（宿主「导出依据场景树」红线自然生效）。草图的"仅显示几何"如何进入渲染层（独立显示层 vs 场景树非导出节点）由另一 agent 方案决定，本契约只保证判别位存在且默认值正确。

### 5.6 兼容与降级字段

- `ExecutionResult.multiPartCounts` 保留：多零件不再走降级路径后，该字段在多零件文件上不再产生；保留用于「运行时不支持多零件结构的旧宿主」判断，以及单零件路径的既有消费。
- 单零件文件仍登记 `ImportModel`（长度 1），使 3d_editor 有统一消费入口，不必分叉。
- `load` 后缀白名单、3MF 魔数校验、单位探测逻辑全部不变。

### 5.7 P0 实施记录（2026-10-06 晚，已落地）

**文件级变更（faijs）**

| 文件 | 变更 |
|---|---|
| `packages/core/src/mesh/import-model.ts`（新） | `ImportPart` / `ImportAssemblyNode` / `ImportBambuViews` / `ImportModel`（`meta` 用 `ShapeMeta`） |
| `packages/core/src/mesh/io.ts` | `ImportFileResult` 增 `parts: Shape[]` + `importModel?`；3MF 全对象 + `buildBambuViews`；STL 补 `parts:[shape]`；`shape` 保留 `parts[0]` |
| `packages/core/src/brep/brep-ops.ts` | 新增 `loadBrepAssembly` + `LoadBrepAssemblyPart` + `leafHasSolid` + `toImportAssemblyNode` |
| `packages/core/src/runtime-state.ts` | `setPendingImportModel` / `takePendingImportModels`（pending 通道） |
| `packages/core/src/cad-runtime/direct-executor.ts` | runUnit finally 收编 `takePendingImportModels` → `importModelsOut` + snapshot getter |
| `packages/core/src/cad-runtime/runtime.ts` | `ExecutionResult.importModels` 定义 + collectDirectResult 组装 |
| `packages/faijs-extra/src/ops/load.ts` | mesh 多零件 → `compound(parts)`；BREP → `await loadBrepAssembly` → 单零件 `fromBrep` / 多零件 `compound(children 各 fromBrep)`；双路径登记 `importModel`；返回类型 `Shape \| CompoundShape` |
| `packages/core/src/browser.ts` | 导出 `loadBrepAssembly` / `LoadBrepAssemblyPart` / `ImportModel` 族类型 |

**行为变化**：`multiPartCounts` 在多零件文件上不再登记（不再降级）；`importModels` 单/多零件均登记。

**测试（faijs，全绿）**

- `test/brep/load-brep-assembly.test.ts`（新）：T0 句柄互通探针 + 多零件（cq-assembly-two-parts）装配树 + 多根（test-model.step）+ 单零件（box_boss）。
- `test/mesh/io.test.ts`：3MF 多对象改新契约（parts 全量声明序 + importModel.parts 身份）。
- `test/api/load-file-param.test.ts`：多对象 3MF / 多 solid STEP → CompoundShape + importModels；单 solid STEP 用例改用 box_boss.step。
- `test/api/load-multipart.test.ts`（改写）：单零件 / 多对象 3MF / 多 solid STEP 新契约 e2e。
- `test/runtime-state.test.ts`：pending importModels 通道存取（api-coverage 门禁要求）。

**验证**：`npx vitest run packages/core` 266 文件 / 2861 用例全绿（13 skipped）；`packages/faijs-extra` 76 用例全绿；`npm run lint` 0 errors；`npm run typecheck` 全绿；`check-api-test-coverage --package=core` 通过（L1 685 exports）；api-surface-snapshot / check-platform-imports / check-lib-src-language / check-test-fs-scope / check-tsconfig-paths 全过；`npm run build` 全绿。

**与方案差异（已按实现校正）**：§5.3 不再调用 `releaseAssemblyTree`（walkLabel 已保证装配节点句柄释放）；`loadBrepAssembly` 不含 brepChain 参数；多根文件合成虚拟根 `imported`。

**T 状态**：T0 探针已落地并通过（句柄互通成立）；T1 部分覆盖（T0 用例含释放探针；内存级断言留 P1）；T5 待 P4（需真实 Bambu 多盘 fixture 标定）。

### 5.7 实施记录（P0 + 验收修复）

**P0 已实施（2026-10-06，faijs 0.30.0）**：`ImportModel`/`ImportAssemblyNode`/`ImportBambuViews`（`mesh/import-model.ts`）；`ImportFileResult.parts + importModel`（`mesh/io.ts` 3MF 全对象 + `buildBambuViews`，STL 补 `parts:[shape]`）；`loadBrepAssembly`（`brep/brep-ops.ts`，DFS 声明序 + `leafHasSolid` 实体校验 + 多根合成虚拟根 `imported`，单零件无 assembly）；`ExecutionResult.importModels`（`runtime-state.ts`/`direct-executor.ts`/`runtime.ts`）；load op 双路径返回 `Shape | CompoundShape`（`faijs-extra/src/ops/load.ts`，BREP `await loadBrepAssembly`——async 漏 `await` 曾致 `reading 'map'`，已修）。验证：core 2861 用例 / faijs-extra 76 用例全绿；lint/typecheck/api-coverage（L1 685 exports）/build 全绿。

**P0.1 验收修复（2026-10-06，faijs 0.30.1）**：STL 单位启发式猜测**收敛进 faijs**。P1 迁移回归暴露 cube01.stl（±0.05 单位）显示缩小（原 host `guessStlUnit` 折叠被删 → faijs `opts.unit` 缺省 mm 不折算 → 0.1 单位 cube 不可点击）。修复：`importFile` STL 分支 `opts.unit` 显式声明优先，未声明时 `guessStlUnit`（历史 3d_editor 行为搬入 faijs，§8 迁移基线单位断言依赖）→ **G0 即折算后坐标**，宿主不再二次换算（红线规则 1：渲染 = 拓扑 = G0）。版本升级全流程走 `set-version.mjs` → check-lockstep → pack → `update-faijs`（禁手改铁律）；draw 包 peer 冲突用 `--legacy-peer-deps` 刷 lock 后 lockstep OK。

## 6. `../3d_editor` 侧设计——单一通道（v2 重写）

### 6.1 单一加载流程（替代双通道）

```
用户选择文件 / ?url= 预载
  → 读 buffer → 资产注册（file-blob-asset-resolver；stpz 解压、STEP 头元数据等预处理保留）
  → useFileUpload **不再调用 loadFormat 渲染解析**，改为：
      1) 记录 `cad.load({ file })`（recordLoadFromRef / ScriptEngine）
      2) 执行 faijs 脚本（worker）
      3) 统一消费 ExecutionResult：
         - outputs          → 三角化 mesh（G0）→ commitGeometry(v0) → VersionStore
                              → GeometryBindingLayer / ModelGroup 渲染（首帧即此）
         - importModels     → SceneMutator 批量建 part（场景树 N 节点、PartInfo 全字段、originals）
         - topology/brepProduced → topologyStore（SelectorRuntime）
         - detectedUnits    → file.sourceUnit
         - compounds        → 装配/分组结构
         - importModels.bambuViews → 多盘布局 / 视图 delta
```

要点：

- **`useFileUpload.ts`**：删除 `loadFormat` 调用与 `LoaderResult` 依赖；保留 buffer 读取、资产注册、同名检测、undo 快照、进度与错误处理（§`.fai.js` 分支不变）。
- **`formatLoaders.ts`**：删除渲染解析职责（`loadFormat` 的 STEP/3MF/STL 分支）。仅保留纯元数据辅助（如 `parseStepHeader` 的 fileMeta——若 faijs `FileMeta` 已返回则一并删除）；`iges` 维持白名单外报错。
- **`ModelGroup.tsx`**：不再直接调 `loadFormat` 渲染；mesh 输入 = 脚本执行结果三角化（G0 通道）。现有 mesh 处理管线（clone/STL 单位/view delta/Bambu 布局/多盘场景树）复用；删除 `:403` 的 3MF `slice(0, 1)`。
- **`loaderResultCache.ts`**：随 `loadFormat` 一并退役（或改为缓存 faijs 执行结果）。

### 6.2 脚本通道批量建 part

- `executeScript.ts:259` 消费 load 终端时：若 `ExecutionResult.importModels` 含该终端，则按 `parts` 逐零件建 part；否则维持现状单 part。
- `SceneMutator` 新增「按导入模型批量建 part」入口（或扩展 `createPart` 接受 `innerId` + `importPart`）：
  - `fileId` 仍 = 文件名（含后缀，确定性，`scene-mutator.ts:180`）；
  - `innerId` = `o1` … `oN`（按 `ImportPart.index`，确定性）；
  - 每个 part 写 `meshIndex` / `triangleCount` / `plateId` / `objectId` / `extruder` 到 `PartInfo`（`shared/types.ts:274` 字段已具备）；
  - `appearance` / `materialGroups` / `meta` 按对应零件写 originals store；`exportable=false` 的零件（草图场景）不进场景树可导出集合。
- `features/load.ts:45` 保持一行 `cad.load({ file })` 不变（一条语句 = 一个文件），不恢复 `partIndex` 参数、不逐 part 重复解析。

### 6.3 场景树

- `buildFileTreeFromPartInfos`（`buildFileSceneTree.ts:17`）本期保持一层（file → N part），N 个 part 的 `meshIndex` 正确。
- `SceneTreeNode` 已支持 `children` / `nodeType: 'container'`，装配层级（`ImportModel.assembly`）的场景树展开作为 P3 增强（§10）。

### 6.4 多盘与视图切换

数据源从"宿主解析 archive"改为 `ImportModel.bambuViews`。这部分渲染代码已完整，一旦 `partInfos` 有 N 条、`meshes` 有 N 个即自动恢复：多盘分组布局（`ModelGroup.tsx:631`）、print/assembly/import delta（`ModelGroup.tsx:439` + `computeViewDelta`）、多盘场景树（`ModelGroup.tsx:774`）。

### 6.5 删除项清单（双通道收口）

| 文件/代码 | 现状 | 变更 |
|---|---|---|
| `formatLoaders.ts` `loadFormat` STEP/3MF/STL 分支 | 宿主自解析渲染 | 删除；渲染几何统一来自执行结果 |
| `useFileUpload.ts:195` | `loadFormat` 调用 | 改为记录 `cad.load` + 执行 + 消费 |
| `ModelGroup.tsx:305-310` | `loadFormat` 渲染 | 移除；走 G0/执行结果 |
| `loaderResultCache.ts` | 宿主解析结果缓存 | 退役 |
| `ModelGroup.tsx:403` | 3MF `slice(0, 1)` | 删除 |
| `formatLoaders.ts:366/374` | 宿主消费 STEP 颜色并 `release` solid | 移入执行结果消费（`shape.appearance` → originals；句柄生命周期归 faijs 侧） |

## 7. 契约变更清单（文件级）

**faijs**

| 文件 | 变更 |
|---|---|
| `packages/core/src/mesh/import-model.ts`（新） | `ImportModel` / `ImportPart`（含 `exportable`）/ `ImportAssemblyNode` / `bambuViews` 类型 |
| `packages/core/src/mesh/io.ts` | `ImportFileResult` 增 `parts: Shape[]`；3MF 分支返回全部对象 + Bambu 视图数据 |
| `packages/core/src/brep/brep-ops.ts` | 新增 `loadBrepAssembly`（XCAF 装配树 → 逐 part Shape + 树） |
| `packages/core/src/runtime-state.ts` | `setPendingImportModel` / `takePendingImportModels` |
| `packages/core/src/cad-runtime/direct-executor.ts` | 收编 pending `ImportModel` |
| `packages/core/src/cad-runtime/runtime.ts` | `ExecutionResult.importModels` 定义与组装 |
| `packages/faijs-extra/src/ops/load.ts` | 多零件构造 `CompoundShape` + 登记 `ImportModel`（含 Bambu 视图）；单零件不变 |
| `packages/core/src/index.ts` / `browser.ts` | 导出 `ImportModel` 类型与 `loadBrepAssembly`（浏览器入口） |

**3d_editor**

| 文件 | 变更 |
|---|---|
| `packages/app/src/hooks/useFileUpload.ts` | 删除 `loadFormat` 调用；改为记录 `cad.load` + 执行 + 消费结果 |
| `packages/app/src/engine/formatLoaders.ts` | 删除渲染解析职责（仅保留纯元数据辅助） |
| `packages/app/src/engine/loaderResultCache.ts` | 退役 |
| `packages/app/src/engine/components/renderers/ModelGroup.tsx` | 移除 `loadFormat` 渲染（:305-310）；删除 3MF `slice(0, 1)`（:403）；首帧走 G0 |
| `packages/app/src/engine/script-engine/executeScript.ts` | 按 `importModels` 批量建 part |
| `packages/app/src/engine/script-engine/scene-mutator.ts` | 批量建 part（`innerId o1..oN` + `PartInfo` 身份字段 + `exportable`） |
| `packages/app/src/engine/components/renderers/buildFileSceneTree.ts` | （P3）按装配层级构树 |

## 8. 兼容性与迁移

- **单零件文件**：返回类型、`multiPartCounts` 消费、特征链全部不变。
- **双通道 → 单通道**是本方案最大改动面：首帧渲染从"宿主自解析"改为"执行结果 G0"。迁移验收 = 原有单零件加载 e2e（STEP/STL/3MF）全量回归，场景树 / 材质 / 拓扑 / 单位 / undo 断言不变；并新增「显示 mesh 与脚本 mesh 三角形数与序一致」断言（红线规则 1，杜绝两套几何）。
- **多零件文件**：从「取第一个 + 弹警告」变为「全部返回 + 无警告」；`multiPartCounts` 不再触发。
- **旧 3d_editor + 新引擎**：旧宿主未消费 `importModels`，会把 compound 当作无几何终端——需在 3d_editor 侧同 PR 升级（本项目内部测试阶段，不考虑 API 向后兼容，见 AGENTS.md）。
- **确定性**：零件枚举序由文件声明序/内核枚举序确定；`ImportModel` 不含时间戳/随机身份。

## 9. 测试计划

**faijs**（`packages/core/test` 或现有 `packages/tests`，按「测试与 src 分离」约定）：

- 多零件 STEP：`packages/fixtures/data/step-metadata/cq-assembly-two-parts.step` → `loadBrepAssembly` 返回 2 个 part + `assembly` 树非空；load 返回 `CompoundShape`，`importModels` 含 2 条 `ImportPart`。
- 多零件 3MF：需补一个多 build item / Bambu 多盘 fixture（现有 `box_boss.3mf` 单对象，需新增）→ `importFile.parts.length > 1`，`bambuViews` 随结果返回。
- 单零件零回归：`box_boss.step` / 单对象 3MF / STL 返回 `SolidShape`，`multiPartCounts` 行为不变。
- 确定性：同一文件连续导入两次，`parts` 顺序与名称一致。
- `ImportModel` 经 `ExecutionResult.importModels` 正确收编（直调 executor 契约测试）。
- `ImportPart.exportable` 默认值测试（无标记 = true）。

**3d_editor**：

- 单通道迁移回归：STEP/STL/3MF 单零件 e2e 全量（场景树 1 part、材质、拓扑、单位、undo）。
- 双通道删除一致性：导入后「渲染 mesh 三角形 == faijs 执行结果三角形」断言。
- 多零件 e2e：导入双零件 STEP → 场景树 2 个 part、渲染 2 个 mesh。
- 多盘 e2e：导入 Bambu 多盘 3MF → 按盘分组布局、print/assembly/import 视图可切换。
- 既有 CI 失败用例（快照身份/材质、钻孔撤销）作为回归基线一并验证。

## 10. 分阶段实施

| 阶段 | 内容 | 产出 |
|---|---|---|
| P0 | faijs 契约：`ImportModel`（含 `exportable` + `bambuViews`）+ STEP 装配导入 + 3MF 全对象 + `ExecutionResult.importModels` + load 多零件返回 compound | **已实施（2026-10-06 晚）**：faijs 单测全绿、单零件零回归（§5.7） |
| P1 | 3d_editor 单一通道：删除显示通道自解析，渲染改消费执行结果 G0 | **代码完成 + 静态验证全绿**（lint/typecheck/单测 204 文件 2880 用例/组件 48 文件 494 用例/build 全绿，faijs 0.30.1）；e2e 回归 **10 过 4 败**：3 个为旧有失败复现（drill-hole:504、snapshot.cylinder-engraving:19、undo-drill-flow:421，见 `../3d_editor/docs/plans/2026-10-06-ci-failure-classification.md`）；**drill-hole:819 疑 P1 引入**（面板打开后钻点击落空，toast「请在模型表面点击钻孔位置」，钻前 mesh 正常 36 顶点——相机适配/拾取时序待查，列 P2/专项）。**T7 回归正面信号**：cylinder-face-selection:230（box_boss.step BREP 圆柱面 overlay）通过 |
| P2 | 3d_editor 批量建 part（innerId/PartInfo/场景树） | **已实施（faijs c4ca759 0.30.3 / 3d_editor 667d535a）**：worker↔host `resolveAsset` 竞态 → `WorkerAssetResolver` 按 key 缓存 Promise；`splitBrep` worker 挂死 → 两 cut 对偶；XCAF 派生句柄悬空 → `liftShapesFromDocument` leaf shapeHandle `kernel.copy()` 深拷贝；worker 累积 XCAF 解析后 BOP 挂死 → `load.ts` 模块级 `loadCache`。`executeScript.createPartsFromResult` 按 importModels 批量建 part（innerId `o<index+1>`、part.color→materialOriginals、writePartMetaOriginals）+ `maybeCommitImportChildWriteback` 重放写回 child G0。验证：explosion-strict-separation 75/111 转绿 |
| P3 | STEP 装配层级场景树展开（`buildFileTreeFromPartInfos` 按 `assembly` 构树） | **已实施（3d_editor 43273f23）**：`LoadedFileModel.assembly` + store `updateFileAssembly` + `buildAssemblyTree`（container id=`${fileId}:asm-<n>` 确定性递增；leaf partIndex 越界抛错）；装配容器 `expanded:true`（导入后零件立即可见）；recordLoadFromRef 幂等路径补 `_commitLoadSideEffects`（assembly/bambuMetadata 写回 file 壳）；ModelGroup 树构造 deps 补 `bambuMetadata, assembly`。验证：buildFileSceneTree 单测 4 用例 + assembly-coincide 转绿（STEP 导出→重导入 2 零件） |
| P4 | Bambu 多盘布局 + 视图切换端到端验证 | **已实施（faijs fa39f6d 0.30.5 / 3d_editor 43273f23）**：faijs 侧 `ThreemfObject.parentObjectId/componentIndex`、`ThreemfArchive.modelXml`、buildItems 全量解析（parse3mfBuild 不再 tail 切片）、`parentComponents` Map、parts 按 build×components 展开打印单元、`leafParts: Map<'父id:componentIndex', BambuPartMeta>`、io.ts 用 leafParts 关联并写 `objectId/plateId/extruder/partId`；3d_editor 侧 adapter 迁 `lib/bambu-3mf`（arch-guard 豁免目录）、`ScriptEngine._commitLoadSideEffects` 写回 `updateFileAssembly/updateFileBambuMetadata`、ModelGroup 多盘分组。验证：`multipart-3mf-plates.spec.ts`（Plate 1/2 分组 + 21 零件 + 视图切换）、faijs `threemf-bambu-identity.test.ts`（buildItems 19/leafParts 21/两盘/父对象 partId 映射） |
| P5 | 显示/导出判别位消费（`exportable`）+ 与草图方案合流验证 | **已实施（3d_editor 待提交）**：`PartInfo.exportable` 透传（scene-mutator/executeScript，仅 false 显式写）；导出收集 `collectSceneMeshes`/`collectFileMeshes` 按 `PartInfo.exportable === false` 剔除仅显示几何（草图合流方置位）。草图方案完整设计由另一 agent 负责（§2.4），本契约保证数据位与消费边界存在 |
| P6 | 文档同步（`docs/ops-api-inventory.md` load 契约、`docs/api-contract.md`）+ Agent Note | **本文档同步**（§10 实施记录 + §5 契约现状） |

## 11. 风险与待确认项
| 编号 | 事项 | 处理 |
|---|---|---|
| T0 | `importAssemblyFromStep` 内部用 `initOcctWasm()` 单例，而 `loadBrep` 用注入的 `BrepEngineApi`；两者返回的 `ShapeHandle` 是否可互通（决定 §5.3 能否复用 XCAF 树） | **实现前先写句柄互通探针**，结论保留为可重复测试（「验证留档」铁律）；若不通，改用注入 kernel 的等价装配 API |
| T1 | 多零件 BREP 句柄生命周期（逐 part 进 brepChain，避免泄漏/双释放；删除宿主侧 `release` 后生命周期全部归 faijs） | 实现时以释放探针 + 内存断言覆盖 |
| T2 | 单零件特征链兼容（`cad.drill(load 结果, …)`） | 单零件路径不改；补回归测试 |
| T3 | 大型装配性能（N 个 part 的三角化与渲染；wasm 预热/首帧延迟） | 沿用 `parseThreemf` 单次解压；必要时分批 yield（显示通道已有 `yieldToUI`）；首帧延迟基准测量 |
| T4 | 3MF `<components>` / sub-model 展开 | 本期不做，维持现状；记录为后续项 |
| T5 | Bambu 零件↔build item 对应关系 + 视图数据随执行结果回传（`objects`/`parts` 表键匹配） | 以 `vise.3mf` 类真实工程文件标定，结论留为测试 |
| T6 | 单通道首帧体验：首帧渲染依赖 faijs 执行完成 | 旧双通道解析两次文件，单通道反而省一次解析（性能净收益）；wasm 预热 + 进度态已有，需基准测量 |
| T7 | GeometryBinding v0 初始化：单通道后 v0 是唯一几何来源，`initVersionPointerIfNeeded` / 「v0 未初始化」路径（snapshot.cylinder-engraving 曾见 `v0WasInitialized:false`）必须覆盖 | P1 阶段以该用例为回归基线 |
| T8 | 与草图方案的边界：`ImportPart.exportable` 的判别时机（加载时静态判别 vs 运行时标记）需与另一 agent 方案对齐 | P5 合流时确认，本契约只保证数据位存在 |

**待确认（推荐默认）**：§5.2 多零件返回 `CompoundShape`（而非新增独立 op）为本方案推荐——理由是复用现有 `outputs: Map<PartName, Shape | CompoundShape>` 与 `isCompoundLike` 消费面，宿主改动最小；若用户希望语言层显式区分「导入的装配」与建模 `group`，可改为新增 `TypeKind: 'import'` 判别字段，成本为一次类型扩展。

---

## Agent Note（P0–P5 落地后，供后续 agent 续作）

**现状（2026-10-06 晚，faijs 0.30.5 / 3d_editor 43273f23）**：

1. **单一加载通道已收口**：3d_editor 打开任意 3d 文件 = 记录一行 `cad.load({ file })` → worker 执行 faijs → 宿主只消费 `ExecutionResult`（outputs/importModels/assembly/bambuViews/topology/detectedUnits）。`formatLoaders.ts` 降纯元数据、`loaderResultCache.ts`/`useFileLoader.ts` 已退役。**新增任何导入路径前先确认是否违反 R0 红线**。
2. **多零件契约**：STEP/3MF 多零件 `cad.load` 返回 `CompoundShape`，身份/结构在 `ExecutionResult.importModels`（`ImportModel.parts/assembly/bambuViews`）。零件序 = 文件声明序；`compound.children` 是匿名几何（不进 `compounds` 字段）。
3. **装配层级（P3）**：`ImportModel.assembly`（XCAF DFS 序）→ 3d_editor `buildAssemblyTree` 构多级场景树；装配容器 id=`${fileId}:asm-<n>` 且 **expanded:true**（导入后零件必须立即可见——折叠会让 e2e 场景树断言与 UX 双双失败，2026-10-06 踩过）。
4. **Bambu 多盘（P4）**：3MF 的 `<build>` 位于 `<resources>` 之前时必须全量解析（`parse3mfBuild(modelXml)`，禁止 tail 切片）；`<object id>`（叶子）与 `model_settings.config` 的 `<object id>`（父对象）是**两套编号**，关联必须走 `parentComponents` → `leafParts`（键 `父id:componentIndex`），禁止 `bambu.objects.get(String(obj.id))`。vise.3mf = 21 零件 / 2 盘（fixture 与 identity 测试已锁定）。
5. **显示/导出判别（P5）**：`ImportPart.exportable` 默认 true；草图等仅显示几何置 false。3d_editor 导出收集（`collectSceneMeshes`/`collectFileMeshes`）按 `PartInfo.exportable === false` 过滤。草图方案完整设计由另一 agent 负责，本契约只保证数据位与消费边界。
6. **版本流程**：faijs 改动后必须 `npm run verify-export-jsdoc` → `npm run set-version -- <新版本>` → `npm run pack` → 3d_editor `npm run update-faijs`。**禁止手改任何 package.json 的 faijs 版本段**。
7. **已知遗留（bug 队列，勿与多零件通道混淆）**：step-cube5 extrude（:161/:206）在 Chrome worker 挂死——faijs node 探针证实几何与 BREP 链全部正常（splitBrep 113ms/extrudeBrep 42ms），是 **occt-wasm 5.6.0 在 worker 对 STEP-XCAF 派生实体的 BOP 挂死**（环境级，node 不复现），与多零件导入通道无关。快照×4、撤销×3、BREP 面高亮×1 归历史功能 bug。
