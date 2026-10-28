# 双引擎 API 层方案：OCCT × SMLib 能力对照与 faijs 新 API 层设计（v2，已吸收评审）

日期：2026-10-28 ｜ 状态：方案（核心骨架已实施，2026-10-28 交付，缺口见 §8）
版本：v2 —— 已吸收 `2026-10-28-occt-smlib-dual-engine-api-plan-review.md` 全部修正（v1 的 SMLib 侧事实错误、配对漏认、计数、边界纪律均已修订，逐条 diff 见 §10）。

## 0. 背景与目标（用户原话）

> 用户（2026-10-28）：「occt和SMlib，他们共同支持的那个CAD的操作，的API有哪些？就算是名词不同，但是语义相同的要把它整理出来，然后只有occt支持的API有哪些？只有SMlib支持API有哪些？先把这个方案整理出来，然后再考虑要给faijs增加一个新的API层，这个API只支持occt和SMlib，不支持brePKit」

本方案交付三张能力对照表（共同支持 / occt-only / smlib-only）+ 新 API 层设计。

## 0.1 数据源与统计口径（评审修正后）

- **OCCT 侧**：occt-wasm 5.6.0 `OcctKernel` 完整 API 声明（`node_modules/occt-wasm/dist/index.d.ts`）。机械去重：**209 个方法名**（含 `*WithHistory` 12 个：chamfer/cut/fillet/fuse/intersect/mirror/offset/rotate/scale/shell/thicken/translate）。
- **SMLib 侧**：`C:\git\new\usd-brep\source\SM_API\inc` —— **16 个 API 头文件**（另有 StdAfx.h 非 API 头，共 17 个文件）。`SMAPI_EXPORT` 宏 **194 次**；按声明严格去重导出函数约 133 个（机械统计上限 175，含重载/变体，口径以头文件声明为准）；wasm 桥 `SmApiBridgeEx.cpp` 另导出 **38–40 个 `*Ex` 封装**。
- **wasm 桥**：`C:\git\new\usd-brep\wasm-probe\src\SmApiBridgeEx.cpp` + `SmApiTessellateEx.cpp`。**include 11/16 个 SM_API 头**（Brep/General/Queries/Types/Curves/Surfaces/Fillets/Heal/TrimmedSurfaces/Intersectors/Primitives）；缺 ImportExport/Polygons/StepIo/StlIo/TessellationParams 共 5 个。补导出只需桥侧包装，不动 SMLib 本体。
- **SMLib 历史追踪**：`C:\git\new\usd-brep\source\SMLib\inc\SmTrackTopologyChanges.h`（注意：在 **SMLib/inc**，不在 SM_API/inc）——桥已实现 `SmApiBooleanWithHistoryEx`（SmApiBridgeEx.cpp:665）、`SmApiFilletWithHistoryEx`（:703）。
- **brepkit 侧**：作为被排除方仅做标注（新层不支持 brepkit）。

> 判定口径：两内核均**直接提供**该操作（语义等价、参数面可映射）→ 共同支持；仅一方原生提供 → 单方支持；一方可组合实现（如椭球 = 球×scale）→ 归单方表并在备注标注「可组合达成」。**每能力只在一张表出现**，交叉引用用「见 §x」。

## 1. 范式差异

| | OCCT | SMLib |
|---|---|---|
| 建模范式 | 顶点 → 边 → 线 → 面 → 壳 → 实体（`BRepBuilderAPI_MakeXxx` 显式拓扑构造） | 曲线 → 面 → 扫掠/缝合（`SmApiCreatePlanarFaces`/`CreateXxxSweep`/`Stitch*`；边隐含在面内，**无显式 vertex/edge/wire 构造 API**） |
| compound | **内核真实类型**（`TopoDS_Compound`，`BRep_Builder`） | 内核**无容器类型**（faijs 层虚拟句柄方案，见 2026-10-28 compound 线） |
| 面/线修复 | 完整修复族（`healSolid/healFace/healWire/fixShape/unifySameDomain/simplify/defeature`） | 仅 `SmApiHealBrep`（固体级） |
| 形状类型/相等性 | `getShapeType/isXxx/isSame/isEqual/hashCode` 原生 | 无（faijs 适配层以句柄/登记表派生） |
| 历史追踪（face 级变更） | `*WithHistory` ×12 + `EvolutionData` | **有**（face 级 Rm/Add/Chg，经 `SmTrackTopologyChanges` + 桥 `BooleanWithHistoryEx`/`FilletWithHistoryEx`，见 §2.1） |
| 批量调用 | `*Batch` 族（WASM 单次调用） | 无（逐调用） |

## 2. 三方能力对照表

> 表内 SMLib 侧统一使用 SM_API 头文件导出名；桥级 `*Ex` 封装单独一列标注：**「原生」= SM_API 头文件直接导出，可直接桥接**；「桥已有」= `SmApiBridgeEx.cpp` 已实现（名字带 `Ex`）；「待补桥」= 头文件有、桥还没有，需补包装。OCCT 侧为 OcctKernel 方法名。

### 2.1 共同支持（OCCT × SMLib 语义等价 → 可进入新 API 层）

#### 图元创建
| 语义 | OCCT | SMLib | 桥状态 | 备注 |
|---|---|---|---|---|
| 长方体 box | `makeBox` / `makeBoxFromCorners` | `SmApiCreateBox` | 待查 | |
| 圆柱 cylinder | `makeCylinder` | `SmApiCreateCylinder` | 待查 | |
| 球 sphere | `makeSphere` | `SmApiCreateSphere` | 待查 | |
| 圆锥/截锥 cone | `makeCone` | `SmApiCreateCone` | 待查 | |
| 圆环 torus | `makeTorus` | `SmApiCreateTorus` | 待查 | |
| 平面矩形面 | `makeRectangle` | `SmApiCreateRectangle`（曲线）→ `SmApiCreatePlanarFaces`（面，TrimmedSurfaces.h:61） | 待查 | |
| 平面切实体 | `halfSpace` + `cut`/`common` | `SmApiCut(pBrep, planePt, planeNormal)`（Brep.h:169，**按平面切割实体**，非布尔差） | 待查 | 评审 §2.5 修正：v1 曾把 SmApiCut 错归布尔差 |

#### 曲线构造
| 语义 | OCCT | SMLib | 桥状态 | 备注 |
|---|---|---|---|---|
| 直线段 | `makeLineEdge` | `SmApiCreateLineSegment` | 待查 | |
| 圆 | `makeCircleEdge` / `makeCircleArc` | `SmApiCreateCircle` | 待查 | |
| 圆弧 | `makeArcEdge` | `SmApiCreateArc` | 待查 | |
| 椭圆 | `makeEllipseEdge` / `makeEllipseArc` | `SmApiCreateEllipse` | 待查 | |
| Bezier | `makeBezierEdge` | `SmApiCreateCanonicalCurve`（SM_CF 族）/ `SmApiCreateCurve` | 待查 | |
| B-spline | `makeBSplineEdge` | `SmApiCreateCurve` | 待查 | |
| 螺旋线 | `makeHelixWire` / `makeHelixWireHanded` | `SmApiCreateHelix` | 待补桥 | |
| 点近似曲线 | `approximatePoints` | `SmApiCreateCurveApproxPoints` | 待查 | |
| 点插值曲线 | `interpolatePoints` | `SmApiCreateCurveInterpPoints` | 桥已有 `SmApiCreateCurveInterpPointsEx` | |
| 曲线去节点 | `curveKnotRemove` | `SmApiRemoveCurveKnots` | 待查 | |
| 曲线投影到面 | —（无同名绑定） | `SmApiDropCurveToSrf` / `SmApiProjectCurve` | 待查 | 见 §2.3（SMLib 特色，OCCT 无原生）→ 不在共同表 |
| 实体阵列（重复） | `linearPattern` / `circularPattern` | `SmApiCreateLinearSweepWithRepetitions` / `SmApiCreateRotationalSweepWithRepetitions` | 待查 | 评审 §2.6：名词不同、近似同功能；**输入层级不同**（OCCT 实体阵列 vs SMLib 曲线重复扫掠）→ 标为配对、标注层级差异 |

#### 曲面构造
| 语义 | OCCT | SMLib | 桥状态 | 备注 |
|---|---|---|---|---|
| 平面 | `makeRectangle` / `halfSpace` | `SmApiCreatePlane` | 待查 | |
| 控制点曲面 | `bsplineSurface` | `SmApiCreateSurface` / `CreateSurfaceFromOrderedPoints` | 桥已有 `...FromOrderedPointsEx` | |
| 蒙皮曲面（≈loft 壳） | `loft(wires, isSolid=false)` | `SmApiCreateSkin` / `CreateSkinPrimitive` / `CreateSkinFromFaces` | 待补桥 | 齿轮主依赖 |
| 直纹面 | `loft(wires, ruled=true)` | `SmApiCreateRuledSurface` | 待补桥 | 标准件主依赖 |
| 拉伸曲面 | `extrude`（实体） | `SmApiCreateExtrude` | 待查 | |
| 扫掠曲面 | `sweep`（实体） | `SmApiCreateSweep` | 待查 | |
| 回转曲面 | `revolve`（实体） | `SmApiCreateSurfaceRevolution` | 待查 | |
| 偏移曲面 | `offset`（实体） | `SmApiCreateOffsetSurface` | 待查 | |
| 壳（薄壳） | `shell`（+`shellWithHistory`） | `SmApiShellBrepFull` | 桥已有 `SmApiShellBrepFullEx` | 评审 §6.4 落实：v1 备注称已归 §2.1 但实际没写行，此处补 |
| 实体偏移 | `offset`（+`offsetWithHistory`） | `SmApiOffsetBrepFull` | 待补桥 | |

#### 拓扑构造
| 语义 | OCCT | SMLib | 桥状态 | 备注 |
|---|---|---|---|---|
| 面（平面环） | `makeFace` | `SmApiCreatePlanarFaces`（TrimmedSurfaces.h:61） | 待查 | |
| 面内开孔 | `addHolesInFace` | `SmApiCreatePlanarFaces`（按几何位置自动判内外环建孔） | 待查 | 语义一致 |
| 缝合（成壳/成体） | `sew` / `sewAndSolidify` / `buildSolidFromFaces` | `SmApiStitch` / `StitchAdvanced` / `SimpleFaceStitch` / `StitchIntoShell` | 待查 | |
| 壳→实体 | `makeSolid(shell)` | `SmApiStitchIntoSolid` | 桥已有 `SmApiStitchIntoSolidEx` | 评审 §2.8 配对 |
| 三角形面 | `buildTriFace` | 三条线段 → `SmApiCreatePlanarFaces`（组合） | — | 可组合达成 |

#### 布尔
| 语义 | OCCT | SMLib | 桥状态 | 备注 |
|---|---|---|---|---|
| 并 | `fuse` / `fuseAll` | `SmApiBooleanUnion` / `SmApiMergeBreps` / `SmApiBooleanMerge` | 桥已有（smlibKernel 在用） | |
| 差 | `cut` / `cutAll` | `SmApiBooleanDifference` | 桥已有 | 注意：**不是 `SmApiCut`**（那是平面切，见上图元行） |
| 交 | `common` / `intersect` | `SmApiBooleanIntersection` | 桥已有 | |
| 通用布尔（多参+选项） | `booleanOp` / `booleanPipeline` | `SmApiBooleanWithOptions` / `BooleanWithCurves` / `BooleanLists` / `BooleanTrees` / `NonManifoldBoolean` | 桥已有 | |
| 工具实体分割 | `split(shape, tools)`（BOPAlgo_Splitter） | `SmApiBooleanWithOptions` 的 `bImprinting`（=imprint 相交后即止）/ `bImprintAndClassifyFaces`（=imprint 并标记待删面）（Brep.h:391/393） | 桥已有 | 评审 §2.10 修正：**有直接等价标志**，非「无直接等价」；风险降级为「需验证 face 标记粒度」，见 §3.1 |
| 相交线/点（Section） | `section` / `sectionPlane` | `SmApiIntersectBreps` / `IntersectBrepWithPlane` | 待查 | |

#### 扫掠/放样
| 语义 | OCCT | SMLib | 桥状态 | 备注 |
|---|---|---|---|---|
| 线性扫掠（拉伸实体） | `extrude` | `SmApiCreateLinearSweep` | 桥已有 | |
| 回转实体 | `revolve` | `SmApiCreateRotationalSweep` | 桥已有 `SmApiCreateRotationalSweepEx` | |
| 放样实体 | `loft(wires, isSolid=true)` | `SmApiCreateSkin`（曲面）→ `SmApiStitchIntoSolid`（组合） | 待补桥 + 已有 | 组合达成 |
| 管道 | `pipe` / `simplePipe` / `sweepPipeShell` | `SmApiCreatePipeSweep` | 待查 | |
| 曲线扫掠 | `sweep` | `SmApiCreateSweep` / `CreateCurveSweep` / `CreateCurveSweepFromFaces` / `CreateCurveSweepFromEdges` / `CreateSweepAlongPlanarPath` | 待查 | |
| 锥度拉伸 | `draft` / `draftPrism` | `SmApiCreateTaperExtrude`（curves, height, draftAngleDeg, caps, fillet）/ `CreateDraftSweep` | 待补桥 | 标准件主依赖 |

#### 圆角/倒角
| 语义 | OCCT | SMLib | 桥状态 | 备注 |
|---|---|---|---|---|
| 等半径圆角 | `fillet` / `filletBatch` | `SmApiFilletEdges` / `CircularFillet` | 桥已有 | |
| 变半径圆角 | `filletVariable` | `SmApiVariableRadiusFillet` / `SmApiFilletEdgesPerEdge`（Brep.h:442，逐边半径+截面类型+G1/G2/G3，**更强**） | 待查 | 评审 §2.9：SMLib 侧能力更强 |
| 倒角（距离） | `chamfer` | `SmApiChamferFillet` | 待查 | |
| 倒角（距离+角度） | `chamferDistAngle` | `SmApiChamferFillet` | 待查 | |

#### 变换
| 语义 | OCCT | SMLib | 桥状态 | 备注 |
|---|---|---|---|---|
| 平移 | `translate` / `translateBatch` | `SmApiTranslate` | 桥已有 | |
| 旋转 | `rotate` / `rotateBatch` | `SmApiRotate`（第四参为**度**） | 桥已有 | 单位换算：faijs 角度用度，OCCT 用弧度 |
| 缩放 | `scale` / `scaleBatch` | `SmApiScale` / `SmApiScaleByPt` | 桥已有 | |
| 通用仿射 | `transform` / `located` / `generalTransform` / `composeTransform` | `SmApiTransform` / `SmApiTransformMatrixEx` | 待查 | |

#### 测量/查询
| 语义 | OCCT | SMLib | 桥状态 | 备注 |
|---|---|---|---|---|
| 包围盒 | `getBoundingBox` | `SmApiBrepBoundingBox` / `FaceBoundingBox` / `EdgeBoundingBox` | 桥已有 | |
| 体积 | `getVolume` | `SmApiBrepComputeVolume` | 桥已有 | |
| 表面积 | `getSurfaceArea` | `SmApiBrepComputeArea` / `FaceComputeArea` | 桥已有 | |
| 边长 | `getLength` / `curveLength` | `SmApiEdgeComputeLength` / `SmApiCurveLengthEx` | 待查 | |
| 质心 | `getCenterOfMass` | `SmApiBrepComputeMassProperties` | 桥已有 | |
| 面质心 | `getSurfaceCenterOfMass` | `SmApiFaceComputeCentroid` | 待查 | |
| 惯量 | `getInertia` | `SmApiPolyBrepComputeMassProperties`（近似） | 待查 | |
| 子形状枚举 | `getSubShapes` / `subShapeCount` / `iterShapes` | `SmApiGetFaces` / `SmApiGetEdges` / `FaceGetBoundaryLoops` / `EdgeToCurveEx` / `EdgeVerticesEx` | 桥已有 | |
| 面外环 | `outerWire(face)` | `SmApiFaceGetBoundaryLoops`（含外环） | 待查 | 评审 §2.7 配对 |
| 点分类（体内/面上） | `containsPoint` | `SmApiFaceClassifyUV`（面级，近似） | 待查 | |
| 形状距离 | `distanceBetween` | `SmApiBrepDistance` / `CurveClosestPoint` | 待查 | |
| 面边关系 | `sharedEdges` / `adjacentFaces` | `SmApiFaceGetBoundaryLoops`（部分） | 待查 | |

#### 曲线/曲面求值
| 语义 | OCCT | SMLib | 桥状态 | 备注 |
|---|---|---|---|---|
| 曲线上点 | `curvePointAtParam` | `SmApiCurvePointAtParamEx` | 待查 | |
| 曲线切线 | `curveTangent` | `SmApiCurveTangentEx` | 待查 | |
| 曲线参数域 | `curveParameters` | `SmApiCurveParametersEx` | 待查 | ⚠️ 数值语义差异见 §3.3 |
| 曲线类型 | `curveType` | `SmApiCurveTypeEx` | 待查 | |
| 曲线闭合 | `curveIsClosed` | `SmApiCurveIsClosedEx` | 待查 | |
| 曲面类型 | `surfaceType(face): SurfaceKind` | `SmApiSurfaceTypeEx`（桥 :242） | 桥已有 | 评审 §2.3：v1 两侧完全漏提 |
| 曲面点 | `pointOnSurface` | `SmApiEvaluateSurfacePoint` / `SmApiPointOnSurfaceEx` | 待查 | |
| 曲面法向 | `surfaceNormal` | `SmApiEvaluateSurfaceNormal` / `SmApiSurfaceNormalEx` | 待查 | |
| 曲面导数 | `surfaceCurvature` | `SmApiEvaluateSurfaceDerivatives` | 待查 | |
| UV 域 | `uvBounds` | `SmApiFaceUvBoundsEx` | 待查 | |

#### 投影/相交
| 语义 | OCCT | SMLib | 桥状态 | 备注 |
|---|---|---|---|---|
| 点投影到面 | `projectPointOnFace` | `SmApiFaceClosestPoint` / `SurfaceClosestPoint` / `BrepClosestPoint` | 待补桥 | 齿轮主依赖 |
| 点投影到边 | `projectPointOnEdge` | `SmApiEdgeClosestPoint` / `CurveClosestPoint` | 待查 | |
| 顶点位置 | `vertexPosition(vertex)` | `SmApiVertexGetPoint`（Queries.h:336） | 待查 | 评审 §2.4：v1 两侧完全漏提 |
| 曲线相交 | —（无同名绑定） | `SmApiIntersectCurves` | 待查 | 见 §2.3 |
| 面相交 | —（无同名绑定） | `SmApiIntersectSurfaces` / `SmApiIntersectFaces` / `SmApiIntersectCurveFace` / `SmApiIntersectCurveBrep` | 待查 | 见 §2.3 |

#### 历史追踪（评审 §1 修正：SMLib 有）
| 语义 | OCCT | SMLib | 桥状态 | 备注 |
|---|---|---|---|---|
| 布尔带历史（face 级 Rm/Add/Chg） | `fuseWithHistory` / `cutWithHistory` / `intersectWithHistory` / `booleanOp(EvolutionData)` | `SmApiBooleanWithHistoryEx`（桥 :665，返回 Rm/Add/Chg 三组面） | 桥已有 | 评审 §2.1 配对；能力对等（face 级） |
| 圆角带历史 | `filletWithHistory` | `SmApiFilletWithHistoryEx`（桥 :703） | 桥已有 | 评审 §2.2 配对 |
| 其余带历史族 | `chamfer/mirror/offset/rotate/scale/shell/thicken/translate WithHistory` ×8 | —（仅布尔/圆角两族） | — | 这 8 个归 occt-only，见 §2.2 |

#### 修复
| 语义 | OCCT | SMLib | 桥状态 | 备注 |
|---|---|---|---|---|
| 修复实体 | `healSolid` / `fixShape` | `SmApiHealBrep` | 桥已有 | |
| 统一法向 | `fixFaceOrientations` | `SmApiUnifyNormals` | 待查 | |
| 流形判定 | `isValid` | `SmApiBrepIsManifoldSolid`（近似） | 待查 | |

#### IO
| 语义 | OCCT | SMLib | 桥状态 | 备注 |
|---|---|---|---|---|
| STEP 导入 | `importStep` / `importXCAFFromSTEP` | `SmApiImportStepEx` | 桥已有 | |
| STEP 导出 | `exportStep` | `SmApiExportStepEx` | 桥已有 | |
| STL 导入 | `importStl` | `SmApiImportStlEx`（SmApiStlIo.h，**桥未接**） | 待补桥 | 评审 §4 修正名字（v1 误写 `SmApiStlIo/ReadStl*`） |
| STL 导出 | `exportStl` | `SmApiExportStlEx`（SmApiStlIo.h，**桥未接**） | 待补桥 | 同上 |
| BREP 序列化 | `toBREP`/`fromBREP`/`toBREPBinary`/`fromBREPBinary` | `SmApiWriteBrepToFile`/`SmApiReadBrepFromFile`（文件级） | 待查 | 语义部分对应 |

#### 网格/渲染
| 语义 | OCCT | SMLib | 桥状态 | 备注 |
|---|---|---|---|---|
| 三角化 | `tessellate` / `meshShape` / `meshBatch` | `SmApiTessellate` / `SmApiTessellateEx` | 桥已有 | |
| 线框 | `wireframe` | `SmApiTessellateBoundaries` / `SmApiTessellateBoundariesEx` | 桥已有 | |

#### 生命周期
| 语义 | OCCT | SMLib | 桥状态 | 备注 |
|---|---|---|---|---|
| 释放 | `release` / `releaseAll` / `checkpoint` / `releaseSince` | `SmApiDeleteBrepEx`（faijs 登记表 + 轮末清扫方案） | 桥已有 | |
| 复制 | `copy` | `SmApiBrepCopy` | 待查 | |

### 2.2 仅 OCCT 支持（SMLib 无原生 → 不进新层，或待 SMLib 补桥）

| 类别 | API（OcctKernel） | 说明 |
|---|---|---|
| 显式拓扑构造 | `makeVertex` / `makeEdge` / `makeWire` / `makeFaceOnSurface` / `removeHolesFromFace` / `makeNullShape` | SMLib 无顶点/边/线构造；wire 已由 faijs 虚拟句柄承接 |
| 特殊图元 | `makeEllipsoid` / `halfSpace` | 椭球可球×scale 组合；半空间可用 `SmApiCut` 平面切达成（见 §2.1） |
| 镜像 | `mirror` / `mirrorBatch` | SMLib 经 `SmApiTransform` 反射矩阵可组合达成（评审 §6.1：v1 误放共同表） |
| 不对称倒角 | `chamferAsymmetric` | SMLib `SmApiChamferFillet` 为单距离形态（语义子集） |
| 高级放样 | `loftWithVertices` | SMLib 无 |
| 高级扫掠族 | `sweepOriented` / `sweepAdvanced` / `sweepFull` / `sweepPipeShell` / `buildExtrusionLaw` / `trimLaw` / `sweepWithLaw` | SMLib 仅基础扫掠 |
| 历史族（其余 8 项） | `chamfer/mirror/offset/rotate/scale/shell/thicken/translate WithHistory` | SMLib 仅布尔/圆角两族带历史（见 §2.1） |
| 批量族 | `queryBatch` / `filletBatch` / `transformBatch` / `rotateBatch` / `scaleBatch` / `mirrorBatch` / `meshBatch` / `translateBatch` | SMLib 逐调用 |
| 修复族 | `healFace` / `healWire` / `unifySameDomain` / `simplify` / `defeature` / `removeDegenerateEdges` / `buildCurves3d` / `fixWireOnFace` | SMLib 仅 `HealBrep`（固体级） |
| 增厚 | `thicken`（+`thickenWithHistory`） | SMLib 无对应（评审 §8 确认） |
| NURBS 工具 | `curveDegreeElevate` / `curveKnotInsert` / `curveSplit` / `getNurbsCurveData` / `curveIsPeriodic` / `interpolatePointsWithTangents` / `liftCurve2dToPlane` / `makeTangentArc` | SMLib 仅 `RemoveCurveKnots`/`ConvertToLinesAndArcs` |
| 面分析 | `reverseSurfaceU` / `getFaceCylinderData` / `uvFromPoint` / `getLinearCenterOfMass` | SMLib 部分无 |
| 拓扑遍历/相等 | `downcast` / `edgeToFaceMap` / `subShapeHashes` / `shapeOrientation` / `isCompound/isCompSolid/isShell/isFace/isWire/isEdge/isVertex` / `isSame/isEqual/hashCode/isNull` / `hasTriangulation` | SMLib 无（faijs 以句柄/登记表派生） |
| 容器 | `makeCompound` | SMLib 无容器类型；faijs 虚拟句柄方案（2026-10-28 compound 线），见 §1 |
| 单元选择布尔 | `intersectionCells`（BOPAlgo_CellsBuilder） | SMLib 无 |
| 反向形状 | `reverseShape` | SMLib 无（UnifyNormals 方向不同） |
| 渲染/HLR | `projectEdges` / `toSVG` / `toPNG` / `toMultiviewSVG` / `toMultiviewPNG` | SMLib 无 |
| XCAF/GLTF | `createXCAFDocument` / `importXCAFFromSTEP` | SMLib 无 |
| 2D 线偏移 | `offsetWire2D` | SMLib `OffsetCurve`（曲线级）→ 见 §2.3 |

### 2.3 仅 SMLib 支持（OCCT 无原生 → SMLib 特色能力）

| 类别 | API（SM_API） | 说明 |
|---|---|---|
| 非流形布尔/扫掠 | `SmApiNonManifoldBoolean` / `SmApiNonManifoldSweep` / `SmApiNonManifoldRotationalSweep` | OCCT 无非流形构造入口 |
| 2D 布尔 | `SmApiBoolean2d` | 2D 面布尔 |
| 多边形级操作 | `SmApiPolyBoolean*` ×4 / `SmApiPolyBrepIsManifoldSolid` / `SmApiPolyBrepComputeVolume` / `SmApiPolyBrepComputeMassProperties` / `SmApiPolyBrepCopy` | OCCT 无 |
| 曲线工具族 | `SmApiMakeCurvesCompatible` / `SmApiOrderCurves` / `SmApiConvertToLinesAndArcs` / `SmApiDropCurveToSrf` / `SmApiLiftUVCurveFromSrf` / `SmApiEvaluateContinuity`（Curves.h:171 `SmApiEvaluateCurve`） | OCCT 无同名绑定 |
| 投影修剪族 | `SmApiProjectBrepOntoPlane` / `SmApiProjectAndTrim` / `SmApiCreateSilhouetteCurves` | OCCT 无同名绑定 |
| 面/边细分查询 | `SmApiFaceInternalPoint` / `SmApiEdgeParameterRange` / `SmApiEdgeClassifyParameter` / `SmApiEdgeClosestPoint` / `SmApiCurveClosestPointAll` / `SmApiBrepClosestPointAll` / `SmApiFindEdge` / `SmApiFindFaces` / `SmApiBrepMaterialCensus` / `SmApiEdgeTangent`（Queries.h:330） | OCCT 无同名绑定 |
| 形状关系判定 | `SmApiBrepRelationship`（Queries.h:55：0 分离 / 1 接触 / 2 互穿 / 3 A 含 B / 4 B 含 A + 间隙距离） | **高价值 smlib-only 能力**（评审 §7 补） |
| 最近点查询 | `SmApiGetClosestPoint`（Queries.h:14） | 评审 §7 补 |
| 曲面构造变体 | `SmApiCreateSurfaceFromCornerPoints` / `SmApiCreateSurfaceFromRandomPoints` | OCCT 无 |
| 高级圆角 | `SmApiFilletPreview` / `SmApiSurfaceSurfaceFillet` / `SmApiRemoveFillet` / `SmApiSetBevelCorners` | OCCT 无同名绑定 |
| 图元变体族 | `SmApiCreateBlendPrimitive` / `SmApiCreateSwungPrimitive` / `SmApiCreateOffsetProfile` / `SmApiCreateCylindricalBox` / `SmApiCreatePyramid` / `SmApiCreateSphereNoPole` / `SmApiCreatePartial*` / `SmApiCreatePlanarCircle`（Primitives.h:51） | OCCT 无（Pyramid/Partial/Blend 等） |
| 重复扫掠 | `SmApiCreateLinearSweepWithRepetitions` / `SmApiCreateRotationalSweepWithRepetitions` | 见 §2.1 配对（评审 §2.6：与 OCCT 阵列近似同功能，**不**判 smlib-only） |
| 转 NURBS | `SmApiTurnToNurbs` | OCCT 无同名绑定 |
| 曲线投影到面/修剪 | `SmApiProjectCurve` / `SmApiTrimProjectParallel` / `SmApiTrimSurfaceWith3dCurves` | OCCT 无同名绑定 |
| 曲线相交 | `SmApiIntersectCurves` | OCCT 无同名绑定 |
| 面/曲线面相交 | `SmApiIntersectSurfaces` / `SmApiIntersectFaces` / `SmApiIntersectCurveFace` / `SmApiIntersectCurveBrep` / `SmApiIntersectCurveSurface`（Intersectors.h:64） | OCCT 无同名绑定 |
| 零件文件读取 | `SmApiReadPartFromFile`（ImportExport.h:57，返回 boolean tree nodes） | 评审 §7 补 |

## 3. 关键风险与待确认项（评审修正后）

1. **`split(shape, tools)` 工具实体分割**：评审 §2.10 确认 SMLib `SmApiBooleanWithOptions` 的 `bImprinting`/`bImprintAndClassifyFaces` 即 OCCT `BOPAlgo_Splitter` 语义，**有直接等价标志**。风险降级为：需验证 SMLib imprint 结果的 **face 标记粒度与 OCCT split 输出（compound 碎片 + 原始面映射）的一致性**，若不一致需桥侧补碎片重组。
2. **`healWire`**：齿轮封盖路径依赖。SMLib 仅 `SmApiHealBrep`（SmBrep 级）。候选：`SmApiStitch` + `SmApiOrderCurves` + `SmApiMakeCurvesCompatible` 组合，或桥补 wire 修复。**需探针**。
3. **曲线/面评估的精度与参数域差异**：`SmApiCurveParametersEx`（边参数域）vs OCCT `curveParameters`（曲线参数域）数值语义可能不同（齿轮的 `gearEdgeEnds` 依赖该值做边链接，需双引擎比对验证）。
4. **法向/定向约定**：SMLib 法向约定需与 OCCT 对齐（布尔后法向、`UnifyNormals` 与 `fixFaceOrientations` 等价性），40 脚本比对已覆盖基础面。
5. **放样语义**：SMLib `SmApiCreateSkin` 产 **SmSurface**（非实体），需包面+缝合才能与 OCCT `loft(isSolid=true)` 对齐；`isSolid=false`（齿轮壳）语义一致。
6. **历史追踪粒度**：SMLib 仅布尔/圆角两族带 face 级历史（Rm/Add/Chg），OCCT 12 族全带。若新层历史能力被依赖，需明确边界（见 §2.1 历史追踪行）。

## 4. 新 API 层设计（faijs dual-engine layer，仅 occt × smlib）

### 4.1 定位

- 独立于 L1 `BrepEngineApi` 的**第二引擎面**：方法集 = §2.1 共同支持表（语义等价操作），逐方法声明 `engines: ['occt','smlib']`。
- **不支持 brepkit**：引擎为 brepkit 时整层不可用（执行前静态拒绝，复用 `assertEngineFor` 模式，报 `E_BREP_UNSUPPORTED` 含引擎名）。
- 与 L1 的关系：L1 是**三引擎最小子集**（现有契约，不动）；新层是**双引擎扩展面**，承载 L1 表达不了、但 occt+smlib 都有的能力（§2.1 中超出 L1 的条目）。库开发者按能力面取层：需要 brepkit 兼容 → L1；只面向 occt+smlib → 新层。

### 4.2 结构建议

```
packages/core/src/dual-engine/
├── api.ts            # DualEngineApi 接口（§2.1 方法集，类型化签名）
├── occt-adapter.ts   # OcctKernel → DualEngineApi
├── smlib-adapter.ts  # SM_API/wasm 桥 → DualEngineApi（补桥导出后接线）
├── registry.ts       # 注册/取用/门禁（getDualEngineApi()，activeId ∈ {occt,smlib}）
└── engine-method-map.json  # 语义 → {occt, smlib} 双实现名映射（机器可读，供门禁与文档）
```

### 4.3 实现策略

1. **补 wasm 桥导出**（`SmApiBridgeEx.cpp` 加 extern "C" 包装，不动 SMLib 本体）。**待补清单**（评审 §5 修正：以下 5 项桥已存在，不在清单内：`StitchIntoSolidEx`/`CreateRotationalSweepEx`/`CreateSurfaceFromOrderedPointsEx`/`CreateCurveInterpPointsEx`/`ShellBrepFullEx`）：
   - P0（齿轮/标准件直接依赖）：`SmApiCreateSkin`、`SmApiCreateRuledSurface`、`SmApiCreateTaperExtrude`、`SmApiFaceClosestPoint`、`SmApiCreateHelix`、`SmApiOffsetBrepFull`。
   - P1（STL IO）：`SmApiImportStlEx` / `SmApiExportStlEx`（名字以 SmApiStlIo.h 为准）。
   - P2（按 §2.1 待查项逐项补齐：`CreateBox/Cylinder/Sphere/Cone/Torus/Rectangle/LineSegment/Circle/Arc/Ellipse/CanonicalCurve/Curve/ApproxPoints/RemoveCurveKnots/CreatePlane/CreateSurface/CreateExtrude/CreateSweep/CreateSurfaceRevolution/CreateOffsetSurface/Stitch 族/Boolean 家族/Intersect 族/PipeSweep/CurveSweep 族/TaperExtrude 已列/ChamferFillet 族/Transform 矩阵/查询族/求值族/ClosestPoint 族/Heal/UnifyNormals/BrepCopy/WriteReadBrep` 等——以 §2.1 桥状态列「待查/待补」为准逐项过）。
2. **smlib-adapter 接线**：语义映射 + 单位换算（角度度/弧度、参数域）+ 句柄登记（沿用 solidHandles/轮末清扫）。
3. **occt-adapter 接线**：直接调 OcctKernel 同语义方法（多为现 L1 适配器已有实现的提取/复用）。
4. **双引擎比对测试**：新层每个方法对同一输入双引擎执行，比对度量（体积/面积/包围盒/子形状数，1% 容差）——扩展 occt-vs-smlib 测试基建。
5. **门禁**：`getDualEngineApi()` 在引擎非 occt/smlib 时抛 `E_BREP_UNSUPPORTED`。

### 4.4 首批方法集（§2.1 全量，按依赖优先级）

- P0（齿轮/标准件可直接消费）：`skin/loftSurface`、`ruledSurface`、`taperExtrude/draft`、`projectPointOnFace`、`sew`、`stitchIntoSolid`、`revolve`、`helix`、`bsplineSurface`、`curveApprox/Interp`、`shell`、`offset`、`surfaceType`、`vertexPosition`。
- P1（共性 CAD 面）：图元族、布尔族（含 `split`/imprint）、扫掠族、变换族、测量族、曲线/曲面求值族、投影族、历史族（布尔/圆角带历史）。
- P2（细分查询）：`faceClosestPoint`、`edgeClosestPoint`、`faceInternalPoint`、`edgeParameterRange`、`brepRelationship` 等。

## 5. 工作量与建议（评审 §5 修正后）

| 项 | 量级 | 说明 |
|---|---|---|
| wasm 桥补导出 | 0.5–1.5 天 | 机械包装（每个 ~30–60 行 extern "C"）；5 项已存在无需重复；重编译替换两侧 wasm（沿用 SHA256 一致流程） |
| smlib-adapter | 2–3 天 | 语义映射 + 单位换算 + 句柄登记 |
| occt-adapter | 1–2 天 | 复用现 L1 适配器实现 |
| 双引擎比对（新层方法） | 1–2 天 | 扩展比对基建 |
| 齿轮/标准件双引擎验收 | 1–2 天 | 齿轮 4 平台依赖 + fasteners 2 支路逐项过（含 healWire 组合方案、split imprint 粒度验证） |

前置阻塞：`healWire` 组合/桥补方案需 C++ 可行性探针（§3.2）；`split` imprint 粒度验证（§3.1）。

## 6. 后续步骤（待用户确认）

1. 确认新层命名与定位（`dual-engine` / 并入既有 `api/`）。
2. 确认 §2.1 方法集范围（P0 优先 or 全量）。
3. 确认 `healWire` 处理方式（组合方案 vs 桥补 vs 暂列 occt-only）。
4. 确认齿轮/标准件支持是否与本层同批实施。

## 7. 评审采纳说明

本版 v2 按 `2026-10-28-occt-smlib-dual-engine-api-plan-review.md` 逐条修订，全部关键证据已机械复核（可复现）：

| 评审项 | 复核结果 | 处置 |
|---|---|---|
| §1 历史追踪（SMLib 有 face 级） | ✅ SmApiBridgeEx.cpp:665/703 确认 | §1/§2.1 修订 |
| §2.1–2.10 十组配对 | ✅ 全部确认（签名/桥行号） | 全部补入 §2.1，含 surfaceType/vertexPosition 两个完全漏项 |
| §3 计数（209/194/×12/11-16） | ✅ 机械统计一致 | §0.1/§2.2 修订 |
| §4 STL 名（ImportStlEx/ExportStlEx） | ✅ SmApiStlIo.h 确认 | §2.1 修订 |
| §5 补桥清单虚高（5 项已存在） | ✅ 桥 grep 确认 | §4.3 修订，工作量下调 |
| §6 边界纪律（单侧条目混入/交叉重复/命名） | ✅ | §2 全表重构：每能力单表、桥状态独立列、统一头文件名 |
| §7 两侧遗漏（OCCT 8/SMLib 6+） | ✅ 全部存在（行号确认） | §2.2/§2.3 补入 |
| §8 核实无误项 | ✅ 与 v1 判断一致 | 保留 |

未采纳/存疑处（仅 1 处口径差异）：SM_API 去重函数数，评审按声明严格去重为 133，本方案机械统计上限 175（含重载/变体），文档按「约 133（上限 175，口径以头文件为准）」表述，不影响任何能力判断。

## 8. 实施状态（2026-10-28 交付）

按 v2 方案完成「双引擎 API 层」核心骨架。代码位置：`packages/core/src/dual-engine/`。

### 8.1 已实施
- **契约面 `DualEngineApi`**（`api.ts`）：继承 L1 `BrepEngineApi`（三引擎最小子集不变），新增 3 个双引擎独有方法 `loftSurface` / `ruledSurface` / `offset`；提供 `smlibBridgeNotWired(method, native)` 中间件（→ `BrepUnsupportedError`）。句柄统一为 L1 `BrepHandle`。
- **OCCT 适配器**（`occt-adapter.ts`）：共享方法复用 L1 `getBrepEngine('occt').primitives`；3 个独有三法直连 `OcctKernel.loft` / `offset`（OCCT 侧全可跑）。
- **SMLib 适配器**（`smlib-adapter.ts`）：共享方法复用 L1 `createSmlibPrimitives()`；`loftSurface` / `ruledSurface` / `offset` 及历史追踪族（fuse/cut/intersect/filletWithHistory）因 SMLib wasm 桥未接 / L1 适配器未暴露 → 显式 `notWired` 抛 `BrepUnsupportedError`（指向 §4.3 P0 / §2.1 历史行）。
- **门禁与取用**（`registry.ts`）：`getDualEngineApi()` 经 `getConfiguredBrepEngineId()` 静态判引擎身份，非 `{occt, smlib}`（brepkit / brep_mock / null）抛 `BrepUnsupportedError`，不静默回退；按引擎缓存。
- **机器可读映射**（`engine-method-map.json`）：88 条语义 → {occt, smlib}，bridgeStatus ∈ {wired, occtOnly, smlibGap}。
- **公共出口 + 子路径**（`index.ts` + `package.json` 6 条 subpath exports，含 `.json`）。
- **构建**：`npm run build` 产出 `dist/dual-engine/`（含 `engine-method-map.json`）。
- **门禁单测**（`test/dual-engine/registry.test.ts`，vi.mock 隔离 wasm 依赖）：6 例全过 —— brepkit / brep_mock / null 被拒且不调用任一适配器工厂；occt / smlib 放行并路由到正确工厂、且按引擎命中缓存；`smlibBridgeNotWired` 行为正确。

### 8.2 缺口（未实施）
- **SMLib 侧 3 个新方法与历史追踪族接线**：因 SMLib wasm 桥（`usd-brep`）未补导出 / L1 SMLib 适配器未暴露，SMLib 侧 `loftSurface` / `ruledSurface` / `offset` 及 `fuse/cut/intersect/filletWithHistory` 当前抛 `BrepUnsupportedError`。等桥补齐（§4.3 P0）后移除抛错即接线。**约束**：`usd-brep` 仓库不在本任务修改范围（不重编 wasm 桥），此项为前置阻塞。
- **wasm 桥补导出**（§4.3 P0/P1 清单：`SmApiCreateSkin` / `SmApiCreateRuledSurface` / `SmApiCreateTaperExtrude` / `SmApiFaceClosestPoint` / `SmApiCreateHelix` / `SmApiOffsetBrepFull` / `SmApiImportStlEx` / `SmApiExportStlEx`）——全部未做，依赖 `usd-brep` 侧工作。
- **双引擎比对测试**（§4.3.4）：未做（需双引擎同跑，扩 occt-vs-smlib 基建）。
- **`engine-method-map.json` 全量对齐**：当前为 v1 种子（88 条），少数 smlib 名以 `→` 标注多步实现；可再逐项对齐桥头文件做源码级核验，非强制。
- **§4.4 首批方法集的「消费面」**：本层为骨架，3 个新方法是唯一在 L1 之上新增的契约；§4.4 其余 P0 方法（skin / taperExtrude / projectPointOnFace / sew / stitchIntoSolid / revolve / helix / bsplineSurface / curveApprox / Interp / shell / offset / surfaceType / vertexPosition）多已随 L1 继承可用（OCCT 侧），其 SMLib 侧覆盖取决于 L1 SMLib 适配器既有实现，非本任务新增接线。

### 8.3 已知无关项（不计入本任务）
- 全仓 `tsc --noEmit` 仍有 59 个 `error TS`，全部位于 `test/` 既有文件（`BrepHandle` brand 问题），与本层无关，未触碰。
