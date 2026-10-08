> 方案出处：Claude (WorkBuddy) + faijs 2026-10-08
> 范围：接入 occt-wasm `XCAFDocument` 的总体方案。本文只描述【当前设计】，不写修订史、不引用历史方案。

# 接入 occt-wasm XCAFDocument 总体方案

## 0. 结论速览

- faijs 的 STEP 导出**已经**建立在 occt-wasm `XCAFDocument` 之上（`brep/export/step.ts` → `getOcctKernel().createXCAFDocument()`），多实体、零 fuse、保留名称与颜色、`memberColors` 也已是装配→XCAF 的颜色通道。
- 但 faijs 内部对"装配层级"存在**多套并存的概念**，彼此未收敛到统一装配树；STEP 导出用的 `StepExportEntry[]` 是**平铺**形态，丢掉了层级与相对位姿。
- 内核**已有装配树概念**：`AssemblyNode`（`api/assembly/solvers/assembly-tree.ts`，纯数据：`name/shape(mesh)/translate/rotate/metadata/children`）。XCAF 接入的正确做法 = **把导出/导入都收敛到 `AssemblyNode` 装配树**，而不是另造一套"场景树"。
- 边界澄清：**场景树是 UI 层（3d_editor）的概念，faijs 内核只应有装配树（AssemblyNode）的概念**。faijs 负责把 `cad.assembly`/`cad.group`/`cad.compound` 与 XCAF 导入树统一映射成 `AssemblyNode`，再由 `AssemblyNode → XCAFDocument` 写真装配。

---

## 1. faijs 已具备的能力（含多套装配 API）

### 1.1 STEP 导出（已用 XCAFDocument）
- `brep/export/step.ts`：`exportStepFromSolids(kernel, entries, fileMeta)`
  - `doc = getOcctKernel().createXCAFDocument()`；每个 `StepExportEntry` → 一个 XCAF label（`addShape`）；导出 `doc.exportSTEP()`。
  - 名称写 label name；颜色经 sRGB→linear 转换；多实体**绝不 fuse**。
  - 现状只调 `addShape`，**从未用 `addChild`** → 导出的是"多独立零件"，不是"真装配树"。
- `occt.ts` 能力表已声明 `createXCAFDocument`/`importXCAFFromSTEP`，`assembly: true`。
- occt-wasm `XCAFDocument` 已提供：`addShape({assembly})` / `addChild(parent, shape, {location})` / `getLocation` / `getReferredLabel` / `exportSTEP`，具备写真装配的全部原语。

### 1.2 多套装配层级 API（现状，需收敛）
1. **`cad.group`**（faijs-extra `compound.ts`）→ `CompoundShape`（kind=compound，children=成员引用），零约束、纯结构。**编辑器消费面**（非平台面，改 API 须同步 3d_editor）。
2. **`cad.assembly`**（faijs-extra `compound.ts`）→ `CompoundShape`+`AssemblyBehavior`（`do_assemble()`/`solve()`）。约束求解产出 per-member `AssemblyTransform[]`；`memberColors` 已对接 XCAF；`joints` 做运动学。**编辑器消费面**。
3. **`cad.compound`**（core `makeCompound`）→ 平台几何复合体：持 OCCT 句柄、可变换、可导出（group/assembly 的几何承载）。
4. **`cad.copy`**（faijs-extra `copy.ts`）→ 深拷贝 Shape。
5. **`api/assembly/*`**（core）：约束求解库（types/normalize/entities/lower/solve/pose/joints），是 `cad.assembly` 的内核。
6. **`AssemblyNode`**（core `api/assembly/solvers/assembly-tree.ts`）：**纯数据装配树**（`name/shape(mesh)/translate/rotate/metadata/children/mates/joints`），被 joints/kinematics 使用——这是 faijs 内核唯一的"装配树"数据结构。
7. **XCAF 导入装配树**（`occtKernel.importAssemblyFromStep` → `XcafNode`）：OCCT 侧 label/component/location/color。
8. **导出平铺 entries**（`StepExportEntry[]`）：`exportStepFromSolids` 实际消费的形态，展平 compound，无层级。

> 收敛点：#1/#2/#3 的几何/结构最终都落进 `CompoundShape`（持 `children` 引用 + `behavior`）；#6 是给运动学用的纯数据树；#7/#8 是 OCCT 进/出处。它们应是**同一棵 `AssemblyNode` 树的不同视图**，目前却是分离实现。

### 1.3 STL / 3MF
- `brep/export/export-model.ts`：`exportModel` 统一单位不变式（坐标刻度==声明单位）。`stl` 仅 mesh；`3mf` 支持多 basematerials/materialGroups/逐零件 metadata；STEP 走 §1.1。

---

## 2. 3d_editor 现状（如何导出 STL/STEP）

- **STL / 3MF**：与 OCCT 无关，是 `scene-kernel/export/`（`mesh.ts` 共用校验 `assertExportMeshes`、`stl.ts` `buildBinaryStl`、`three-mf.ts` `build3mf`、`zip.ts`）的主线程纯 mesh 字节生成器。平台红线：BREP 句柄不出 worker，主线程只拿渲染 mesh。
- **STEP**：不直接造字节，经 `platform/execution/instruction-core.ts` → `dispatchExport` → faijs `exportStepFromSolidsHighLevel`（XCAF）。两通道：
  - OCCT 宿主（electron）：单文件多实体 XCAF STEP。
  - brepkit 宿主（weapp，无 XCAF）：`exportStepFilePerSolid` 逐实体 `kernel.exportStep` 打 zip。
  - entries 由 `ExportInstruction.entries`（partName/brep 句柄?/mesh?/name/color）组装；brep 句柄缺失则 `missing[]` 如实回报（绝不静默降级为 mesh 重建）。
- **场景树（scene tree）= UI 层概念**，存在于 3d_editor；它如何把层级喂给 3d_editor 的导出通道，与 faijs 内核的装配树是两件事。

---

## 3. 总体方案（内核只认装配树）

### 3.1 内核唯一装配树模型 = `AssemblyNode`（扩展，不另造）
在现有 `api/assembly/solvers/assembly-tree.ts` 的 `AssemblyNode` 上扩展，**不引入 SceneNode**：

```ts
interface AssemblyNode {
  name: string
  // 几何来源二选一（与现有 ExportEntry/CompoundShape 对齐）：
  solid?: BrepHandle                       // 精确 BREP（OCCT 路径；句柄活在 worker）
  mesh?: { positions: Float32Array; indices: Uint32Array }  // mesh 路径（现有 Shape）
  color?: [number, number, number]         // sRGB 0..1（来自 memberColors / XCAF 回读）
  meta?: { partNumber?: string; description?: string; layer?: string }
  transform?: number[]                     // 相对父的 3x4 行主 [r00..r22,tx,ty,tz]
  children: AssemblyNode[]
  sharedPrototypeRef?: string              // 引用另一节点几何（XCAF component 实例化）
}
```
- 引擎无关、可序列化（JSON 安全的 transform/color/meta），跨 worker/主线程安全。
- **平台红线保持**：BREP 句柄只活在 worker；`AssemblyNode` 在 worker 内构造（持有句柄引用），序列化给主线程做 STL/3MF 时只带 `mesh`；STEP 在 worker 内用句柄直接写 XCAF。

### 3.2 统一收敛：所有"装配层级"来源 → `AssemblyNode`
- `cad.assembly`/`cad.group`/`cad.compound` 产出的 `CompoundShape` + `behavior` + 求解出的 `AssemblyTransform[]` → 归一化为 `AssemblyNode` 树（transform 来自求解结果，color 来自 `memberColors`，children 来自 compound 成员）。
- XCAF 导入树（`XcafNode`）→ `AssemblyNode`（transform 来自 `getLocation`，color 来自 label）。
- 旧 `StepExportEntry[]` 作为 `AssemblyNode[]`（`children` 空）的等价特例保留，存量 `.fai.js` 与 3d_editor 调用零修改。

### 3.3 `AssemblyNode` → XCAFDocument（真装配写入）
`exportStepFromSolids` 升级为 `exportStepFromAssembly(root, opts)`：
- 递归走 `AssemblyNode`：
  - 叶子 → `doc.addShape(node.solid ?? reconstructFromMesh(node.mesh), { name, color(sRGB→linear), assembly: false })`；
  - 有 `children` 的内部节点 → 先 `addShape` 自身（若带几何），再对每子 `doc.addChild(parentLabel, childGeom, { location: node.transform, name, color })`；
  - `transform`（3x4）直接喂 `addChild({location})`，修复"现状多零件无相对位姿"缺口；
  - `sharedPrototypeRef` → 用 component 引用（`getReferredLabel`）复用几何，省体积。
- 末态 `doc.exportSTEP()` + 单位/header 文本重写（沿用 `rewriteStepUnitEntities` / `rewriteFileMetaHeader`）。

### 3.4 统一导出分发 `exportDocument(root, format)`
- **STEP（OCCT）**：§3.3 写真装配树。
- **STEP（brepkit 回落）**：无 XCAF → 展平 `AssemblyNode` 为叶子 entries，逐实体 `kernel.exportStep`，返回 `stepFiles`（沿用 `exportStepFilePerSolid` 契约）。
- **STL / 3MF**：展平 `AssemblyNode`，把 `transform` 烘焙进 mesh 顶点，走现有 `buildStlBufferFromMesh` / `build3mf`；颜色、materialGroups、逐零件 metadata 沿用现有能力。

### 3.5 与现有代码衔接（不推倒重来）
- `instruction-core.dispatchExport` 改为构造 `AssemblyNode` 树（现阶段 `children` 全空 = 平铺，行为不变），再调 `exportDocument`；OCCT/brepkit 双通道按 `capabilities.xcaf` 自动选，移除手写 if。
- 导入回环：`importAssemblyFromStep` → `AssemblyNode`，打通"导入 STEP 装配 → 编辑 → 导出保持层级"。

### 3.6 元数据与层级保真
- 颜色：沿用 sRGB→linear 既有逻辑（`memberColors` 已通）。
- 名称/partNumber/description：XCAF 侧写 label name（或用户数据）；当前仅 3MF 写 partNumber/description，STEP 侧补上即可复用同一 `AssemblyNode.meta`。

---

## 4. 落地步骤（建议顺序）

1. **扩展 `AssemblyNode`**：增加 `solid?`/`color?`/`meta?`/`transform?`/`sharedPrototypeRef?`（mesh 字段保留，向后兼容）。
2. **归一化器**：`CompoundShape(+behavior+transforms) → AssemblyNode`、`XcafNode → AssemblyNode` 两个纯函数 + 单测。
3. **`exportStepFromSolids` → `exportStepFromAssembly`**：补 `addShape({assembly})` + `addChild(location)` 分支；旧 entries 入口作特例。写装配树 round-trip 单测（导出后 `importAssemblyFromStep` 回读，断言层级+transform+color 一致）。
4. **`exportDocument` 统一分发**：承载 step/stl/3mf。
5. **3d_editor 收口**：`dispatchExport` 改用 `AssemblyNode`+`exportDocument`，移除双通道手写 if。
6. **元数据补足**：`AssemblyNode.meta` 进 STEP label name / 用户数据。

## 5. 风险与红线

- **BREP 句柄不出 worker**：XCAF 装配树构建必须发生在持有句柄侧（OCCT worker），只把字节/展平 mesh 描述交给主线程。
- **绝不 fuse**：多实体/装配导出严禁用布尔合并代替层级（既有硬约定）。
- **绝不文本级改几何坐标**：单位/header 只能文本层改声明（沿用 `rewriteStepUnitEntities`/`rewriteFileMetaHeader` 红线）。
- **occt-wasm XCAFDocument 能力边界**：当前类型未暴露 layer / PMI(GDT) / 命名子形状颜色以外的属性；若需这些，走原生面 `getOcctKernel()` 调 RawXCAFKernel，或向 occt-wasm 提扩展。
- **多套 API 收敛 ≠ 删除**：`cad.group`/`cad.assembly` 是**编辑器消费面**（改 API 须同步 3d_editor），本方案只新增"→AssemblyNode"的归一化出口，不改动其调用形态与消费方。
- **brepkit 不对称**：weapp 无 XCAF，装配/层级在 brepkit 路径下必须显式回落，不能假装支持。
