# faijs 螺纹孔（攻丝孔）PMI 与技术要求方案

- 产出：claude-sonnet-4-20250514 + CatPaw（初稿）｜2026-10-31 事实修订与实施
- 状态：**螺纹孔（`tapped`）已实现**；技术要求（`PmiTechNote`）**未实现**（§7 保留为后续）

> **本文档 2026-10-31 修订说明**：初稿把 `fai_drill` 的螺纹孔理解成"装饰标注"，
> 与代码事实相反（§1.2 逐条列证）。修订版以**源码实测**为基线重写语义分型、
> 数据模型与实施路径，并把"钻圆柱孔 + PMI 注明后攻丝"这条**此前完全不存在**的
> 能力作为本次主线（§2–§6）。

---

## 0. 用户原始需求

> 「4×M6-6H ↓14：有效螺纹深度 14mm（攻丝，形成 M6 牙的长度）
> Φ5 ↓16：预钻底孔直径 Φ5，钻孔总深度 16mm
> 含义：钻头钻深 16，然后丝锥只往前攻进去 14；孔底部会留 2mm 深、Φ5 的无螺纹光底
> 一、CAD 渲染、图形预览，信任哪一套几何？
> ✅ 实体几何只信任【底孔：Φ5、深度 16】」
>
> 「fai_drill 的螺纹孔，是真的钻螺纹孔，并不是标注，文档里写错了。
> 如何钻圆柱孔，在 PMI 里注明后攻丝螺纹孔，目前并没有支持的方案，必须要解决。」

> 「新增 holeType: 'tapped'，包含原始几何信息和后加工攻丝信息。显示 PMI 时，
> 要同时显示这两类信息，它们是整体，并不是只有后加工的才属于 PMI。」

技术要求（另一类标注，本次未实施）：

```
技术要求
1、锐边倒钝，未注倒角0.3×1°，未注圆角0.3
2、加工面无划痕及损伤
```

---

## 1. 事实基线（源码实测）

### 1.1 `fai_drill` 两条链的真实行为

| `holeType` | mesh 链 | brep 链 |
|---|---|---|
| `simple` | `cylinderGeometry` 圆柱 CSG 减除，**平底**（`extra/mesh/drill-hole/DrillHoleCore.ts#buildHoleGeometry`） | `kernel.cut(solid, makeCylinder)`，**平底**（`brep/brep-ops.ts#buildDrillToolSolid`） |
| `screw` | 用 `makeScrew()` 生成**整根螺纹实体**再 CSG 减除 → **真螺旋内螺纹**；直径取**公称** `spec.dia`，`params.diameter` 被忽略（`DrillHoleCore.ts` 的 screw 分支） | 先按 `params.diameter` 切底孔，再用 `threadBrep({ radius: diameter / 2, inward: true })` 切螺旋 ridge（`extra/ops/fai_drill.ts#screwHoleBrep`） |

**结论：`holeType:'screw'` 是真实几何，不是标注。** 用户判断正确，初稿 §3.2/§3.4/§8.1/§10 的
"螺纹不是实体几何""`threadBrep` 与本方案不相关"全部作废。

### 1.2 初稿的六处错误（逐条对照）

| # | 初稿说法 | 代码事实 |
|:--|:--|:--|
| 1 | 螺纹是装饰标注，实体几何只有底孔 | `holeType:'screw'` 两条链都切出螺旋牙（§1.1） |
| 2 | `threadBrep` 是"实体螺纹，不相关" | 它就是 `fai_drill` screw 分支的实现核心 |
| 3 | "钻尖锥角 118° 会体现在底孔几何中" | 两条链**都是平底**，无锥尖（初稿 §8.3 自己也承认，前文自相矛盾） |
| 4 | 脚本里用 `cad.faceRef(part0, 7)` 指底孔内壁 | `api/face-ref.ts`：mesh 链抛 `E_TOPO_MESH_UNSUPPORTED`；且该 API 明确"查询用途，不用于脚本生成"（序号跨内核漂移） |
| 5 | STEP AP242 映射 `thread_aspect`，调 `setThreadAspect` / `getThreadAspects` / `getProductNotes` | 这些 API **不存在**。`brep/engine/types.ts#BrepXcafDocument` 只有 `addShape`/`addChild`/`exportSTEP`/`close`；`step-pmi.ts#supportsXcafPmi` 探测的 `setDimension` 也从未存在 |
| 6 | 导出链路"已具备" | `api/export-step.ts#stepEntryOf` 构造条目时**不带 `pmi`**；`api/export-3mf.ts` 全文无 `pmi`。仅 `mesh/threemf-pmi.ts` 有序列化器但无人调用 |

### 1.3 顺带发现的真 bug（初稿错误 #1 的副产品）

brep 的 screw 分支用 `radius: diameter / 2` 切螺纹齿 —— 底孔 Φ5 就按半径 2.5 切，
齿顶再内缩 `0.6 × pitch`，结果只是"Φ5 孔壁上一道 0.6mm 深螺旋槽"：既不是 M6 大径（3.0），
也不是干净底孔。mesh 链反而是按公称直径的真螺纹。**同一个 `holeType:'screw'`，两条链产出的孔不是同一个东西。**

初稿作者很可能只看了 brep 那条链上"那点槽"，才认定"螺纹不是几何"。

### 1.4 拓扑身份现状（决定数据模型）

- 钻孔产生的新面**有 role**：`brep/face-evolution.ts#drillBrepWithRoleTable` 按
  `生成面 = 结果 − 输入 − 改型后继` 判定，登记 `hole:0`、`hole:1`…，origin = 本次语句 StmtId。
- 但这个 role **只在 op 内部拿得到**；脚本层没有"第 N 张面 → role"的合法路径
  （`faceRef` 禁用于脚本，且 mesh 链无 role）。
- 布尔缝面则连 role 都没有（`topology/naming/roles.ts#mergeRoleTables` 登记空子表，`role=null`）。
- **PMI 过不了 op**：`shape.ts#fromBrep` / `solid()` 不透传 `pmi`。4 个孔要 4 次
  `fai_drill`，第 2 次就把第 1 个孔的标注丢了。

---

## 2. 语义分型：三种孔，两个世界

| `holeType` | 语义 | 几何 | PMI |
|---|---|---|---|
| `simple` | 光孔 | 圆柱（平底） | 无 |
| `screw` | **建模螺纹**（螺纹已是几何） | 螺旋牙实体 | 无（几何即事实） |
| `tapped` | **攻丝孔**（先钻底孔，后攻丝） | **只有底孔**圆柱 | `PmiThreadHole`：底孔 + 螺纹**同一条标注** |

`tapped` 的几何口径（用户原则，写死为不变量）：

- 实体几何 = 底孔 `Φ diameter × depth`，**不含**任何螺旋牙；
- 螺纹（规格、公差等级、有效螺纹深度）**不是几何**，是 PMI；
- `threadDepth ≤ depth`，差值即孔底的无螺纹光底（例：16 − 14 = 2mm）；
- 消费者（渲染 / CAM / 3D 打印 / 图纸）**只信任底孔几何**，螺纹信息一律从 PMI 读。

> 与 `screw` 的区别不是"有没有螺纹信息"，而是**螺纹信息在几何里还是在 PMI 里**。

---

## 3. 数据模型：`PmiThreadHole`

位于 `packages/core/src/api/pmi/types.ts`。**两类信息是同一个条目的两个必填分组**，
不设"只有后加工才算 PMI"的分裂（用户明确要求）。

```ts
/** 螺纹（后加工攻丝）规格 —— 这条标注的"后加工"一半。 */
export interface PmiThreadSpec {
  /** 螺纹标准：公制 M / 英制 UN / 管螺纹 G-R。 */
  readonly standard: 'metric' | 'imperial' | 'pipe'
  /** 公称直径（mm）。M6 → 6。 */
  readonly nominalDiameter: number
  /** 螺距（mm）。缺省按 standard + nominalDiameter 查表。 */
  readonly pitch?: number
  /** 公差等级。内螺纹 metric：'6H'；imperial：'2B'/'3B'。 */
  readonly toleranceClass?: string
  /** 有效螺纹深度（mm）——攻丝形成的螺纹长度，不含孔底光底。 */
  readonly depth: number
  /** 旋向，默认右旋。 */
  readonly handedness?: 'right' | 'left'
  /** 规格标签（显示用，不参与身份）。'M6' / 'M8×1' / '1/4"-20' / 'G1/2'。 */
  readonly specLabel?: string
}

/** 底孔（原始几何）参数 —— 这条标注的"几何"一半。 */
export interface PmiPilotHole {
  /** 底孔直径（mm）。M6 粗牙 → 5。 */
  readonly diameter: number
  /** 底孔总深度（mm）。≥ thread.depth。 */
  readonly depth: number
  /** 钻尖锥角（度）。标注用；当前几何为平底，不做锥尖（§8）。 */
  readonly drillPointAngle?: number
}

/** 孔的几何定位器 —— 两链通用，改参重放后可重算。 */
export interface PmiHoleAxis {
  /** 孔口点（模型局部坐标，与 fai_drill 的 position 同一契约）。 */
  readonly origin: Vec3
  /** 轴向单位向量（指向材料内部）。 */
  readonly direction: Vec3
}

export interface PmiThreadHole {
  readonly kind: 'threadHole'
  /** 后加工：螺纹规格（M6-6H ↓14）。 */
  readonly thread: PmiThreadSpec
  /** 原始几何：底孔（Φ5 ↓16）。 */
  readonly pilot: PmiPilotHole
  /** 几何定位（两链通用的主定位，mesh 链唯一可用定位）。 */
  readonly axis: PmiHoleAxis
  /**
   * 螺纹的来源：
   * - 'tapped'：几何只有底孔，螺纹由攻丝形成（**几何不含牙**）
   * - 'modeled'：几何已含实体螺旋牙（对应 holeType:'screw'）
   */
  readonly process: 'tapped' | 'modeled'
  /** 孔数量（如 4×）。缺省 1。 */
  readonly count?: number
  /** BREP 链的可选面引用（op 内部产出的 `hole:N`）；mesh 链缺省。 */
  readonly target?: FaceTopoRef
  /** 显示文本缓存（缺省由 `formatThreadHole` 生成）。 */
  readonly label?: string
}
```

### 3.1 为什么定位器是 `axis` 而不是 `FaceTopoRef`

| 方案 | mesh 链 | 脚本可生成 | 改参重放 | 结论 |
|---|---|---|---|---|
| `target: FaceTopoRef`（初稿） | ❌ 抛 `E_TOPO_MESH_UNSUPPORTED` | ❌ `faceRef` 禁用于脚本；op 内部 role 脚本层拿不到 | ✅ | 不成立 |
| `axis` 定位（本方案） | ✅ | ✅（参数即定位） | ✅（重算参数） | **主定位** |
| `target` 可选加强 | — | 由 op 内部填 | ✅ | BREP 上多一层面关联 |

`axis` 与 `fai_drill` 的 `position` / `direction` 参数**同一语义**（都是模型局部坐标），
因此 op 产出标注时不需要任何额外求解，重放时定位天然一致。

### 3.2 显示：两类信息一体呈现

用户要求"显示 PMI 时同时显示这两类信息，它们是整体"。提供单一真源的格式化函数：

```ts
// api/pmi/text.ts
formatThreadHole(item: PmiThreadHole): string
// 例：'4×M6-6H ↓14（底孔 Φ5 ↓16，攻丝）'
// 无公差等级：'M6 ↓14（底孔 Φ5 ↓16，攻丝）'
// 建模螺纹：'M6 ↓14（实体螺纹）'
```

宿主（3D 编辑器 / 看图）直接渲染这一行；数据侧仍是两组结构字段，
不做"字符串即数据"的有损存储（`label` 字段只是缓存，可缺省）。

---

## 4. `fai_drill` 的 `tapped` 实现

### 4.1 参数

新增/复用的 `params` 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `holeType` | `'simple' \| 'screw' \| 'tapped'` | 新增 `'tapped'` |
| `diameter` | number | `tapped` 时可省略：按 `公称直径 − 螺距` 反算底孔（M6 → 5） |
| `depth` | number | 底孔总深度（16） |
| `threadDepth` | number | 有效螺纹深度（14）；缺省 = `depth` |
| `threadClass` | string | 公差等级（'6H'）；缺省 metric 内螺纹取 `'6H'` |
| `screwSystem` / `screwSpecIdx` / `screwThread` | — | 复用（规格来源 `primitives/screw/screw-db.ts`） |

### 4.2 几何（两条链一致）

`tapped` 走**与 `simple` 完全相同**的圆柱路径（mesh：`buildHoleGeometry` 的圆柱分支；
brep：`buildDrillToolSolid`）。不调 `threadBrep`，不做 second cut。

### 4.3 PMI 产出（op 内，两条链）

`fai_drill` 在拿到结果 Shape 后追加 `PmiThreadHole`：

1. `thread`：来自 `screw-db` 查表（`nominalDiameter` / `pitch` / `toleranceClass` / `depth=threadDepth`）；
2. `pilot`：`diameter`（或反算值）/ `depth`；
3. `axis`：op 的 `position` + 解析后的轴向（**局部坐标**，与几何同源）；
4. `target`（仅 brep）：在 `drillBrepWithRoleTable` 返回的 roleTable 里定位
   `outStmt → hole:i`，挑选 `kernel.surfaceType(face) === 'cylinder'` 的那张生成面，
   合成 `FaceTopoRef { origin: outStmt, role: 'hole:i', hint }`；
5. `count`：本次调用为 1（多次调用累加由脚本/宿主决定）。
6. 同时**保留输入 Shape 的既有 pmi**（`carryPmi`），避免多孔场景互相覆盖。

`holeType:'screw'` 也产出同一类型的标注（`process: 'modeled'`），这样下游读到的
"这是螺纹孔"语义只有一种形状，不需要按 holeType 分叉。

### 4.4 脚本样例

```js
// 攻丝孔：几何只钻 Φ5×16，螺纹是 PMI（M6-6H，有效深 14）
part0 = cad.fai_drill(part0, {
  position: [10, 10, 0],
  direction: 'z',
  holeType: 'tapped',
  screwSpecIdx: 5,      // M6
  depth: 16,            // 底孔深
  threadDepth: 14,      // 有效螺纹深
  threadClass: '6H',
})

// 查询（两链通用）
const taps = cad.pmiThreads(part0)                      // PmiThreadHole[]
const text = cad.formatThreadHole(taps[0])              // 'M6-6H ↓14（底孔 Φ5 ↓16，攻丝）'
```

---

## 5. PMI 传递链

```
fai_drill（op）
  ├─ 几何：底孔（两链）
  └─ shape.pmi += PmiThreadHole（含 axis + 可选 target）
        ├─ ExecutionResult.pmi        ← cad-runtime 收集（已存在）
        ├─ cad.exportStep  / 3MF      ← 本次修复：条目携带 pmi
        └─ cad.pmiItems / pmiOn / pmiThreads
```

### 5.1 本次修复的断点

| 断点 | 修法 |
|---|---|
| `stepEntryOf` 丢 pmi | 单件/装配成员一律从 `shape.pmi` 带入 `ExportEntry.pmi` |
| `export-3mf` 丢 pmi | 同上，写进 `<metadatagroup name="faijs:pmi">` |
| op 间 pmi 覆盖 | `fai_drill` 先 `carryPmi(input → result)` 再追加 |

### 5.2 STEP 语义边界（诚实降级）

`BrepXcafDocument` 只有 `addShape`/`addChild`/`exportSTEP`/`close`，**没有**任何 PMI/thread
写入工具；AP242 语义螺纹实体同样需要上游能力。因此：

- 有 `pmi` 时仍把 `FILE_SCHEMA` 升级到 AP242（`upgradeStepSchemaForPmi`，已有）；
- 具体螺纹标注**不写**进 STEP 实体（`supportsXcafPmi` 恒 false → `writePmiToXCAF` 返回 0）；
- 数据不丢：随 `PmiSet` / 3MF 元数据传递；STEP 侧等上游提供 thread/DimTol 工具再补。

**不做的**：不伪造 `thread_aspect`、不写不存在的 `setThreadAspect`（初稿的错误源头）。

---

## 6. 边界：实体几何 vs PMI

```
实体几何（mesh/BREP）                    PMI（shape.pmi）
┌──────────────────────┐              ┌────────────────────────────┐
│ tapped: 底孔 Φ5×16    │              │ PmiThreadHole              │
│   （圆柱，平底）       │   ← axis →   │  · pilot   Φ5  ↓16（几何）  │
│ screw : 螺旋牙实体     │              │  · thread  M6-6H ↓14（后加工）│
│ simple: 圆柱          │              │  · process tapped/modeled  │
└──────────────────────┘              └────────────────────────────┘
     ↑ fai_drill                            ↑ fai_drill 自动产出
```

- `tapped`：几何**不含**牙，PMI 含完整两类信息；
- `screw`：几何含牙，PMI 仍产出（`process:'modeled'`）以便统一消费；
- 倒角/圆角是几何；"未注倒角 0.3×1°"是技术要求（§7），不是 op 参数。

---

## 7. 技术要求 `PmiTechNote`（未实施，保留设计）

结构与理由不变（初稿 §4）：

```ts
export interface PmiTechNoteItem {
  readonly index: number
  readonly text: string
  readonly subItems?: readonly string[]
}

export interface PmiTechNote {
  readonly kind: 'techNote'
  readonly items: readonly PmiTechNoteItem[]
  readonly category?: 'general' | 'machining' | 'heatTreatment' | 'surface' | 'inspection'
  readonly title?: string
}
```

与 `PmiNote` 的分工：`PmiNote` = 单条自由文本（可挂拓扑）；`PmiTechNote` = 零件级
编号条目块。两者互补，不互相替代。

**本次未实施**（状态如实标注：类型/方法/查询/导出均未落地）。

---

## 8. 不做什么

1. **不做 `tapped` 的实体螺纹几何**——用户原则：攻丝孔的实体几何只有底孔。
2. **不做钻尖锥角几何**——`PmiPilotHole.drillPointAngle` 仅作标注字段；两条链仍是平底。
   锥尖会改变所有既有 `simple` 孔的体积与面数（全局回归），单独立项。
3. **不写不存在的 STEP/XCAF API**（thread_aspect / setThreadAspect）。
4. **不做 PMI 的 3D 渲染**——宿主职责，只给数据 + `formatThreadHole` 文本。
5. **不做螺纹-底孔匹配校验**——如 M6 底孔应为 Φ5 属工程判断；仅在 `diameter`
   省略时按公式给默认值，不因不匹配报错。
6. **不做跨所有 op 的 PMI 自动传播**——本次只在 `fai_drill` 内 `carryPmi`；
   布尔/变换类 op 的通用传播留作后续（§10）。

---

## 9. 测试

| 测试文件 | 断言要点 |
|---|---|
| `test/api/pmi/pmi-thread-hole.test.ts`（17） | 类型/工厂/JSON 往返；`formatThreadHole` 两类信息齐全（含 count/LH/fine/modeled/通孔）；`pmiThreads` / `pmiOn` 查询；`carryPmi` 不覆盖；符号表收录 |
| `test/extra/ops/fai-drill-tapped.test.ts`（10，brep） | `tapped` 体积/面数与 `simple` 逐项相同；`diameter` 省略反算 Φ5；`screw` 体积**小于** `simple`（真的切牙）；`process='modeled'`；PMI 两组字段 + BREP 孔壁 `hole:N`；`threadDepth` 夹到孔深；连续 3 次钻孔标注累积 |
| `test/extra/ops/fai-drill-tapped.mesh.test.ts`（3，mesh） | mesh 链同样产出标注；`target` 缺省（不伪造拓扑引用）；三角数与 `simple` 一致 |
| `test/api/pmi/pmi-export-wiring.test.ts`（2） | `export3mf` 的 `<metadatagroup name="faijs:pmi">` 里同时含底孔与螺纹；无标注时不写空组 |
| `test/api/pmi/pmi-thread-e2e.test.ts`（2，脚本面） | `.fai.js` 里 `cad.fai_drill(holeType:'tapped')` → `ExecutionResult.pmi` 有螺纹孔；`cad.pmiThreads` / `cad.formatThreadHole` 脚本内可用 |

---

## 10. 遗留与后续

| 项 | 说明 |
|---|---|
| 钻尖锥角 | 需要改 `simple`/`tapped` 两链刀具几何，影响存量测试基线，单独立项 |
| `screw` 的 brep 口径 | `radius: diameter/2` 与公称直径不一致（§1.3），修复会改变既有 screw 孔几何；需同步 `../3d_editor` 与回归 |
| PMI 跨 op 传播 | 当前仅 `fai_drill`（`carryPmi`）。`union`/`transform` 等仍会丢失标注 |
| STEP 语义 PMI | 阻塞在 occt-wasm（无 DimTol/thread 工具），标注能力需上游 |
| `PmiTechNote` | 未实施（§7） |
| `docs/ops-api-inventory.md` | 需重新生成才能收录 `pmiThreads` / `formatThreadHole`；但生成器当前因**既有**两处缺章（`useMeshChain`、`setBooleanOperandValidation` 无 `@group` JSDoc）而失败，属既有问题，未在本案顺带修 |
| `npm run typecheck` | 仓库 HEAD 存在既有失败：`packages/core/src/brep/mesh-solid.ts` 有两个重复的 `get size()`（362/410 行，`TS2300 Duplicate identifier 'size'`），与本案无关，未修改 |
