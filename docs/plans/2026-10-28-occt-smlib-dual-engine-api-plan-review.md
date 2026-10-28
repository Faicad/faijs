# 评审文档：双引擎 API 层方案（OCCT × SMLib）核查

评审对象：`2026-10-28-occt-smlib-dual-engine-api-plan.md`（2026-10-28 07:09 撰写，状态：方案未实施）
评审日期：2026-10-28
评审方式：两侧真实声明全量抽取 + 机械比对 + 关键语义人工核验（**不改设计文档，仅出评审**）

## 0. 评审结论摘要

| 严重度 | 类别 | 条数 | 关键项 |
|---|---|---|---|
| 🔴 高 | 事实错误（SMLib 侧能力判断） | 1 | §1/§2.2「SMLib 无历史追踪」不成立 |
| 🔴 高 | 名词不同功能相同的配对漏认 | 10 | 你重点要求的项，方案漏认/错归 |
| 🟠 中 | 计数/数字不实 | 4 | 183 / 150 / ×10 / 桥 include 全量 |
| 🟠 中 | STL IO 名称错误 | 1 | 见 §4（含对本人先前口述的纠正） |
| 🟠 中 | §4.3「先行补桥」清单虚高 | 1 | 11 项中 5 项桥已实现 |
| 🟡 低 | 结构性/边界纪律 | 4 | §2.1 自相矛盾、交叉重复、命名不统一 |
| 🟡 低 | 两侧能力遗漏未入表 | 2 | OCCT 8 项、SMLib 6+ 项 |
| ✅ | 核实无误 | — | 见 §8，避免全盘否定 |

> 总体判断：方案骨架（三张对照表 + 新层设计 + 门禁复用 `assertEngineFor`）是对的，问题集中在 **SMLib 侧事实准确度** 与 **三张表的边界纪律**。下面逐条给出证据与行号。

---

## 1. 🔴 最严重事实错误：「SMLib 无历史追踪」

- 设计文档 **§1 第 25 行**：历史追踪行写「OCCT `*WithHistory`/`EvolutionData` 完整 ／ SMLib **无**」。
- 设计文档 **§2.2 第 201 行**：把「`*WithHistory` ×10 + `EvolutionData`」整体判为 occt-only。
- **核实结果（错）**：
  - `SMLib/inc/SmTrackTopologyChanges.h` 真实存在（注意它在 `SMLib/inc`，**不在** `SM_API/inc`，所以只抽 SM_API 头文件时看不到它 —— 这是当初容易漏判的根因）。
  - wasm 桥 `wasm-probe/src/SmApiBridgeEx.cpp` 已用它实现：
    - `SmApiBooleanWithHistoryEx`（第 665 行）：返回 Rm / Add / Chg 三组面指针 —— 这正是 OCCT `EvolutionData` 的等价物；
    - `SmApiFilletWithHistoryEx`（第 703 行）。
- **修正**：历史族至少在 **face 级 Rm/Add/Chg** 上 SMLib 与 OCCT 能力对等，应：
  1. 把「布尔带历史」「圆角带历史」两条从 §2.2 移入 §2.1（作为名词不同的配对，见 §3.1/§3.2）；
  2. §2.2 第 201 行删去「历史追踪族」整行，或改为「OCCT 12 个 *WithHistory + EvolutionData；SMLib 经 SmTrackTopologyChanges 提供布尔/圆角带历史（face 级 Rm/Add/Chg）」；
  3. §1 第 25 行范式表「SMLib 无」改为「SMLib 有（face 级，经桥 WithHistoryEx）」。

---

## 2. 🔴 名词不同、功能相同 —— 方案漏认/错归的配对（你重点要求）

下列配对方案**没有识别出来**，或识别了但归错了表。逐项给出真实声明证据。

### 2.1 `SmApiBooleanWithHistoryEx` ↔ OCCT `*WithHistory` + `EvolutionData`
- 两侧都有。桥 `SmApiBridgeEx.cpp:665` 已实现并返回 Rm/Add/Chg 面组。
- 方案：§2.2 第 201 行把它判为 occt-only（**错**，见 §1）。

### 2.2 `SmApiFilletWithHistoryEx` ↔ OCCT `filletWithHistory`
- 两侧都有。桥 `SmApiBridgeEx.cpp:703` 已实现。
- 方案：同上错归 §2.2。

### 2.3 `SmApiSurfaceTypeEx` ↔ OCCT `surfaceType`
- OCCT：`surfaceType(face): SurfaceKind`（`index.d.ts`，真实存在）。
- SMLib：桥 `SmApiSurfaceTypeEx`（`SmApiBridgeEx.cpp:242`，封装 SM_API 的曲面类型查询）。
- 方案：**两侧都完全没提** `surfaceType`/`SmApiSurfaceType` —— 既不在 §2.1 也不在 §2.2/§2.3。

### 2.4 `SmApiVertexGetPoint` ↔ OCCT `vertexPosition`
- OCCT：`vertexPosition(vertex): Vec3`（`index.d.ts`，真实存在）。
- SMLib：`SmApiVertexGetPoint`（`SmApiQueries.h:336`，SM_API 导出）。
- 方案：**两侧都完全没提**。

### 2.5 `SmApiCut`（按平面切） ↔ OCCT `halfSpace` + `cut`/`common`
- SMLib：`SmApiCut(pBrep, planePt, planeNormal)`（`SmApiBrep.h`）—— 语义是 **用平面切割实体**，不是布尔差。
- 方案 **§2.1 第 92 行** 把 `SmApiCut` 塞进「**差 cut**（布尔差）」行，与 `SmApiBooleanDifference` 并列（**错归**）。应单独成行「按平面切割」，配对 OCCT `halfSpace`+`cut`。
- 连带影响：§2.2 第 197 行把 `halfSpace` 判为「SMLib 无」，但 SMLib 用 `SmApiCut`（平面切）即可等价达成，不应简单判 occt-only。

### 2.6 `CreateLinearSweepWithRepetitions` / `CreateRotationalSweepWithRepetitions` ↔ OCCT `linearPattern` / `circularPattern`
- SMLib：`SmApiCreateLinearSweepWithRepetitions` / `SmApiCreateRotationalSweepWithRepetitions`（均在 `SM_API/inc`，真实存在）。
- OCCT：`linearPattern` / `circularPattern`（`index.d.ts`，真实存在）。
- 方案 **§2.3 第 229 行** 把这两个 SMLib 函数判为「OCCT 无」，但 OCCT 有近似等价的实体阵列（`linearPattern`/`circularPattern`）。输入层级不同（曲线重复扫掠 vs 实体阵列），属「名词不同、近似同功能」，应在 §2.1 标为配对并注明输入层级差异，而非判 smlib-only。

### 2.7 `SmApiFaceGetBoundaryLoops` ↔ OCCT `outerWire`
- OCCT：`outerWire(face): ShapeHandle`（`index.d.ts`，取外环）。
- SMLib：`SmApiFaceGetBoundaryLoops`（取面的边界环，含外环）。
- 方案：§2.1 第 137 行只在「子形状枚举」里带过 `FaceGetBoundaryLoops`，未与 `outerWire` 配对；应在拓扑构造/查询处显式标为配对。

### 2.8 `SmApiStitchIntoSolid` ↔ OCCT `makeSolid(shell)`
- OCCT：`makeSolid(shell): ShapeHandle`（`index.d.ts`，壳→体）。
- SMLib：`SmApiStitchIntoSolid`（壳缝合为实体，SM_API 导出）。
- 方案：§2.1 第 83 行 `StitchIntoSolid` 已列，但**未与 `makeSolid` 配对**；`makeSolid` 本身也未在 §2.2 作为 occt-only 候选出现（漏）。

### 2.9 `SmApiFilletEdgesPerEdge` ↔ OCCT `filletVariable`
- SMLib：`SmApiFilletEdgesPerEdge`（SM_API 导出）—— **逐边半径 + 逐边截面类型 + G1/G2/G3**，能力比 OCCT `filletVariable` 更强。
- 方案 §2.1 第 113 行把 `filletVariable` 只配 `SmApiVariableRadiusFillet`，漏了更强的 `SmApiFilletEdgesPerEdge`。应注明 SMLib 侧该条目更强。

### 2.10 `SmApiBooleanWithOptions` 的 `bImprinting` / `bImprintAndClassifyFaces` ↔ OCCT `split`
- SMLib：`SmApiBooleanWithOptions` 带标志（头文件原文）：
  - `bImprinting`：「TRUE = imprint intersection on BrepA and quit」；
  - `bImprintAndClassifyFaces`：「TRUE = imprint and mark faces to be deleted」。
  - 这正是 OCCT `split(shape, tools)`（BOPAlgo_Splitter）的语义。
- 方案 §2.1 第 97 行 / §3 第 1 项写「`split` SMLib **无直接等价**」—— **不准确**。SMLib 有直接的 imprint 标志可达成，应在 §2.1 标为配对（或至少 §3 风险项改为「SMLib 经 imprint 标志可达，需验证 face 标记粒度」），不要再写「无直接等价」。

---

## 3. 🟠 计数 / 数字不实

| 位置 | 原文 | 实测 | 结论 |
|---|---|---|---|
| §0 第 11 行 | OCCT「约 150 个方法」 | `index.d.ts` 去重方法名 **209** 个 | 偏低，应改为 209 |
| §0 第 12 行 | SMLib「**183** 个 `SMAPI_EXPORT` 导出」 | `SMAPI_EXPORT` 宏在 16 个 API 头出现 **194** 次（含重载/同名变体）；按声明严格去重导出函数名 **133** 个；另桥额外导出 **40** 个 `*Ex` 函数 | 183 对不上任何一档，应改为「194 次宏 / 133 去重函数 + 40 桥 Ex」 |
| §2.2 第 201 行 | `*WithHistory` **×10** | OCCT 实际 **12** 个（chamfer/cut/fillet/fuse/intersect/mirror/offset/rotate/scale/shell/thicken/translate） | 应为 ×12 |
| §0 第 12 行 & §4.3 | 「wasm 桥已 **include 全部头文件**」 | 桥 `SmApiBridgeEx.cpp:25-54` 仅 include **11** 个 SM_API 头（`SmApiBrep/General/Queries/Types/Curves/Surfaces/Fillets/Heal/TrimmedSurfaces/Intersectors/Primitives`）；缺 `ImportExport`/`Polygons`/`StepIo`/`StlIo`/`TessellationParams` 共 5 个（16 选 11） | 不成立，应改为「include 11/16」 |

---

## 4. 🟠 STL IO 名称错误（并纠正本人先前口述）

- 设计文档 **§2.1 第 176–177 行**：
  - 原文 STL 导入写 `` `SmApiStlIo`（`SmApiReadStl*`，桥未接） ``；
  - 原文 STL 导出写 `` `SmApiStlIo`（`SmApiWriteStl*`，桥未接） ``。
- **核实**：
  - 真实导出名在 `SM_API/inc/SmApiStlIo.h` 是 **`SmApiImportStlEx`** / **`SmApiExportStlEx`**（无 `SmApiStlIo`/`ReadStl*`/`WriteStl*` 这类名字）。
  - 桥 `SmApiBridgeEx.cpp` 中**没有** `SmApiImportStlEx`/`SmApiExportStlEx`（grep 大小写不敏感 `stl` 命中 0）。即 STL 桥**确实未接** —— 这一点设计文档写对了。
- **纠正本人先前口述**：我在更早的口头核查里曾说「`SmApiImportStlEx/SmApiExportStlEx` 已实现、不存在桥未接问题」，**该结论错误**，以本次为准：STL 桥未接属实，但名字应改为 `SmApiImportStlEx`/`SmApiExportStlEx`。
- **修正**：第 176–177 行名字改为 `SmApiImportStlEx` / `SmApiExportStlEx`（保留「桥未接」）。

---

## 5. 🟠 §4.3「先行补桥」清单虚高

- 设计文档 **§4.3 第 262 行** 列出待补桥导出（节选）：`SmApiCreateSkin`、`SmApiCreateRuledSurface`、`SmApiCreateTaperExtrude`、`SmApiFaceClosestPoint`、`SmApiStitchIntoSolid`、`SmApiCreateRotationalSweep`、`SmApiCreateHelix`、`SmApiCreateSurfaceFromOrderedPoints`、`SmApiCreateCurveInterpPoints`、`SmApiShellBrepFull`、`SmApiOffsetBrepFull` 等。
- **核实**：桥 `SmApiBridgeEx.cpp` 的 `unsigned int SmApi*` 导出清单中，**以下 5 项已存在**（注意桥名带 `Ex`）：
  - `SmApiStitchIntoSolidEx` ✓
  - `SmApiCreateRotationalSweepEx` ✓
  - `SmApiCreateSurfaceFromOrderedPointsEx` ✓
  - `SmApiCreateCurveInterpPointsEx` ✓
  - `SmApiShellBrepFullEx` ✓
- 另：`SmApiOffsetBrepFull` 确实**不在**桥中（grep 命中 0），属真待补；其余（`CreateSkin`/`CreateRuledSurface`/`CreateTaperExtrude`/`FaceClosestPoint`/`CreateHelix`）也不在桥中。
- **修正**：§4.3 清单应删除已实现的 5 项（或标注「（桥已存在，命名为 *Ex）」），工作量估算（§5 第 278 行「1–2 天」）相应下调。

---

## 6. 🟡 结构性 / 边界纪律问题

1. **§2.1 自相矛盾（判定口径冲突）**：§0 第 15 行自己定了「两内核均直接提供 → 共同支持」。但 §2.1 里混进了约 10 个单侧条目，例如：
   - 图元：`pyramid`（第 45 行）、`椭圆锥`（46）、`圆柱块`（47）、`局部图元族 Partial*/SphereNoPole`（48）、`正多边形`（62）；
   - 投影/相交：`曲线投影到面`（160）、`曲线相交`（161）、`面相交`（162）；
   - 变换：`镜像`（125，标「可组合达成」却放进共同表）；
   - 倒角：`不对称倒角`（116，标「语义子集」）。
   这些应按口径移到 §2.3（smlib-only）或 §2.2（occt-only），否则 §2.1 失去「共同支持」的定义纯度。

2. **§2.1 与 §2.2/§2.3 交叉重复**：同一能力两处都写、一处说共有另一处说单有，例如 `offsetWire2D`（§2.1 第 63 / §2.2 第 211）、`containsPoint`/`classifyPointOnFace`（§2.1 第 138 / §2.2 第 207）、`surfaceCurvature`（§2.1 第 152 / §2.2 第 206）、`makeBSplineEdge`（§2.1 第 58 / §2.2 第 205）、`sweepPipeShell`（§2.1 第 105 / §2.2 第 199）、`halfSpace`（§2.1 第 69 / §2.2 第 197）、`RemoveCurveKnots`（§2.1 第 64 / §2.3 第 223）、`ProjectCurve`/`DropCurveToSrf`（§2.1 第 160 / §2.3 第 223、231）、`CylindricalBox`/`Pyramid`/`SphereNoPole`/`Partial*`（§2.1 第 47–48 / §2.3 第 228）。建议每能力只在一张表出现，交叉处用「见 §x」引用。

3. **命名写法不统一（直接导致自动比对假阳性）**：同一格混写全名 `SmApiBooleanWithOptions` 与简称 `BooleanLists`（第 94 行）；桥级 `*Ex` 与头文件级原名混排，且多数未标「（桥）」，读者分不清哪些现在就能调、哪些要补桥。建议：表内统一用 SM_API 头文件名，桥实现单独一列标「桥:SmApiXxxEx / 待补」。

4. **§2.2 第 214 行「更正备注」落空**：该备注称「`shell/offset` 已归 §2.1 共同支持」，但 §2.1（第 36–191 行）**根本没有 shell/offset 行**；`SmApiShellBrepFull`/`SmApiOffsetBrepFull` 也未在 §2.1 出现。备注与正文矛盾，应实打实补一行或删除备注。

---

## 7. 🟡 两侧均未进入任何表的能力（遗漏）

**OCCT 侧有、三张表均未列**（应在 §2.2 补为 occt-only 候选）：
- `makeCompound`（compound 容器相关，与 §1 第 22 行 compound 议题呼应）、`linearPattern`/`circularPattern`（阵列，见 §2.6）、`surfaceType`（见 §2.3）、`vertexPosition`（见 §2.4）、`outerWire`（见 §2.7）、`makeSolid`（见 §2.8）、`intersectionCells`、`reverseShape`、`hasTriangulation`。

**SMLib 侧有、三张表均未列**（应在 §2.3 补为 smlib-only 特色）：
- `SmApiBrepRelationship`（返回 0 分离 / 1 接触 / 2 互穿 / 3 A 含 B / 4 B 含 A + 间隙距离，**很有价值的 smlib-only 能力**）；
- `SmApiCreatePlanarCircle`、`SmApiGetClosestPoint`、`SmApiIntersectCurveSurface`、`SmApiReadPartFromFile`（返回 boolean tree nodes）、`SmApiEvaluateCurve`、`SmApiEdgeTangent`。

---

## 8. ✅ 核实无误（避免全盘否定）

- **OCCT 方法名全部真实**：对 209 个去重方法逐个比对，方案出现的方法名无虚构。
- **§4 引用的 faijs 现有符号真实存在**：`assertEngineFor` / `E_BREP_UNSUPPORTED` / `getConfiguredBrepEngineId` / `BrepEngineApi` 在 `packages/core/src/api`、`runtime-state.ts`、`sdk.ts` 中均存在（门禁复用方案可行）。
- **§1 范式判断大体成立**：SMLib 无显式 vertex/edge/wire 构造 API、无 compound 容器类型、无批量 `*Batch` 族 —— 这些结论与源码一致。
- **`SmApiRotate` 第四参为度**：与头文件一致，方案第 122 行「度/弧度换算」标注正确。
- **STL「桥未接」状态**（见 §4）：属实。
- **`thicken` SMLib 无对应**：属实（§2.2 第 204 行 occt-only 正确）。

---

## 9. 建议的修改顺序（落到设计文档时）

1. **先修 SMLib 事实错误**：§1 第 25 行、§2.2 第 201 行（历史追踪）；§2.1 第 92 行（`SmApiCut` 错归布尔差）；§2.2 第 197 行（`halfSpace` 不应简单判 occt-only）；§3 第 1 项（`split` 的 imprint 等价）。
2. **补配对表**：把 §2.1–§2.10 的 10 组配对显式写入，含 `surfaceType`/`vertexPosition` 两个被完全漏掉的（§2.3、§2.4）。
3. **修数字**：§0 第 11/12 行、§2.2 第 201 行、§0/§4.3 的桥 include 说法、§4.3 第 262 行清单（删 5 项已实现的）。
4. **修 STL 名字**（§4）：`SmApiImportStlEx`/`SmApiExportStlEx`，保留桥未接。
5. **统一命名与（桥）标注**，解决 §6.1–6.3 的交叉重复与口径冲突；落实 §2.2 第 214 行备注（补行或删备注）。
6. **补遗漏能力**：§7 列出的 OCCT 8 项 / SMLib 6+ 项入对应表。
7. 改完建议附一份逐条 diff 说明。

---

## 附：核查证据索引（可复现）

- OCCT 方法全集：`node_modules/occt-wasm/dist/index.d.ts`（去重 209；`*WithHistory` 12 个；`surfaceType`/`vertexPosition`/`outerWire`/`makeSolid`/`makeCompound`/`halfSpace`/`intersectionCells`/`reverseShape`/`hasTriangulation` 均存在）。
- SMLib 导出全集：`C:/git/new/usd-brep/source/SM_API/inc/*.h`（`SMAPI_EXPORT` 宏 194 次；去重函数名 133）。
- SMLib 历史追踪：`C:/git/new/usd-brep/source/SMLib/inc/SmTrackTopologyChanges.h`；桥实现 `wasm-probe/src/SmApiBridgeEx.cpp:665`（BooleanWithHistoryEx）、`:703`（FilletWithHistoryEx）。
- 桥导出清单：`wasm-probe/src/SmApiBridgeEx.cpp`（`unsigned int SmApi*` 共 40 个 `*Ex`；include 11/16 个 SM_API 头；无 STL/Step/ImportExport/Polygons/TessellationParams 封装）。
- SMLib 关键签名：`SmApiBrep.h`（`SmApiCut` 平面切、`SmApiBooleanWithOptions` 的 `bImprinting`/`bImprintAndClassifyFaces`）、`SmApiQueries.h:336`（`SmApiVertexGetPoint`）、`SmApiStlIo.h`（`SmApiImportStlEx`/`SmApiExportStlEx`）。
