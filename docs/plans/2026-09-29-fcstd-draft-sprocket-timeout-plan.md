# FCStd Draft 轮廓解析重建：Sprocket 类 timeout 处置方案

- Status: 部分实施（A1 已落地、A2 已提交 `c6a99df0`；A3/A4 待 Sprocket 重转，仍被 `--exclude Sprocket` 隔离）
- 范围: `packages/fcstd/src/draft-draw.ts`（主改点）、`packages/sketch`（bspline 图元面，仅当需要）、fixture 单测
- 关联: P1-2 全库 stage2 扫描（fcstd-port `tools/run-sweep.ts`）

## 1. 现象

stage2 全库扫描中 `Sprocket` 系列 449 个产物（占语料 14.3%，zip 合计 829 MB）全部无法在时限内跑完。实测 `Sprocket ANSI simplex 1¾x1¼ z21` 在 420 s 上限下 `exit=124`、产物目录为空——连一个 STEP 都未产出，是卡死而非慢。按 120 s/个计入会让串行扫描多出约 13 h，因此扫描已用 `--exclude Sprocket` 隔离，本方案处置这一隔离项。

## 2. 实测根因

| 观测项 | 实测值 |
|---|---|
| 产物代码 | `model/Body.fai.js` 第 11 行是单条 176 KB 的 `cad.draw((pen) => pen.polyline([…], true))` |
| 折线点数 | 6842（`Body.fai.js` 只 30 行，其余行均 < 2600 字符） |
| 源对象类型 | `Part::Part2DObjectPython`（Python 齿轮生成器） |
| 源 BREP | 该形态 9 个 `.brp` member，最大者 706 条曲线（见 §3），无一条折线 |
| 卡点 | OCC 由数千条边建 wire 再 extrude，420 s 未完成；不是 WASM abort、不是 OOM |
| 第二形态 | `Sprocket ISO606 simplex 8×3/0 z30` 的慢来自 `cad.circularPattern` 的 30 齿阵列 |

离散的产地是 `packages/fcstd/src/draft-draw.ts` 的 `extractDraftDrawing`：`draft-draw.ts:220-225` 把 `initOcctWasm()` 的返回值**局部窄化**成一个只声明 `fromBREP / wireframe / getSubShapes / release` 的类型，随后 `draft-draw.ts:234` 对每条 wire 调 `kernel.wireframe(handle, DRAFT_DEFLECTION = 0.01)`——纯网格离散，解析曲线一并被采样成点；唯一出口 `renderDrawContour`（`draft-draw.ts:286-288`）只产出 `pen.polyline(...)`。

因此 6842 个点不是源数据规模，而是转换端的表示损失：**源是 168 条解析曲线，产物是 6842 个点**。

## 3. 源数据实况（静态解析 `.brp`，未跑内核）

BREP 的 `Curves` 段一曲线一行，行首整数为曲线类型。按 (类型, token 数) 统计 `Sprocket ANSI simplex 1¾x1¼ z21` 的 9 个 member：

| member | Curves | 直线 `1`/7tok | 圆 `2`/14tok | 参数曲线 `7`/21·24·27·36tok |
|---|---|---|---|---|
| PartShape.brp | 706 | 70 | 158 | 239 |
| PartShape1.brp | 168 | 42 | 126 | 0 |
| PartShape3.brp | 336 | 210 | 126 | 0 |
| PartShape4.brp | 8 | 6 | 2 | 0 |
| PartShape6.brp | 575 | 69 | 47 | 230 |
| PartShape9.brp | 578 | 70 | 49 | 230 |
| PartShape12.brp | 581 | 70 | 49 | 231 |
| PartShape7.brp / PartShape10.brp | 1 / 1 | 0 | 1 / 1 | 0 |

记录格式由 token 数反推：`1` = 直线（基点 3 + 方向 3）；`2` = 圆（基点 3 + 法向 3 + 两方向各 3 + 半径 1）；`7` = 变长参数曲线（6 token 头部 + `poles` 三元组，实测 `poles = degree + 1` 且无 knot / weight 序列，形态上与 Bézier 一致）。整份数据里**没有折线记录**，也没有显式离散。

⇒ 与点数脱钩的唯一路径是**按曲线类型重建**。把 tessellation 调粗只能按 `点数 ∝ 1/√deflection` 压低点数且同步牺牲精度，不构成正解（§8 明确排除）。

> **A2 订正（2026-09-29，提交 `c6a99df0`）：** 上表 `PartShape6/9/12` 的 230/230/231 条 `type 7` 参数曲线即 A2 的覆盖目标，但三者均为 **Sprocket** member，现被 stage2 扫描 `--exclude Sprocket` 隔离（§1），故 A2 的真实执行腿不在它们身上，而在 §5.2 的 `Chair`。A2 落地后这些参数曲线一旦随 Sprocket 重转（A3）将以精确 NURBS 而非折线产出。

## 4. 能力现状（逐项核对，含文件行号）

| 能力 | 现状 | 证据 |
|---|---|---|
| 判边曲线类型 | **有** | `occt-wasm/dist/index.d.ts:391` `curveType(edge): CurveKind`（line/circle/ellipse/hyperbola/parabola/bspline/bezier/offset） |
| 取曲线参数区间 / 求值 | **有** | 同上 `:393` `curvePointAtParam`、`:394` `curveTangent`、`:395` `curveParameters`、`:399` `curveIsClosed`、`:401` `curveLength` |
| 取直线端点 | **有** | `:271` `getSubShapes(shape,'vertex')` + `:355` `vertexPosition(vertex)` |
| 取参数曲线控制点 | **有** | `:415` `getNurbsCurveData(edge)` = `NurbsCurveData{degree,rational,periodic,knots,multiplicities,poles,weights}`（`types.d.ts:250-265`） |
| 通用出口 | **有** | `:537` `getRawKernel(): OcctRawKernel`（231 个方法，含 `curveType/curveParameters/curvePointAtParam/getNurbsCurveData`，`raw-types.d.ts:252-263`） |
| faijs 是否已桥接 | **已桥接** | `packages/core/src/brep/engine/primitives.ts:203-206`（curveType/curvePointAtParam/curveTangent/curveParameters）、`:219`（getNurbsCurveData）；适配器 `adapters/occt.ts:105-107`、`adapters/brepkit.ts:54-56` |
| pen 图元面 | **有 arc / ellipse / bezier / spline** | pen 的真实类型是 vendored `BaseSketcher2d`：`packages/brepjs/dist/2d/blueprints/baseSketcher2d.d.ts:41-99`（`lineTo`、`threePointsArcTo`、`sagittaArcTo`、`bulgeArcTo`、`tangentArcTo`、`ellipseTo`、`bezierCurveTo`、`cubicBezierCurveTo`、`smoothSplineTo`） |
| faijs sketch geoms | **有 line / circle / arc / ellipse / point；`bspline` 在 schema 中** | `packages/sketch/src/canonical.ts:29-52`；`contour.ts:57-66` 已能消费 bspline |
| sketch 入口窄化 | **有（本仓）** | `packages/sketch/src/project.ts:169-170` 对 `bspline` 抛 `E_SKETCHC_UNSUPPORTED_GEOM` |
| BrepEngine 返回面窄化 | **有（本仓）** | `primitives.ts:219` 把 `getNurbsCurveData` 声明为 `{degree,periodic,rational}`，丢掉 poles/weights/knots |

**结论：不存在第三方缺口。** `occt-wasm` 已暴露判类型、求值、取顶点、取 NURBS、以及 raw kernel 出口；faijs 的 BREP 层已把这些桥接进来（`curveType` 等）；pen 也已有 arc / bezier / spline。上一版方案里「必须上游提供 `getLineData` / `getCircleData`，否则 fork 该包」的结论来自一次被截断的 API 清单与一处未查清的 pen 基类，**作废**。§4 表内两处窄化（`project.ts` 入口、`primitives.ts` 返回面）都在本仓。

## 5. 方案：逐边解析重建

改 `extractDraftDrawing`：把「`wireframe()` 采样 → 折线链接」换成「拓扑走线 → 逐边判型 → 解析图元」。

1. `getSubShapes(shape, 'wire')` 得 wire；无 wire 时退回 `getSubShapes(shape, 'edge')`（保留现状的 edge-compound 兜底）。
2. 每条 wire 内 `getSubShapes(wire, 'edge')` 得边，逐边按 `curveType(edge)` 分派：
   - `line` → `getSubShapes(edge,'vertex')` + `vertexPosition` 取两端点，`movePointerTo` / `lineTo`。
   - `circle` → 用 `curveParameters` + `curvePointAtParam` 取端点，闭边走整圆，开边由两端点与 `curveTangent` 定圆心与起止角，落 `pen.threePointsArcTo` 或 `cad.sketch` 的 `arc` geom。
   - `bezier` / `bspline` → `getNurbsCurveData` 取 poles/weights/knots/degree；非有理且 `poles = degree+1` 者落 `pen.bezierCurveTo`，其余落 `cad.sketch` 的 `bspline` geom（需先放开 `project.ts:169` 的入口拒绝）。
   - `ellipse` → `pen.ellipseTo`。
3. `renderDrawContour` 由「单条 `pen.polyline([…])`」改为「按序的 pen 命令序列」（`.fai.js` 的 function body 允许多语句）。
4. 取整由 1e-6 保留；输出与源曲线的解析等价性由单测钉住。

边的顺序问题已有现成结论可复用：`packages/core/src/api/edge-ref.ts:10-13` 记录 `wireframe().edgeGroups[k]` 与 `getSubShapes(solid,'edge')[k]` 同序；本方案改走拓扑而非 `edgeGroups`，仍需按端点接续排序（现 `chainWireContours` 的端点匹配逻辑可保留，但输入由「折线」换成「曲线端点」）。

### 5.1 A1 实施中实测到的三处缺陷（已修，2026-09-29）

A1 落地后 `draft-chain-e2e.test.ts` 的 Chair 用例在 `makeFace` 处回归，逐层定位出**三个互不相同**的缺陷。全部由 `draft-draw.test.ts` / `codegen.test.ts` 钉住，`probe-emitted-source.ts`（按语句号定位到对象）与 `probe-contour-closure.ts`（全库闭合率审计）为诊断工具。

| # | 缺陷 | 实测证据 | 修法 |
|---|---|---|---|
| 1 | 闭合判定要求 `chain.length > 1` | Kitchen_cabinet_base `Clone2D001` 是**单条边**的闭合 B 样条外轮廓（629 段，首点与末点完全相同）却被判 open；`Clone2D017` 是 a→b→a 的两段闭合环同样被判 open | 闭合改判**发射几何本身**（对 snap 后的首末点取值），去掉边数下限 |
| 2 | 零延展守卫用「端点跨度」 | 整圆的首末点**重合**，跨度恒为 0 ⇒ 每个 Draft `Circle` 对象（单边单段轮廓）都会被静默丢弃，对象退化成 `shape-asset` | 守卫改为量**曲线长度**（线段长 + `radius × sweep`，扫角归一化与 `geometry2d/adapt.ts` 的 `profileSegToCurve` 对齐） |
| 3 | 开放轮廓被当成可构面的环 | Chair 两个 `Shape2DView` 各 17 条轮廓**全部为开放**（`maxAdjGap=0`，`closureGap` 10–570）：投影对象是边 compound，无 wire 拓扑。喂给面调用即 `CONSTRUCTION_FAILED: makeFace: construction failed`（OCCT `MakeFace::IsDone()` 对开 wire 为 false） | 按 `closed` 分流：闭合 → 面（`cad.sketchOnPlane`）；开放 → 1D 曲线（`as:'wire'`）；两者并存则 `cad.compound` |

缺陷 3 的语义依据（不是「能跑就行」）：**开放轮廓是路径，不是轮廓**。Kitchen_cabinet_base 的消费方式直接印证——被 `cad.extrude` 用的是闭合的 `Clone2D005/006/008/009/014/015/018`，被 `cad.sweep` 当脊柱的是开放的 `Clone2D004/010/017`。被取代的 A4 形态无法区分二者：`BlueprintSketcher.close()` 给**每一条**轮廓补了一条闭合线段（`packages/draw/src/draw.ts` 的 `drawSession` 收尾即 `pen.close()`），于是开放脊柱被补成闭环。A1 保留开放，并在发射端显式走 `as:'wire'`。

回归面判据：Chair 端到端（17+17 条开放轮廓 → 34 条 wire + 2 个 compound）**产出 STEP**；Sprocket 全部轮廓闭合，仍走单条面调用，发射形态与 A1 首版一致。

### 5.2 A2 实测（2026-09-29 提交 `c6a99df0`，执行腿 + 语料审计）

**A2 落地内容**

- `BrepEngineApi` 新增 `makeBSplineEdge` + `curveSplit`，occt / brepkit / mock 三端实现；`getNurbsCurveData` 返回面从窄结构扩为完整 `BrepNurbsCurveData`（含 `poles`/`weights`/`knots`/`multiplicities`/`periodic`），并钉下两个实测坑：对 conic（circle/ellipse/hyperbola/parabola）**抛异常/返回 `null`**（非 B-spline/Bézier），以及返回的是**整条基曲线**而非边的 trim。
- `draft-draw.ts` 新增 `DraftSplineSegment`，`bezier` / `bspline` 边改走精确 NURBS，反向/裁剪/缝合均按曲线精确处理；含样条的轮廓整体不做量化（量化会让相邻 line/arc 与 spline 之间留亚微米缝，OCC 在 `Precision::Confusion=1e-7` 下缝不上）。
- `geometry2d` 抬平面时精确建边并按 `curveSplit` 裁剪；`sketch` 入口放开 `bspline`（`project.ts` 原 `E_SKETCHC_UNSUPPORTED_GEOM` 是入口窄口，非求解能力缺；端点用钳位域端点求值而非 `poles[0]/poles[last]`，periodic/非钳位 knot 向量下极点不在曲线上）。

**语料实测**（全库审计 `scripts/audit-draft-kinds.ts`：3201 文档 / 766 Draft 对象 / 78 795 Draft 边）

| 形态 | 实测值 |
|---|---|
| 参数曲线总量 | `bezier=1339 bspline=912`——合计 **2279** 条边原走逐边离散 |
| 椭圆 | `ellipse=28`——**A2 未覆盖**，仍走逐边离散（根因见 §9） |
| 覆盖面 | 20 个文档的 2279 条参数边不再被采样成折线 |

**执行腿**（`draft-parametric-e2e.test.ts`，BY EXECUTION，语料在兄弟 checkout `FreeCAD-library`；本文件撰写时该 e2e 已写好但**尚未在 sweep 运行期重跑**——其断言逻辑本身即验证，详见下表）

| 文档 | 预期 | 实测（探针 `probe-a2-fillet-baseline.ts` 对照 A1） |
|---|---|---|
| `Chair` | 端到端产出 STEP | **RUN-OK**（step 272992 bytes，与 A1 字节数相同 ⇒ A2 未破坏本已能跑的文档）；34 条参数边中 28 条 `bspline` 以 spline 发射，6 条 `ellipse` 仍采样（A2 未覆盖） |
| `Cloud_shelf` | 阻塞于 s7 `cad.fillet` | 报错 `edgeRef: adjacent face ordinal 1 has no role lineage`——`Cut = subtract(导入 BREP, 挤出 ShapeString)`，来自导入资产的面其 hash 未进 roleTable。**A1（折线形态）同句逐字失败** ⇒ 与 A2 无关 |
| `Batman shelf` | 阻塞于导入 Body 内选边 | 报错 `edgeRef: edge ordinal 49 out of range [1, 48]`——失败选边在被 import 的 Body 模块，ES import 先于 main 求值，Draft 语句根本没机会执行。**A1 同句逐字失败** ⇒ 与 A2 无关 |

⇒ A2 的诚实执行腿只有 `Chair`（原 A1 即 `draft-chain-e2e` 的 `expectRun: true`）；`Cloud_shelf` / `Batman shelf` 仅作为「下游既有缺口」的探针锚点，断言**逐字错误文本**而非 `it.fails`——这样一旦 A2 真在更早处回归（spline 抬升失败），错误文本变化即挂，`it.fails` 会静默吞掉。

## 6. 分阶段与判据

| 阶段 | 内容 | 判据 |
|---|---|---|
| A1 | 逐边 `curveType` 分派 + `line` / `circle` 解析产出 | Sprocket 样例的折线点数下降一个数量级；`PartShape1`（42 线 + 126 圆，无参数曲线）形态端到端产出 STEP |
| A2 | `bezier` / `bspline` 经 `getNurbsCurveData` 解析产出（含放开 `project.ts:169`、放宽 `primitives.ts:219` 返回面） | `Chair` 端到端产出 STEP 且 28 条 `bspline` 以 spline 发射（已实测 RUN-OK，§5.2）；语料 2279 条参数边无「采样成折线」残留（`draft-parametric-e2e` 断言）；`PartShape6/9/12` 属 Sprocket 仍排除，其精确产出归 A3；`ellipse=28` 仍采样（A2 未覆盖，见 §9） |
| A3 | 449 个 Sprocket 重转 | 全部在时限内产出 STEP |
| A4 | 全库 Draft 对象重转对照 | Draft 通路无回归，库整体点数/体积变化有记录 |

A1 完成即已覆盖该形态的 1 个 `PartShape` 主体（168 条曲线全是线 + 圆），A2 补齐其余。

## 7. 回归面与验证计划

- 回归面：`draft-draw.ts` 服务全部 `Part::Part2DObjectPython` 对象，产物流水线经 `convert.ts` 的 `isDraft2DObject` → `codegen.ts` 的 `renderDrawContour`；A4 必须覆盖其它 Draft 产物。
- 单测：合成 fixture 各一条 `line` / `circle` / `bezier` / `bspline` 边，断言重建后的图元种类与参数（而非点数）。
- 端到端：`Sprocket ANSI simplex 1¾x1¼ z21`（纯线+圆）与 `Sprocket ISO606 simplex 8×3/0 z30`（含阵列）各一例，断言产出 STEP 与耗时。
- 全库对照：走 Draft 通路的产物比对 STEP 的体积 / 面积 / 包围盒与折线点数。
- stderr 零容忍。

## 8. 明确排除的路线

- **调粗 tessellation（`DRAFT_DEFLECTION` 可配置化）**：与源精度同源，只是更粗，属降级；FreeCAD 与本项目同为 OCCT 内核，源侧能表达的解析曲线本项目同样能表达，不接受以精度换可运行性。
- **把 Sprocket 长期隔离**：449 个 / 14.3% 的库跑不出产物，属能力缺口，不是交付选项。

## 9. 待实测确认项

- ~~`type 7` 记录对应的 `curveType()` 精确返回值（`bezier` 还是 `bspline`）~~ **已实测解决（A2）**：全库审计测得 `bezier=1339 bspline=912`，`readEdge` 的 `bezier` / `bspline` 合并分支（`draft-draw.ts:732`）同时覆盖二者，无需区分 `type 7` 是哪种；内核实测也确认二者被 `curveType` 分别报为 `bezier` / `bspline`，且 `getNurbsCurveData` 对两者都返回 NURBS 控制数据。该实测需 kernel 初始化，与 P1-2 扫描串行、不得并发——A2 实施时已串行完成。
- **`ellipse` 残留（A2 未覆盖，归后续）**：语料 `ellipse=28` 条仍走逐边离散（`draft-draw.ts:770` 的 fallback）。根因：`readEdge` 仅对 `line` / `circle` / `bezier` / `bspline` 有解析分支——`circle` 走 `arcSegment`/`circumcircle`，`ellipse`/`hyperbola`/`parabola` 无解析分支，落到逐边离散；而 `getNurbsCurveData` 对 conic 返回 `null`/`抛异常`（`brep/engine/primitives.ts:244` 钉死），所以无法借 A2 的 NURBS 路径复用。椭圆虽可精确表示为有理 2 次 NURBS，但需内核侧 conic→NURBS 转换（或 `readEdge` 专用 ellipse 分支），属独立内核缺口，不在 A2 范围。`Chair` 的 6 条 ellipse 即此残留，其发射计数断言因此为 `34 − 6 = 28`（`draft-parametric-e2e.test.ts`）。
