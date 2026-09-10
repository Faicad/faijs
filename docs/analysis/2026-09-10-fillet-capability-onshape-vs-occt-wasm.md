# 圆角能力对照分析：Onshape FeatureScript vs occt-wasm vs faijs 现状

> 分析对象：`C:\git\new\onshape\onshape-std-library-mirror`（Onshape FeatureScript 标准库镜像）
> 与本项目 BREP 内核 `occt-wasm@3.8.4`。
> 目的：回答「成熟 CAD 的圆角为什么会分化出这么多形态」以及「本项目哪些能做、怎么做、卡在哪一层」。
> 本文只做能力盘点与结论，不含实施步骤。

## 用户原始需求（原话）

1. 「分析代码，现在写.fai.js脚本代码的时候，除了倒角chamfer，支持圆角吗？」
2. 「现在，写一份开发计划文档，我需要给.fai.js脚本提供圆角fillet的功能，并且在../3d_editor项目完成对应的UI功能。你可以参考chamfer的设计开发，核心是设计好fillet的接口api，注意边拓扑的问题。此外，目前cq-compat里的cadquery兼容的边选择器语法，能够用在.fai.js自己的倒角、圆角的边选择中吗？」
3. 「分析项目C:\git\new\onshape\onshape-std-library-mirror，为何它的圆角有那么多变化，哪些本项目可以支持，occt-wasm底层支持哪些api参数」

## 结论摘要（TL;DR）

1. **Onshape 的圆角不是"设计出来的功能矩阵"，而是内核参数的直曝 + 失败场景驱动的补丁堆。**
   `fillet.fs:476` 一句 `opFillet(context, topLevelId, definition)` 把整张 definition 交给闭源内核，
   FeatureScript 层几乎不做几何，只做 UI 声明与参数预处理。
2. **occt-wasm 只绑定了 4 个圆角入口**（`fillet`、`filletBatch`、`filletVariable`、`filletWithHistory`），
   限制来自 **wasm 绑定层**，不是 OCCT 本身（`BRepFilletAPI_MakeFillet` 的 `SetFilletShape`、
   带参数区间的 `SetRadius`、多点 law 均未绑定）。
3. **本项目可干净支持：等半径边圆角（带命名演化）、沿边线性变半径、改半径重放。**
   其余（非对称、CONIC/CURVATURE 截面、部分圆角、相切传播、完整圆角、面圆角）在 occt-wasm 现版本上做不到，
   要么得给 wasm 加 C++ 绑定，要么得在 faijs 侧自己拼（成本高且语义不等价）。
4. **两条本次调研发现的现状事实，直接影响实施成本**（详见 §5）：
   - vendored 的 `fillet()` 会把 `[r1,r2]` / 函数半径**静默降级为第一个值**（`helpers.ts:132-141`）；
   - faijs 的 `BrepEngineApi` 尚未声明任何 fillet 方法，但**运行时 kernel 对象上 `fillet` / `filletVariable` /
     `filletWithHistory` 全都在**（`occtWasmAdapter.ts:677/719/1011`），因为入口处是
     `as unknown as BrepEngineApi` 强转，编译期守卫穿透。

---

## 1. 为什么 Onshape 的圆角有那么多变化

### 1.1 表层原因：内核能力直曝

`fillet.fs` 的 feature 定义是一份**声明式 UI 规格**（`annotation { "Name": …, "Default": … }` 直接写在
参数声明上），几何实现全在 `opFillet` 里：

| 位置 | 内容 |
|---|---|
| `fillet.fs:476` | `opFillet(context, topLevelId, definition)` — 等半径/变半径边圆角，整个 definition 直接传入 |
| `fillet.fs:422` | `opFullRoundFillet(context, topLevelId, definition)` — 完整圆角，独立内核 op |
| `faceBlend.fs:270` | `opFaceBlend(context, id, definition)` — 面圆角，又一个独立内核 op |
| `geomOperations.fs:721/800/677` | 三个 `op*` 的 `@` 原生声明（闭源实现，只暴露签名） |

也就是说：UI 面板上每一个开关，背后都对应内核 definition 里的一个键。**内核有多少参数，UI 就有多少开关**，
FeatureScript 层没有"替用户做决定"的收口。

### 1.2 深层原因：圆角是"最高频 + 最容易失败"的操作

每个额外参数都对应一类具体的失败场景或工程需求：

| 形态 | 行号 | 解决什么问题 |
|---|---|---|
| `FilletType: EDGE / FULL_ROUND` | `fillet.fs:44-50` | 三面夹一面的特殊形状（完整圆角） |
| `BlendControlType: RADIUS / WIDTH` | `blendcontroltype.gen.fs` | 装配按**弦宽**标注而非半径的场景 |
| `FilletCrossSection: CIRCULAR / CONIC / CURVATURE`（+ 隐藏的 `CHAMFER`） | `filletcrosssection.gen.fs` | 外观件 / A 级曲面的截面形状控制 |
| 变半径 `vertexSettings` + `pointOnEdgeSettings` | `fillet.fs:271-341` | 半径太大放不下时局部收小 |
| 部分圆角（`PERCENTAGE / ENTITY / OFFSET` 三类起止边界） | `fillet.fs:196-262` | 边的一端不想圆 |
| `allowEdgeOverflow` + `keepEdges` | `fillet.fs:347-365` | 圆角吃掉相邻小面时保留指定边 |
| `smoothCorners` + `smoothCornerExceptions` | `fillet.fs:366-374` | 三边交角处几何脏 |
| `tangentPropagation` | `fillet.fs:391`（默认值表） | 一次选边自动扩到相切链 |
| 面圆角 `faceBlend`（独立 feature） | `faceBlend.fs:270` | 输入模型不同：面集而非边集 |
| 半径/宽度的 3D 拖拽手柄 | `edgeBlendCommon.fs:84-142` | 交互调参（manipulator） |

### 1.3 还有一个原因：历史堆积

`fillet.fs` 里有 6 处 `isAtVersionOrLater` 版本门：

```
433  V2479_PF_ADDED_ENTITY_END_CONDITION        部分圆角支持"实体"作为终止边界
445  V1917_PARTIAL_FILLET_FIX_CHAIN_OF_EDGES    部分圆角修边链
449  V1968_PARTIAL_FILLET_CHECK_INVALID_BOUNDS  部分圆角非法边界检查
470  V575_SHEET_METAL_FILLET_CHAMFER            钣金感知圆角
601  V1968（同上，另一处）
886  V2502_PF_INVALID_OFFSET_FIX                OFFSET 边界参数越界修正
```

含义：这些参数是**逐版本被客户案例堆上去的**，不是一次性设计。`fillet.fs:459-461` 还留了一句注释，
坦白 `variableFilletArcLengthParameterization` "不是 feature 参数，只是借 definition 传给 server"——
这是典型的补丁式扩展痕迹。

### 1.4 顺带：边界常量的来源

- `valueBounds.fs:346` `BLEND_BOUNDS = { (meter): [1e-5, 0.005, 500], (millimeter): 5.0, … }`
- 3d_editor 的 `src/stores/tools/chamfer-store.ts:23-25`
  `DEFAULT_CHAMFER_WIDTH = 5 / MIN 0.01 / MAX 500`，注释写明 "Onshape BLEND_BOUNDS-inspired"。
  即：mm 下界 `1e-5 m = 0.01 mm`、默认 `5 mm`、上界 `500 m → 500`（单位换成 mm 后数值对齐，量级含义已变）。
  **圆角 UI 应沿用同一组边界**，与倒角保持一致的手感。

---

## 2. Onshape 圆角的完整维度清单

### 2.1 正交维度

| 维度 | 取值 | 定义位置 |
|---|---|---|
| 圆角类型 | `EDGE` / `FULL_ROUND` | `fillet.fs:44-50`（`@internal`） |
| 控制量 | `RADIUS` / `WIDTH` | `blendcontroltype.gen.fs` |
| 截面形状 | `CIRCULAR` / `CONIC`(rho) / `CURVATURE`(magnitude) / `CHAMFER`(hidden) | `filletcrosssection.gen.fs` |
| 是否变半径 | `isVariable` + `vertexSettings[]` + `pointOnEdgeSettings[]` | `fillet.fs:264-341` |
| 非对称 | `isAsymmetric` + `otherRadius` + `flipAsymmetric` | `edgeBlendCommon.fs:57-78` |
| 部分圆角 | `isPartial` + `startPartialType` / `endPartialType` ∈ `PERCENTAGE`/`ENTITY`/`OFFSET` | `fillet.fs:196-262` |
| 溢出与保留 | `allowEdgeOverflow` + `keepEdges` | `fillet.fs:347-365` |
| 角落平滑 | `smoothCorners` + `smoothCornerExceptions` | `fillet.fs:366-374` |
| 相切传播 | `tangentPropagation` | `fillet.fs:391`（默认 `false`） |
| 弧长参数化 | `variableFilletArcLengthParameterization` / `partialArcLengthParameterization` | `fillet.fs:459-461`、`fillet.fs:430` |

### 2.2 `edgeBlendCommon.fs` 的两个公共选项

```fs
// edgeBlendCommon.fs:31-45 —— 只处理非圆形截面
predicate edgeFilletCommonOptions(definition)
    CONIC     → isReal(definition.rho,       FILLET_RHO_BOUNDS)
    CURVATURE → isReal(definition.magnitude, FILLET_RHO_BOUNDS)

// edgeBlendCommon.fs:50 —— 只有 RADIUS+CIRCULAR 才走 definition.radius
function radiusIsCircular(definition)
    = blendControlType == RADIUS && crossSection == CIRCULAR

// edgeBlendCommon.fs:57-78 —— 非对称，且仅 RADIUS 控制量下可用
predicate asymmetricFilletOption(definition)
    isAsymmetric → otherRadius (BLEND_BOUNDS) + flipAsymmetric
```

配套常量：`CHAMFER_ANGLE_BOUNDS = (degree)[0.1, 45, 179.9]`（`edgeBlendCommon.fs:23`）。

### 2.3 变半径的两类锚点（`fillet.fs:271-341`）

| 锚点 | 字段 | 说明 |
|---|---|---|
| 顶点 | `vertexSettings[].vertex`（Query, VERTEX）+ `vertexRadius` | 语义 = 与该顶点相邻的边在此端的半径 |
| 边上内点 | `pointOnEdgeSettings[].edge` + `edgeParameter`（实数，按 `FS_VARIABLE_RADIUS_ARC_LENGTH_PARAMETERIZATION` 参数化）+ `pointOnEdgeRadius` | 边上任意内点给半径 |

两者都随 `isAsymmetric` / `crossSection` 追加 `OtherRadius` / `flipAsymmetric` / `variableRho` /
`variableMagnitude`。组末尾还有 `smoothTransition`（过渡平滑）。

### 2.4 部分圆角（`fillet.fs:196-262`）

三层结构：`isPartial` → `startPartialType`（起端）→ `secondBound` → `endPartialType`（末端）。
每端的三类边界：`OFFSET`（长度偏移）、`ENTITY`（选一个面或顶点做切割边界，附带 `useTrimmed*Bound`）、
`PERCENTAGE`（沿边参数 0–1）。

**关键：部分圆角在 Onshape 里也不是纯内核能力。** `fillet.fs:427-436` 先由
`generatePartialFilletData()` 算出 `partialFilletBounds` / `partialFilletCapBounds` /
`filterEntities` / `facesToDelete`，`opFillet` 之后再用 `opDeleteFace` 收尾（`fillet.fs:513-522`，
参数 `includeFillet:false, capVoid:false, leaveOpen:false`）。即 **"切割 + 圆角 + 删面"的 FS 层组合**。

### 2.5 面圆角 `faceBlend`（独立 feature）

`faceBlend.fs:270` 调 `opFaceBlend`。输入不是边集而是**两个面集**（face set 1 / face set 2），
配套四个枚举：

| 枚举 | 取值 |
|---|---|
| `FaceBlendCrossSection` | `ROLLING_BALL` / `SWEPT_PROFILE` |
| `FaceBlendCrossSectionShape` | `CIRCULAR` / `CONIC` / `CURVATURE` / `CHAMFER` |
| `FaceBlendPropagation` | `TANGENT` / `ADJACENT` / `CUSTOM` |
| `FaceBlendTrimType` | `WALLS` / `SHORT` / `LONG` / `NO_TRIM` |

**本质区别：输入模型不同（面集 vs 边集），是另一条内核管线。** 不能当"边圆角的一个选项"实现。

### 2.6 倒角对照（说明 faijs 现状的位置）

| 枚举 | 取值 | 定义 |
|---|---|---|
| `ChamferType` | `EQUAL_OFFSETS` / `TWO_OFFSETS` / `OFFSET_ANGLE` / `RAW_OFFSET`(hidden) | `chamfertype.gen.fs` |
| `ChamferMethod` | `FACE_OFFSET` / `APEX_RANGE` | `chamfermethod.gen.fs` |

`occt-wasm` 恰好提供 `chamfer` / `chamferDistAngle`（对应 `EQUAL_OFFSETS` / `OFFSET_ANGLE`），
faijs 用 `chamferDistAngle` 逐边换算实现 `TWO_OFFSETS`——**即 faijs 的倒角能力已与 Onshape 三形态对齐**，
只差 `ChamferMethod`（度量口径：面偏移 vs 顶点范围）这一项。圆角则差得远。

---

## 3. occt-wasm 底层到底给了什么（v3.8.4）

JS 层（`node_modules/occt-wasm/dist/index.d.ts`）与 wasm 绑定层（`raw-types.d.ts`）两边一致，
**只有 4 个圆角入口 + 1 个可间接用于去圆角的能力**：

| API | index.d.ts | raw-types.d.ts | 签名 |
|---|---|---|---|
| `fillet` | :135 | :142 | `(solid, edges: ShapeHandle[], radius: number) → ShapeHandle` |
| `filletBatch` | :241 | :196 | `(ops: {solid, edges, radius}[]) → ShapeHandle[]`（多实体批量，每个 op 一个半径） |
| `filletVariable` | :455 | :274 | `(solid, edge: ShapeHandle, startRadius, endRadius) → ShapeHandle`（**单边**，沿边线性） |
| `filletWithHistory` | :461 | :279 | `(solid, edges, radius, inputFaceHashes: number[], hashUpperBound) → EvolutionData` |
| `defeature` | :452 | :271 | `(shape, faces[], tolerance)`，注释明写 "Remove complete features such as holes, bosses, chamfers, or fillets and heal"（**可用于移除圆角**） |

### 3.1 关键判断：限制在绑定层，不在 OCCT

C++ 的 `BRepFilletAPI_MakeFillet` 提供：

- `SetFilletShape(RATIONAL | QUASI_ANGULAR | POLYNOMIAL)` → 即 conic / curvature 截面；
- 带沿边参数区间的 `SetRadius(...)` → 即部分圆角；
- 多点 law（`Law_Function`）→ 即多锚点变半径。

**occt-wasm 一个都没绑定。** 所以"CONIC 截面能不能做""部分圆角能不能做"的成本在 occt-wasm 的 C++ 侧，
faijs 侧无论怎么写 JS 都突破不了。这决定了下面的支持矩阵。

### 3.2 与 cad 脚本面的关系

`fillet` 的 `edges` 参数是 **Edge 句柄数组**（`ShapeHandle[]`），没有"按几何谓词选边"的入口。
这正是圆角迟迟没进 `.fai.js` 脚本面的根因：脚本面 v1 不投子形状，脚本里表达不了"选哪些边"。
倒角之所以能进，是因为它改用 faijs 的 role 命名体系（`EdgeTopoRef`，相邻两面的 role 对）绕开了句柄。

---

## 4. faijs 侧现状盘点

| 层 | 位置 | 状态 |
|---|---|---|
| wasm 内核 | `occt-wasm@3.8.4` | ✅ 4 个圆角 API 齐全（§3） |
| brepjs kernel 适配器（vendored） | `occtWasmAdapter.ts:677 fillet` / `:719 filletVariable` / `:1011 filletWithHistory` / `:1029 chamferWithHistory` / `:733 defeature` | ✅ **运行时均已存在** |
| faijs 引擎接口 | `brep/engine/primitives.ts:58 chamfer`、`:63 chamferDistAngle` | ❌ **fillet 系列零声明** |
| mock 引擎 | `brep/engine/adapters/brep-mock.ts:139/143` | ❌ 只有 chamfer 桩，无 fillet 桩 |
| TS 兼容面投影 | `api/generated/topology.ts:413` `compatOp(projectBrepOp('fillet', ['shape','edges','radius'], 'A', __vendored_fillet))` | ✅ 已生成 |
| 投影登记 | `api/surface/arg-spec.ts:2799-2804` | ⚠️ 有条目但**未标 scriptFace**，故未进脚本面 |
| 脚本面（cad 命名空间） | `lang/symbol-table.generated.ts` | ❌ 无 `fillet` |
| 3d_editor | — | ❌ 无圆角 UI（倒角 UI 齐全，可参照） |

### 4.1 待修正：vendored 的 `fillet()` 会静默丢掉第二个半径

`vendored/brepjs/kernel/occtWasm/modifierOps.ts:18-33` 的 `fillet()` 签名宣称支持
`number | [number, number] | ((edge) => number | [number, number])`，但内部先过
`resolveUniformRadius()`（`helpers.ts:132-141`）：

```ts
if (typeof radius === 'number') return radius
if (Array.isArray(radius)) return radius[0]          // ← r2 被丢弃
if (edges.length === 0) throw …
const val = radius(edges[0])                          // ← 只问第一条边
return typeof val === 'number' ? val : val[0]         // ← r2 被丢弃
```

含义：**所有经由 vendored `fillet()` 的调用，实际只能是统一半径**；`[r1,r2]` 与 per-edge 函数形态
都被静默降级，第二个半径无声无息消失。这正是 `api/generated/topology.ts:413` 投影的底层实现。
⇒ 变半径必须走 `filletVariable` / 直接调 `k.filletVariable`，**不能复用这条 vendored 路径**；
且若将来 TS 兼容面要暴露 `[r1,r2]`，必须先修 `resolveUniformRadius` 的降级行为（或显式报错）。

### 4.2 待注意：编译期守卫对运行时方法存在性无效

`initOcctWasm()`（`occt-kernel/occtKernel.ts:87`）内部以 `as unknown as BrepEngineApi` 返回 kernel 实例；
`brep/engine/adapters/occt.ts:67` 的 `AssertSatisfiesBrepEngineApi<…>` 断言的是
`initOcctWasm` 的**声明返回类型**，而该类型是强转得来的 —— 因此
**在 `BrepEngineApi` 里加一个方法，编译器不会告诉你运行时 kernel 上到底有没有**。

这对 fillet 是利好也是风险：利好是 `fillet` / `filletVariable` / `filletWithHistory` 在 kernel 对象上
**已经存在**（`occtWasmAdapter.ts:677/719/1011`），加上接口声明即可用；风险是这条路径没有类型兜底，
必须靠**实跑测试**（而非 typecheck）确认签名对得上（尤其 `filletWithHistory` 返回 `EvolutionData`，
与 `boolean.ts` 的 `decodeEvolution` / `propagateAllOrigins` 串接需要验证）。

---

## 5. 可支持矩阵

| Onshape 维度 | 能否支持 | 路径 / 阻塞原因 |
|---|---|---|
| 等半径边圆角 | ✅ | `kernel.filletWithHistory` + `decodeEvolution` + `propagateAllOrigins`（与 `boolean.ts:40-74` 同构），保住 role 命名 |
| 等半径（无命名演化，快路径） | ✅ | `kernel.fillet`；代价：后续按 role 选面/边退化 |
| 沿边线性变半径 | ✅ | `kernel.filletVariable(solid, edge, r1, r2)`，**单边**；无 history 版本 ⇒ 命名必须显式降级 |
| 顶点半径 `vertexSettings` | ⚠️ 可翻译 | 展开为"与该顶点相邻的边"的 `filletVariable` 端点值；需要顶点→邻边查询（faijs 侧要有 `getSubShapes(vertex,'edge')` 一类能力，待确认） |
| 边上内点半径 `pointOnEdgeSettings` | ❌ | 只能给 start/end 两端，`SetRadius` 的参数区间未绑定 |
| 不同边不同半径 | ⚠️ 分组多次调用 | 按半径分组每组一次 `fillet`；**不要**指望 `resolveUniformRadius` 的 per-edge 函数形态（§4.1 已证其被降级） |
| 非对称双半径 | ❌ | Parasolid 私有能力，OCCT `MakeFillet` 无对应 |
| `CONIC`(rho) / `CURVATURE`(magnitude) 截面 | ❌ | 需 occt-wasm 加 `SetFilletShape` 绑定 |
| `WIDTH` 弦宽度量 | ⚠️ 上层换算 | 已知两面夹角可换算；但圆角宽度沿曲面度量，仅平面邻面精确（误差需显式告知用户） |
| 部分圆角（起止边界） | ❌ | 需沿边参数区间的 `SetRadius`；Onshape 自己也是 `opSplitPart`+`opDeleteFace` 拼的（`fillet.fs:513-522`），faijs 无对应切割/删面能力 |
| 相切传播 `tangentPropagation` | ❌ | 需相切链查询能力，occt-wasm 未暴露 |
| 完整圆角 `FULL_ROUND` | ❌ | OCCT 无对应 API |
| `allowEdgeOverflow` / `keepEdges` / `smoothCorners` | ❌ | 内核私有行为开关 |
| 面圆角 `faceBlend` | ❌ | 输入模型不同（面集），OCCT 无对应 |
| **改半径**（modifyFillet 的 `CHANGE_RADIUS`） | ✅ 天然支持 | `.fai.js` 即模型，改 `radius` 重放即可 —— 比 Onshape 的 `opModifyFillet` 更自然 |
| **移除圆角**（`REMOVE_FILLET`） | ⚠️ | 可用 `defeature`（`index.d.ts:452`），但需先给 `BrepEngineApi` 加接口 + mock 桩 |
| 多实体批量圆角 | ✅ | `filletBatch`（`index.d.ts:241`），faijs 侧未接 |

---

## 6. 对 fillet API 设计的建议（供开发方案采纳）

1. **V1 只做两种形态：等半径 + 沿边线性变半径。** 不要抄 Onshape 的面板矩阵——那些开关在我们这条
   内核链上大部分是死路，抄进来只会做出"UI 有、内核没有"的假能力。
2. **不设 `type` 字段。** 倒角需要 `type` 是因为三种形态吃不同参数槽；圆角两种形态都落在 `radius`
   一个槽上，用 `radius` 的数值形态（`number` vs `[r1,r2]`）区分即可，脚本更短。
3. **不同边不同半径用多条语句表达，不要在一条语句里塞复杂结构**：

   ```js
   const p1 = cad.fillet(p0, { edges: [e1], radius: 2 })
   const p2 = cad.fillet(p1, { edges: [e2], radius: 5 })
   ```

   这符合"`.fai.js` 即模型"的定位，且每条语句自带一次命名演化，比单语句多半径的演化串接干净得多。
4. **圆角一律走 `filletWithHistory`**（等半径），与倒角一并修掉"倒角后丢 role 命名"的问题，
   否则会出现"倒角后能选边、圆角后不能"的不一致。**变半径路径没有 history 版本，必须显式降级为
   "不产出 roleTable"，并在 UI 确认前提示用户**，绝不能拿旧 role 去错指新拓扑。
5. **边界沿用倒角**：默认 5 mm、下界 0.01 mm、上界 500（源自 `valueBounds.fs:346` 的 `BLEND_BOUNDS`，
   与 `chamfer-store.ts:23-25` 一致）。
6. **OCCT 半径放不下时的 `OcctError` 必须在引擎边界回译为明确的 faijs 错误码**
   （如 `E_FILLET_RADIUS_TOO_LARGE`），不许裸冒到脚本层。这是圆角最高频的失败场景——
   Onshape 之所以要变半径、部分圆角、溢出保留，八成都是为了绕它。
7. **若将来真要 CONIC 截面或部分圆角，先评估给 occt-wasm 加 C++ 绑定的成本**，那不是 faijs 侧能解决的事。

## 7. 待确认项

1. 顶点 → 相邻边的查询能力在 faijs/occt-wasm 侧是否具备（决定 `vertexSettings` 类语义能否翻译）。
2. `defeature` 是否值得为"移除圆角"接入（取决于 UI 是否需要反向编辑）。
3. `filletWithHistory` 返回的 `EvolutionData` 与 `propagateAllOrigins` 的字段契约，需实跑验证
   （§4.2 类型守卫穿透，typecheck 不兜底）。
