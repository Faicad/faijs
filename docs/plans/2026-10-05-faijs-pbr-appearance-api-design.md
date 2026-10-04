# 2026-10-05 faijs PBR 外观（颜色/材质/透明度）API 设计 v2

状态：方案（未实施）
作者：MainAgent（会话调研结论 + 用户 2026-10-05 修改意见重写）
替代：[2026-10-04-faijs-pbr-appearance-api-design.md](./2026-10-04-faijs-pbr-appearance-api-design.md)（已废弃）

## 0. 用户原话（最高优先级，直接引用）

### 原始需求（2026-10-04）

> 请调研cadquery 如何给模型设置颜色和材质，如何导出gltf

> 请了解../3d_editor项目是如何实现pbr渲染的，以及如何设计faijs模型的pbr相关的api，能够给模型设置颜色、材质、透明度等，然后可以在编辑器里正确渲染

### 修改意见（2026-10-05，本文档按此完全重写）

> 方案里。不需要兼容存量：现有 `return { shape, color, metalness, roughness }` 与 `ScriptMetaIR.appearance` 语义不变、继续有效；这句话删除， 请完全重新设计一个合理的方案。

> 此外，设置这些外观属性应该不必属于op。而且应该可以类似let box1 = cad.box(...); box1.set这种写法。

> 外部step/3mf的导入导出，这些需要兼容已有规范。

需求拆解（本文档的验收锚点）：

1. faijs 模型**能设置颜色、材质、透明度**（用户点名三要素，材质为 PBR 语义）。
2. 设置结果能在 **3d_editor 里正确渲染**（走编辑器已有 PBR 渲染管线）。
3. **外观设置不属于 op**（不进入 `defineOp`/`api-namespace`/args-schema 的几何 op 体系）。
4. 写法为 **`box1.set...` 方法调用**（`let box1 = cad.box(...); box1.setColor(...)` 形式）。
5. **不兼容存量**：现有 `return { shape, color, metalness, roughness }` 与 `ScriptMetaIR.appearance` 不再承诺继续有效（本项目内部测试阶段，允许破坏性变更）。
6. **STEP/3MF 导入导出按已有格式规范**（AP214 STYLED_ITEM 颜色、3MF basematerials/colorgroup 等），不发明私有字段。

## 1. 背景与目标

faijs 目前对「外观」没有设置能力（详见 v1 §2 的实测证据，本文档不再重复调研过程，只保留结论与证据位置）：

- `Shape = { positions, indices }` 纯数据，不携带外观（`packages/core/src/mesh/types.ts`）。
- 脚本 `return` meta 仅解析 `color/metalness/roughness` 三字段（`lang/metadata-extractor.ts`），作为「元数据旁路」，与几何产物分离。
- STEP/3MF **读取**侧已有规范实现：`occt-kernel/stepColorParser.ts`（AP214 `STYLED_ITEM` → `COLOUR_RGB` 引用链）、`mesh/threemf-loader.ts`（`basematerials`/`colorgroup`/逐三角形属性），但**写侧/设置侧完全缺失**。
- 3d_editor 是完整 PBR 渲染管线（ACES + IBL + `MeshPhysicalMaterial`），`MaterialAppearance` 29 字段已覆盖全参数；瓶颈在上游数据源。

v2 与 v1 的根本差异：**外观从「return 元数据旁路」改为「Shape 对象自身的方法与属性」**——设置即执行、产物自解释、重放即重执行，不再需要两套语法并存。

## 2. 设计原则

1. **外观设置不是 op**。它不改变几何、不参与网格/布尔/分派，因此**不进入** `defineOp` 双实现体系、不进 `api-namespace`、不建 args-schema。外观方法是 Shape 对象在运行时形态上的普通方法（成员调用），L0 解析器天然支持（合法 JS 子集），引擎零函数知识（K5 不受影响）。
2. **`box1.set...` 是唯一外观语法**。设置 = 调用 Shape 方法，原地合并外观并返回 `this`（支持链式）。不再有 return meta 外观通道。
3. **不兼容存量**。`ScriptMetaIR.appearance` 删除；`return { shape, color, ... }` 中 `color/metalness/roughness` 字段不再解析（多余字段按未知 key 忽略或报错——实施时二选一并固定）。存量脚本需迁移（见 §9）。
4. **导入导出尊重外部规范**。颜色/材质只按 STEP AP214、3MF Core、glTF 2.0 PBR 的既有语义读写；规范没有的字段不伪造、不写入（能力矩阵见 §8）。
5. **双链路天然兼容**。外观方法是对象层面的元数据合并，与几何内核无关——mesh 产物与 brep 产物（网格化后）都是 Shape 实例，方法对两者同一行为；无需为外观设置声明双实现。
6. **确定性/可重放**。外观是脚本语句的副作用，重放 = 重执行 = 外观一致；编辑器手动 override 属宿主层，不污染脚本原值。
7. **一个事实一个家**。外观规格的权威类型在 faijs（`PbrAppearance`，引擎无关、JSON 可序列化）；3d_editor `MaterialAppearance` 是宿主渲染细节，双向映射收敛到一个转换函数。
8. 单位与坐标契约不变（mm、+Z 向上、角度度、颜色 sRGB 0–1），见 `docs/api-contract.md`。

## 3. 语言与 API 设计

### 3.1 目标写法（用户点名形态）

```js
const box1 = cad.box(10, 20, 30)          // 几何 op，返回 Shape
box1.setColor("#e53935")                   // 颜色（CSS 名称 / #rrggbb / #rrggbbaa / [r,g,b] / [r,g,b,a]）
box1.setMaterial({ metalness: 0.1, roughness: 0.4 })  // 材质参数（PBR）
box1.setOpacity(0.8)                       // 透明度 0–1
return { shape: box1, name: 'Box' }        // return 只承载结构（shape/name），不再承载外观
```

链式（返回 `this`）：

```js
const lens = cad.sphere(5)
lens.setColor([0.9, 0.95, 1]).setMaterial({ transmission: 1, ior: 1.5, thickness: 10 }).setOpacity(0.9)
return { shape: lens, name: 'Lens' }
```

### 3.2 方法集（Shape 公开方法）

| 方法 | 签名 | 语义 |
|---|---|---|
| `setAppearance` | `(spec: PbrAppearance) => this` | 统一入口；合并语义 `{...cur, ...spec}`，`undefined` 字段保留旧值 |
| `setColor` | `(color: PbrColor) => this` | 便捷：等价 `setAppearance({ color })`；`#rrggbbaa` 的 aa 归一为 `opacity` |
| `setMaterial` | `(spec: MaterialSpec) => this` | 便捷：等价 `setAppearance(spec)`，`MaterialSpec` 为 `PbrAppearance` 去掉 `color/opacity` 的字段集 |
| `setOpacity` | `(opacity: number) => this` | 便捷：透明度的唯一权威字段（0–1，越界 clamp 并报 schema 警告） |
| `getAppearance` | `() => Readonly<PbrAppearance>` | 读取（对称性；供脚本内条件分支/导出用） |

Phase 2（面级，设计预留、不在 P1）：

| 方法 | 签名 | 语义 |
|---|---|---|
| `setFaceColor` | `(faces: number[], color: PbrColor) => this` | 按 brep 面序号设色（对齐上游 `colorFaces` 语义）；mesh 链需面序→三角形分组（§6.2） |
| `setFaceMaterial` | `(faces: number[], spec: MaterialSpec) => this` | 面级材质 |

> 命名说明：`set*` 动词方法符合用户点名写法；面级用 `setFace*`（faijs 自身命名，未来如需对齐上游 `colorFaces` 兼容面再做投影，不在本方案内）。

### 3.3 执行机制（非 op 如何落地）

1. **L0 语法（复用既有成员调用机制，无需新增语句形态）**：`box1.setColor(...)` 是成员调用表达式语句，语言层**已支持**——装配求解先例 `asm1.solve()` / `asm1.do_assemble()` 走同一路径：`metadata-extractor.ts` 的 `classifyOpCall`（:1618-1645）对 `MemberExpression`（object 为 Identifier 且**非**命名空间绑定）归类为 `receiver` 调用（`receiver=box1, callee=setColor`）；`StatementSummary` 的 `receiver/outputs/hasAssignment` 字段已就绪（:940-947）；**无赋值的裸成员调用**（`box1.setColor(...)`）与 `asm1.solve()` 同为 `hasAssignment=false`、`outputs=[]` 形态，测试先例：`metadata-extractor.test.ts:350-373`（`const pose = asm1.solve()` → `receiver:'asm1', outputs:['pose']`）、`packages/tests/faijs/assembly/assembly-kinematics.test.ts:37,48`（`asm1.solve()` 裸语句）。
2. **执行**：编译产物在 JS 虚拟机执行；方法调用真实执行——`setAppearance` 把 spec 合并进 `shape.appearance`（原地、不重建 positions/indices）。
3. **check 预检**（`faijs-cli check`）：变量引用预检照常（`box1` 须已声明，receiver 引用收集已存在：`metadata-extractor.ts:965` `spec.receiver` → refs）；**方法名不做 op schema 校验**——与 `solve` 同制（成员方法调用归类时不查 op 表；可选「方法名白名单」弱校验：未知方法名 warning 不拒绝——实施时定）。
4. **产物输出**：`ExecutionResult.outputs` 的 Shape 自带 `appearance` 字段（JSON 可序列化），编辑器/查看器只读字段，不依赖方法（worker 边界后方法可丢，字段不丢）。
5. **重放**：同一脚本重执行 → 方法重跑 → 外观重现；代码文本即唯一事实源（keep-syntax 原则延续）。

> **实施注记（2026-10-05 实测钉死）**：脚本面（.fai.js）链式成员调用 `a.setColor(...).setMaterial(...)` **当前不支持**——`classifyOpCall` 只识别 object 为 Identifier 的**单层** receiver 调用；链式外层 receiver 是 CallExpression，落入 `bare expression statements not allowed`（metadata-extractor.ts:1914）。**一次一条 `setX` 语句**即可（`box1.setColor(...)` 后接 `box1.setMaterial(...)`），与用户点名写法一致。TS 库面方法返回 `this` 仍可链式（core 单测 `api/appearance.test.ts` 覆盖）。

### 3.4 与 op 体系的边界（为什么不算 op）

| 维度 | 几何 op（box/extrude/union…） | 外观方法（setColor…） |
|---|---|---|
| 声明 | `defineOp({ mesh, brep })` + args-schema | 无（Shape 方法签名） |
| 分派 | 静态引擎路径分派（mesh/brep） | 无分派（与内核无关的元数据合并） |
| 返回 | 新 Shape（不可变） | `this`（原地合并，可链式） |
| 归属 | `api-namespace` 装配进 `cad.` | Shape 实例方法（`box1.`） |
| K5 | defineOp 元数据承载（引擎不特判） | 引擎无需认识方法名（天然 K5 友好） |

结论：外观设置是**语言层 Shape 方法**，不是几何 op；不进入 op 体系，也不需要 mesh/brep 双实现——两条链的产物都是 Shape 实例，方法行为一致（§6.1）。

## 4. 数据模型

### 4.1 `PbrAppearance`（faijs 侧权威类型，`packages/core/src/api/appearance.ts`）

与 v1 §4.1 相同的类型设计（全字段可选、不做默认值清零、`opacity` 为透明度唯一权威字段、`alphaMode` 对齐 glTF）：

```ts
export type PbrColor = string | [number, number, number] | [number, number, number, number]
export type PbrAlphaMode = 'OPAQUE' | 'MASK' | 'BLEND'

export interface PbrAppearance {
  color?: PbrColor                      // CSS 名称 / #rrggbb / #rrggbbaa / [r,g,b] / [r,g,b,a]（sRGB）
  opacity?: number                      // 0–1，透明度的权威字段（color 的 aa 分量等价，并存时 opacity 优先）
  metalness?: number                    // 0–1
  roughness?: number                    // 0–1
  emissive?: [number, number, number]   // 自发光
  emissiveIntensity?: number
  transmission?: number                 // 透射/玻璃族
  thickness?: number
  ior?: number
  attenuationColor?: [number, number, number]
  attenuationDistance?: number
  clearcoat?: number                    // 清漆
  clearcoatRoughness?: number
  sheen?: number                        // 织物
  sheenColor?: [number, number, number]
  sheenRoughness?: number
  anisotropy?: number                   // 拉丝金属
  anisotropyRotation?: number
  specularIntensity?: number            // 高光工作流
  specularColor?: [number, number, number]
  envMapIntensity?: number              // IBL 强度（编辑器内）
  alphaMode?: PbrAlphaMode
  alphaCutoff?: number
  doubleSided?: boolean
  unlit?: boolean
}

export type MaterialSpec = Omit<PbrAppearance, 'color' | 'opacity'>
```

### 4.2 `Shape` 扩展

```ts
// packages/core/src/mesh/types.ts
export interface Shape {
  positions: Float32Array
  indices: Uint32Array
  /** 外观（可选）。双链路产物自解释；worker 序列化保留字段、不保留方法。 */
  appearance?: PbrAppearance
  /** Phase 2：面级外观分组 [三角形起始, 数量, 外观]；存在时优先于 appearance 作为未分组默认。 */
  materialGroups?: Array<{ start: number; count: number; appearance: PbrAppearance }>
  /** Phase 2：顶点颜色（3MF colorgroup / 面级 mesh 链），sRGB 0–1，长度 = positions 长度。 */
  vertexColors?: Float32Array

  // 外观方法（运行时形态提供；纯数据鸭子判定 isMeshShape 不受影响）
  setAppearance(spec: PbrAppearance): Shape
  setColor(color: PbrColor): Shape
  setMaterial(spec: MaterialSpec): Shape
  setOpacity(opacity: number): Shape
  getAppearance(): Readonly<PbrAppearance>
}
```

- **方法实现位置**：Shape 实例由产物构造点统一包装（`solid()`/`fromHandle()`/网格产物），一个共享的 `attachAppearanceMethods(shape)` 工厂附加方法（不改变 positions/indices 引用）。`isMeshShape` 仍按 `positions/indices` 鸭子判定，不受方法影响。
- **序列化**：方法不序列化（JSON 天然丢弃函数）；`appearance/materialGroups/vertexColors` 是数据字段，随产物跨 worker 传递（§6.3）。

### 4.3 删除项（破坏性变更）

- `lang/types.ts` `ScriptMetaIR.appearance` **删除**（`ScriptMetaIR` 只保留 `name` 等结构性字段）。
- `lang/metadata-extractor.ts` `parseReturnStatement` 中 `color/metalness/roughness` 解析分支**删除**（未知 key 忽略，或报错——实施时固定其一，见 §9）。

## 5. 导入（按已有规范读）

| 源 | 规范依据 | 读取实现（现状） | 映射到 faijs |
|---|---|---|---|
| STEP | AP203/AP214：`STYLED_ITEM` → `PRESENTATION_STYLE_ASSIGNMENT` → `COLOUR_RGB`（实体级颜色）；XCAF label 颜色 | `occt-kernel/stepColorParser.ts` + `occtKernel.ts`（`PartInfo.color [r,g,b] 0–1`） | `shape.appearance.color`（数组形式，sRGB） |
| 3MF | Core spec `<basematerials><base displaycolor="#RRGGBB">`（对象级颜色）、`<colorgroup>`（顶点色）、`<object pid>/<triangle p1..p3>`（逐三角形材质） | `mesh/threemf-loader.ts`（`ThreemfObject.baseColor` / `vertexColors` / 逐三角形属性） | 对象级 → `appearance.color`；colorgroup → **Phase 2** `vertexColors`；逐三角形 → **Phase 2** `materialGroups` |
| STL | 无颜色定义 | — | 无外观 |
| glTF（可选 Phase 2） | glTF 2.0 PBR metallic-roughness | （编辑器当前不导入 glTF） | `baseColorFactor/metallicFactor/roughnessFactor/alphaMode` → `appearance` |

要点：

- **宽容兼容外部数据**：STEP 引用链缺失、3MF 未知 pid/多 base 等，回落「无该外观」或默认材质，**不得以内部严格性拒收规范内合法文件**（AGENTS.md 全局铁律）。
- 导入颜色是**原值**（sRGB 原样保留，不做色域转换；编辑器侧按 `MaterialAppearance` 的 sRGB 契约消费）。
- 3MF 的 `displaycolor` 是 6 位 hex（规范无 alpha）→ 只映射 RGB，`opacity` 保持未设。

## 6. 双链路与执行

### 6.1 mesh / brep 统一行为

外观方法是对象层面合并，不触碰几何内核：

- mesh 链产物：`{ positions, indices, appearance }` → `setColor` 合并 `appearance`。
- brep 链产物（网格化后）：同样构造为 Shape 实例 → 方法行为一致。
- 因此**无需**为外观设置声明 mesh/brep 双实现（§3.4 边界表）；几何 op 链（`cad.box` → `cad.extrude` → …）照常按静态规则分派，外观随 shape 引用一路携带（op 返回新 Shape 时，实现需继承输入的 `appearance`——**这是实施要点**：所有几何 op 的产物构造默认继承 `input.appearance`，除非被覆盖；实现集中在产物包装点，避免每个 op 手写）。

### 6.2 Phase 2 面级（mesh 链需要内核配合）

- brep 链：XCAF label 级颜色天然支持（面序号 → label `setColor`），无需内核改动。
- mesh 链：需要「brep 面序号 → 三角形分组」的稳定映射——网格化阶段为每个面记录三角形区间（`materialGroups`），或按面拆分几何。这是本方案**唯一需要内核配合**的项，故排 Phase 2，实施前单独评估。

### 6.3 worker / 序列化边界

- 执行（含方法调用）在 worker 内完成；产物经消息通道回传时，`appearance`（及 Phase 2 的 `materialGroups`/`vertexColors`）作为 JSON 数据字段传递；**方法不需要跨 worker**（编辑器只消费字段）。
- `cad-runtime` 产物结构化契约需把 `appearance` 加入白名单字段（实施时核对 `browser-host` 消息 schema）。

## 7. 编辑器对接（3d_editor）

1. **脚本路径**：`executeScript.ts` 从 `outputs[i].appearance`（Shape 自带）取外观，**不再读** `ts.meta.appearance`（已删除）；`scene-mutator.ts` 的 `buildAppearance()` 升级为全字段映射 `faijsAppearanceToHost()`。
2. **原值/覆盖语义**（沿用 v1 结论，修正现状）：脚本/形状外观写入 `materialOriginals`（原值）；`MaterialEditor` 用户编辑写入 `materialOverrides`（覆盖）；查询优先级 `overrides > originals > defaultMaterial`。现状「脚本外观写 overrides」会导致重放覆盖用户修改，必须修正。
3. **导入路径**：STEP 导入消费 `shape.appearance.color`（修复 v1 发现的丢色问题）；3MF 导入把 `baseColor` 转为 `MaterialAppearance` 写入 `materialOriginals`（Phase 2 支持 vertexColors 渲染）。
4. **唯一映射点**：`faijsAppearanceToHost(app: PbrAppearance): MaterialAppearance`（§4.1 ↔ `MaterialAppearance` 29 字段映射表同 v1 §4.2），放 3d_editor `engine/material/` 或 `@faicad/shared`；反向 `hostAppearanceToFaijs` 用于导出。
5. 渲染层零改动：`MaterialFactory` → `MeshPhysicalMaterial` 直接消费映射结果。

## 8. 导出（按已有规范写，能力矩阵）

| 目标格式 | 规范 | 能写 | 不能写（规范限制，不伪造） | faijs/编辑器路径 |
|---|---|---|---|---|
| STEP | AP214 `STYLED_ITEM`/`COLOUR_RGB`；XCAF 颜色 | 颜色 | 材质/透明度（STEP 无 PBR 语义） | brep 链 XCAF `setColor`（读取侧已有对称能力；写侧 API 面未决问题见 §11.1）；单零件/装配 `memberColors` 机制扩展 |
| glTF/GLB | glTF 2.0 PBR metallic-roughness | 颜色、metalness、roughness、alpha（`baseColorFactor`/`metallicFactor`/`roughnessFactor`/`alphaMode`） | transmission/clearcoat/sheen/anisotropy/specular/envMapIntensity（非 Core 或 OCCT 导出不支持） | 编辑器侧 `THREE.GLTFExporter`（从 `MeshPhysicalMaterial` 导出，PBR 子集天然符合）或 brep 链 `occt-wasm XAFDocument.exportGLTF()`（roadmap 已确认内核能力）——实施时按产物质量二选一 |
| 3MF | Core `<basematerials>`（`displaycolor="#RRGGBB"`） | 颜色 | 透明度/材质参数（3MF Core 无定义；Bambu 扩展通道未确认） | 3d_editor `three-mf-exporter.ts` 已有颜色提取，改为读 `MaterialAppearance`；Phase 2 支持 `<colorgroup>` |
| STL | 无颜色 | — | 全部 | — |

> 边界：CadQuery 的 glTF 导出同样只带 PBR 子集（v1 调研结论），本方案与上游能力边界一致；编辑器内 PBR 全参数渲染是完整能力，跨格式导出按上表降级。

## 9. 破坏性变更清单（不兼容存量，实施 PR 明示）

| # | 变更 | 影响 |
|---|---|---|
| 1 | 删除 `ScriptMetaIR.appearance`（`lang/types.ts`） | 消费 `meta.appearance` 的宿主代码（3d_editor `executeScript.ts`）改读 `outputs[i].appearance` |
| 2 | 删除 `metadata-extractor.ts` 的 `color/metalness/roughness` return 解析 | 存量脚本 `return { shape, color }` 中这些字段不再生效（未知 key 忽略或报错，实施时固定） |
| 3 | 新增 Shape 方法（`setAppearance`/`setColor`/`setMaterial`/`setOpacity`/`getAppearance`） | Shape 运行时形态带方法；纯数据判定（`isMeshShape`）不变 |
| 4 | 新增 `Shape.appearance` 字段 | 产物构造点继承输入外观（§6.1 实施要点） |
| 5 | 编辑器「脚本外观 → materialOriginals（原值）」语义修正 | `engine-store.test.ts` 等断言同步更新 |

迁移指引（文档化即可）：存量脚本把 `return { shape: box1, color: '#f00' }` 改写为 `box1.setColor('#f00'); return { shape: box1 }`。

> **实测注记（2026-10-05）**：全仓 grep（`**/*.fai.js` 含 `color:|metalness|roughness`）为 **0 命中**；`metadata-extractor.test.ts` 亦无 appearance 相关用例。即 `return { shape, color, metalness, roughness }` 是**类型已定义、解析器已实现、编辑器消费端在等，但从未有脚本真正使用**的死特性（唯一在用的是 `name`）。因此本清单的破坏性变更实际迁移集为空——删掉它只影响解析器分支与 3d_editor 消费代码，不影响任何现存脚本。

## 10. 测试与验收

| 类别 | 用例 |
|---|---|
| 语法/解析 | `box1.setColor(...)` 表达式语句解析、sN 分配；未知方法名弱校验；`setOpacity` 越界 clamp |
| 执行 | 方法原地合并（positions/indices 引用不变）；链式 `setColor(...).setOpacity(...)`；多次设置合并语义；op 产物继承输入外观 |
| 数据 | `shape.appearance` 序列化往返（worker 消息）；方法不序列化 |
| 编辑器 | `faijsAppearanceToHost` 全字段映射；玻璃/金属/透明三 preset 渲染；originals/overrides 优先级 |
| 导入 | STEP 带色零件 → `appearance.color` 入库；3MF baseColor 入库；STL 无外观；外部文件宽容兼容（缺引用链/未知 pid 不拒收） |
| 导出 | STEP 颜色保留（对照 AP214 语义）；3MF `displaycolor` 正确；glTF PBR 子集正确 |
| 破坏性 | 存量 `meta.appearance` 相关测试按 §9 清单更新后全绿；`npm run doc-sync` 门禁通过 |

验收锚点（用户原话映射）：

1. `let box1 = cad.box(...); box1.setColor(...); box1.setMaterial(...); box1.setOpacity(...)` 可写、可执行。
2. 3d_editor 打开该脚本渲染正确（PBR 参数生效、透明度生效）。
3. 设置外观的语句**不是 op**（不在 `cad.` 命名空间、不进 op 体系）。
4. STEP/3MF 导入导出按各自规范不丢颜色、不写规范外字段。

## 11. 分阶段实施（P1 已落地，2026-10-05）

| 阶段 | 内容 | 交付 |
|---|---|---|
| **P1 最小闭环** ✅ | `PbrAppearance` 类型 + Shape 方法（setAppearance/setColor/setMaterial/setOpacity/getAppearance）+ `Shape.appearance` + 产物构造点继承外观 + 复用成员调用语句机制（asm.solve 先例，§3.3.1）+ 删除 `ScriptMetaIR.appearance`（§9 清单 1–4）+ 编辑器 `faijsAppearanceToHost` + originals/overrides 语义修正 | 「颜色/透明度/基础 PBR 在编辑器正确渲染」闭环 + 破坏性变更落地。**验证**：faijs core typecheck/lint 全绿、core 单测 2956、faijs-tests 571（含 appearance e2e 7 个）；3d_editor test:unit 2822、改动文件 eslint 干净；worker 协议补 `appearance` 过线（protocol.ts，web/weapp/electron 三端共用）。已知缺口：3d_editor typecheck:desktop 3 处 faijs 0.29.1→0.29.3 升级存量漂移（weapp/sketch-host），非 P1 引入，见 Agent Note 2026-10-05-pbr-appearance-shape-methods |
| **P2 导入修复** | STEP/3MF 导入颜色 → `materialOriginals`（按 §5 规范映射）；STEP 丢色修复 | 导入即所见 |
| **P3 导出** | STEP 颜色、3MF `basematerials`、glTF PBR 子集（§8 路径二选一） | 导出不丢颜色 |
| **P4 面级 + 顶点色** | `setFaceColor`/`setFaceMaterial` + mesh 面序分组（内核网格化配合）+ `vertexColors`/`materialGroups` + 3MF colorgroup/逐三角形读写 | 多材质/贴图 |

依赖标注：P4 依赖内核网格化改动，独立评估；P1–P3 均为增量实现、可独立停。

## 12. 未决问题（实施阶段实测确认）

1. ✅ 已解决：外观方法调用走 `classifyOpCall` receiver 分支，`set*` 为 `hasAssignment=false` 无输出语句，与 `solve` 一致（§3.3.1 + e2e A1 实测）。**额外发现**：脚本面链式 `a.setX(...).setY(...)` 不支持（解析器只认单层 receiver），已写入 §3.3.1 实施注记。
2. `occt-wasm` XCAF **写侧** API 面（`setColor` 等）是否与读取侧对称暴露——决定 P3 STEP/glTF 写路径形态。
3. ✅ 已解决：`materialOriginals` 生产写入方缺失——P1 新增 `setMaterialOriginals`（单零件增量）并由 createPart 写脚本/导入原值；overrides 仅剩用户编辑（handle-material-api）与 fai_split 派生。
4. 3MF Bambu 扩展（`parseBambu3mfFromEntries`）是否有自定义透明度通道——决定 P3 3MF 是否可带 alpha（默认按 Core 规范不带）。
5. ✅ 已定案：return 未知 key **静默忽略**（宽容语义；return 对象非 op 参数不做校验）——写入 `metadata-extractor.ts` 解析注释；`ops-api-inventory.md` 无 return 语义章节，无需另写。
6. glTF 导出路径二选一（编辑器 `GLTFExporter` vs 内核 `XAFDocument.exportGLTF()`）：按 P3 实测产物（顶点色保留度、材质参数、坐标轴）定稿。

## 13. 相关文档

- 本文档替代：`docs/plans/2026-10-04-faijs-pbr-appearance-api-design.md`（已废弃）
- `docs/api-contract.md`（op 三分类 / Result / 单位契约；本文档的 Shape 方法不属 op 分类，补充说明见 §3.4）
- `docs/language-design.md`（keep-syntax / 语句模型；本文档新增表达式语句形态）
- `docs/ops-api-inventory.md`（实施后补方法条目）
- `docs/plans/2026-10-03-cadquery-full-port-roadmap.md`（glTF 排除项与 `XAFDocument.exportGLTF()` 内核能力注记）
- `docs/plans/2026-10-03-fai-zip-third-party-sdk-and-viewer-plan.md`（`FaiViewerMesh.appearance` 槽位由 `PbrAppearance` 补全）
- 3d_editor：`packages/shared/src/types.ts`（`MaterialAppearance`）、`packages/app/src/engine/material/MaterialFactory.ts`、`packages/app/src/stores/core/material-store.ts`、`packages/app/src/engine/script-engine/scene-mutator.ts`、`packages/app/src/engine/formatLoaders.ts`
