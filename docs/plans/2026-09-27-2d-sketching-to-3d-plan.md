# 2D 绘图与草图 → 3D 建模能力建设方案

状态：实施中（A 组/B 组/C1/C2/C3(底座+接线)/C4(纯投影)/D(基元:parameterOfPoint/trimCurve/splitCurveAt + 圆角/倒角:chamfer2d/fillet2d + 偏移:offsetOutline2d/offsetPolygonLoops2d + 剪除:pruneSelfIntersections(横向) + 布尔:pointInContour/segmentIntersection/booleanUnion2d/booleanIntersect2d/booleanDifference2d + SVG:contourToSvgPath/svgPathToContours)/E1(部分)/E2/E3(基础:on-surface 桥+op+放置e2e)/E4(基础:clean-poly 棱柱打孔+volume e2e)/F2/F6(部分) 已落地，E3(fixWireOnFace 曲面贴合)/E4(draftAngle 拔模)/E5/D1(collinear splice)/D2(切向剪除)/D3(全量角)/G/F4/F5 待做）；draw 工厂已含 rectangle/roundedRectangle/polygon/circle/ellipse，附 chamfer2d/fillet2d/offsetOutline2d/pointInContour/segmentIntersection。

本方案是 faijs 2D 能力建设的总纲，覆盖"完整 2D 绘图 + 完整 2D 草图 + 2D→3D 桥接"的最终目标与实施路径。`docs/plans/2026-09-26-profile-classify-holes-alignment.md`（profile 孔洞分类消 H15）的结论被本方案吸收为其子集——该方案的 profile 分类工作对应本方案工作项 F2，内核原语核对对应 E1；本方案在其上把范围从"孔洞分类"扩展到"完整 2D 能力 + 2D→3D 桥接"，并纠正了该方案中一处与用户需求相悖的判断（见 §1.4）。

## 1. 需求

### 1.1 本次需求原话

> 我要求的是本项目要有完整的 2D 绘图和 2D 草图功能，甚至不一定是 2D。因为我的目的是要实现 3D 建模。2D 图形存在的唯一目的就是辅助 3D 建模，比如后续的拉伸、打孔。比如在给定模型的某个面上画草图，然后执行拉伸（当然也可以是其他的参考面，这是cad软件的标准功能）。这个面甚至不一定是平面。当然，第一版可以只支持平面，但是必须要有这个目标指引，不要根据现有的 faijs 的代码写法误判需求。

### 1.2 历次需求纠正原话（沿用自 2026-09-26 方案）

> （v3）你的理由根本不成立。faijs 必须有正确的 2d 图形处理能力。要么你找到一个更好的实现，要么把 brepjs 的这部分代码迁移过来。不依赖 brepjs 仓库，不是禁止任何的 brepjs 代码。根本是两回事。

> （v4）"直接全量搬 geometry2d.ts 不是最优起点……只需要其中一条纵切"——你明显理解错误。如果这些功能都是合理的，那么就都应该移植过来。目前 faijs 没有，只代表 faijs 的能力缺口，不是不需要。

> （v5）你为什么要自作主张呢？如果没有特定的理由，为什么不直接用别人的全套的算法？

> （v7）本项目是 3D 建模，2D 图形的最终目的就是 3D。类似在给定模型的平面上画草图，然后拉伸成实体，是必须支持的功能。目前 faijs 是否支持？是否可以采用 brepjs 的方案？

### 1.3 需求解读（三条硬约束）

**约束一：2D 是手段，3D 是目的。** 任何 2D 能力都必须有通向 3D 特征的出口（拉伸、打孔、旋转、扫掠、放样）。衡量一套 2D 能力是否"完成"的标准，不是它自身能画出多复杂的轮廓，而是它能否稳定地驱动 3D 建模。因此本方案的验收主线是 e2e：**从 2D 输入到 3D 实体**。

**约束二：草图依附于模型的面，面不必是平面。** 用户要的不是"在 z=0 画图"，而是"在给定模型的某个面上画草图，然后拉伸"。这个面可以是平面，也可以是圆柱面、锥面、任意参数曲面。第一版可以只支持平面，但架构的接口形状、数据流、内核原语必须为曲面草图预留并指向它——"仅平面"是阶段性实现，不是设计前提，绝不能固化进类型与 API。

**约束三：完整，而不是够用。** 2D 绘图（任意曲线类型、布尔、偏移、圆角倒角、SVG 往来）与 2D 草图（参数化约束求解）都属于目标范围。faijs 当前没有的，是能力缺口，不是不需要。凡是 brepjs 里合理的 2D 能力，都应当移植或找到更好的实现，"为什么不直接用别人的全套算法"。

### 1.4 必须避免的误判

**误判一（原方案 v7 §4.5 ②）**："Sketcher 画图 DSL 不迁，因为 faijs 的画图入口是自己的 faijs 语言 + Sketcher/draw DSL，两套用户画图 API 定位冲突。" —— 该理由**与实测不符**：faijs 中并不存在 brepjs 那套 Sketcher/draw/Drawing 画图 DSL。`packages/core/src/api/generated/2d.ts` 为 0 投影 / 45 skip，`generated/sketching.ts` 除 `makeBaseBox` 外 51 skip，`arg-spec.ts` 中 `Blueprint`/`Curve2D`/`Sketcher`/`draw`/`boolean2D` 全部 `kind:'skip'`，`api/compat/` 目录不存在。把"不存在的实现"当成"已存在的冲突"来裁剪需求，正是用户反复警告的"根据现有代码误判需求"。因此本方案把画图 DSL 纳入目标范围（工作项 C 组）。

**误判二**：把 faijs 现有的 z=0 通道（`cad.profile` / `cad.sketch` / cq-compat Sketch / SVG）当作"2D 能力已具备"。这四条通道各自独立、各自锁死 z=0、各有一套轮廓分类实现，是历史遗留的输入口，不是需求定义。本方案以"面上草图→3D"为主线重新组织，把现有通道统一到同一条管线上（工作项 F）。

**误判三**：把"第一版只需平面"读成"只需平面"。见约束二。

### 1.5 入口命名与统一性决策（2026-09-27 用户拍板）

> 那么就新增 cad.draw 这个 api，profile 保留。最终 profile/sketch/draw，都要统一支持 3D 拉伸。

决策落定：

- **新增 `cad.draw`**（链式绘图 DSL，brepjs Blueprint/Drawing 方向）：作为人手写脚本/交互式绘图的入口，支持全曲线类型 + 2D 布尔/偏移/圆角/SVG 往来，产出轮廓对象，再放置到 3D。
- **`cad.draw` 归属独立子包 `@faicad/faijs-draw`**（目录 `packages/draw/`，2026-09-27 用户拍板）：自由绘图与约束求解是两种不同范式，不并入 core，也不并入 sketch 包。draw 包 peerDep 到 core，复用 core 的纯 2D 几何基座。
- **core 保持只支持 `cad.profile`，并补 3D 拉伸能力**：core 的 2D 脚本面入口只有 `cad.profile`；core 另承担纯 2D 几何基座（`Curve2dObj`/`Blueprint`/`organiseBlueprints`）与 2D→3D 桥接 op（`cad.sketchOnPlane`/`sketchOnFace`/`punchHole`）以及 `cad.extrude` 沿草图法向拉伸——这就是「加 3D 拉伸」的落点。
- **保留 `cad.profile`**（数据式参数入口）：服务和机器/UI 生成代码与序列化，调用形态与 schema 保持向后兼容，底层改为消费统一的 2D 几何与分类管线。
- **`cad.sketch` 保持为约束草图入口**（planegcs，仍在 `@faicad/faijs-sketch`），不与前两者争名；"把草图放到平面/面上"用 core 的 `sketchOnPlane`/`sketchOnFace`。
- **三位一体、统一拉伸**：`profile`（core）/ `draw`（draw 包）/ `sketch`（sketch 包）三种 2D 轮廓来源最终都必须经同一条放置管线（core 的 `sketchOnPlane`/`sketchOnFace`）完成 3D 化，并统一支持 `extrude`（沿草图/面法向）等 3D 特征操作。三者的差异只在"如何描述/生成 2D 轮廓"，不体现在下游 3D 能力上。

## 2. 现状实测（2026-09-27）

### 2.1 faijs：四条独立的 z=0 通道，桥接全缺

| 通道 | 入口 | 实现位置 | 平面约束 | 分类逻辑 |
|---|---|---|---|---|
| 轮廓面 | `cad.profile`（brep-only） | `packages/core/src/api/profile.ts` | 锁死 z=0，无 plane/origin | 自造 parent 链 + `depthOf` + 面积比较（`profile.ts:237-266`），探针为环首采样点 |
| 约束草图 | `cad.sketch`（`@faicad/faijs-sketch`，宿主注入） | `packages/sketch/src/`（planegcs） | 局部 XY | 经 `contour.ts` 出环后调 `buildProfileShape`（`faces.ts:57-64`） |
| CQ 兼容容器 | `@faicad/cq-compat-sketch`（re-export） | `packages/cq-compat/src/sketch.ts` | 全部硬编码 z=0，`extrude` 写死 `(0,0,height)` | 面级内核布尔 |
| SVG | `svgToSolid` 内部通路 | `packages/core/src/brep/svg/svg-to-solid.ts` | z=0，仅 XY 仿射 | 独立 `classifyHoles`（质心 + bbox 预筛，`svg-to-solid.ts:757-818`）；已知 bug：质心探针跑丢、≥3 层嵌套静默丢岛 |

**桥接能力（`sketchOnPlane` / `sketchOnFace` / `punchHole`）：零实现。** 全仓仅出现在未实施的 2026-09-26 方案文档与 `api/surface/arg-spec.ts` 的 skip 登记中。

**3D 消费端**：`cad.extrude`（`extrude.ts:465-533`）接受已在 3D 空间的平面 face，支持任意拉伸向量与 `upTo`，但**不负责草图放置**；它拒绝 1D 曲线（`E_EXTRUDE_NEEDS_FACE`，`extrude.ts:471-475`）。另有 `revolve`/`sweep`/`loft`。

**内核层**：faijs 没有 2D 曲线句柄体系。L1 契约 `BrepEngineApi`（`packages/core/src/brep/engine/primitives.ts:33-273`）中 2D→3D 桥接所需原语缺失：`liftCurve2dToPlane`、`buildEdgeOnSurface`、`intersectCurves2d`、`draftPrism` 均不在 L1；`engine-method-map.json` 把前两者标为 `occt-only`，`draftPrism` 未登记（仅 `packages/cq-compat/src/workplane.ts:2382` 经强转调用 occt 原生）。现有 profile 是"解析式 2D 轮廓 → 直接构 3D 边"的旁路（`profile.ts:164-182`）。

**API 投影面**：`api/surface/arg-spec.ts` 中 `module:'2d'`（`:1117-1457`）与 `module:'sketching'`（`:2671-2846`）除 `makeBaseBox` 外全为 `skip`；`api/brepjs-compat/index.ts` 在 core-decouple 后只剩纯组合子，vendored brepjs 树已删除（`packages/brepjs/` 仅剩 `dist`）。

### 2.2 brepjs：完整 2D 栈（可移植清单）

| 层 | 文件（`D:\Faicad\brepjs`） | 内容 |
|---|---|---|
| 纯几何内核 | `src/kernel/geometry2d.ts`（1059 行，纯 TS 零依赖） | `Curve2dObj` 判别联合（brepjs 用判别字段 `__bk2d`: line/circle/ellipse/bezier/bspline/trimmed，faijs 移植后改名 `kind2d`）、`evaluateCurve2d`/`tangentCurve2d`/`curveBounds`、构造族、变换族、`intersectCurves2dFn`（解析解 + Newton 迭代）、`serializeCurve2d`、bbox |
| 曲线函数面 | `src/2d/curve2dGeometryFns.ts`、`src/2d/lib/curve2D.ts`、`curve2dFns.ts`、`intersections.ts`、`makeCurves.ts` | Result 风格函数面 + `Curve2D` 句柄类；构造/变换/求交/投影/切点 |
| 2D 容器 | `src/2d/blueprints/blueprint.ts`、`compoundBlueprint.ts`、`blueprints.ts`、`lib.ts` | `Blueprint`（curves/bbox/orientation/isInside/isClosed/intersects/变换族/toSVG）、`CompoundBlueprint`（外环+孔）、`Blueprints`（不相交集合）、`organiseBlueprints`（Flatbush + union-find + 首曲线中点探针 + `isInside` 分层，支持 ≥3 层嵌套与多外环拆分） |
| 画图 DSL | `baseSketcher2d.ts`、`genericSketcher.ts`、`blueprintSketcher.ts`、`cannedBlueprints.ts`；`src/sketching/drawing.ts`、`drawingPen.ts`、`drawingFactories.ts`、`drawFns.ts`、`draw3d.ts`、`sketcher.ts`、`faceSketcher.ts` | `BaseSketcher2d` ~30 个笔方法 → `Blueprint`/`Drawing`；`Sketcher`（平面）/`FaceSketcher`（曲面 UV）→ `Sketch`；预制图形、投影出图 |
| 2D 运算 | `boolean2D.ts`、`booleanOperations.ts`、`segmentAssembly.ts`、`intersectionSegments.ts`、`booleanHelpers.ts`、`blueprintOffset.ts`、`lib/offset.ts`、`blueprintCustomCorners.ts`、`lib/customCorners.ts`、`blueprintApproximations.ts`、`lib/svgPath.ts`、`svg.ts` | 布尔（fuse/cut/intersect 多态）、偏移（round/bevel/miter）、圆角/倒角、SVG 导入导出 |
| 2D→3D 桥接 | `blueprint.ts:243/269/310`、`src/2d/curves.ts`、`src/sketching/sketch.ts`、`compoundSketch.ts`、`sketches.ts`、`sketchFns.ts` | `sketchOnPlane`（`curvesAsEdgesOnPlane` + `liftCurve2dToPlane`）、`sketchOnFace`（`curvesAsEdgesOnFace` + `buildEdgeOnSurface` + `fixWireOnFace`，scaleMode original/bounds/native）、`punchHole`（`subFace` + `draftPrism`）；`Sketch.extrude/revolve/sweepSketch/loftWith` 出口 |
| 内核原语 | `src/kernel/kernel2dTypes.ts`、`occt/kernel2dOps.ts:806/890/914`、`occt/advancedOps.ts:961` | `liftCurve2dToPlane`（line/circle/arc 精确 3D 边，bezier/bspline 抬控制点）、`buildEdgeOnSurface`（采样 60 点 + 插值）、`extractSurfaceFromFace`/`extractCurve2dFromEdge`/`buildCurves3d`/`fixWireOnFace`；`draftPrism`（`BRepFeat_MakeDPrism`，`height=null` 通孔） |

### 2.3 能力对照

| 能力 | faijs 现状 | brepjs | 结论 |
|---|---|---|---|
| 2D 曲线模型（解析曲线） | 无（profile 只有 line/arc 采样） | `Curve2dObj` 六种 | 缺口，移植 |
| 2D 轮廓分类 | profile 自造弱版 / svg 另一套 | `organiseBlueprints`（精确 `isInside`） | 缺口，统一移植 |
| 完整 2D 绘图 DSL | 无 | `BaseSketcher2d` 全家族 | 缺口，移植 |
| 2D 布尔/偏移/圆角 | 无 | 全套 | 缺口，移植 |
| 平面草图→3D | 无（仅 z=0） | `sketchOnPlane` | 缺口，移植 |
| 曲面草图→3D | 无 | `sketchOnFace` | 缺口，移植（目标指引） |
| 打孔 | 无 | `punchHole` | 缺口，移植 |
| 约束草图 | 有（planegcs 求解） | 无 | faijs 优势，接入统一管线 |
| 内核 2D 原语 | 缺 4 项 | 全 | 缺口，补齐 |

## 3. 目标架构

### 3.1 统一管线

一切 2D 输入收敛到同一条管线，出口一律是 3D 特征：

```
来源（cad.profile 数据式 / cad.draw 链式绘图 / cad.sketch 约束草图 / SVG / CQ Sketch）
   │  统一表示为
   ▼
Curve2dObj[]  （解析曲线：line/circle/ellipse/bezier/bspline/trimmed）
   │  organiseBlueprints 分类（精确包含判定）
   ▼
Blueprint | CompoundBlueprint | Blueprints   （外环 / 外环+孔 / 不相交集合）
   │  2D 运算（布尔 / 偏移 / 圆角倒角 / 变换）
   │  放置（桥接）
   ▼
sketchOnPlane(plane) ──► 3D wire/face        sketchOnFace(face, scaleMode) ──► 面内 wire/face
   │                                              │
   ▼                                              ▼
extrude / revolve / sweep / loft            extrude（沿面法向）/ punchHole
   │
   ▼
3D 实体（Shape）
```

设计要点：**`cad.profile`（数据式，core）、`cad.draw`（链式绘图，draw 包）、`cad.sketch`（约束草图，sketch 包）是 2D 输入层的三个并列来源，统一收敛到同一条下游管线**，而非三套并行世界——三者的差异只在"如何描述/生成 2D 轮廓"，下游的放置与 3D 特征能力完全一致。绘制/求解只产出 2D 轮廓数据；放置与 3D 特征（`sketchOnPlane`/`sketchOnFace`/`punchHole`/`extrude`）由 core 统一提供。平面草图与曲面草图共用 `Blueprint` 与 `organiseBlueprints`，差异只在"放置"这一步（`sketchOnPlane` vs `sketchOnFace`）。

### 3.2 分层与目录落点

纯 2D 几何基座与 2D→3D 桥接留在 core（profile 依赖、三包共用）；自由绘图 DSL 与 2D 运算落到独立子包 `@faicad/faijs-draw`。

**core（`packages/core/src/`）：**

| 层 | 落点 | 职责 | 依赖约束 |
|---|---|---|---|
| L1 纯 2D 几何 | `geometry2d/curve2d.ts` | `Curve2dObj` 六种曲线、求值/切线/bounds、构造族、变换族、`intersectCurves2dFn`、序列化、bbox（移植 brepjs `kernel/geometry2d.ts`） | 零依赖纯 TS |
| L1 纯 2D 容器 | `geometry2d/blueprint.ts`、`compound-blueprint.ts`、`blueprints.ts`、`organise.ts` | 三类轮廓容器 + `organiseBlueprints` + `isInsideLoop` | 只 import `curve2d.ts`（含 Flatbush） |
| L1 内核边界 | `geometry2d/bridge/` | `sketchOnPlane`/`sketchOnFace`/`punchHole`、`curvesAsEdgesOnPlane`/`OnFace`；经依赖注入拿内核 | 允许 import 内核接口，禁止 import `api/`（防环） |
| L1 内核补齐 | `occt-kernel/`（组合层）、occt 平台面 | `liftCurve2dToPlane`、`buildEdgeOnSurface`、`draftPrism` | 按 occt-only 平台面 |
| L3 API 面 | `api/profile.ts`（保留）、`api/sketch-on-plane.ts`/`sketch-on-face.ts`/`punch-hole.ts`（新 op）、`api/extrude.ts`（补法向读取） | `defineOp` 包装、注册进 `createApiNamespace`；core 的 2D 脚本面入口只有 `cad.profile` | 见 §3.3 |
| 统一现有通道 | `api/profile.ts`、`brep/svg/svg-to-solid.ts` | profile 与 SVG 统一消费 `organiseBlueprints` 与放置管线 | — |

**draw 包（`packages/draw/src/`，`@faicad/faijs-draw`）：**

| 层 | 落点 | 职责 | 依赖约束 |
|---|---|---|---|
| 2D 绘图 DSL | `draw/base-sketcher.ts`、`generic-sketcher.ts`、`blueprint-sketcher.ts`、`canned-blueprints.ts` | `BaseSketcher2d` 笔方法家族、`BlueprintSketcher`、预制图形 | import core `geometry2d/*`（curve2d/blueprint） |
| 2D 容器加工 | `draw/drawing.ts`、`drawing-pen.ts`、`drawing-factories.ts`、`draw-fns.ts`、`projection.ts` | `Drawing`/`DrawingPen`、绘制工厂、`drawProjection`/`drawFaceOutline` | import core `geometry2d/*` |
| 2D 运算 | `ops/boolean2d.ts`、`offset.ts`、`custom-corners.ts`、`svg.ts` | 布尔、偏移、圆角/倒角、SVG 往来 | import core `geometry2d/*` |
| 脚本面入口 | `draw.ts`（`cad.draw`）、`namespace.ts` | `cad.draw` 链式绘图库函数（纯 TS，无内核分派，返回可放置轮廓数据对象）；`createDrawNamespace`/`mergeDrawNamespace`/`registerDrawSymbols` 镜像 sketch 包 | peerDep core；合并进 `createApiNamespace()` |

**sketch 包（`packages/sketch/src/`，`@faicad/faijs-sketch`）：** 约束草图（`cad.sketch`）已存在，F 组把其求解产物接入统一管线（`faces.ts` 改消费 `organiseBlueprints` 与放置管线）。

包图无环：core 的 `geometry2d/curve2d.ts`、`blueprint.ts`、`organise.ts` 均不得 import `api/`、`brep/`、`mesh/`；只有 `geometry2d/bridge/` 触碰内核，且经接口注入以保持层次（`geometry2d/` 与内核之间加边界适配文件）。draw 包与 sketch 包只经 core 的 `geometry2d/*` 子路径（`Curve2dObj`/`Blueprint`/`organiseBlueprints`）与 `sdk`、`runtime-state`、`symbol-table` 触达 core，不 import core 的 `api/`。

### 3.3 与 faijs 架构约定的融合

- **op 三分类**：2D 纯函数（curve2d/blueprint/draw/ops）不是 op，作为 TS 库函数导出——基座（curve2d/blueprint/organise）经 core 的 `@faicad/faijs/geometry2d/*`，绘图/运算（draw/ops）经 draw 包 `@faicad/faijs-draw`；`sketchOnPlane`/`sketchOnFace`/`punchHole` 是需要内核的 op，在 core 走 `defineOp`（单 brep 实现）注册；`cad.draw` 在 draw 包以纯函数库注入（无内核分派，返回可放置轮廓数据对象而非 Shape）。
- **引擎静态判定，无运行时回退**：2D→3D 桥接依赖 occt 平台原语（`liftCurve2dToPlane`/`buildEdgeOnSurface`/`draftPrism`），brepkit 不支持，故这些 op 声明 `engines: ['occt']`——在 brepkit 链上按静态规则切换为 mesh 或报错，不做 try-catch 回退。
- **Result 原生**：2D 纯函数按 faijs 约定返回 `Result`（或内部抛 `BrepError`，在 op 边界归一）；与 brepjs 的 `Result` 风格天然一致。
- **注册装配点**：core 的新 op（`sketchOnPlane`/`sketchOnFace`/`punchHole`）加进 `api/api-namespace.ts` 的 `createApiNamespace()` return 字面量（`profile` 旁，冲突时置于 `...scriptFaceOps` 之后覆盖）与 `api/index.ts` 导出面，并新增 `geometry2d/*` 子路径导出供 draw/sketch 包 import；重跑 `npx tsx packages/core/scripts/gen-symbol-table.ts` 更新 `lang/symbol-table.generated.ts`，否则 `.fai.js` 静态 `check()` 报函数不存在。draw 包镜像 sketch 包的 `namespace.ts`（`createDrawCadNamespace`/`mergeDrawNamespace`/`registerDrawSymbols`），经 `registerLib('cad', …)` 合并，不写进 core 的 `createApiNamespace()`。若 core 桥接 op 经 `arg-spec` 生成路径，则改 `arg-spec.ts` 的 `kind` 后重跑 `gen-l3-surface.ts`（注意其 vendored 分支指向已删除的 `@faicad/faijs-brepjs`，2D 新符号应走 `selfhost:true`/`kind:'faijs'` 或路径 A 的手写 op）。

### 3.4 目标指引：曲面草图（不砍）

用户明确"这个面甚至不一定是平面"。架构必须容纳：

- `sketchOnFace(face, scaleMode)`：经 `extractSurfaceFromFace` 取曲面 → `uvBounds` → 按 `scaleMode`（`original`/`bounds`/`native`）把 2D 曲线映射到 UV 域 → `buildEdgeOnSurface` 成 3D 边 → `fixWireOnFace` 贴面。`original` 支持平面与圆柱，`bounds`/`native` 支持任意参数曲面。
- `FaceSketcher`：以 UV 坐标在（含非平面）面上直接画。
- 曲面草图的 3D 出口：`extrude` 沿面法向，或 `sweepSketch` 以 `baseFace` 为支撑面。

**第一版只实现平面，但 `geometry2d/bridge/` 的接口形状（输入 `face`、`scaleMode`）、`Curve2dObj` 的完备性、以及 `buildEdgeOnSurface`/`extractSurfaceFromFace` 的原语位置必须现在就为曲面留好**——这样曲面草图只是"实现一个已有接口"，而不是"重构架构"。

## 4. 内核原语补齐方案

| 原语 | 语义 | 归属 | 实现方式 | 依据 |
|---|---|---|---|---|
| `intersectCurves2d` | 2D 曲线求交（解析 + Newton） | **不入口内核**，纯 TS | 随 `geometry2d/curve2d.ts` 一起移植 `intersectCurves2dFn` | 纯 TS，零 WASM，brepjs 即在 TS 层 |
| `liftCurve2dToPlane` | 2D 曲线 → 平面上的 3D 边 | **occt 平台面（L2）** | occt-wasm 原生有点列版 `(points2d[], origin, z, x)`；core 组合层把 `Curve2dObj` 求值/构边后调用。line/circle/arc 走精确边，bezier/bspline 抬控制点 | brepkit 不可对齐（`engine-method-map.json` 已标 occt-only） |
| `buildEdgeOnSurface` | 2D 曲线 → 参数曲面上的 3D 边 | **core 组合实现** | occt-wasm 无原生；按 brepjs 方式采样 N 点 + `interpolatePoints`（faijs L1 已有 `interpolatePoints`） | 组合实现，不依赖原生 |
| `draftPrism` | 带拔模角的棱柱（打孔） | **occt 平台面（L2）** | occt-wasm 原生 `draftPrism(shape, dx, dy, dz, angleDeg)`；正式暴露给 core 平台面 | 已在 `fai_cq_warehouse`/`cq-compat` 经强转使用 |
| `assembleWire` | 混装 edge/wire → wire | L1 或组合 | 现有 `makeWire`（`primitives.ts:172`）+ 对混合输入补 `makeWireFromMixed` | 能力表已声明、core 未实现（骨架缺口） |

**分层决策**：不强行扩 L1 `BrepEngineApi`——`liftCurve2dToPlane`/`draftPrism` 在 brepkit 无对应，扩 L1 会破坏"双方语义对齐"约束。正确做法是**纳入 occt 平台面（L2，occt-only）**，op 侧声明 `engines:['occt']`，符合 faijs"能力按引擎归属、静态分派"的既有设计（参考 `brep/engine/adapters/occt.ts:33-152` 的能力名单机制）。

## 5. 工作项

组织原则：每项可独立开始、发现一个解决一个、立刻写代码；下列"依赖"仅表示技术前置，不是阶段闸门。实施节奏遵循既有开发循环——取一项 → 写代码 + 单测 → 跑通 → rebuild + 提交 → 下一项。每项一个 PR 主题，不夹带。

### A 组：2D 纯几何基座（core）

- **A1 移植 `geometry2d/curve2d.ts`**：全量移植 brepjs `src/kernel/geometry2d.ts`（1059 行）——`Curve2dObj` 六种曲线、求值/切线/bounds、构造族、变换族、`intersectCurves2dFn`（解析解族 + Newton 兜底）、`createBBox2d`/`addCurveToBBox`、序列化。文件头保留 Apache-2.0 版权与出处注记（延续 `svg-to-solid.ts:4` 的"适配自 brepjs，注明出处"惯例）。判别字段改名 `kind2d`（替代 brepjs 的 `__bk2d`，对齐 faijs 命名，2026-09-27 已定）。依赖：无。
- **A2 迁移保真测试**：在 brepjs 仓库对同一输入跑出真值 → 固化为 faijs 断言，覆盖六种曲线求值、构造族、变换族、序列化往返、求交各类型（line-line/line-circle/circle-circle/同心圆/Newton 路径/自交守卫）。目的：防迁移漂移。依赖：A1。

### B 组：2D 容器与分类（core）

- **B1 移植容器三件套**：`geometry2d/blueprint.ts`（`Blueprint`）、`compound-blueprint.ts`（`CompoundBlueprint`）、`blueprints.ts`（`Blueprints`）——构造、bbox 缓存、`orientation`、`isInside`、`isClosed`、`intersects`、变换族、`toSVG*`。**关键适配**：curves 用 `Curve2dObj[]`（纯对象），去掉 brepjs 的内核句柄与 dispose 语义（faijs 是纯数据）；`isInside` 的射线求交调 `intersectCurves2dFn`。依赖：A1。
- **B2 移植 `organiseBlueprints`**：`geometry2d/organise.ts`——Flatbush 空间索引分组 + union-find + 首曲线中点探针 + `isInside` 分层 + 多外环拆分 + ≥3 层嵌套。Flatbush 作为 core 正式依赖引入（MIT、零传递、~2KB），`check-ghost-deps` 需通过。依赖：B1。
- **B3 分类统一验证**：对 brepjs 同输入对照（单环/双岛/岛-孔/三层嵌套/两不相交多环组/bbox 重叠不包含），分层结果一致。依赖：B2。

### C 组：2D 绘图 DSL（完整绘图）→ `cad.draw`（draw 包）

本组交付 `@faicad/faijs-draw` 包内 `cad.draw` 脚本面 API 的底座：`cad.draw()` 链式绘图，轮廓对象自带 2D 运算，产出可放置轮廓，最终与 `profile`/`sketch` 一样经 core 的放置管线支持 3D 拉伸。落点在 `packages/draw/src/draw/`，只 import core 的 `@faicad/faijs/geometry2d/*`。

- **C1 移植笔方法基座**：`packages/draw/src/draw/base-sketcher.ts`（`BaseSketcher2d`）与 `generic-sketcher.ts` 接口——line/vLine/hLine/vLineTo/hLineTo/polarLine/polarLineTo/tangentLine/threePointsArc/sagittaArc/vSagittaArc/hSagittaArc/bulgeArc/vBulgeArc/hBulgeArc/tangentArc/ellipse/halfEllipse/bezier/quadratic/cubic/smoothSpline/customCorner + `done`/`close`/`closeWithMirror`/`closeWithCustomCorner`。产物为 `Curve2dObj[]` → `Blueprint`。依赖：B1。**已落地（初版）**：`BaseSketcher2d` 先以 core 的 `geometry2d/pen-sketcher.ts` 纯对象基座落地（lines/arcs/beziers/ellipse 家族与 `close`/`curves`，8 pen 测试通过）；SVG-style 椭圆弧经 `svg-ellipse.ts`（`makeEllipseArcFromSvgParams`/`normalizeEllipseRadii`，trimmed form、独立 4 测试）实现，`ellipseTo`/`ellipse`/`halfEllipseTo`/`halfEllipse` 已如实落地；`smoothSpline*`/`customCorner`/`closeWithMirror` 依赖 D/comers 与 Spline 助手未实现（如实抛 `not yet ported`），待随 D 组补齐。
- **C2 移植 `BlueprintSketcher` 与预制图形**：`blueprint-sketcher.ts`、`canned-blueprints.ts`（`polysidesBlueprint`/`roundedRectangleBlueprint`）。依赖：C1。**已落地**：core `geometry2d/blueprint-sketcher.ts`（`BaseSketcher2d` 子类 + `done(): Blueprint`）与 `canned-blueprints.ts`（多边形 / 圆角矩形，圆形用 `tangentArc`、椭圆角用 `ellipse`），5 测试通过（六边形轮廓/射线弧、直角、圆角 4 弧+4 线、椭圆角皆闭合）。
- **C3 移植 `Drawing`/`DrawingPen` 与绘制工厂（`cad.draw` 入口）**：`packages/draw/src/draw/drawing.ts`（不可变 2D 包装，含 2D 布尔/偏移/圆角委托）、`drawing-pen.ts`、`drawing-factories.ts`（矩形/圆/椭圆/多边形/文字/插值/参数曲线）、`draw-fns.ts`；`cad.draw()` / `cad.draw.roundedRectangle(...)` 等即在此接入脚本面。**已落地（底座）**：`@faicad/faijs-draw` 包已建（package.json/workspaces(顺序在 core 后)/tsconfig{,.build}/vitest alias/lockstep `^0.18.0`/ghost-deps 全绿，`npm run build -w` 出 dist）；`src/draw.ts` 提供链式 `draw(session): Blueprint` + 命名空间工厂 `draw.rectangle/roundedRectangle/polygon/circle`，`drawing-factories.ts` 复用 core `geometry2d`；6 包内测试通过。脚本侧 `cad.draw` 运行时注入（F1 registerDrawSymbols）已落地：`src/namespace.ts` 提供 `createDrawCadNamespace()`/`mergeDrawNamespace()`（在 core `createApiNamespace()` 之上并入 `draw`）与 `registerDrawSymbols()`/`unregisterDrawSymbols()`（在 core 符号表登记/注销 `draw` 键），宿主可整体折进 `cad`。
- **C4 移植投影出图**：`projection.ts`（`drawProjection`/`drawFaceOutline`，3D 边 → 2D 曲线 → Blueprint）。依赖：B1、A1。
    - **已落地（纯几何形式）**：vendored `projection.ts` 已删、无内核可投影，故定义纯投影：`projectPointToPlane`/`projectWire`（`(p−o)·xDir/(p−o)·yDir`，与 `liftPointToPlane` 严格互逆）/`drawFaceOutline`（单轮廓）/`drawProjection`（多轮廓）→ 经 `BlueprintSketcher` 折线闭合为 `Blueprint`，仅 import core `geometry2d/*`；含 roundtrip 逆幺元测试。

### D 组：2D 运算（draw 包）

本组落点在 `packages/draw/src/ops/`，作为 `Drawing` 的 2D 运算后端，只 import core 的 `@faicad/faijs/geometry2d/*`。

- **D1 2D 布尔**：`packages/draw/src/ops/boolean2d.ts` 移植 `intersectionSegments.ts`/`booleanHelpers.ts`/`segmentAssembly.ts`/`booleanOperations.ts`/`boolean2D.ts`（fuse/cut/intersect 多态，含 Compound/Blueprints 递归分解）。适配：句柄操作换纯对象函数（`splitCurve2d`/`intersectCurves2dFn`/变换族）。依赖：B1、A1。
    - **基元已备**：纯基座已新增 `parameterOfPoint(c, px, py, maxRatio=0.1)`（coarse 采样 + Newton 收敛到垂直足）与 `trimCurve(c, tStart, tEnd)` / `splitCurveAt(c, t)`（basis 域切子曲线），供布尔/圆角取参数点与切曲线（依赖 `intersectCurves2dFn` 联合使用）。
    - **分类器已落地**：`packages/draw/src/ops/boolean.ts` 已含 `pointInContour(p, pts)`（even-odd 射线内/外分类）与 `segmentIntersection(a1,a2,b1,b2,eps)`（两线段交点/参数，平行与越界返 `null`，共线交叠留给拼接特判）。二者是 D1 布尔判定「保留哪一侧、边在何处相交」的基础。
    - **缝合已落地**：`booleanUnion2d` / `booleanIntersect2d` / `booleanDifference2d` 走「拆分−分类−装配」：用 `segmentIntersection` 把 A/B 每条边在交叉处分段，`pointInContour` 判定段中点归属（并集=不落入对方内部，交集=落入对方内部，差集=保留 A 不在 B 内 + 落在 A 内的 B 边界取反向），再按端到端装配回闭环。多边形输入（含非凸）输出面积精确；共线交叠未做特殊剪除（完整布尔仍需补 collinear splice）。
- **D2 2D 偏移**：移植 `offset.ts`（源自 `blueprintOffset.ts` + `lib/offset.ts`，round/bevel/miter，Cavalier Contours 思路，自交剪除 + stitch）。依赖：D1。
    - **基元已落地**：`packages/draw/src/ops/offset.ts` 的 `offsetOutline2d(verts, dist)` 对凸 CCW 轮廓做 miter 平行偏移（每顶点 = 两条邻边各沿外法向平移 `dist` 后的交点），正值外扩/负值内缩，O(n)。非凸/自交轮廓的 Cavalier 自交剪除仍待做（横向相交已可，切向/顶点塌陷重叠仍待做）。
    - **剪除已落地（横向）**：`packages/draw/src/ops/polygon2d.ts` 的 `pruneSelfIntersections(pts)` 把自交闭环分解为简单叶并保留正面积（CCW）瓣，`decomposeSelfIntersections` 逐交叉分裂；`offsetPolygonLoops2d(verts, dist)` 让偏移经过该剪除返回剪除后的闭环。可处理 proper 横向自交（如蝴蝶结）；偏移被推过臂的切向/顶点塌陷重叠（会翻成单一 CW 环）尚未剪除。
- **D3 2D 圆角/倒角**：移植 `custom-corners.ts`（源自 `blueprintCustomCorners.ts` + `lib/customCorners.ts`，`fillet2D`/`chamfer2D`）。依赖：B1。
    - **基元已落地**：`packages/draw/src/ops/custom-corners.ts` 已含 `chamfer2d(corner,p,q,inset)` 与 `fillet2d(corner,p,q,radius)`（两直线段共顶点处的直线倒角 / 切圆弧圆角，返回三曲线拼接 `CornerSplice`/`FilletCorner`，圆角弧经 `makeArc2dThreePoints` 保持精确半径，圆心在角平分线上）。纯 2D，仅依赖 core `geometry2d`（§197/§199）。
- **D4 SVG 往来**：移植 `svg.ts`（源自 `lib/svgPath.ts`/`svg.ts`/`blueprintApproximations.ts`，2D ↔ SVG path）。依赖：B1。
    - **往返已落地**：`packages/draw/src/ops/svg.ts` 已含 `contourToSvgPath(loops)`（每闭环 `M…L…Z`，绝对坐标、3 位小数）与 `svgPathToContours(d)`（解析绝对/相对 `M/m`、`L/l`、`H/h`、`V/v` 与 `Z/z`，含 move 后隐式 line 对与指数数字），多边形轮廓精确往返。

### E 组：2D→3D 桥接（core）

- **E1 内核原语核对与补齐**：对 `liftCurve2dToPlane`/`buildEdgeOnSurface`/`draftPrism`/`makeWireFromMixed` 逐项核对并在 occt 平台面/core 组合层落地（见 §4）。产出 Agent Note 记录归属决策。依赖：无（可先做）。**已落地（部分）**：`liftCurve2dToPlane` 以 core 组合层 `geometry2d/bridge/lift-on-plane.ts` 形式落地（逐曲线求值 + 既有 `makeLineEdge`/`makeArcEdge`/`makeBezierEdge`/`makeWire` 构边，无需扩 L1）；`buildEdgeOnSurface` 已随 E3 在 `geometry2d/bridge/on-surface.ts` 落地（采样→UV 映射→`interpolatePoints` spline）；`draftPrism`/`makeWireFromMixed` 待后续。
- **E2 `sketchOnPlane`**：`geometry2d/bridge/sketch-on-plane.ts`——`curvesAsEdgesOnPlane`（逐曲线 `liftCurve2dToPlane`）+ `assembleWire` → 3D wire/face，携带 `defaultOrigin`/`defaultDirection`。测试：XY/XZ/自定义平面 → wire 顶点坐标断言。依赖：E1、B1。**已落地**：桥接在 `geometry2d/bridge/`（`plane.ts` 帧 + `lift-on-plane.ts`），op 在 `api/sketch-on-plane.ts`（`cad.sketchOnPlane`，`as:'face'|'wire'`，命名平面 `'XY'`/`'XZ'` 或显式 `{origin,normal,xAxis}`），已接 `createApiNamespace`/`api/index.ts`/`gen-symbol-table`；e2e 断言 XY/XZ/显式位移帧/命名带偏移/斜平面/`as:'wire'` 全部通过；另 e2e 覆盖整圆轮廓（桥 `liftCurve2dToPlane` 弧拆分→`makeFace`→`extrude` 体积校验）。
- **E3 `sketchOnFace`（曲面草图，目标指引）**：`geometry2d/bridge/sketch-on-face.ts`——`extractSurfaceFromFace` + `uvBounds` + `curvesAsEdgesOnFace`（scaleMode original/bounds/native）+ `buildEdgeOnSurface`，闭合后 `fixWireOnFace`。`original` 先支持平面/圆柱，`bounds`/`native` 支持任意面。测试：圆柱面/平面，三种 scaleMode。依赖：E1、B1。**已落地（基础）**：`geometry2d/bridge/on-surface.ts` 提供 `MakeUvMap`/`curves2dBounds`（采样跨曲线真值域 `curveBounds`，修复 `[0,1]` 欠采样）/`buildEdgeOnSurface`（≤2 独立点→`makeLineEdge`，否则 `interpolatePoints` spline）/`assembleWireOnFace`；op 在 `api/sketch-on-face.ts`（`cad.sketchOnFace({contours,on,face,scaleMode?,as?})`，face=序号或 `cad.faceRef`，经 `buildEdgeResolutionContext` 解析活面），已接 `createApiNamespace`/`api/index.ts`/`gen-symbol-table`；e2e 断言 box 顶面放置 `original`/`bounds` 拉伸正体积、`as:'wire'` 得 on-face 曲线。`fixWireOnFace` 曲面贴合（makeFace 仅平面精确）待后续。
- **E4 `punchHole`**：`geometry2d/bridge/punch-hole.ts`——`subFace`（草图在目标面上成面）+ `draftPrism`（`height=null` 通孔，含 `draftAngle`）。测试：产物 volume 断言（含拔模）。依赖：E1、E3。**已落地（基础）**：op 在 `api/punch-hole.ts`（`cad.punchHole({contours,on,face,height?,draftAngle?,scaleMode?})`，`on`+`face=序号或 faceRef`；`height=` 盲孔、`height:null` 通孔；面法向内侧挤出棱柱并 `kernel.cut`），已接 `createApiNamespace`/`api/index.ts`/`gen-symbol-table`；因 occt `kernel.extrude` 对 on-surface 桥 wire 派生面的近共面外壳体积坍缩到 ~0，改用`buildPolygon3d` 在宿主面平面重建严格共面、直线边的多边形再挤出（GOTCHA 回归断言已落 e2e）；e2e 断言 20×20×10 box 顶面 4×4 通孔 volume≈3840、盲孔 height:4 volume≈3936、非零 `draftAngle` 抛 `E_PUNCH_DRAFT_UNSUPPORTED`。`draftAngle` 拔模待后续。
- **E5 `Sketch`/`CompoundSketch` 包装与 3D 出口**：`Sketch`（wire + defaultOrigin/Direction + baseFace）的 `extrude`/`revolve`/`sweepSketch`/`loftWith`，`CompoundSketch`（孔用独立实体 cut）——接到 faijs 现有 `cad.extrude`/`revolve`/`sweep`/`loft`。依赖：E2、E3。

### F 组：API 接线与统一

- **F1 新 op 与命名（已定）**：core 新增 `api/sketch-on-plane.ts`/`sketch-on-face.ts`/`punch-hole.ts` 用 `defineOp` 包装 `sketchOnPlane`/`sketchOnFace`/`punchHole`；draw 包 `op.ts` 新增 `cad.draw`（链式绘图，纯函数库）；`cad.profile` 保留。core 新增 `geometry2d/*` 子路径导出，接入 `createApiNamespace` + `api/index.ts` + 重跑 `gen-symbol-table.ts`；draw 包 `namespace.ts` 提供 `registerDrawSymbols`，并新增包（package.json/workspaces/lockstep/check-ghost-deps）。命名见 §6。依赖：E2/E3/E4、C 组。
- **F2 profile 分类消 H15**：`api/profile.ts` 把 `ProfileSeg`（line/arc）适配为 `Curve2dObj`，分类段整体替换为 `organiseBlueprints`，删除自造 parent 链/`depthOf`/面积比较。防回归测试见 §7。依赖：B2。
- **F3 SVG 统一（已定：统一，不保留采样版）**：`svg-to-solid.ts` 的 `classifyHoles`（`:757-818`）删除，统一走 `organiseBlueprints`。前置子任务：把 SVG parser 从「出离散采样点」升级为「出 `Curve2dObj`」（line/arc/bezier）。现有 `classifyHoles` 有 bug（质心探针跑丢 + ≥3 层嵌套静默丢岛，见 §7 防回归测试），删掉即消债，不留采样版 tech debt。依赖：B2。
- **F4 约束草图接入统一管线**：`packages/sketch` 的求解产物 `SketchGeom` → 转 `Curve2dObj[]` → 走统一分类与放置管线（替代当前直接 `buildProfileShape`）；使约束草图也能放到任意平面/面。依赖：B2、E2。
- **F5 命名空间/符号表/文档**：core 新能力在 `ops-api-inventory.md`、`api-namespace.ts`、`symbol-table.generated.ts` 的登记；draw 包新能力在 draw 包自身登记并新增包（package.json/workspaces 顺序/lockstep/ghost-deps）；必要时 `arg-spec.ts` 的 skip → faijs/selfhost。
- **F6 三入口统一 3D 化（统一拉伸）**：让 `cad.profile`/`cad.sketch`/`cad.draw` 的产物都能经 `sketchOnPlane`/`sketchOnFace` 放置并 `extrude`；统一"轮廓 → 放置 → 3D 特征"接线，并验证三入口在 3D 能力上等价（差异仅在 2D 描述方式）。依赖：F1、F2、F4、E5。
    - **已落地（内核放置缝）**：放置核心抽为 `buildShapeFromBlueprints(kernel, plane, blueprints, as)`（core `api/sketch-on-plane.ts`），`buildSketchOnPlaneWith` 改为先转 `Blueprint[]` 再调用；e2e 已证 draw 形状轮廓（`roundedRectangleBlueprint`，即 draw 工厂产出的 `Blueprint`）经 `buildShapeFromBlueprints` → 放置 → `extrude` 得正体积实体。draw 入口已能流入同一条放置管线。

### G 组：目标指引落地（可最后，但方向必须在架构里）

- **G1 平面草图 e2e**：任意平面上草图 → `extrude` 沿草图法向 → 实体；`punchHole` 打孔。
- **G2 曲面草图 e2e**：圆柱面/参数曲面上草图 → 拉伸/打孔。
- **G3 `extrude` 沿草图法向**：`cad.extrude(sketch, distance)` 读取草图法向（而非固定 Z）；契约并入 `docs/api-contract.md`。

## 6. API 面契约（命名已定：2026-09-27）

命名落定：新增 `cad.draw`（链式绘图，独立子包 `@faicad/faijs-draw`）、保留 `cad.profile`（数据式，core）、`cad.sketch` 保持约束草图（`@faicad/faijs-sketch`，`packages/sketch/src/op.ts:108-124`）。三者最终统一支持 3D 拉伸；`cad.sketch` 被约束求解占用，故"放置"改用 core 的 `sketchOnPlane`/`sketchOnFace`。core 的 2D 脚本面入口只有 `cad.profile`；`sketchOnPlane`/`sketchOnFace`/`punchHole`/`extrude` 是 core 提供的放置与 3D 拉伸能力。

| 能力 | 名称 | 归属 | 签名/形态 |
|---|---|---|---|
| 自由绘图（脚本面，**新增**） | `cad.draw` | `@faicad/faijs-draw` | `cad.draw().hLineTo(10).vLineTo(20).close()`；或 `cad.draw.roundedRectangle(w, h, r)`；产物是可继续 2D 运算的轮廓对象 |
| 轮廓/容器（TS 面，基座） | `Curve2dObj` / `Blueprint` / `CompoundBlueprint` / `Blueprints` | core `@faicad/faijs/geometry2d/*` | 纯数据/类，三包共用 |
| 自由绘图（TS 面） | `Drawing` / `DrawingPen` / 绘制工厂 | `@faicad/faijs-draw` | 类与函数 |
| 数据式轮廓（脚本面，**保留**） | `cad.profile` | core | 现状调用形态向后兼容；底层改走统一 2D 几何与分类管线 |
| 约束草图（**保留**） | `cad.sketch` | `@faicad/faijs-sketch` | 现状不变，产物接入统一管线 |
| 平面草图放置 | `cad.sketchOnPlane` | core | `(轮廓, plane: 'XY'\|'XZ'\|{origin,normal,xDir}, origin?) => Shape`（`轮廓` 可来自 profile/sketch/draw） |
| 曲面草图放置 | `cad.sketchOnFace` | core | `(轮廓, face: FaceRef, scaleMode?) => Shape` |
| 打孔 | `cad.punchHole` | core | `(shape, face: FaceRef, {height?, draftAngle?, origin?}) => Shape` |

`.fai.js` 目标体验（示意）——三个入口最终都走同一条放置 + 拉伸：

```js
// A) cad.draw 链式绘图 → 放置 → 拉伸
const p = cad.draw().hLineTo(40).vLineTo(20).hLineTo(0).close()
const solidA = cad.extrude(cad.sketchOnPlane(p, 'XZ'), 10)

// B) cad.profile 数据式轮廓 → 放置 → 拉伸（向后兼容）
const q = cad.profile({ contours: [rectLoop(20, 10)] })
const solidB = cad.extrude(cad.sketchOnPlane(q, 'XY'), 8)

// C) cad.sketch 约束草图 → 求解 → 放置 → 拉伸
const s = cad.sketch(geoms, constraints)
const solidC = cad.extrude(cad.sketchOnPlane(s, 'XZ'), 6)

// D) 面上草图 + 打孔（面不必是平面）
const f = cad.faceRef(part, { at: [0, 0, 10] })
const boss = cad.extrude(cad.sketchOnFace(p, f), 8)
const hole = cad.punchHole(part, f, { height: null, draftAngle: 2 })
```

（具体签名以 `docs/ops-api-inventory.md` 与 `docs/api-contract.md` 落地为准。）

## 7. 测试计划（关键验证落成可重复测试）

- **迁移保真（A2/B3）**：在 brepjs 仓库对同一输入跑真值 → 固化为 faijs 断言，覆盖全部导出函数与分层结果。防迁移漂移。
- **2D 绘图（C）**：笔方法端到端（每种笔 → 预期 `Curve2dObj` 序列/顶点）、`closeWithMirror`/`customCorner` 边界、预制图形、SVG 往返。
- **2D 运算（D）**：布尔三态 × 相交/不相交/包含/共边/相切、偏移 join 三型 + 自交剪除、圆角倒角、退化输入。
- **桥接（E）**：`sketchOnPlane` 各平面 wire 坐标断言；`sketchOnFace` 平面/圆柱/任意面三 scaleMode；`punchHole` volume 断言（含拔模）；`extrude` 沿法向。
- **H15 场景（F2）**：首点探针失效、面积相等但包含、强非凸月牙、三层嵌套、多岛各带孔、弧环与父环相切/共边——精确求交 + `isOnCurve` 排除下分类正确。`GOTCHA:` 留档旧首点探针 + `<=` 面积跳过的坑。
- **SVG classifyHoles 防回归（F3）**：质心探针跑丢（强凹 C 形/月牙）、三同心圆丢中心岛（≥3 层嵌套）——统一到 `organiseBlueprints` 后分类正确。`GOTCHA:` 留档旧 `classifyHoles` 静默丢岛的坑。
- **三入口等价（F6）**：同一轮廓分别用 `profile`/`draw`（及求解后的 `sketch`）构造 → 放置 → 拉伸，产物几何等价。
- **回归**：现有 profile/svg/sketch 全部测试通过 → 受影响包全量。
- **e2e（G）**：平面/曲面草图 → 拉伸/打孔 → 实体（闭环验收）。
- **规范**：`npm run lint`、`npm run typecheck`（取差，注意既有基线）、stderr 零容忍；单包测试 → 全量 → `scripts/ci.ps1`（只复跑失败项）。

## 8. 风险与边界

- **Newton 数值路径确定性**：仅 bezier/bspline 走；主链路（line/arc）全解析解。
- **迁移漂移**：以"在 brepjs 跑真值 → 固化断言"防漂移（A2/B3 强制）。
- **Flatbush 依赖**：core 新增正式依赖，`check-ghost-deps` 需通过；若后续想去掉，在测试等价前提下换简实现并记 Agent Note。
- **内核原语缺口**：`liftCurve2dToPlane`/`draftPrism` 只能在 occt 平台面落地（brepkit 不可对齐）→ 桥接 op 声明 `engines:['occt']`，brepkit 链按静态规则切换。缺口大则如实上报。
- **Face 类型桥接**：faijs 的 face 引用（`BrepoHandle`/`FaceRef`）→ `geomSurf` 的适配是本迁移最主要的非常规适配点（`extractSurfaceFromFace`）。
- **包图无环**：core 的 `geometry2d/` 纯层（curve2d/blueprint/organise）不得 import `api/`/`brep/`/`mesh/`；桥接经边界适配文件。draw/sketch 包只经 core 的 `geometry2d/*` 子路径触达 core，不 import core `api/`，保证 `draw → core`、`sketch → core` 单向无环。
- **draw 新包运维**：新增 `@faicad/faijs-draw` 须过全链路守卫（`check-workspaces-order` 拓扑顺序、`check-ghost-deps`、`check-dep-lockstep`、madge 包图无环），其发布拓扑纳入发布方案；若为省事临时并进 sketch 包会污染 sketch 包语义，故坚持独立包。
- **许可**：brepjs 为 Apache-2.0，core 为 MIT；收录适配版须在文件头保留版权与许可声明，记 Agent Note（延续 `svg-to-solid.ts` 先例）。draw 包若含从 brepjs 移植的绘图/运算代码，同样须沿用 Apache-2.0 版权注记。
- **`cad.sketch` 命名冲突**：约束草图与自由绘图分名且分属不同包，需在 `ops-api-inventory` 明确二者差异。

## 9. 明确不做 / 待定

- **本方案是目标总纲，不夹带实施**：按工作项逐个 PR，每项一主题；本方案本身不产生代码改动。
- **已定（2026-09-27，见 §1.5、§6、F3）**：新增 `cad.draw`（独立子包 `@faicad/faijs-draw`）、保留 `cad.profile`（core，core 的 2D 脚本面入口只有 profile，并补 3D 拉伸）、`cad.sketch` 保持约束草图；三者统一支持 3D 拉伸；SVG `classifyHoles` 统一到 `organiseBlueprints`（现有采样版分类有 bug，删除不留 tech debt）。
- **已定（2026-09-27）**：`Curve2dObj` 判别字段改名 `kind2d`（替代 brepjs 的 `__bk2d`）。
- **待定（实施时定并记 Agent Note）**：是否引入 Flatbush（或等价自研索引）。建议用Flatbush。
- **不做**：`cad.draw` 不并入 core、不并入 sketch 包；不修改 op 注册签名语义；不改 `packages/brepjs`（保持删除状态，仅其 `dist` 残留，不作为依赖）；不引入 2D 内核句柄体系（2D 曲线用纯对象）。

## 10. 验收标准（"2D 完整"的定义）

1. 能画：任意曲线类型（line/arc/circle/ellipse/bezier/bspline）的完整绘图 DSL + 2D 布尔/偏移/圆角倒角 + SVG 往来。
2. 能汇入：`cad.profile`（数据式，core）、`cad.draw`（链式绘图，draw 包）、`cad.sketch`（约束草图，sketch 包）三个入口共享统一下游管线，3D 能力等价。
3. 能放置：平面上（`sketchOnPlane`）与面上（`sketchOnFace`，含非平面）都能把草图放到模型上。
4. 能建模：`profile`/`sketch`/`draw` 三入口的放置结果都可拉伸（沿面法向）、旋转、扫掠、放样、打孔，产出 3D 实体；e2e 闭环。
5. 能回归：现有 profile/svg/sketch 行为不破，H15 类分类问题消失。