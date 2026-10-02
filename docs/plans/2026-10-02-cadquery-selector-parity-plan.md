# CadQuery 选择器完整支持方案（顶点点选择器 + 字符串语法全量 + 选择器探针通道）

> 状态：**方案已定，待实施**。依据为 `packages/core`、`packages/faijs-cadquery`、`packages/cq-compat-assembly` 的当前源码，以及 `C:\git\CADQ\cadquery`（HEAD `a637795`，v2.8.0 线）的 `selectors.py` / `cq.py` / `tests/test_selectors.py`。
> 范围：`packages/core`（选择器子系统扩展）、`packages/faijs-cadquery`（接线与去重）、`packages/faijs-cadquery/tests`（新增验证通道）。
> 本文只陈述**当前源码事实**与**目标设计**，不复述历史方案、不引用任何 plan 文档作为现状依据。

---

## 1. 目标与已定口径

让 faijs 对 CadQuery 拓扑选择器的支持达到**语义完整并可被验证**，而不是"在封闭盒体上碰巧一致"。

四项口径已裁决（2026-10-02）：

| 编号 | 决策点 | 结论 |
|---|---|---|
| D1 | 验证通道 | **新增「选择器探针」参考通道**：python 侧把每条用例的选择结果（选中实体类型/中心，保序）落 JSON，候选侧跑同一表达式做结构化差分。现有 STEP 通道看不见进程内选择结果（见 §2.4），必须补这条 |
| D2 | 本版范围 | **字符串语法全量**，作用于 `face` / `edge` / `vertex`：`>` `<` `>>` `<<` `\|` `#` `+` `-` `%type` `[k]`索引、多轴 `XY/XZ/YZ`、`(x,y,z)` 向量、六个命名视图、`and`/`or`/`exc`(`except`)/`not` 与括号嵌套；含 `.faces("+Z").vertices("<XY")` 这类**逐级收窄**。对象选择器类（`NearestToPoint`/`Box`/各 `*Nth`）与 `wires()`/`shells()`/`solids()` 目标类型**不在本版** |
| D3 | 选择集语义 | **保持挂起模型 + 逐级收窄**：沿用 `Workplane` 上"挂起选择器"的现有形态（不推翻 `workplane()` / `eachpoint` / `fillet` 的消费方式），但补上"上一级选择结果作为下一级候选集"的收窄语义 |
| D4 | 重复实现 | **统一到 core 子系统**：`shape-class.ts` 的 `TypeSelector`/`DirectionSelector`/`NearestToPointSelector`/`StringSyntaxSelector` 以及 `workplane.ts` 内三处私有选择器解析，一律收口到 `core/src/api/cadquery-selectors/` 的同一份实现 |
| D5 | 测试覆盖 | **每条已实现语法都必须有案例，且由门禁机器校验**：优先移植上游 `tests/test_selectors.py` / `test_cadquery.py` 的现成用例；上游没有的形态（§5.5 表中标 `extra.*` 的行）自撰**轻量探针用例**，判据仅为「ref 侧实跑的选择结果 == 候选侧选择结果」 |

达成后：`.vertices(">Z")` 与 `.vertices()` 不再等价；`.faces("|Z")` 不再静默返回形状中心；`.faces("+Z").vertices("<XY")` 返回那张面的 4 个顶点里 `x+y` 最小的那个（`(0,0,1)`）；且**每条语义都有 ref 侧实跑数据做差分背书**，语法清单里不存在"实现了但没案例"的条目（§5.5 门禁强制）。

---

## 2. 现状取证（读当前源码）

### 2.1 三个目标类型的实现落差

| 目标 | 实现位置 | 实际支持 | 缺口 |
|---|---|---|---|
| face | `core/src/api/cadquery-selectors/face.ts`（`resolveFaceSelector`，返回单值 `{center, normal}`） | `>` `<` `+` `-` × `X/Y/Z`、`[-k]` 索引、多轴 `XY/XZ/YZ`、六个命名视图 | **无 `\|`、无 `#`、无 `%type`、无 `and/or/not/exc`**。`axisDir` 表（`face.ts:122-129`）不含 `\|Z` → `dir` 为 `undefined` → `if (handle && dir)` 分支被跳过 → 落到末尾 bbox 兜底（`face.ts:312-325`），末尾正则 `/^([<>+-])([XYZ])/` 也不匹配 → **返回 `{center: 形状中心, normal: [0,0,1]}`，不抛错**。`c.faces("\|Z").workplane()` 因此静默把原点放在形状中心 |
| edge | `core/src/api/cadquery-selectors/edge.ts`（`resolveEdgeSelection`，返回 handle 数组） | 仅 `\|X/\|Y/\|Z`、`#X/#Y/#Z`、空=全部 | 无 `>` `<` `+` `-`（方向 / 极值）、无索引、无 `and/or/not`。且 `#Z` 的实现是"bbox 中心沿轴取极大"（`edge.ts:44-50`），而 CadQuery 的 `#Z` 是 **`PerpendicularDirSelector`**（法向/切向与 Z 夹角 = π/2），两者在一般形状上不同源 |
| vertex | **无解析器**。`workplane.ts:3592-3607` 的 `vertices()` 只把字符串塞进 `wp.vertexSel`；全仓唯一消费点 `eachpoint`（`workplane.ts:3778-3783`）只判 `wp.vertexSel !== null` 就 `getSubShapes(shape,'vertex')` 枚举**全部**顶点，**字符串内容被完全忽略** | `.vertices(">Z")` ≡ `.vertices()` | 整条链缺失 |

`edge.ts` / `face.ts` 的多处近似（`>` `<` 不做"平行"前置过滤、并列用面积打破、`#Z` 用 bbox 极值、`>`/`<` 用"面心相对形状中心"猜外法向）在**箱体/棱柱**上与被映射的 CadQuery 语义重合，这是现有 49 个 `test_selectors` 镜像全绿的原因；一旦离开平面多面体就会分叉。

### 2.2 选择集模型：挂起但无收窄

`Workplane`（`workplane.ts:190-215`）用三个互斥字符串字段承载选择：`faceSel` / `edgeSel` / `vertexSel`。生产端每次调用都**清掉上一级**：

```
faces(wp, sel)    → clone(wp, { faceSel: sel, edgeSel: null, vertexSel: null })   // :3509
edges(wp, sel)    → clone(wp, { edgeSel: ...,  faceSel: null, vertexSel: null })  // :3583
vertices(wp, sel) → clone(wp, { vertexSel: ..., faceSel: null, edgeSel: null })   // :3606
```

而 CadQuery 的语义是**立即解析的对象栈**：`_selectObjects(type, sel)` = `newObject(_filter(_collectProperty(type), sel))`（`cq.py:771-790`），即"对**当前栈里每个对象**取该类型的子实体、并集、去重，再用选择器过滤"。所以 `c.faces("+Z").vertices("<XY")` 的候选集是**那张面的 4 个顶点**，不是整个实体的 8 个。当前模型在 `vertices()` 处丢掉 `faceSel`，收窄信息丢失。

已有的收窄特例只有一个：`resolveFaceEdgeSelection`（`edge.ts:87`，供 `.faces(">Z").edges().fillet()`）。它证明收窄在现模型里**可以实现**，只是没被推广。

`eachpoint`（`workplane.ts:3778-3796`）的 `faceSel` 分支同样是枚举**全形状**的面，不是被选中的面。

### 2.3 同一选择器语义在仓内的重复实现（D4 的取证）

| # | 位置 | 形态 |
|---|---|---|
| 1 | `core/src/api/cadquery-selectors/face.ts` | `resolveFaceSelector`（`>`/`<`/`+`/`-`/多轴/索引/命名视图） |
| 2 | `core/src/api/cadquery-selectors/edge.ts` | `resolveEdgeSelection`（`\|`/`#`）、`resolveFaceEdgeSelection` |
| 3 | `cq-compat/src/workplane.ts:3322` | `selectFaceHandles`（siblings 用；复制了 `>`/`<`/索引/命名视图 + 面积打破） |
| 4 | `cq-compat/src/workplane.ts:3358` | `selectEdgeHandles`（siblings 用；`\|` 用 bbox 严格零、`>`/`<` 用 bbox 极值） |
| 5 | `cq-compat/src/workplane.ts:4707` | `selectFaceHandlesForRemoval` |
| 6 | `cq-compat/src/shape-class.ts:255-407` | `TypeSelector` / `DirectionSelector`（`containsPoint` 消歧，仅面 + 居中射线）/ `NearestToPointSelector`（bbox 中心）/ `StringSyntaxSelector`（只认 `>X`/`<X` 与 `or`） |
| 7 | `cq-compat/src/sketch.ts:493` | `applyStringSelector`（2D 草图元素；目标类型不同，见 §4.9） |

同一个 `>Z` 现在有 4 套不同实现（#1/#3/#5/#6）；同一份 `|Z` 有 3 套。任何一处修语义，其余几处不会同步。

### 2.4 验证通道现状：STEP 比对看不见选择结果

现有流水线（`packages/faijs-cadquery/tests/README.md` 与源码）：

```
ref-harness/cq_step_plugin.py   # pytest 插件，AST 注入 try/finally + __CQ_EXPORT__(locals(), case_id)
                                #   只导出 Solid/Compound/CompSolid 的 STEP（:82-87，非实体直接 continue）
ref-harness/run-ref.py          # 按 baseline.json 的 tag 快照跑上游测试 → out/ref/*.step + manifest.json
tests/run-cand.ts               # 镜像 .fai.js → faijs CLI → out/cand/*.step
tests/compare.ts                # 配对比较 体积/质心/bbox/布尔差 + 拓扑计数 → PASS / PASS-NT / FAIL
tests/gen-manifest.ts           # 三态清单（ported / blocked / skipped）唯一事实源
```

**盲区**：该通道只比对"最终导出的那个实体"，进程内的选择结果完全不可见。证据：

- `out/report.json` 当前计数 `pass 294 / passNt 5 / fail 5 / blocked 346`，其中 `test_selectors` 相关 **46 条全部 PASS**；
- 但 46 个镜像文件里，凡涉及选择器断言的**全部**是同一形态——注释写明"选择是进程内断言，导出的是输入立方体"，正文只有 `let c = await cq.box(...)` + `let result = cq.val(c)`。例：`tests/test_selectors/TestCQSelectors__testVertexFilter__c.fai.js` 的注释是 `vertices("<XY") pick in-process; exports centred cube`；
- 所以 `vertices()` 是空操作，STEP 报告照样 PASS。**这不是误报，是通道的能力边界**——它按设计只验几何产物。

**镜像覆盖**：上游 `TestCQSelectors` 有 45 个 test 方法，`tests/test_selectors/` 下缺 16 个（无任何镜像文件）：`testVertices`、`testWorkplaneCenter`、`testEnd`、`testCompounds`、`testParallelPlaneFaceFilter`、`testGrammar`、全部 `testLengthNthSelector_*`（6 个）、全部 `testAreaNthSelector_Vertices/Edges/NestedWires/Faces`（4 个）。另有 1 个 `.blocked`（`testEdgeTypesFilter`，`blockedBy: kernel:ellipse-tall-axis`）。

`test_selectors.py` 里 `vertices(` 出现 35 次，`test_cadquery.py` 96 次。

### 2.5 参考环境现状

`tests/baseline.json` 锁定：`cadquerySrc=C:\git\CADQ\cadquery`、`cadqueryTag=v2.8.0`、`python=C:\Users\ylt\cadquery-env\Scripts\python.exe`、`ocp=cadquery-ocp 7.9.3.1.1`、`faijsOcct=occt-wasm ^3.8.0`。

**该 python 环境在本机不存在**（`C:\Users\ylt` 无此目录，本机用户为 `yuan_`；系统 python 无 `cadquery`）。`out/ref/` 里已有 651 个 ref STEP 与 `manifest.json` 存档可用，因此：

- 现有 STEP 比对**仍可离线复跑**（`run-cand.ts` + `compare.ts` 不需要 venv，只需 `out/ref`）；
- **新增探针通道需要重建一个 cadquery 2.8.0 环境**（见 §6 Phase 0）。这是本方案唯一的外部前置条件。

---

## 3. CadQuery 语义基线（对齐依据）

以下均取自 `cadquery/selectors.py`（896 行）与 `cadquery/occ_impl/shapes.py`，是设计的对齐目标。

### 3.1 算法（含 tolerance）

| 类 | filter 规则 | 适用对象 |
|---|---|---|
| `Selector` | 原样返回全部（恒等） | 任意 |
| `ParallelDirSelector(dir, tol=1e-4)` | `dir.cross(vec).Length < tol` | **仅** `ShapeType()=='Face' && geomType()=='PLANE'`（用 `normalAt(None)`）或 `=='Edge' && geomType()=='LINE'`（用 `tangentAt()`）；**其余一律 continue（跳过）**（`selectors.py:167-189`） |
| `DirectionSelector(dir, tol=1e-4)` | `dir.getAngle(vec) < tol`（`getAngle` 值域 0..π，**带符号敏感**） | 同上 |
| `PerpendicularDirSelector(dir, tol=1e-4)` | `abs(dir.getAngle(vec) - π/2) < tol` | 同上 |
| `TypeSelector(t)` | `o.geomType() == t.upper()` | 任意（比较前 upcase） |
| `CenterNthSelector(vec, n, directionMax=True, tol=1e-4)` | `key = Center().dot(vec)`；按 key 升序 **聚类**（相邻 key 差 ≤ tol 同簇）；`directionMax=False` 时整体 reverse；取 `clustered[n]`（**返回簇 = 列表**） | 任意 |
| `DirectionMinMaxSelector(vec, directionMax)` | 等价 `CenterNthSelector(vec, n=-1, directionMax)` | 任意 |
| `DirectionNthSelector(vec, n, directionMax)` | **先** `ParallelDirSelector(dir,tol).filter`，**再** `_NthSelector.filter`（`selectors.py:449-452`） | 面/边 |
| `AndSelector` / `SumSelector` / `SubtractSelector` | `set(left) & set(right)` / `set(left+right)` / `set(left) - set(right)` | 任意 |
| `InverseSelector(sel)` | `SubtractSelector(Selector(), sel)` | 任意 |

`_NthSelector.filter` 对空列表抛 `ValueError`，越界抛 `IndexError`（`selectors.py:307-319`）。

### 3.2 字符串语法（`_makeGrammar` / `_makeExpressionGrammar` / `_SimpleStringSyntaxSelector`）

**原子**（MatchFirst 顺序即优先级，`selectors.py:656-663`）：

| 语法 | 映射 |
|---|---|
| `direction` | `DirectionSelector(axes[dir])`（**裸 `X` 等价 `+X`**，`test_selectors.py:155` 断言） |
| `%type` | `TypeSelector(type)` |
| `[<>]direction [Optional([idx])]` | 无 idx → `DirectionMinMaxSelector(vec, op=='<'?False:True)`；有 idx → `DirectionNthSelector(vec, int(idx), minmax)` |
| `[>>\|<<]direction [Optional([idx])]` | 无 idx → `CenterNthSelector(vec, -1, op=='<<'?False:True)`；有 idx → `CenterNthSelector(vec, int(idx), minmax)` |
| `[\|#+-\|]direction` | `\|`→`ParallelDirSelector`；`#`→`PerpendicularDirSelector`；`+`→`DirectionSelector(v)`；`-`→`DirectionSelector(-v)` |
| 命名视图 | `DirectionMinMaxSelector(Vector, bool)`：`front=(0,0,1),True`、`back=(0,0,1),False`、`left=(1,0,0),False`、`right=(1,0,0),True`、`top=(0,1,0),True`、`bottom=(0,1,0),False`（`selectors.py:687-694`） |

- `direction` = `X|Y|Z|XY|XZ|YZ` 或 `(x,y,z)`（`floatn`，允许 `+`/`-` 与 `.5`/`5.` 形态）。
- 轴线表：`axes = {X:(1,0,0), Y:(0,1,0), Z:(0,0,1), XY:(1,1,0), YZ:(0,1,1), XZ:(1,0,1)}`（`selectors.py:678-685`，注意 `XY/XZ/YZ` 是**对角向量不是单位向量**）。
- index 语法 `lsqbracket + Optional("-") + Word(nums) + rsqbracket`；`int("".join(index.asList()))` → 支持 `[-2]`。
- 命名视图匹配是 **caseless 无关**（`one_of([...])` 默认不 caseless，但实现里另做了 `sel.trim().toLowerCase()` 归一，见现实现）；`%type` 的 `cqtype` 是 `caseless=True` + `upcase_tokens`。

**表达式层**（`selectors.py:770-819`）：pyparsing `infix_notation(atom, [(and,2,LEFT), (or,2,LEFT), (exc|except,2,LEFT), (not,1,RIGHT)])`，支持任意括号嵌套。`and`/`or`/`exc` 是 `reduce` 左结合，`not` 右结合。

**语法一致性清单**（`tests/test_selectors.py:1115-1147`，`testGrammar`）：

```
"+X "  "-Y"  "|(1,0,0)"  "|(-1, -0.1 , 2. )"  "#(1.,1.4114,-0.532)"  "%Plane"
">XZ"  "<Z[-2]"  "<<Z[2]"  ">>(1,1,0)"  ">(1,4,55.)[20]"  "|XY"  "<YZ[0]"
"front"  "back"  "left"  "right"  "top"  "bottom"
"not |(1,1,0) and >(0,0,1) or XY except >(1,1,1)[-1]"
"(not |(1,1,0) and >(0,0,1)) exc XY and (Z or X)"
"not ( <X or >X or <Y or >Y )"
```

这 23 条只断言"能解析通过"，**不依赖 ref 环境**，可直接做成 JS 侧断言。

### 3.3 `Center()` / `normalAt()` / `tangentAt()` / `geomType()` 的确切定义

| CadQuery | 定义 | 位置 |
|---|---|---|
| `Vertex.Center()` | 顶点本身坐标 | `shapes.py:1973` |
| `Mixin1D.Center()` | `BRepGProp.LinearProperties_s` 质心（边/线框） | `shapes.py:2257-2261` |
| `Face.Center()` | `BRepGProp.SurfaceProperties_s` 质心（**面积加权**） | `shapes.py:3435-3439` |
| `Face.normalAt(None)` | 面中心处法向（**带面朝向**） | `shapes.py:3348` |
| `Edge.tangentAt()` | 边中点处切向（符号随边参数方向） | `shapes.py:2175` |
| `Area()` / `Length()` / `radius()` | `SurfaceProperties` / `LinearProperties` / 圆参数 | `shapes.py:1106-1112` / `2264` / `2268` |
| `geomType()` | 面 → `geom_LUT_FACE`（11 值）；边 → `geom_LUT_EDGE`（9 值），输出**大写** | `shape_protocols.py:8-32` |

`geom_LUT_FACE`：`PLANE CYLINDER CONE SPHERE TORUS BEZIER BSPLINE REVOLUTION EXTRUSION OFFSET OTHER`；`geom_LUT_EDGE`：`LINE CIRCLE ELLIPSE HYPERBOLA PARABOLA BEZIER BSPLINE OFFSET OTHER`。

### 3.4 候选集语义（收窄的定义）

`_collectProperty(propName)`（`cq.py:227-255`）：遍历当前栈的每个对象 `o`，取 `o.<propName>()` 的子实体，用一个 **有序 set**（`dict`）去重后返回列表。

`_selectObjects`（`cq.py:760-790`）：`toReturn = _collectProperty(objType)` → `newObject(_filter(toReturn, selector))`。

**去重是语义的一部分**，不是优化。上游断言 `c.edges().vertices().size() == 4`（单位正方形线框：4 边共 4 个顶点，若不去重则为 8）。同理 `c.vertices().edges().size() == 0`（顶点的边集合为空）。

---

## 4. 设计

### 4.1 模块布局（core 侧）

`packages/core/src/api/cadquery-selectors/`（保持 D8 已确立的"独立物理边界"；不依赖 `api/topo-resolve.ts` 与 `topology/naming/`）：

```
cadquery-selectors/
├── index.ts          # 公开出口
├── types.ts          # EntityKind / SelStep / EntityView / Selection / SelectorExpr
├── borrow-bridge.ts  # 保留原样（asBrepShape 借用视图归一）
├── grammar.ts        # 新增：字符串 → 表达式 AST（tokenize + 递归下降；含 and/or/exc/not/括号）
├── descriptor.ts     # 新增：AST 原子 → 描述对象（修饰符 / 轴表 / 命名视图 / (x,y,z) / index）
├── entity.ts         # 新增：EntityView 投影层（handle → 选择器所需的几何量）
├── predicates.ts     # 新增：对齐 §3.1 的 filter 实现（按 desc 分派）
├── resolve.ts        # 新增：resolveSelection(shape, chain) → 候选集逐级收窄
├── face.ts           # 改：resolveFaceSelector 退化为 resolveSelection 的单面投影（签名不变）
├── edge.ts           # 改：resolveEdgeSelection / resolveFaceEdgeSelection 退化为投影
├── vertex.ts         # 新增：resolveVertexSelector + 顶点投影
└── selectors.test.ts # 新增：语法一致性 + 谓词语义 + 收窄语义
```

不放 pyparsing 移植依赖，也**不引入任何新 npm 依赖**——文法很小，手写递归下降即可（`grammar.ts` 约 200 行）。

### 4.2 表达式与描述对象

```ts
// types.ts
export type EntityKind = 'face' | 'edge' | 'vertex'

/** 一条选择器步骤：在候选集上按 kind 取子实体，再用 sel 过滤。 */
export interface SelStep { kind: EntityKind; sel: string }

/** 表达式 AST（grammar.ts 产出）。 */
export type SelectorExpr =
  | { op: 'atom'; desc: AtomDesc }
  | { op: 'and' | 'or' | 'exc'; terms: SelectorExpr[] }
  | { op: 'not'; term: SelectorExpr }

/** 原子描述（descriptor.ts 产出）。 */
export type AtomDesc =
  | { kind: 'dir';          vec: Vec3 }                       // 裸轴 / (x,y,z)
  | { kind: 'parallel';     vec: Vec3 }                       // |
  | { kind: 'perpendicular';vec: Vec3 }                       // #
  | { kind: 'signed';       vec: Vec3; sign: 1 | -1 }         // + / -
  | { kind: 'minmax';       vec: Vec3; max: boolean }         // > <
  | { kind: 'minmaxNth';    vec: Vec3; max: boolean; n: number }  // >A[k] <A[k]
  | { kind: 'centerNth';    vec: Vec3; max: boolean; n: number | null } // >>A >>A[k]
  | { kind: 'type';         name: string }                    // %TYPE（已 upcase）
  // 命名视图在 descriptor 层直接归一为 minmax，不单列
```

`descriptor.ts` 承载 `NAMED_VIEW` 表（`front/back/left/right/top/bottom` → `{vec, max}`）与 `AXES` 表（`X/Y/Z/XY/XZ/YZ` → 向量，**保持非单位**以对齐 `axes` 表；仅在需要处归一）。`%type` 的合法名限定为 §3.3 的两个 LUT 并集，大小写不敏感。

`grammar.ts` 的验收直接以上游 `testGrammar` 的 23 条表达式为准（§3.2），外加非法表达式必须抛错。同时 `grammar.ts` 导出 `SYNTAX_FEATURES`——**语法清单的唯一事实源**，§5.5.5 的覆盖门禁以它为分母，新增语法而不在此登记会自动失败。

### 4.3 实体投影层 `entity.ts`

选择器只依赖一组几何量，与实体类型解耦。投影层把 `BrepHandle` 映射到这些量（**注意 `Face.Center()` 是面积加权质心，不是 bbox 中心**）：

| CadQuery 需求 | 实现 | 备注 |
|---|---|---|
| `Vertex.Center()` | `getKernel().vertexPosition(v)` | 直接点 |
| `Edge.Center()` | `getLinearCenterOfMass(e)` | LinearProperties 质心 |
| `Face.Center()` | `getSurfaceCenterOfMass(f)` | SurfaceProperties 质心 |
| `BoundingBox()` | `getBoundingBox(h)` | 内核带 ±0.1mm 容差 padding（边实测膨胀约 0.2，见 `edge.ts:58-61`、`edge.ts:112-116`） |
| `Face.normalAt(None)` | `surfaceNormal(f, uMid, vMid)` + **朝向消歧** | `uMid/vMid` 取 `uvBounds(f)` 中点；**内核参数法向不携带面朝向**（`shape-class.ts:267-272` 已实测：两盒 4 个 X-thin 面全报 `+X`）。用 `containsPoint(owningSolid, c + n·ε)` 翻正（`shape-class.ts:307-319` 已验证该手法），ε = `min(ext) * 1e-3 + 1e-6` |
| `Edge.tangentAt()` | `curveTangent(e, pMid)`，`pMid` 取 `curveParameters(e)` 中点 | 符号随边参数方向（CadQuery 亦如此，见 §7 风险 R4） |
| `Face.geomType()` | `surfaceType(f)` → upcase | 需把内核小写 kind 映射到 LUT 名；`REVOLUTION`/`EXTRUSION`/`OFFSET`/`OTHER` 逐一对齐 |
| `Edge.geomType()` | `curveType(e)` → upcase | 同上 |
| `Face.Area()` | `getSurfaceArea(f)` | 本版仅 `%type` 与 tie-break 不用面积（§3.1 无面积打破，故不再用于选择） |
| `Edge.Length()` | `curveLength(e)` | 对象选择器类才需要，本版仅投影备用 |

投影结果做**按需惰性**计算（只在被谓词访问时算），因为 `>Z` 只需要 `Center()`，`|Z` 只需要 `normalAt`/`tangentAt`。

### 4.4 谓词层 `predicates.ts`

严格按 §3.1 实现，**不做任何 faijs 式近似**。三条必须写进代码注释与测试的差异点：

1. `parallel` / `perpendicular` / `signed` 对**非平面面**与**非直线边**一律跳过（`selectors.py:176-184` 的 `continue`），不是"取参数法向照算"。
2. `minmax` / `centerNth` / `minmaxNth` **不做**"垂直于轴"前置过滤，**不做**并列面积打破——纯粹按 `Center().dot(vec)` 聚类取簇。现有实现的两处近似（`face.ts:242-254`、`face.ts:288-292`）在此退役。
3. `minmaxNth` 是"**先平行过滤再取第 n 簇**"，与 `minmax` 不同源（`$>Z[-2]$` 与 `$>Z$` 走不同路径）。

`filter(expr, views, ctx)` 用集合运算组合：`and` → 交、`or` → 并、`exc` → 差、`not` → `全集 - 子集`（全集 = 传入的全部候选）。实体身份用内核 `hashCode`（或 `isSame`）做去重与集合键，与 §3.4 的有序 set 对齐。

### 4.5 候选集与逐级收窄 `resolve.ts`

```ts
export interface Selection { kind: EntityKind; handles: BrepHandle[] }

/**
 * chain 逐级收窄：
 *   resolveSelection(shape, [{face,'+Z'}, {vertex,'<XY'}])
 *     → 该 shape 的 +Z 面上的顶点中 x+y 最小的那些
 * 单步 chain 即为现有 resolveFaceSelector/resolveEdgeSelection 的语义。
 */
export function resolveSelection(shape: Shape, chain: SelStep[]): Selection
```

算法（对齐 `_collectProperty` + `_filter`）：

```
candidates: BrepHandle[] = [brepOf(shape)]     // 起点 = 整个 shape（一个"对象"）
kind = null
for step of chain:
    // ① 收集：对每个当前对象取 step.kind 子实体，并集去重（有序）
    //    首次（kind === null）即 shape 自身的 step.kind 子实体
    //    连续同 kind（.edges().edges()）→ 内核 getSubShapes(edge,'edge') 返回自身，恒等
    next = dedupByHash(flatMap(candidates, o => getSubShapes(o, step.kind)))
    // ② 过滤：按表达式在 next 上求值（谓词只依赖 EntityView）
    candidates = filter(parse(step.sel), views(next), ctx = shape)
    kind = step.kind
return { kind, handles: candidates }
```

- `step.sel` 为空串（`.vertices()` / `.edges()`）→ 不过滤，返回收集结果（CadQuery 的 `_filter` 在 selector 为 `None` 时原样返回）。
- 错误对齐 §3.1：空候选集上做 Nth → 抛错（`ValueError` 对应）；索引越界 → 抛错（`IndexError` 对应）。错误消息带 `[cq-compat]` 前缀以维持现有文本约定。
- 断链兜底：`brepOf(shape)` 为 `undefined`（无 BREP 链）时保留现有"整形状 bbox 兜底"行为（`face.ts:312-325`），以保证 mesh-only 场景下游不崩——**但 `|`/`#`/`%` 等需要真实面/边的选择器在无 BREP 时必须抛错**，不得静默返回形状中心。

### 4.6 兼容投影（签名不变）

对外三个兼容函数退化为薄投影，`cq-compat` 与 `cq-compat-assembly` 的下游不用改：

| 函数 | 新实现 |
|---|---|
| `resolveFaceSelector(shape, sel, centerOption?)` → `{center, normal}` | `resolveSelection(shape, [{face, sel}])` 取**簇内第一个**；`center` = 该面 `Center()`（`CenterOfMass`）或 `CenterOfBoundBox`；`normal` = 该面**真实外法向**（`normalAt` + 朝向消歧） |
| `resolveEdgeSelection(shape, sel)` → `handle[]` | `resolveSelection(shape, [{edge, sel}]).handles` |
| `resolveFaceEdgeSelection(shape, sel)` → `handle[]` | `resolveSelection(shape, [{face, sel}, {edge, ''}]).handles` |
| `resolveVertexSelector(shape, sel)` → `handle[]` | 新增；`resolveSelection(shape, [{vertex, sel}]).handles` |

> `resolveFaceSelector` 的 `normal` 从"轴向量"改为"真实外法向"是**有意为之**：`|`/`#`/`+`/`-` 只对平面面有意义，用轴向量无法表达；而单轴 `>Z` 的真实外法向在平面面上与 `[0,0,±1]` 一致，故 `workplane()` / `faceRef` 的行为不变。此点由探针 + 现有单测双向锁定（§5）。

### 4.7 cq-compat 接线

**`Workplane` 增一个字段**（不改现有三个）：

```ts
/** 选择链（CadQuery 栈语义）：每步收窄候选集。faces("+Z").vertices("<XY")
 *  => [{kind:'face',sel:'+Z'},{kind:'vertex',sel:'<XY'}]。 */
selChain?: SelStep[]
/** 派生于 selChain 的末位投影，供未改造的消费点复用（保持既有语义）。 */
faceSel / edgeSel / vertexSel   // 不变
```

- `faces/edges/vertices(wp, sel)`：写入/追加 `selChain`，并把 `faceSel`/`edgeSel`/`vertexSel` 按**末位同 kind 项**同步（单步 chain 时与现状字节等价；连续同 kind 时 `.faces(a).faces(b)` 取 b，对齐 CadQuery `_filter` 的单次过滤语义）。
- `eachpoint`：`selChain` 存在时改用 `resolveSelection(shape, wp.selChain)` 取候选集（**这是 `.faces(">Z").eachpoint()` 不再铺满全部面的修复点**）；否则保持现状（`pts` / 默认 origin）。
- `workplane()`：继续调 `resolveFaceSelector(wp.shape, wp.faceSel)`，`|Z`/`#Z`/`%PLANE` 从此走真实语义而非静默兜底。
- `fillet`/`chamfer`（`workplane.ts:4582-4625`）：`resolveEdgeSelection` 一行不改，内部改为走新引擎；`.faces(...).edges()` 分支改调 `resolveFaceEdgeSelection` 的新投影。
- 三处私有实现收口：`selectFaceHandles`（:3322）与 `selectEdgeHandles`（:3358）删除，改为 `resolveSelection(shape, [{face|edge, sel}])`；`selectFaceHandlesForRemoval`（:4707）同源改写（实施时先读全其调用链再动）。
- `CqShape` 类模型（`shape-class.ts`）的 `facesOf/shells/solids` 保留；其 4 个 Selector 类改为 core 实现的薄适配：`TypeSelector` / `DirectionSelector` / `ParallelDirSelector` / `PerpendicularDirSelector` / `DirectionSelector` / `CenterNthSelector` 均从 `@faicad/faijs/api/cadquery-selectors` 引入（`CqShape` → 内部 handle 的适配在 cq-compat 侧，core 不认识 `CqShape`）。
- `NearestToPointSelector` 属对象选择器类（不在 D2 范围）：**保留在 cq-compat**，但**改为用 `Center()` 语义**（当前用 bbox 中心，`shape-class.ts:346`）以对齐上游；`StringSyntaxSelector` 删除，改为委托 core 的语法引擎。

### 4.8 不在本版范围（显式记录，避免误读为"已支持"）

| 项 | 理由 |
|---|---|
| 对象选择器类：`NearestToPointSelector` / `NearestToShapeSelector` / `BoxSelector` / `RadiusNthSelector` / `LengthNthSelector` / `AreaNthSelector` | D2 裁决为字符串语法全量；这些类需 `distance()` / `radius()` / `Wire→Face` 面积等额外投影（`AreaNthSelector` 对闭合平面 Wire 要临时建面，`selectors.py:525-533`） |
| `wires()` / `shells()` / `solids()` 的选择器 | D2；`Wires` 的 `_collectProperty` 有 Solid→Compounds 特例（`cq.py:243-249`），单独一轮 |
| 2D 草图选择器（`sketch.ts:493 applyStringSelector`） | 目标不是 3D 拓扑实体（`>X` 作用于草图元素坐标），语义独立；本版只保证不回归 |
| `.all()` / `.end()` 等多对象栈 API | D3 裁决保持挂起模型；这些 API 需要真实对象栈，属结构性改造 |
| faijs 脚本面（`cad.*`）暴露选择器 | 选择器不是 op，不进 `defineOp` / `arg-spec`；`api/surface/arg-spec.ts:3080` 的 `vertex` skip 条目是另一个东西（2D 点构造） |

---

## 5. 验证设计

三条通道并行，缺一不可。

### 5.1 选择器探针通道（D1，新增）

**三段式**：同一份 **spec** 驱动两侧，各自产出同构 JSON，再做差分。

**(a) spec** — 新增 `packages/faijs-cadquery/tests/selectors-probe.json`（与 `manifest.json` 同为仓库事实源，人工维护）：

```json
{
  "tests.test_selectors::TestCQSelectors::testVertexFilter": [
    { "id": "testVertexFilter.faces+Z.vertices<XY",
      "root": "c", "chain": [["faces","+Z"],["vertices","<XY"]] },
    { "id": "testVertexFilter.c.vertices<XY",
      "root": "c", "chain": [["vertices","<XY"]] }
  ]
}
```

`chain` 用 `[方法名, ...实参]` 的**语言中立**形式，避免 python/JS 两套语法解析差异。`root` 指向上游用例里的具名局部变量（AST 注入的 `locals()` 已覆盖具名中间量，故 root 一定是可命名的）。

**(b) ref 侧** — 扩 `ref-harness/cq_step_plugin.py`：

- 新增环境变量 `CQ_PROBE_SPEC`（路径）；
- 在既有 `_export(mapping, case_id)` 内，对匹配本条 `case_id` 的 probe 条目：取 `obj = mapping[root]`，`reduce(lambda o, m: getattr(o, m[0])(*m[1:]), chain, obj)`，再对结果取 `vals()`；
- **投影**：每个实体记 `{ "type": ShapeType(), "center": Center().toTuple() }`，**保序**（索引语义依赖顺序）；
- 输出 `out/ref/selectors.json`：
  ```json
  { "testVertexFilter.faces+Z.vertices<XY":
    { "kind":"Vertex", "count":1, "picks":[{"type":"Vertex","center":[0,0,1]}] } }
  ```
- `run-ref.py` 透传 `CQ_PROBE_SPEC` 与输出路径。

**(c) cand 侧** — 新增 `tests/probe-cand.ts`：

- 读同一份 spec；
- 对每条条目，从对应镜像文件（`tests/<module>/<Class>__<test>__<var>.fai.js`，`root` 即镜像里的根变量名）生成 runner：镜像正文 + 探针尾（应用 `chain` 并打印 JSON）。runner 落 `out/probe-runners/`，用与 `run-cand.ts` 相同的 faijs CLI（`--mode brep`）执行；
- 尾调 `cq.__describeSelection(wp)`（新增的测试专用导出，薄封装 `resolveSelection` + `Center()`/`ShapeType` 投影），保证**两侧用同一投影定义**；
- 产出 `out/cand/selectors.json`。

**(d) 差分** — 新增 `tests/compare-selectors.ts`：

- 逐条比对 `count` 与 `picks`（顺序敏感）；
- `center` 容差：绝对 `1e-6`；
- 状态 `PASS` / `FAIL` / `MISSING-REF`（ref 侧没录到，计入分母但不算 PASS，与 `compare.ts` 的 `blocked` 诚实口径一致）；
- 输出 `out/selectors-report.md` + `.json`，并把命令补进 `tests/README.md`。

**通道有效性的自证**：Phase 0 完成、ref 数据录好后，第一次跑差分**必须在 `testVertexFilter` 上 FAIL**（当前 `vertices()` 是空操作、`.faces("+Z")` 不收窄）。能报出这个已知缺口，才证明通道真的看得见选择结果——这是一个正向验收项，不是失败。

**ref 数据的前置条件**：`baseline.json` 指向的 `C:\Users\ylt\cadquery-env` 在本机不存在，须先重建（`python -m venv` + 装 `cadquery==2.8.0` / `cadquery-ocp 7.9.3.1.1`，对齐 `baseline.json` 的锁定值），并把 `baseline.json.python` 改指实际路径（同一改动里同步 `cadqueryVersion` / `ocp` 字段以免口径漂移）。

### 5.2 in-process 断言（不依赖 ref 环境）

以下可直接在 `selectors.test.ts` / `compare`-free 地断言，是 Phase 1–2 的主验收（**局部不被 ref 环境阻塞**）：

- **语法层**：`testGrammar` 的 23 条表达式全部解析通过（§3.2 逐字照抄）；反向用例（`">"[0]`、`"|"`、`"(X"`、`">Z[]"`、`"not"`、`"%NOTATYPE"`）必须抛错。
- **语法层次不再混淆**：`>Z` 与 `>Z[-2]` 与 `>>Z` 与 `>>Z[2]` 必须解析成 4 个不同 `AtomDesc`（防止把 `>>` 吞成 `>` + 空）。
- **选择器优先级**：裸 `X` 等价 `+X`（`test_selectors.py:155-157` 的断言逐条移植）。
- **收窄语义**：`edges().vertices()` 去重后 = 4（不是 8）、`vertices().edges()` = 0、`faces()` 在 wire 上 = 0 —— 直接对应上游 `testVertices`（该用例**没有镜像但也不需要 ref**，纯行为断言）。
- **自撰用例的期望值**：§5.5.4 的 `expectCount` 可在本地先断言，使 R1 的 ref 阻塞不至于让这批语法完全无保护；ref 数据到位后再由差分复核。必测的三类"反直觉语义"（都要落 `GOTCHA:` 注释）：
  1. **空集**：`vertices("|Z")` / `vertices("#Z")` / `vertices("%VERTEX")` / `vertices("+Z")` / `vertices("X")` 全部 = 0（`BaseDirSelector` 跳过非面/边；`%type` 因大小写恒不等）；
  2. **抛错**：`vertices(">Z[1]")` / `vertices(">Z[-1]")` 抛 `ValueError`（`DirectionNthSelector` 先平行过滤 → 空集 → `_NthSelector` 抛错），**不是**返回 4 个顶点；
  3. **可用**：`vertices(">Z")`=4、`vertices("bottom")`=4、`vertices(">(1,0,0)")`=2、`vertices(">>Z")`=4 —— 这些走 `DirectionMinMaxSelector`/`CenterNthSelector`，顶点用它自身点参与排序。

### 5.3 现有 STEP 通道不回归

- `npx tsx tests/run-cand.ts` + `npx tsx tests/compare.ts`：`test_selectors` 46 条必须仍是 PASS；
- `out/report.json` 全局计数不得出现新的 FAIL（当前 `fail 5`，那 5 条与本方案无关，改动前后须逐条同名同状态）；
- 补镜像的 16 个用例后**必须重跑 `gen-manifest.ts`**（manifest 是三态唯一事实源，漏跑会让清单与磁盘脱节）。

### 5.4 验证纪律（沿用仓库红线）

- 禁止通过放宽容差把 FAIL 改成 PASS（容差只在 `compare.ts` / `compare-selectors.ts` 集中定义）；
- `blocked` 用例必须填 `blockedBy`，不得记成 `ported`；
- 测试触发错误时必须 spy `console.warn/error` 并断言（CI stderr 零容忍）；
- 与直觉不一致的 API 行为（如内核参数法向不带朝向、`getCenterOfMass` 对面句柄返回 `(0,0,0)`）必须落成带 `GOTCHA:` 注释的防回归测试。

### 5.5 语法覆盖矩阵（D5：每条语法必有案例）

**判据统一为"两边一致"**：自撰用例不另立期望，只比较 ref 侧（CadQuery 实跑）与候选侧（faijs 实跑）的 `{kind, count, picks[].center}` 是否全等（`center` 容差 `1e-6`，**顺序敏感**）。这正是"轻量级、只校验拓扑选择结果一致"的落法。

**上游用例一律以"文件:行 期望值"引用**，不改写、不转述；下列行号取自 `C:\git\CADQ\cadquery` HEAD `a637795`。

#### 5.5.1 原子层（修饰符 × 目标类型）

| ID | 语法 | face | edge | vertex |
|---|---|---|---|---|
| S1 | 裸轴 `X`（=`+X`） | ✅ `test_selectors.py:155-157`（`faces("X")` 中心 == `faces("+X")`）；`:154` `faces("XY")`=0 | ⚠️ `extra.edge.bareAxis`（`edges("X")`=4 条 X 向边） | ⚠️ `extra.vertex.bareAxis` → **期望 0**：裸轴映射为 `DirectionSelector`（`BaseDirSelector` 子类），对顶点一律 `continue`（`selectors.py:176-184`） |
| S2 | `+A` | ✅ `:130-152`（`+Z`=1 中心 `(0,0,1)`；`-X` 中心 `(-0.5,0,0.5)`；`+Y`、`-Y` 同） | ⚠️ `extra.edge.plusZ`（`+Z` → 4 条竖边） | ⚠️ `extra.vertex.plusZ` → **期望 0**（同 S1 的跳过规则） |
| S3 | `-A` | ✅ `:134-144` | ⚠️ `extra.edge.minusZ`（`-Z` → 4 条竖边） | ⚠️ `extra.vertex.minusZ` → **期望 0**（同 S1） |
| S4 | `>A` | ✅ `:127-157` 六向中心逐点断言；`:359-363` `faces(">Z").vertices()`=4 | ✅ `:367` `edges(">Z")` | ✅ `:1028`、`:1094`、`:1109`、`test_cadquery.py:326`、`:2517`。`>A` 是 `DirectionMinMaxSelector`（`CenterNthSelector` 子类），docstring 明确 `Applicability: All object types. for a vertex, its point is used`（`selectors.py:399-426`）⇒ **顶点可用，不跳过** |
| S5 | `<A` | ✅ `:455-473`（`<Z[2]`、`<Z[-2]`） | ⚠️ `extra.edge.ltZ` | ✅ `test_cadquery.py:437`、`:465`、`:2517`（`vertices("<Z")`=4） |
| S6 | `>>A` | ✅ `:299` `faces(">>X")`；`:226-353` `CenterNthSelector` 对象版 | ✅ `:308` `prism.edges(">>Z[-2]")` | ⚠️ `extra.vertex.ddZ` → **期望 4**（`CenterNthSelector(vec,-1,True)` → `z=+0.5` 的 4 个顶点） |
| S7 | `<<A` | ✅ `:297-298`（`<<(2,0,1)[0]`、`<<X[0]`） | ⚠️ `extra.edge.llZ` | ⚠️ `extra.vertex.llZ` → **期望 4**（`z=-0.5`） |
| S8 | `\|A`（平行） | ✅ `:195`、`:1100` `faces("\|Z")`=2；`:205` `faces("\|Z").vertices()`=8 | ✅ `:217-224`（`\|X/\|Y/\|Z` 各 4 边 + `cross().Length==0`）；跳过规则 ✅ `:159-189`（球面/球边 → 0） | ⚠️ `extra.vertex.parZ` → **期望 0**（跳过非面/边，`selectors.py:176-184`） |
| S9 | `#A`（垂直） | ✅ `:122` `faces("#Z")`=4 + `normalAt·Z==0` | ✅ `:117` `edges("#Z")`=8 + `tangentAt·Z==0` | ⚠️ `extra.vertex.perpZ` → **期望 0**（同上） |
| S10 | `%type` | ✅ `:95-102`（`%PLANE`==`faces()`；`%sphere`/`%cone`=0；`%plane`/`%PLANE` 同） | ✅ `:104-112`（`%Ellipse`=2、`%circle`=2、`%LINE`=2、`%Bspline`=0、`%Offset`=0、`%HYPERBOLA`=0） | ⚠️ `extra.vertex.type` → **期望 0**。**GOTCHA**：`Vertex.geomType()` 返回 `"Vertex"`（`shapes.py:373` 的 `geom_LUT`），而 `TypeSelector.__init__` 做 `typeString.upper()`（`selectors.py:281`），比较恒不等 ⇒ 上游 `%type` 对顶点**永远空集**。候选侧必须复刻这个"空集"，不得擅自返回全部顶点 |
| S11 | `[k]` 正索引 | ✅ `:417-423`（`>X[1]`、`>(1,0,0)[1]`）、`:296-298`、`:499`（`>(0,1,1)[0]`） | ✅ `:313` `>Z[-2]`（同族） | ⚠️ `extra.vertex.nth` → **抛 `ValueError`**。**GOTCHA**：`>A[k]` 是 `DirectionNthSelector` = **先 `ParallelDirSelector.filter`、再 `_NthSelector.filter`**（`selectors.py:452-455`），顶点在第一步被全部跳过 → `_NthSelector.filter` 对空列表抛 `ValueError`（`:307-309`）。**不是**返回 4 个顶点 |
| S12 | `[-k]` 负索引 | ✅ `:427-431`、`:462-473`（`<Z[-1]`/`<Z[-2]`）、`:493-496` | ✅ `:308`、`:313` | ⚠️ `extra.vertex.nthNeg` → 同 S11，**抛 `ValueError`** |
| S13 | 多轴 `XY/XZ/YZ` | ✅ `:154` `faces("XY")`=0；`:1109` `faces("+Z").vertices("<XY")` | ⚠️ `extra.edge.diagYZ`（`edges("YZ")` → 4 条 YZ 向边） | ⚠️ `extra.vertex.diagXY` → `vertices("XY")` **期望 0**（裸轴跳过）；**并补** `vertices(">XY")`=1（`(1,1,0)` 非单位向量，`x+y` 最大者只有 1 个顶点） |
| S14 | `(x,y,z)` 向量 | ✅ `:415` `>(1,0,0)[1]`、`:421` `>(-1,0,0)[1]`、`:496`、`:499` | ✅ `:655-661` `>(1,1,0) and \|Z` | ⚠️ `extra.vertex.vecSel` → `vertices(">(1,0,0)")` **期望 2**（`x=+0.5` 的两个顶点） |
| S15 | 命名视图 6 个 | ✅ 行为：`test_cadquery.py:301` `faces("front").workplane()`；解析：`:1136-1141` | ⚠️ `extra.edge.viewTop` | ⚠️ `extra.vertex.viewBottom` → **期望 4**（`DirectionMinMaxSelector((0,1,0), False)` → `y` 最小的 4 个顶点） |
| S16 | 空白容忍 | ▫️ 语法层断言即足：`:1123` `"+X "`（尾随空格）、`:1126` `"\|(-1, -0.1 , 2. )"`、`:1127` `"#(1.,1.4114,-0.532)"`、`:1133` `">(1,4,55.)[20]"` | 同左（三种 floating 形态两侧都只做解析） | 同左 |

> ✅ = 上游已有现成用例可直接移植；⚠️ = 上游无案例，须自撰 `extra.*` 探针用例；▫️ = 只需语法层解析断言（不进几何差分）。

#### 5.5.2 表达式层

| ID | 语法 | 上游 | 自撰补充 |
|---|---|---|---|
| E1 | `and` | ✅ `:1028` `vertices(">X and >Y")`=2；`:655-661` `edges(">(1,1,0) and \|Z")` | — |
| E2 | `or` | ✅ `:1048` `faces(">Z or <Z")`=2；`:1050` `edges("\|X or \|Y")`=8；`:1094` `vertices("(>X and >Y) or (<X and <Y)")`=4 | — |
| E3 | `exc` | ✅ `:1066` `faces("#Z exc >X")`=3 | ⚠️ `extra.vertex.exc` |
| E4 | `except`（别名拼写） | ▫️ 解析：`:1142`（该表达式内含 `except`） | ⚠️ `extra.face.exceptAlias`：`"#Z except >X"` 的**行为**结果须等于 `"#Z exc >X"`（`:1066`=3）；只解析通过不算覆盖 |
| E5 | `not` | ✅ `:1086` `faces("not >Z")`=5；`:1088` `faces(">Z").edges("not >X")`=3 | ⚠️ `extra.vertex.not` |
| E6 | 括号嵌套 | ▫️ 解析：`:1143-1144`；行为：`:1094` | ⚠️ `extra.face.nestedNot`：`"not ( <X or >X or <Y or >Y )"`（`:1144` 仅解析 → 补行为） |
| E7 | 优先级（`not` 右结合；`and`/`or`/`exc` 左结合） | ▫️ 解析：`:1142-1144` | ⚠️ `extra.expr.precedence`：`:1142` 那条不加括号的表达式（含 `not`/`and`/`or`/`except` 四算子）其选择集须等于按优先级显式加括号的写法 |

#### 5.5.3 收窄与集合语义

| ID | 语义 | 上游 | 自撰补充 |
|---|---|---|---|
| C1 | 全选各 kind | ✅ `testVertices` `:42-48`（vertices=4、edges=4、wires=1、faces=0） | — |
| C2 | **去重**（语义，非优化） | ✅ `:46` `edges().vertices()`=4（**不是 8**） | — |
| C3 | 空收窄 | ✅ `:44` `vertices().edges()`=0；`:50` `vertices().faces()`=0；`:51` `edges().faces()`=0；`:52` `edges().vertices().faces()`=0 | — |
| C4 | face→vertex 收窄 | ✅ `:359-363` `faces(">Z").vertices()`=4；`:205` `faces("\|Z").vertices()`=8 | — |
| C5 | 收窄 + 选择器（本方案的核心缺口） | ✅ `:1109-1113` `faces("+Z").vertices("<XY")`=(0,0,1) | — |
| C6 | 连续同类收窄 | ✅ `:1182` `edges(">Z").edges(">X")`；`:1188` `vertices(">Z").vertices(">X and >Y")` | — |
| C7 | 三段跨 kind 链 | ❌ 上游无 | ⚠️ `extra.chain.faceEdgeVertex`：`faces("+Z").edges(">X").vertices("<Y")` |
| C8 | 空候选集上 Nth → 抛错 | ✅ `:230-232`（`ValueError`） | ⚠️ `extra.err.nthEmpty`（fixture `empty`，字符串版） |
| C9 | 索引越界 → 抛错 | ✅ `:245`、`:258`、`:276`、`:290`（`IndexError`） | ⚠️ `extra.err.indexOOB`（`faces(">Z[5]")`，字符串版） |

#### 5.5.4 探针 fixture（两侧共用，6 个）

自撰用例只需"几何 + 选择链"，故 fixture 做成两侧共用的声明式表，**不新增每用例的 py/js 文件**：

| fixture | ref 侧构造（对齐上游 `tests/__init__.py:21-36`） | cand 侧镜像 |
|---|---|---|
| `unitCube` | `Workplane().rect(1,1).extrude(1).val()`（=`makeUnitCube(centered=True)`） | `tests/probe-fixtures/unitCube.fai.js` |
| `unitCubeOff` | `Solid.makeBox(1,1,1)`（=`makeUnitCube(centered=False)`） | `tests/probe-fixtures/unitCubeOff.fai.js` |
| `unitSquareWire` | `Wire.makePolygon([(0,0,0),(1,0,0),(1,1,0),(0,1,0),(0,0,0)])` | `tests/probe-fixtures/unitSquareWire.fai.js` |
| `cylinder` | `Workplane().circle(1).extrude(2).val()`（验 `%CYLINDER`、非 PLANE 面的跳过规则） | `tests/probe-fixtures/cylinder.fai.js` |
| `sphere` | `Workplane().sphere(1).val()`（验非 PLANE 面 + `:159` 的 `BaseDirSelector` 跳过规则） | `tests/probe-fixtures/sphere.fai.js` |
| `empty` | 空 `Workplane()`（无对象，验 `:230-232` 的 `ValueError`） | `tests/probe-fixtures/empty.fai.js` |

`selectors-probe.json` 增 `extra` 段，条目形态：

```json
{ "id": "extra.vertex.parZ", "fixture": "unitCube", "kind": "vertices",
  "sel": "|Z", "expectCount": 0, "covers": ["S8"], "why": "上游无 vertex+| 用例；跳过规则 ⇒ 空集" }
```

`expectCount`（可选）是从上游语义推导的期望值，用于 §5.2 那条**不依赖 ref 环境**的本地断言，缓解 R1；`why` 记录"为什么自撰"（上游缺案例的具体理由），便于复核。

#### 5.5.5 覆盖门禁（把"每语法有案例"变成机器校验）

新增 `tests/selectors-coverage.json`（矩阵的机器可读形态：`{ id, feature, kind, upstream?, extra?, expectCount? }`）+ `tests/check-selector-coverage.ts`，四条断言：

1. **无遗漏**：`grammar.ts` 导出的 `SYNTAX_FEATURES`（原子修饰符 × kind、表达式算子、收窄语义的规范化清单）每一项在矩阵里 ≥1 条 case。**这条是 D5 的强制点**——新增语法但没加案例，测试直接失败。
2. **无死条目**：矩阵里每个 `extra` 指向的 id 必须在 `selectors-probe.json` 真实存在。
3. **无孤儿用例**：`selectors-probe.json` 的每条 id 都被矩阵引用。
4. **上游引用可核**：`upstream` 为 `"file:line"` 时，若 `C:\git\CADQ\cadquery` 存在则校验该行确实含对应选择器字面量；路径不存在时打印 `UPSTREAM-SKIP` 警告，**不计失败**（诚实口径，与 `blocked` 的处理一致）。

门禁同时挂在两处：`npm test -w @faicad/faijs-cadquery` 里的一条 test，以及 `compare-selectors.ts` 报告尾部的 `UNCOVERED` 行。新增语法而未补案例，CI 必红。

---

## 6. 阶段划分与验收

| 阶段 | 内容 | 验收 | 阻塞 |
|---|---|---|---|
| **P0** 探针通道 | `selectors-probe.json` 骨架；`cq_step_plugin.py` + `run-ref.py` 扩展（`CQ_PROBE_SPEC`）；`tests/probe-cand.ts`；`tests/compare-selectors.ts`；`tests/README.md` 更新；重建 cadquery 环境；录 `out/ref/selectors.json` | 差分脚本能产出报告，且**在 `testVertexFilter` 上如实报 FAIL**（通道看得见缺口）；`MISSING-REF` 计数为 0 | 需重建 venv |
| **P1** 语法层 | `grammar.ts` + `descriptor.ts`（手写递归下降，零新依赖）；建 `selectors-coverage.json` + `check-selector-coverage.ts` 门禁骨架；导出 `SYNTAX_FEATURES` | 23 条 `testGrammar` 表达式全通过；12 条非法表达式全抛错；4 个 `>Z >Z[-2] >>Z >>Z[2]` 描述对象互不相同；**S1–S16 / E1–E7 的「解析层」条目全部有案例**（▫️ 行在此闭环）。**不触碰现有行为**，`npm test -w @faicad/faijs-cadquery` 全绿 | 无 |
| **P2** 投影 + 谓词 + 求解器 | `entity.ts` / `predicates.ts` / `resolve.ts`；`face.ts` 改为投影（`resolveFaceSelector` 签名不变）；建 6 个 fixture 与 `extra` 探针用例 | 探针 face 条目全 PASS；`selectors.test.ts` 覆盖 `\|`/`#`/`%PLANE`/`and`/`or`/`not`/`exc`/多轴/向量/索引；**S1–S16 / E1–E7 / C1–C9 的 face 行全部非 `UNCOVERED`**（E4、E6、S15 在此补行为）；`slide-top-stage-g.test.ts`、`parity-fixes.test.ts`、`siblings.probe.test.ts`、`loft.test.ts`、`sketch-workplane.test.ts` 全绿；STEP 通道 `test_selectors` 46 条仍 PASS | P0（face 差分）、P1 |
| **P3** edge 全量 | 谓词扩到 edge；`resolveEdgeSelection` / `resolveFaceEdgeSelection` 改为投影；删除 `selectEdgeHandles` | 探针 edge 条目全 PASS；**S1–S7、S13–S15 的 edge 行全部非 `UNCOVERED`**；`edges(">Z")`/`edges("+Z")`/`edges("#Z")`/`edges("\|Z")`/`edges(">Z or <Z")` 语义与 ref 一致；`p1-workplane-ops.test.ts`、`siblings.probe.test.ts`、`chamfer`/`fillet` 目录测试全绿 | P2 |
| **P4** vertex 全量 + 逐级收窄 | `vertex.ts`；`Workplane.selChain`；`faces/edges/vertices` 写链；`eachpoint` 改走 `resolveSelection`；删除 `selectFaceHandles` / 改写 `selectFaceHandlesForRemoval` | 探针 vertex 条目全 PASS（含 `testVertices` / `testVertexFilter` 的 `(0,0,1)`）；**S1–S15 的 vertex 行与 C1–C9 全部非 `UNCOVERED`**（含 `extra.vertex.parZ`/`perpZ`/`type` 三条**空集**断言的 `GOTCHA` 测试）；`resolveVertexSelector` 单测；`.faces("+Z").vertices("<XY")` 精确命中；`.faces(">Z").eachpoint()` 只落在被选面；`assembly-lift-boundary.test.ts` 全绿 | P3 |
| **P5** 去重收口 + 镜像补全 | `shape-class.ts` 4 类收口到 core（`NearestToPointSelector` 只改为 `Center()` 语义后保留）；补 16 个缺镜像；重跑 `gen-manifest.ts`；`tests/README.md` / `baseline.json` 更新 | `grep -rn "cross(\|getAngle\|NAMED_VIEW" packages/faijs-cadquery/src` 不再出现选择器算法实现（只剩薄封装）；`npm test -w @faicad/faijs-cadquery` / `-w @faicad/faijs` / `-w @faicad/faijs-tests` 全绿；STEP 报告无新增 FAIL | P4 |

**每阶段的验收里都含一条 D5 门禁项**：`check-selector-coverage.ts` 中该阶段负责的语法条目必须"有案例且非 `UNCOVERED`"。门禁只认矩阵与 probe spec 的一致性，**不认"我已经测过了"的口头结论**——P1–P4 每阶段结束都要跑一次，未覆盖条目会以 `UNCOVERED: <feature-id>` 列在报告里。

每阶段结束后按 `AGENTS.md` 的测试步骤走：先跑本阶段新写的测试 → 再跑可能受影响的测试 → 全绿才跑 `scripts/ci.ps1`（**不用 CI 找 bug**）。新增/修改的源文件需过 `npm run typecheck` 与 `npm run lint`，新 import 需过 `scripts/check-ghost-deps.mjs`（本方案零新依赖，预期无变化）。

---

## 7. 风险

| 编号 | 风险 | 应对 |
|---|---|---|
| R1 | **ref 环境不可用**：`baseline.json.python` 指向的 venv 本机不存在，P0 的 ref 数据录不出来，差分只剩 `MISSING-REF` | P1 的语法层与 §5.2 的纯行为断言**不被阻塞**，可先推进；P0 环境重建作为独立前置项先行。若重建失败，如实标注"探针通道已建但无 ref 基线"，**不得**用 cand-vs-cand 自比冒充通过 |
| R2 | **面外法向朝向**：内核 `surfaceNormal(f,uMid,vMid)` 不携带面朝向（`shape-class.ts:267-272` 实测），而 CadQuery 的 `normalAt()` 带朝向。`\|`/`#`/`+`/`-` 的正确性依赖它 | 用 `containsPoint(owningSolid, center + n·ε)` 消歧（`shape-class.ts:307-319` 已验证）；ε 取 `min(ext)*1e-3 + 1e-6`；落成 `GOTCHA:` 测试（两侧对同一盒体应给出同号法向）。对非封闭/多体上下文（无单一 owning solid）退化为参数法向，并在文档标注为已知边界 |
| R3 | **`resolveFaceSelector` 的 `normal` 语义变更**（轴向量 → 真实外法向）可能影响 `workplane()` / `faceRef` 的下游（`cq-compat-assembly/src/assembly.ts:78`） | 平面面上两者一致；以探针 + `assembly-lift-boundary.test.ts` + `slide-top-stage-g.test.ts` 双向锁定。若出现偏离，保留"轴向量"作为 `opts.axisNormal` 逃生口，但**默认走真实法向**（否则 `\|`/`#` 无法表达） |
| R4 | **边切向符号随参数向**：CadQuery 的 `+A` 对边是符号敏感的（`getAngle` 0..π），而边参数方向由 OCCT 决定，`OCP` 与 `occt-wasm` 两条句柄通路的朝向可能不同 → `+A` 在边上可能不一致 | 探针先测；若确认朝向不可控，对边的 `signed` 断言降为"平行性 + 符号按参考实现"，并在报告里把该条目标注为 `ORIENTATION-SENSITIVE`（**不静默放宽**，明确记为已知边界）。`\|`/`#` 天然符号不敏感，不受影响 |
| R5 | **近似改精确导致现有镜像/单测回归**：`>`/`<` 去掉"垂直过滤 + 面积打破"后，此前靠该近似通过的面用例可能变化 | P2 的验收明确要求 `test_selectors` 46 条与 5 个既有单测文件全绿；先跑差分定位，再判断是"参考更对"还是"实现有误"，**不得**为了绿而保留近似 |
| R6 | **`selChain` 与 `faceSel/edgeSel/vertexSel` 双轨期间状态不一致**（例如 `siblings` 读 `selChain` 而 `fillet` 读 `edgeSel`） | 双轨只在 P4 引入；`faceSel/edgeSel/vertexSel` 定义为 `selChain` 末位同 kind 项的**纯投影**，构造时同步写入，不允许单独赋值。P5 收口后加一条断言：任一 `Workplane` 上两者必须一致 |
| R7 | **去重口径**：收窄时不去重会让 `edges().vertices()` 得到 8 而非 4；去重键选错（坐标近似 vs 内核 hash）会漏并或错并 | 用内核 `hashCode` / `isSame` 做身份（对齐 `CqObject` 当字典键的做法）；落成 `edges().vertices().size() === 4` 的防回归测试 |
| R8 | **内核 padding 污染选择**：`getBoundingBox` 对边带 ±0.1mm padding（`edge.ts:58-61`），旧实现为此加了 `PAD` / `EDGE_CENTER_TOL` 等魔数 | 新引擎**不使用 bbox 做谓词**（`>`/`<` 用 `Center()`，`\|`/`#` 用切向/法向，`%` 用 `geomType()`），故这些魔数整体退役——这本身是消除 R8 的手段。仅在需要 bbox 的兜底路径保留，并标注其 padding 前提 |
| R9 | **文档/清单脱节**：补镜像后忘记 `gen-manifest.ts`，或扩了 probe spec 没重录 ref | 两条并列写进 §5 与 `tests/README.md` 的"红线"段；差分脚本对 spec 有而 ref 缺的条目输出 `MISSING-REF`（可见、不静默） |
| R10 | **"看起来有案例"的假覆盖**：语法在 `grammar.ts` 里实现、矩阵里也登记了，但案例只覆盖解析层（▫️）而没覆盖几何结果，于是"测试全绿"仍不等于语义对齐 | 矩阵每行**显式标出 face/edge/vertex 三列**，`⚠️` 行必须落到 `extra.*` 探针（几何差分），不得用解析断言顶替；门禁第 1 条断言的是"该语法 × 该 kind 至少一条**几何**案例"，`▫️` 仅在两侧都无行为差异时允许（S16、E4/E6/E7 的解析部分） |
| R11 | **"顺手补齐"破坏跳过/抛错语义**：实现者看到 `vertices("+Z")` 返回 0 或 `vertices(">Z[1]")` 抛错，容易当成 bug 去"修好"（让它返回 4），从而与上游分叉 | 这三类反直觉语义（空集 / 抛错 / 可用，见 §5.2）**逐条落成带 `GOTCHA:` 注释的测试**，注释里写明上游出处（`selectors.py:176-184`、`:281`、`:452-455`、`:307-309`）；探针差分是最终仲裁，`expectCount` 只是本地先行保护 |

---

## 8. 实施清单

| 步骤 | 位置 | 动作 | 依赖 |
|---|---|---|---|
| 1 | `tests/` | 建 `selectors-probe.json`（`upstream` 段先覆盖 `testVertices` / `testVertexFilter` / `testGrammar` / `testAndSelector` / `testSumSelector` / `testSubtractSelector` / `testInverseSelector` / `testComplexStringSelector` / `testFaceTypesFilter` / `testEdgeTypesFilter`；`extra` 段按 §5.5 的 ⚠️ 行逐条登记 `id/fixture/kind/sel/expectCount/why`） | — |
| 1b | `tests/` | 建 `selectors-coverage.json`（§5.5 矩阵的机器可读形态）与 `check-selector-coverage.ts` 门禁（四条断言） | 1 |
| 1c | `tests/probe-fixtures/` | 6 个 fixture 镜像：`unitCube` / `unitCubeOff` / `unitSquareWire` / `cylinder` / `sphere` / `empty`（与 ref 侧 `tests/__init__.py:21-36` 逐一对齐） | — |
| 2 | `tests/ref-harness/` | `cq_step_plugin.py` 加 `CQ_PROBE_SPEC` 分支与 `out/ref/selectors.json` 落盘；`run-ref.py` 透传；新增 `probe-extra.py`（把 `extra` 段的 `fixture` 名映射到 cadquery 构造，产物与上游用例**同一份 JSON**） | 1,1c |
| 3 | `tests/` | 新增 `probe-cand.ts` / `compare-selectors.ts`；更新 `README.md` | 1 |
| 4 | 环境 | 重建 cadquery 2.8.0 venv；`baseline.json.python` 改指实际路径；录 ref 数据 | — |
| 5 | `core/.../cadquery-selectors/` | `grammar.ts` + `descriptor.ts`（并导出 `SYNTAX_FEATURES` 供门禁消费） | — |
| 6 | 同上 | `entity.ts`（含 `orientedNormal` + `geomType` 映射） | 5 |
| 7 | 同上 | `predicates.ts` + `resolve.ts`（`resolveSelection`） | 5,6 |
| 8 | 同上 | `face.ts` 改投影；`selectors.test.ts` 补齐 | 7 |
| 9 | 同上 | `edge.ts` / `vertex.ts` 改扩；`index.ts` 出口 | 7 |
| 10 | `cq-compat/src/` | `Workplane.selChain`；`faces/edges/vertices` 写链；`eachpoint` 改走 `resolveSelection`；删 `selectFaceHandles`/`selectEdgeHandles`；改写 `selectFaceHandlesForRemoval` | 9 |
| 11 | `cq-compat/src/` | `shape-class.ts` 4 类收口到 core；`StringSyntaxSelector` 改委托；`NearestToPointSelector` 改 `Center()` | 9 |
| 12 | `tests/` | 补 16 个缺镜像；重跑 `gen-manifest.ts`；重跑 STEP 通道确认无新增 FAIL | 10,11 |
| 12b | `tests/` | 跑 `check-selector-coverage.ts`：§5.5 覆盖矩阵全部条目非 `UNCOVERED`，`UPSTREAM-SKIP` 为 0（或已如实记录） | 1b,12 |
| 13 | 全仓 | `typecheck` / `lint` / 各包 test / `check-lockstep.mjs`（未改版本号则免）/ `ci.ps1` 一次 | 全部 |

> 本方案只改文件。**任何 `git commit` / `git add` 都需用户当次逐字授权**，不会自行提交。
> 版本号未变，无需走 `set-version.mjs`。
