# SMLib（usd-brep）作为第三个 BREP 引擎引入 faijs：开发计划与 API 分析

> 状态：方案（未实施）
> 方案出处：MainAgent（豆包办公）分析 `C:\git\new\usd-brep` 源码与 `wasm-probe` 实验后撰写
> 日期：2026-10-26

## 0. 用户要求（原文）

> 请写一份开发计划，我需要把smlib引入faijs做为occt/brepkit之外的另外一个brep引擎，其源代码可见C:\git\new\usd-brep，且以及实验过可以编译为wasm供js/ts层使用。请完成smlib的api的分析并写出这份技术文档。

本方案是**方案文档**，不含任何实施代码改动；后续用户明确说"开始实施"前，一切修改都只发生在本方案内。

## 1. 目标与结论摘要

把 NVIDIA `usd-brep`（SMLib NURBS BRep 内核）以 **`smlib` 引擎 id** 接入 faijs，成为 `occt` / `brepkit` 之外的第三个 BREP 引擎。四个核心结论：

1. **可行性已由实验证实**：`C:\git\new\usd-brep\wasm-probe` 已把 SMLib + SM_API 全部源码编译为 standalone wasm（`smlib_standalone.wasm`，6.77 MB，brotli 后 2.01 MB），并以 `--export-table` + 显式 `EXPORTED_FUNCTIONS`（185 个 `SmApi*` 函数）导出；微信小程序端已做 9 版真机预览迭代（`wechat-demo`），核心链路（wasm 加载 + `SmApiCreateBox` + `SmApiBooleanUnion`）已在小程序页面内跑通。
2. **smlib 的 API 面**是稳定的 C 风格 C++ 封装 `SM_API`（14 个头文件、1,862 行、40+ 函数族），与 faijs L1 契约面 `BrepEngineApi`（116 个方法、12 组）**主体可对齐**；存在三类缺口：SM_API 层**无 STEP/STL 导入导出**、**无逐子形状枚举与 hash**（需适配器补）、**布尔为原地消耗式语义**（与 faijs 语言层消费语义对齐——布尔本就不保留输入、keepHidden 已取消；但 L1 内核调用方仍要求输入句柄调用后有效且返回新句柄，适配器需副本化处理，§4.2/§5.4）。
3. **接入路径与 brepkit 完全同构**：`smlib-kernel/`（wasm 装载 + 内核适配）+ `brep/engine/adapters/smlib.ts`（注册）+ `BREP_ENGINE_IDS` 增补 `'smlib'` + `setSmlibWasmInitFn` 注入模式；`dispatchPath` / `brep-chain` / 两级引擎声明机制零改动自动生效。
4. **最大的未验证兼容点是 wasm 异常处理**：链接参数用了 `-fwasm-exceptions`（传统 wasm EH 编码），微信运行时是否支持由 `wechat-demo` 页面标注为"唯一未验证的兼容点"；Node/浏览器侧无此问题。

## 2. smlib（usd-brep）现状

### 2.1 是什么

`usd-brep` 是 NVIDIA 维护的独立 Omniverse 仓库，包含 **SMLib**——基于 **NURBS 的边界表示（BRep）实体建模内核**。实体表示为拓扑实体（shell → face → edge → vertex）绑定精确几何定义（NURBS 曲面、B 样条曲线、解析图元），几何数学精确、与分辨率无关（`README.md` / `AGENTS.md`）。

- 许可：**Apache-2.0**（`LICENSE`，2020-2026 NVIDIA CORPORATION & AFFILIATES）
- 版本：`VERSION` = `1.0.0`
- 源码规模：`source/` 下 13 个组件；wasm 编译范围 = `source/SMLib`（内核，约 200 个 `.cpp`）+ `source/SM_API`（高层封装，14 个 `.cpp`），跳过 `SmDllMain.cpp` / `SmGraphicsExtern.cpp` / `StdAfx.cpp`

### 2.2 分层

| 层 | 位置 | 说明 |
|---|---|---|
| `SMLib` | `source/SMLib/` | C++ 内核。几何/拓扑类（`SmBrep` / `SmFace` / `SmEdge` / `SmSurface` / `SmBSplineCurve` …）与算法；内存由内部 `SmContext` 管理 |
| `SM_API` | `source/SM_API/` | **稳定 C 风格 C++ 封装**，函数名 `SmApi*`。布尔、扫掠、倒角、三角化等高层操作的主入口——**本方案分析的对象** |
| `SM_API_USD` | `source/SM_API_USD/` | USD 集成（自定义 `BrepArray` schema），**不在 wasm 编译范围** |
| `BREP_SM_USD` / `BREP_USD_DATA` | — | BRep ↔ USD 数据转换内部库 |
| `SmPyLib` | `source/SmPyLib/`（模块 `_omni_solid`） | pybind11 Python 绑定，不在 wasm 编译范围 |
| `OCCT_BREP_IMPORT/EXPORT` | — | OCCT `.brep` ↔ USD 翻译器，依赖 OCCT，**不可进 wasm** |

### 2.3 内核关键机制（与 faijs 契约相关）

- **上下文**：`SmApiCreateContext()` / `SmApiGetOrCreateContext()`，进程级全局默认 `SmContext`，惰性创建；发布构建**单线程**（`SM_USE_TBB` 未定义时全部 TBB 代码被宏关掉）。
- **错误**：`SmApiStatus`（`long`），`SM_SUCCESS = 1000`，其余 `SM_ERR_*` 码（`SmMessages.h`）。
- **面演化原料**：`SmTrackTopologyChanges`（`source/SMLib/inc/SmTrackTopologyChanges.h`）是内核级 `SmNotifyCallback`，维护操作前后被移除/新增的拓扑对象列表——这是 faijs `*WithHistory` 面演化数据的内核对应物。
- **三角化输出**：`SmApiTessellate` → `SmPolyBrep`；`SmPolyBrepData.h` 的 `SmPolyFaceData` 带 **`m_lFaceIndex`（该 PolyFace 对应的原始 `SmFace` 索引）**——这是映射 faijs `BrepMeshResult.faceGroups` 面 hash 的关键字段。
- **已知缺陷**（`KNOWN_ISSUES.md`，适配器验证时必须知情）：`remove_fillet` 报成功但实际不删；`heal_brep` 可能假成功；周期/闭合曲面（torus/sphere/cylinder）的 healing 存在多条误修路径；圆角旁的三角化可能产生内翻三角形（`surface_angle_tolerance_deg=15°` 可规避）。

## 3. wasm 编译实验现状（wasm-probe 事实）

`C:\git\new\usd-brep\wasm-probe` 是用户此前实验的完整记录，以下事实均已落盘可复核：

### 3.1 编译链路

| 环节 | 脚本 | 关键参数 |
|---|---|---|
| 逐文件编译 | `compile-all.ps1` | emcc `-std=c++17 -sDISABLE_EXCEPTION_CATCHING=0 -O2 -c`；宏 `SM_NO_DEBUG_CODE` / `SM_NO_GFX_OUTPUT_CODE` / `SM_GRAPHICS_CALLBACKS=1` / `NDEBUG` / `NOMINMAX`；**不定义 `SM_USE_TBB`**（单线程 wasm）；include `source/SMLib/inc` + `source/SM_API/inc` |
| 整库链接 | `link-probe.ps1` | `-fwasm-exceptions -msimd128 -mtail-call -O3`；`INITIAL_MEMORY=128MB` / `MAXIMUM_MEMORY=4GB` / `ALLOW_MEMORY_GROWTH=1` / `STACK_SIZE=5MB` / `EVAL_CTORS=2` / `--no-entry` / `-Wl,--whole-archive`；`wasm-opt -O4 --strip-debug --strip-producers` |
| standalone 链接 | `link.rsp` | 追加 `-sSTANDALONE_WASM=1` / `-Wl,--export-table` / `-sEXPORTED_FUNCTIONS=@exports-api.json` → `smlib_standalone.js/.wasm` |
| API 导出清单 | `make-exports-api.ps1` → `exports-api.json` | 185 个 mangled `SmApi*` 符号 |
| 全量符号 | `exports.json` | 整库全部导出（含 `_N_*` NLib 数学函数） |
| 压缩 | `brotli-report.cjs` | `BROTLI_PARAM_QUALITY=11, LGWIN=22` |

### 3.2 产物体积（`wasm-probe/out`）

| 产物 | 大小 | 说明 |
|---|---|---|
| `smlib.wasm` | 5,280,806 B | 整库链接原始产物 |
| `smlib_opt.wasm` | 8,327,949 B | wasm-opt 优化后（未 strip 前更大） |
| `smlib_opt.wasm.br` | 2,014,966 B（24.2%） | brotli 压缩 |
| `smlib_api_opt.wasm` / `.br` | 5,266,026 / 1,331,098 B | API 面版本 |
| `smlib_standalone.wasm` | 6,766,357 B | **standalone 模式（无 emscripten JS glue 依赖）** |
| `smlib_standalone.js` | 161,067 B | 极薄装载壳（`--export-table` 形态） |
| `smlib.js` | 98,231 B | 常规 glue |

微信端用的是 `smlib_standalone.wasm`（brotli 后约 1.7 MB 量级），直接由 `WXWebAssembly.instantiate` 加载，不依赖 emscripten 运行时胶水——这正是"供 js/ts 层使用"的实验结论。

### 3.3 微信小程序真机验证（wechat-demo）

- 目录：`wechat-demo/`（app.json / pages/index / packages/cad），**9 版预览二维码**（`preview-qr*.png`，v1–v9），分包包体 1,392,925 B（`preview-info.json`）。
- 页面 `pages/index/index.js` 是**特性矩阵测试**：`tiny_plain / tiny_simd / tiny_eh / tiny_full` 四变体逐个 `WXWebAssembly.instantiate`（SIMD、EH 逐项探测）+ 真内核 `smlib_standalone.wasm.br` 加载 + `createBox` + `booleanUnion`。
- loader `wasm-probe/wechat/smlib-loader.js`（复制到 `wechat-demo/cad/`）：以 `wasi_snapshot_preview1` + `env` stub imports 加载；用 `SCRATCH = 64MB` 固定偏移做参数中转（生产实现应改 wasm 侧导出 `malloc/free`）；`MANGLED` 表按 `exports-api.json` 取修饰名。
- **唯一未验证兼容点**（loader 头注释原文）：`-fwasm-exceptions` 的传统 wasm EH 编码在微信运行时是否支持需真机确认；SIMD 需要微信 ≥ 8.0.25、基础库 ≥ 2.14.0（`.wasm.br`）。

### 3.4 结论

wasm 实验已证明：整库可编译、可链接、可 standalone 导出、可在微信真机跑通核心布尔链路；进入 faijs 的**工程障碍不在编译，而在 API 适配与契约对齐**（§4、§5）。

## 4. smlib API 分析

### 4.1 SM_API 头文件族（14 个，`source/SM_API/inc/`，合计 1,862 行）

| 头文件 | 行数 | 函数族 |
|---|---|---|
| `SmApiGeneral.h` | 147 | 上下文、Draw、Transform / Scale / ScaleByPt / Translate / Rotate |
| `SmApiPrimitives.h` | 226 | Plane、PlanarCircle、Box、Sphere、Cone、Cylinder、Torus、Pyramid、CylindricalBox、PartialSphere、SphereNoPole、PartialCone、ConeEllipticEnds、PartialCylinder、PartialTorus、OffsetProfile、BlendPrimitive、SwungPrimitive、SkinPrimitive、SkinFromFaces |
| `SmApiBrep.h` | 495 | 布尔（Boolean / Union / Difference / Intersection / Merge / MergeBreps / Boolean2d / BooleanWithCurves / BooleanWithOptions / NonManifoldBoolean / BooleanLists / BooleanTrees / PiecewiseMerge）、Tessellate / TessellateBoundaries、TurnToNurbs、ProjectBrepOntoPlane / Cut / ProjectAndTrim / CreateSilhouetteCurves / ProjectCurve、Stitch / StitchIntoSolid / StitchIntoShell / StitchAdvanced / SimpleFaceStitch / UnifyNormals、扫掠（Linear / Rotational / Draft / Pipe / AlongPlanarPath / CurveSweep×3 / TaperExtrude / ×WithRepetitions / NonManifold×2）、FilletEdges / FilletEdgesPerEdge / VariableRadiusFillet / SurfaceSurfaceFillet / FilletPreview / SetBevelCorners、ShellBrepFull / OffsetBrepFull |
| `SmApiCurves.h` | 204 | LineSegment / Line / Circle / Ellipse / Arc / Helix / Rectangle / RegularPolygon / Curve / CanonicalCurve / CurveApproxPoints / CurveInterpPoints / OffsetCurve / EvaluateCurve / EvaluateContinuity / ProjectCurve / DropCurveToSrf / LiftUVCurveFromSrf / MakeCurvesCompatible / OrderCurves / RemoveCurveKnots / ConvertToLinesAndArcs |
| `SmApiSurfaces.h` | 99 | CreateSurface / FromCornerPoints / FromOrderedPoints / FromRandomPoints / Extrude / Sweep / RuledSurface / SurfaceRevolution / Skin / OffsetSurface / EvaluateSurfacePoint / EvaluateSurfaceNormal / EvaluateSurfaceDerivatives |
| `SmApiQueries.h` | 295 | 最近点（Brep / Curve / Surface / Edge / Face + `All` 变体、GetClosestPoint）、BrepRelationship / BrepDistance、拓扑访问（GetEdges / GetFaces / FaceGetBoundaryLoops / FindEdge / FindFaces）、属性（IsManifoldSolid / MaterialCensus / ComputeVolume / ComputeArea / ComputeMassProperties / BoundingBox / Copy / FaceBoundingBox / FaceComputeArea / FaceInternalPoint / FaceClassifyUV / FaceClosestPoint / FaceComputeCentroid / EdgeBoundingBox / EdgeComputeLength / EdgeClosestPoint / EdgeParameterRange / EdgeClassifyParameter / EdgeTangent / VertexGetPoint） |
| `SmApiFillets.h` | 28 | ChamferFillet / CircularFillet / RemoveFillet |
| `SmApiPolygons.h` | 87 | PolyBoolean / Union / Difference / Intersection / Merge、PolyBrepIsManifoldSolid / PolyBrepComputeVolume / PolyBrepComputeMassProperties / PolyBrepCopy |
| `SmApiIntersectors.h` | 76 | IntersectCurves / Surfaces / Faces / Breps / BrepWithPlane / CurveSurface / CurveFace / CurveBrep |
| `SmApiTrimmedSurfaces.h` | 54 | TrimSurfaceWith3dCurves / TrimProjectParallel / CreatePlanarFaces |
| `SmApiHeal.h` | 21 | HealBrep |
| `SmApiImportExport.h` | 59 | ReadBrepFromFile / WriteBrepToFile / ReadPartFromFile（**原生 `.smb` 格式**，文件路径 API） |
| `SmApiTessellationParams.h` | 33 | `SmTessellationParams`（dChordHeightTol / dCurveAngleTolDeg / dSurfaceAngleTolDeg / dMaxEdgeLength / dMaxAspectRatio，0=忽略） |
| `SmApiTypes.h` | 38 | `SmApiStatus = long`、`SMAPI_EXPORT` |

### 4.2 调用约定与语义（适配器必须消化的方言）

1. **返回码**：全部函数返回 `SmApiStatus`（`SM_SUCCESS=1000`），结果经 `T*&` out 参数返回；失败时 out 参数置 NULL。
2. **原地消耗式布尔（语言层已对齐，内核层需副本化）**：`SmApiBooleanUnion(pBrep1, pBrep2, rpResult)`——`pBrep1` 原地修改并成为结果，`pBrep2` 在成功后**被内核删除**。这与 faijs 语言层语义**一致**：布尔默认消费输入（`api-contract.md` §6 R5，"Consumed → not a terminal"），`api/boolean.ts` 曾无条件 `keepHidden(...inputs)`（R5「布尔源保留但隐藏」）**已取消**（当前源码无 keepHidden，仅复制类 op 如 pattern/replicate 仍用 `keepHidden(input)`，§6 保留列表）；输入要保留须脚本显式 `a.keep()`。**但 L1 内核调用方契约仍有两个硬要求**（见 `api/boolean.ts` 链式布尔）：① 用户输入句柄调用后**仍有效**——库只 `release` 中间累积结果（`if (i > 1) kernel.release(prev)`），从不释放用户输入；语言层消费判定只影响 terminal 导出、不禁止脚本复用输入变量；② 每次调用返回**新句柄**（链式 `resultSolid = kernel[op](prev, tool)` 后对 `prev` 做 release，若返回句柄 == 原地改的 `prev` 会把结果误释放）。因此适配器必须以副本化满足这两点（§5.4.1），这不是语言语义问题，是句柄生命周期契约问题。
3. **对象模型**：`SmBrep` 是**由面/边/顶点组成**的边界模型；曲线（`SmCurve` 族：Line / Circle / Ellipse / BSplineCurve …）与曲面（`SmSurface` 族）是**独立对象**，可以脱离 Brep 单独存在——与 OCCT 的 `TopoDS_Shape` + `Geom_Geometry` 分离模型同构，与 brepkit 的单一 handle 模型不同。
4. **角度**：SM_API 全部用**度**（`dAngleDeg`）；faijs L1 契约中 `revolveVec` 用度、`rotate` 用弧度——按 L1 口径换算。
5. **几何求值**：曲线/曲面求值（点/导数/法向）在 SM_API 层有直接函数（`SmApiEvaluateCurve` / `SmApiEvaluateSurfacePoint|Normal|Derivatives`），与 L1 `curvePointAtParam` / `surfaceNormal` 同构。
6. **三角化控制**：`SmTessellationParams`（弦高/曲线角/曲面角/最大边长/最大长宽比）与 L1 `BrepTessellateOptions`（linearDeflection / angularDeflection / relative）语义可映射。
7. **导入导出缺口**：SM_API 层只有原生 `.smb`（`SmDatabaseIO` 格式）；**无 STEP、无 STL**。USD 侧的 `BrepArray` 与 OCCT 翻译器（`source/OCCT_BREP_IMPORT/EXPORT`）都依赖外部组件，不可进 wasm。

### 4.3 与 faijs L1 `BrepEngineApi` 的对账

以下按 `packages/core/src/brep/engine/primitives.ts` 的 12 组分列。**A** = 有 SM_API 直接对应（适配器接线即可）；**B** = 有对应但语义/参数形态需换算或组合；**C** = SM_API 层无对应，需适配器补实现或声明为缺口。

| L1 方法组 | 映射 | 结论 |
|---|---|---|
| 生命周期 `release` / `dispose` | `SmApiGetOrCreateContext` + 内核对象释放；wasm 堆由内核管理 | A（wasm 下 `SmBrep` 即 wasm 堆上的 C++ 对象，句柄 = 指针值，`release` 需内核删除语义，探针确认） |
| 实体图元 `makeBox/Cylinder/Sphere/Cone/Torus/Rectangle` | `SmApiCreateBox/Cylinder/Sphere/Cone/Torus/Plane` | A |
| 实体图元 `makeBoxFromCorners` / `makeVertex` / `makeEllipsoid` | 无直接（ConeEllipticEnds 是椭圆锥，非椭球） | C（适配器组合：box 由平面六面拼合；vertex 由内核级构造） |
| 造型 `extrude` | `SmApiCreateLinearSweep`（输入是曲线数组+方向+距离+封盖，非 face） | B（face→外环曲线数组的桥；L1 的 dx/dy/dz 向量换算为方向+长度） |
| 造型 `revolveVec` | `SmApiCreateRotationalSweep` | A（中心/轴/角度/封盖全部直通，角度同为度） |
| 造型 `sweep` | `SmApiCreateCurveSweep` / `SmApiCreatePipeSweep` | B（L1 `sweep` 吃 profile face + spine wire；smlib 吃曲线数组 + BSplineCurve 路径，需桥接；SmApiCreateCurveSweep 还带 ScaleReference / ScaleCurve / Options，超出 L1 语义的可忽略） |
| 造型 `loft` | `SmApiCreateSkinPrimitive`（degree 1/2/3、封盖、返回侧/端面） | B（截面 wire→曲线数组；`ruled` 对应 degree=1；`endPoint` 收口需探针确认 SmApiCreateSkinPrimitive 是否支持退化截面） |
| 造型 `sew` / `sewAndSolidify` | `SmApiStitch` / `SmApiStitchIntoSolid` | A |
| 造型 `shell` | `SmApiShellBrepFull`（面集合 + 距离 + 扩展/自交开关 + 实体化） | A |
| 造型 `hullFromPoints` | 无直接 | C（探针确认内核 `SmPoly` 是否有 hull；无则缺口声明） |
| 造型 `bsplineSurface` | `SmApiCreateSurfaceFromOrderedPoints`（点阵→过点曲面，需 ≥4×4） | A（过点插值，与 L1 语义锚一致） |
| 造型 `makeSolid` | `SmApiStitchIntoSolid` / `SmApiUnifyNormals` 组合（面集→实体） | B（探针确认：smlib 的"shell→solid"路径是 stitch；无独立 MakeSolid） |
| 造型 `thicken` | 无直接（`SmApiShellBrepFull` 的 `bCreateOffsetSolid` 对 sheet body 生成侧壁体，语义不同） | C（早期缺口声明，或探针验证 ShellBrepFull 可覆盖） |
| 布尔 `fuse/cut/common/intersect` | `SmApiBooleanUnion/Difference/Intersection` | **B（句柄生命周期契约）**：原地消耗式与 faijs 语言层消费语义一致（keepHidden 已取消），但 L1 调用方要求输入句柄调用后有效、返回新句柄（链式 `release(prev)`），适配器须 `SmApiBrepCopy` 副本化（§5.4.1） |
| 布尔 `fuseAll` | `SmApiMergeBreps`（数组 + 操作类型） | A |
| 分割 `sectionByPlane` / `splitByPlane` | `SmApiIntersectBrepWithPlane`（截面曲线）；两半拆分需 `SmApiCut`（切掉一侧）组合 | B（`SmApiCut` 的保留侧语义需探针钉死；两半 = cut + 原体差值） |
| 倒角圆角 `chamfer` | `SmApiChamferFillet`（**全局自动**，按斜切面宽，非逐边 `Add(distance,E)`） | **B（语义差异大）**：L1 等距倒角是逐边，smlib 是全体边自动倒角。需探针确认是否支持边集合限定；不支持则该 L1 方法在 smlib 下按能力缺口处理（§5.6 显式失败），或映射到逐边能力（如有） |
| 倒角圆角 `fillet` | `SmApiCircularFillet`（全局自动）或 `SmApiFilletEdges`（逐边+半径+截面类型+连续性） | B（`SmApiFilletEdges` 更接近 L1 逐边语义，探针选定映射） |
| 倒角圆角 `filletVariable` | `SmApiVariableRadiusFillet`（start/end 半径 + 截面 + 连续性） | A |
| 倒角圆角 `filletWithHistory` | `SmApiFilletEdges` + 内核 `SmTrackTopologyChanges` 收集 | B（面演化需内核级回调，§5.5） |
| 变换 `translate/scale/rotate/transform/...` | `SmApiTranslate / SmApiScale(ScaleByPt) / SmApiRotate / SmApiTransform(Axis2Placement)` | A（`rotate` 弧度→度换算；`mirror` 无直接——SM_API 无反射 API，需探针确认 `SmApiTransform` 的 Axis2Placement 是否可编码反射，否则适配器用几何反射矩阵组合 `SmApiTransform`；`located/locate/generalTransform` 的 3×4 行主序矩阵 → Axis2Placement 或 4×4 转换） |
| 阵列 `linear/circular/gridPattern` | 无直接 | C（适配器组合实现：copy + 变换循环，不依赖内核） |
| 曲线构造 `makeLineEdge/ArcEdge/CircleEdge/CircleArc/BezierEdge/BSplineEdge` | `SmApiCreateLineSegment` / `SmApiCreateArc`（中心+起止角，三点需换算圆心）/ `SmApiCreateCircle` / `SmApiCreateCanonicalCurve`（poles/knots/multiplicities/weights/degree 全参数齐备） | A/B（`makeArcEdge` 三点→圆心+角度换算；`makeBSplineEdge` 与 `SmApiCreateCanonicalCurve` **完全同构**） |
| 曲线构造 `makeHelixWire` | `SmApiCreateHelix`（起终点半径可变、右/左手、拟合容差硬校验） | A（L1 的 origin/axis/pitch/height/radius 换算为 smlib 的 +Z 局部系 + 变换；smlib 的 helix 是 BSplineCurve，再包成 wire） |
| 曲线构造 `approximatePoints` / `interpolatePoints` / `interpolatePointsWithTangents` | `SmApiCreateCurveApproxPoints` / `SmApiCreateCurveInterpPoints`（chordlength/centripetal/uniform 参数化）/ `SmApiCreateCurve`（过点三次，无显式切向约束） | A/B（`interpolatePointsWithTangents` 的切向约束在 SM_API 层无直接入口——需内核级或降级近似，按 §5.6 显式记录） |
| 曲线构造 `curveSplit` | 无直接 | C（需内核级 knot 插入/拆分，或经 `SmApiRemoveCurveKnots` 之外的曲面拆分探针） |
| 拓扑构造 `makeWire` | `SmApiOrderCurves`（重排为环序）+ 曲线数组归并 | B（L1 wire 是边数组；smlib 曲线数组需桥接：边→曲线、曲线→边） |
| 拓扑构造 `makeFace` / `makeNonPlanarFace` | `SmApiCreatePlanarFaces` / `SmApiTrimSurfaceWith3dCurves`（曲面+多环修剪） | A |
| 拓扑构造 `addHolesInFace` | `SmApiTrimSurfaceWith3dCurves` 的多 loop 输入（crCurveLoops） | A |
| 拓扑构造 `makeCompound` / `buildTriFace` | 无直接 compound；`SmApiCreatePlanarFaces` 可建三角面 | C（compound 语义需内核级 `SmBrep` 容器或探针） |
| 三角化 `meshShape` | `SmApiTessellate` → `SmPolyBrep` | A（`SmTessellationParams` ↔ `BrepTessellateOptions` 映射；**faceGroups 由 `SmPolyFaceData.m_lFaceIndex` → 面 hash**，§5.4） |
| 三角化 `wireframe` | `SmApiTessellateBoundaries`（角度容差 + 点数组 + 每边计数 + 边数组） | A（输出与 L1 `BrepEdgeData` 同构：points / edgeGroups 由每边计数累积） |
| 拓扑查询 `getSubShapes` | `SmApiGetFaces` / `SmApiGetEdges`；**vertex 无枚举 API**（只有 `SmApiVertexGetPoint`） | B（face/edge 直通；vertex 需内核级枚举或从边端点推导；`wire/shell/solid` 枚举需探针） |
| 拓扑查询 `subShapeHashes` / `hashCode` | 无直接 hash API | C（适配器自建稳定 hash：按子形状几何参数（类型+控制点+参数域）计算，模 `BREP_HASH_BOUND`；brepkit 适配器同模式） |
| 拓扑查询 `isSame` / `shapeType` / `shapeOrientation` / `edgeToFaceMap` / `adjacentFaces` / `sharedEdges` | `SmApiFaceGetBoundaryLoops`（每环边+方向）+ 内核拓扑遍历 | B/C（face/edge 邻接可由 loops 推导；`edgeToFaceMap` 需遍历所有面的 loops 建索引） |
| 几何求值 `curveType/PointAtParam/Tangent/Parameters/IsClosed/Length` | `SmApiEvaluateCurve`（点/一阶/二阶导数）/ `SmApiEdgeParameterRange` / `SmApiEdgeComputeLength` | A（`curveIsClosed` 由参数域+端点重合判定或内核 flag） |
| 几何求值 `surfaceType/Normal/PointOnSurface/uvBounds/CenterOfMass` | `SmApiEvaluateSurfaceNormal / Point / Derivatives` + `Surface::uv_domain()`（AGENTS.md 已示 `uv_domain`） | A |
| 几何求值 `getNurbsCurveData` | 无直接读取 API（`SmApiCreateCanonicalCurve` 是写侧） | C（内核级 `SmBSplineCurve` 数据提取，或经 `SmApiTurnToNurbs` + 内核访问器） |
| 几何求值 `containsPoint` | 无直接 point-in-solid 分类（`SmApiFaceClassifyUV` 是 UV 分类；`SmApiBrepRelationship` 是体-体关系） | C（内核级 point classify 探针；不可行则早期缺口） |
| 测量 `getBoundingBox/Volume/CenterOfMass/SurfaceArea/Length` | `SmApiBrepBoundingBox`（loose/tight）/ `SmApiBrepComputeVolume`（相对精度参数）/ `SmApiBrepComputeMassProperties`（面积+体积+质心+惯性矩一次出）/ `SmApiBrepComputeArea` / `SmApiEdgeComputeLength` | A（精度参数取默认档；L1 无精度参数） |
| 校验修复 `isValid` | `SmApiBrepIsManifoldSolid` + `SmApiBrepMaterialCensus` | A（"合法实体"判据：manifold + material 区域；语义锚与 faijs T1 判据可对齐） |
| 校验修复 `healSolid` | `SmApiHealBrep` | **A（已知缺陷注意）**：`KNOWN_ISSUES.md` 明确 heal 可能假成功——适配器必须在 heal 后复核 `is_manifold_solid` |
| 校验修复 `fixShape` / `fixFaceOrientations` | `SmApiUnifyNormals`（法向统一） | B（`fixShape` 无直接，探针 SmApiHealBrep 是否覆盖；`fixFaceOrientations` → `SmApiUnifyNormals`） |
| 校验修复 `removeDegenerateEdges` | `SmApiStitchAdvanced` 的 `bSqueezeSmallEdges` 等开关 | B |
| IO `importStep/exportStep/importStl/fromBREP` | **SM_API 层无**（仅 `.smb` 原生 + 文件路径 API） | **C（重大缺口）**：wasm 下无文件系统，`.smb` 文件 API 需 MEMFS 或内存缓冲区变体（探针）；STEP/STL 需独立调研（SM_API_USD 与 OCCT 翻译器不可进 wasm） |
| 面演化 `cut/fuse/intersect/fillet WithHistory` | 布尔/倒角 + 内核 `SmTrackTopologyChanges`（removed/added 拓扑对象列表） | B（§5.5；`modified`/`generated`/`deleted` 分段编码需按 faijs 约定重建） |

### 4.4 对账结论

- **A 直通**：图元、旋转扫掠、缝合、抽壳、三角化（含 face 分组）、线框、求值、测量、单/双曲线构造、heal。约占 L1 方法的 **一半以上**，是首批打通范围。
- **B 换算**：布尔（句柄生命周期契约）、挤出（face→曲线桥）、loft、逐边倒角、平面分割、法向统一、矩阵方言。是适配器的主体工作量。
- **C 缺口**：STEP/STL IO、子形状 hash、顶点枚举、点-体包含分类、compound、`curveSplit`、`thicken`、`hullFromPoints`、椭圆体、变半径曲线切向约束。其中 **IO 缺口影响最大**（load/export 的 STEP 链路是 faijs 核心能力），必须显式决策（§5.6）；其余可逐个探针或声明。

**为什么 smlib 没有子形状 hash 与顶点枚举（C 项解释）**：SM_API 是"操作封装层"，只暴露高层函数（建体、布尔、查询），**不暴露完整拓扑数据模型**——`SmApiGetFaces`/`SmApiGetEdges` 是仅有的枚举入口，**没有 `GetVertices`**（只有 `SmApiVertexGetPoint(pVertex, rpPt)` 这类"拿到句柄后的属性查询"），也没有任何返回"面/边/顶点的稳定整数编号"的 API。faijs L1 的 `subShapeHashes`/`hashCode`/`getSubShapes` 需要的是**每个子形状的稳定身份**（跨操作可追踪，供拓扑命名/面演化/faceGroups 使用），而 smlib 的拓扑对象身份是**指针**（wasm 堆地址），操作后指针即失效、无编号可复用。因此适配器必须自建：① **顶点枚举**——从 `SmApiGetEdges` 拿边、再经内核级边端点访问器（或 `SmApiEdgeClosestPoint(0/1)` 参数端点）推导出顶点集；② **子形状 hash**——按子形状几何参数（类型 + 控制点 + 参数域，参照 brepkit 适配器模式）计算稳定哈希，模 `BREP_HASH_BOUND`（2^31-1）。这是适配工作量而非能力缺陷，且必须与三角化映射（`m_lFaceIndex` → 面 hash）共用同一套 hash 方案，否则 `faceGroups` 与拓扑查询对不上。

## 5. faijs 接入设计

### 5.1 接入点总览（与 brepkit 同构，机制零新增）

| 环节 | 落点 | 改动 |
|---|---|---|
| 引擎 id | `packages/core/src/brep/engine/types.ts:21` | `BREP_ENGINE_IDS` 增补 `'smlib'` → `['occt','brepkit','smlib','brep_mock']`；`BrepEngineId` 自动推导 |
| wasm 装载 | 新增 `packages/core/src/smlib-kernel/smlibWasm.ts` | 镜像 `brepkit-kernel/brepkitWasm.ts`：`setSmlibWasmInitFn(fn)`（挂 globalThis 共享，宿主注入）、`initSmlibWasm()`（默认装载 vendored wasm，`initPromise` memo）、`resetSmlibWasm()` |
| 内核适配 | 新增 `packages/core/src/smlib-kernel/smlibKernel.ts` | 镜像 `brepkit-kernel/brepkitKernel.ts`（1,652 行）：显式对象字面量实现 `BrepEngineApi`，逐方法接线，方言在适配器内消化 |
| 引擎注册 | 新增 `packages/core/src/brep/engine/adapters/smlib.ts` | 镜像 `adapters/brepkit.ts`：`SMLIB_BREP_ENGINE_ID = 'smlib'`、`registerSmlibBrepEngine()`（幂等，provider 预初始化）、`ensureSmlibDefaultEngine()`；`type _AssertSmlibApi = AssertSatisfiesBrepEngineApi<SmlibPrimitives>` 编译期守卫 |
| wasm 资产 | 新增 `packages/core/vendor/smlib-wasm/`（种子 = `wasm-probe/out/smlib_standalone.wasm.br` 等） | 先 vendor 进 core；后续独立 npm 包 `@faicad/smlib-wasm`（对齐 `occt-wasm` / `brepkit-wasm` 的依赖形态） |
| 装配 | `brep-chain.ts` 的 `ensureOcctDefaultEngine` 保持 occt 缺省 | 小程序/浏览器宿主显式 `setSmlibWasmInitFn + registerSmlibBrepEngine`（对齐 brepkit 装配注释：`ensureOcctDefaultEngine` 的动态 import 永不触发） |

`dispatchPath`（`cad-runtime/backend-dispatch.ts`）、`brep-chain.ts` 的逐 part `solidCache` 降级、`defineOp.engines` / 库级 `faijs.lib.platform` 两级声明、`engine-method-map.json` / `capability-map.json` 静态追踪——全部引擎无关，**接入 smlib 后零改动自动生效**（BREP 链切换红线：链上出现 smlib 不支持的操作 → 该 part 后续降级 mesh，机制由 `BrepChainState` 天然提供）。

### 5.2 wasm 装载与生命周期

- **注入模式**：`setSmlibWasmInitFn(fn: (() => Promise<SmlibKernel>) | null)`，语义与 `setBrepkitWasmInitFn`（`brepkitWasm.ts:69`）完全一致：注入函数写共享状态，`initSmlibWasm()` 优先用注入、未注入时加载 vendored 资产；重置时清空 `initPromise`。
- **编译参数基线**（沿用 wasm-probe 已验证参数）：`-fwasm-exceptions -msimd128 -mtail-call -O3`、`INITIAL_MEMORY=128MB / MAX=4GB / STACK=5MB`、`STANDALONE_WASM=1 --export-table`、`EXPORTED_FUNCTIONS=@exports-api.json`（185 个）、brotli 压缩（微信分包）。
- **上下文**：`initSmlibWasm()` 首次调用即 `SmApiCreateContext()`（对齐 AGENTS.md 建议：启动时先建 context，勿并发惰性创建）；wasm 是单线程构建，宿主侧不并发调 `SmApi*`（AGENTS.md 并发说明）。
- **句柄**：wasm 堆上的 C++ 对象指针（`SmBrep*` 等）即句柄，与 `BrepHandle`（number）直通零转换——与 brepkit 的 u32 句柄同构；**类型区分**靠 SM_API 返回类型天然隔离（`SmBrep*`/`SmFace*`/`SmEdge*` 各自命名空间），无需 brepkit 的 KIND 标签位（探针确认：`SmApiGetFaces` 返回的 `SmFace*` 与 `SmApiGetEdges` 返回的 `SmEdge*` 不共享编号空间——若共享则需照搬 KIND 标签方案）。

### 5.3 内存与 IO

- **数据中转**：wasm 侧应导出 `malloc/free`（对齐 loader 注释的生产建议），不用 `SCRATCH` 固定偏移。
- **原生 `.smb` IO**：`SmApiReadBrepFromFile/WriteBrepToFile` 是文件路径 API，wasm 下挂 MEMFS（`-sFORCE_FILESYSTEM` 或 `--embed-file`）或探针内存缓冲区变体；作为 faijs 内部序列化可选项，不进公共 API 面。
- **STEP/STL**：见 §5.6 缺口决策。

### 5.4 关键方言消化（smlibKernel.ts 的实现要点）

1. **布尔句柄生命周期契约**：smlib 的 `SmApiBooleanUnion` 原地消耗（`a` 原地变、`b` 被删）——语言层语义对齐（faijs 布尔本就消费输入，keepHidden 已取消），但 L1 调用方（`api/boolean.ts`）要求：① 用户输入句柄调用后仍有效（脚本可复用，R5 只影响 terminal 导出）；② 每次调用返回新句柄（链式 `if (i > 1) kernel.release(prev)` 依赖新旧句柄分离）。适配器实现 `fuse(a, b)` = `a' = copy(a)` + `b' = copy(b)` + `SmApiBooleanUnion(a', b', &out)` → 返回 `a'`（`b'` 被内核吃掉，`a`/`b` 用户句柄完好）。深拷贝是 wasm 内同构复制，相对布尔计算开销可忽略；首期全副本，后续若 L1 采纳"consumed 句柄不可复用"纪律可省去 `copy(b)`。
2. **face→曲线桥**：L1 `extrude/sweep/loft` 输入是 face/wire；smlib 扫掠输入是 `SmCurve*` 数组。桥 = 取 face 外环的边 → 每条边取其曲线（内核级 `SmEdge`→`SmCurve` 访问器，探针确认），或经 `SmApiFaceGetBoundaryLoops` 拿边再取曲线。`makeWire` 的反向桥（曲线数组 → L1 wire 句柄）同理。
3. **三角化映射**：
   - `meshShape` → `SmApiTessellate(pBrep, poly, params, ...)`；`SmPolyBrep` 的顶点/法向/三角形索引 → `BrepMeshResult`（positions Float32Array、normals、indices Uint32Array）。
   - **faceGroups**：遍历 PolyBrep 的 PolyShell/PolyFace 层级，取 `m_lFaceIndex` → 原始 `SmFace` → 适配器自建面 hash（§4.4 C 项 hash 方案）→ 输出 `[triStart, triCount, faceHash]` 三元组（**索引单位**，与 L1 契约一致）。
   - 参数映射：`dChordHeightTol ↔ linearDeflection`（0=忽略 ↔ undefined 语义）、`dCurveAngleTolDeg/dSurfaceAngleTolDeg ↔ angularDeflection`（度/弧度换算）；`relative` 无直接对应，探针 `kMaxEdgeLength` 负数相对语义。
4. **wireframe**：`SmApiTessellateBoundaries(pBrep, dAngleTolDeg, rPoints, rVertexCounts, rEdges)` → `BrepEdgeData`（points Float32Array、edgeGroups `[pointStart, pointCount, edgeHash]`，浮点单位；edgeHash 由 `rEdges` 的 `SmEdge*` 映射）。
5. **矩阵方言**：L1 3×4 行主序 12 double ↔ `SmAxis2Placement`（`SmApiTransform`）。单一转换点（镜像 brepkit 的 `toKernelMatrix` 模式）；`mirror` 若无反射支持，用反射矩阵 + `SmApiTransform` 探针。
6. **测量精度**：`SmApiBrepComputeVolume/Area/MassProperties` 的 `dRelativeAccuracy` 参数取默认档（如 1e-3 交互档），不暴露给 L1。
7. **heal 复核**：`healSolid` 后必须 `SmApiBrepIsManifoldSolid` 复核（KNOWN_ISSUES 假成功），复核失败按操作失败返回（不静默传坏体）。

### 5.5 面演化（`*WithHistory`）适配

faijs L1 面演化契约：`BrepEvolutionData { result, modified(分段 [inHash,count,outHash…]), generated(同构), deleted(扁平) }`，`*WithHistory` 逐核函数在 `brep/engine/native-history.ts` 按引擎 id 记录。

smlib 侧材料：内核 `SmTrackTopologyChanges`（Notify 回调维护 removed/added 拓扑对象列表）+ `SmApiFaceGetBoundaryLoops` 等拓扑访问器。

适配策略（P3）：
1. 在 wasm 导出侧加一个极薄的内核桥（在 `source/SMLib` 内新增一个 `SmApiHistory*.cpp` 或经现有 `SmContext` 回调挂点），在目标操作前后注册 `SmTrackTopologyChanges` 收集 removed/added 拓扑对象。
2. removed 面 → `deleted`（扁平 hash）；added 面 → 按输入面 hash 分组为 `modified`（1→N 后继）；`generated` 按 faijs 约定（该输入面派生中间形）从快照差异重建。
3. 首期只对齐 L1 三员 `cut/fuse/intersect WithHistory`（brepkit 同范围）+ `filletWithHistory`（探针可行性）；`chamfer/translate/rotate/mirror/scale/shell/offset/thicken WithHistory` 按 `native-history.ts` 记录为不支持（对齐 brepkit 现状，`unsupported(...)` 由平台面拦截）。

### 5.6 缺口决策（C 项的处理原则）

按 faijs 红线（静态判定、无运行时回退、能力缺口显式暴露），C 项分为三类：

| 类别 | 项 | 处理 |
|---|---|---|
| **适配器可实现**（不依赖内核新能力） | 阵列（copy+transform 循环）、`makeVertex`/`makeCompound`（组合）、子形状 hash、`edgeToFaceMap`/`adjacentFaces`/`sharedEdges`（由 loops 推导建索引）、`interpolatePointsWithTangents` 降级（显式记录近似） | 在 `smlibKernel.ts` 内实现；近似项按"双钉"纪律记录偏差 |
| **需内核探针** | `curveSplit`、`containsPoint`、`thicken`、`hullFromPoints`、`mirror`（反射）、`splitByPlane` 两半、`isSame`/`shapeType` 的类型判别 | 探针（`wasm-probe` 同法，一次编译产物 + Node 冒烟）；可行则实现，不可行降为缺口 |
| **SM_API 层真缺口** | **STEP/STL IO**、`importStep/exportStep/importStl/fromBREP`、`makeEllipsoid` | 适配器内**显式失败**（对齐 brepkit 的 `fail()` 模式，`[smlib-kernel] …` 报错），op 面用 `engines` 声明或实现内报错静态暴露；**IO 缺口单独立项**（§6 P5） |

**IO 缺口的现实影响**：`load('x.step')` / `exportStep` 是 faijs 核心能力；smlib 引擎下这些 op 将执行前拒绝（`E_BREP_UNSUPPORTED` 或实现内显式失败）。缓解路径（独立调研，不进本方案实施范围）：(a) 评估 `SM_API_USD` 的 `BrepArray` schema 是否可独立编译为 wasm（其依赖 OpenUSD，成本高）；(b) 评估 usd-brep 仓内 OCCT 翻译器复用 `occt-wasm` 已完成能力的可行性（相当于 STEP 仍走 occt，smlib 只做建模）；(c) 接受 smlib 为"建模专用引擎"，IO 统一走 mesh 链降级。

### 5.7 引擎声明与门禁

- `defineOp.engines`：依赖 smlib 独有能力（如 `SmApiVariableRadiusFillet` 语义、helix 原生拟合）的 op 声明 `['smlib']` 或增补；中立 op 不声明（缺省 = 全平台）。
- `engine-method-map.json`：新增 smlib 列，`status` 按 §4.3 对账结果分类（`aligned` / `dialect` / `smlib-only` / `occt-only` / `need-probe`）。
- `capability-map.json` 静态追踪：smlib 引擎适配器实现后自动纳入（脚本读内核方法名）。
- `check-lib-layering.mjs` / `check-platform-imports.mjs`：新增 `smlib-kernel/` 平台目录，规则与 `brepkit-kernel/` 相同（禁止库代码直接 import smlib 内核，只能经 `getBrepApi()` / 平台面）。

## 6. 分阶段落地

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0 wasm 资产固化** | 从 `wasm-probe/out` 选定最终产物（`smlib_standalone.wasm.br` + 装载壳），vendor 进 `packages/core/vendor/smlib-wasm/`；补 `malloc/free` 导出与最小 Node 冒烟测试（context + box + boolean） | Node 侧冒烟全绿；产物大小与 `wasm-probe` 记录一致 |✅ 已完成（2026-10-26，见文末 P0 实施记录） |
| **P1 内核桥 + 首批 L1** | `smlib-kernel/`（smlibWasm.ts + smlibKernel.ts 骨架）、`adapters/smlib.ts`、`BREP_ENGINE_IDS` 增补；实现生命周期、图元、布尔（副本化）、变换、测量、`meshShape`/`wireframe`（含 faceGroups 映射）、`getSubShapes`（face/edge） | `_AssertSmlibApi` 编译通过；engine-switch 测试可在 smlib 会话下建 box/union 并出 mesh |
| **P2 全 API 对账** | §4.3 的 A/B 项全部接线（扫掠桥、loft、逐边倒角探针、平面分割、曲线全族、拓扑构造、几何求值、校验修复）；C 项按 §5.6 三分类收敛 | `engine-method-map.json` 的 smlib 列全部非 `need-probe`；探针结论落测试 |
| **P3 面演化** | `*WithHistory` 三员 + `SmTrackTopologyChanges` 内核桥 | face-evolution 测试在 smlib 会话下通过；`native-history.ts` 记录准确 |
| **P4 一致性测试** | 复用 `packages/tests/faijs/engine-compat/harness.ts`（T1 `solid` 精确相等 + T2 度量收敛 + 双钉 band）：smlib ↔ occt / smlib ↔ brepkit 三引擎两两对账 | 新增 `smlib.test.ts`；每零件声明 `engines` 与测试存在性互证（`assertEngineMetaConsistent` 纪律） |
| **P5 IO 缺口调研** | §5.6 的 (a)/(b)/(c) 三路径评估，产出结论后再决定是否新增计划 | 独立方案文档（不进本方案实施范围） |

批次纪律：P0–P4 各阶段交付态必须完整（不留"新老两套写法并存"）；每阶段先跑自己写的测试，再跑受影响测试，全绿后才准 CI（AGENTS.md 开发后测试步骤）。

## 7. 验证方案

| 层 | 判据 |
|---|---|
| 类型 | `npm run typecheck` 全绿；`_AssertSmlibApi = AssertSatisfiesBrepEngineApi<SmlibPrimitives>` 生效（缺方法即编译报错，与 `_AssertBrepkitApi` 同守卫） |
| 装载 | `setSmlibWasmInitFn` 注入 / 缺省 vendored 双路径测试；`resetSmlibWasm` 后重新装载（镜像 `brepkitWasm` 的 multi-version 测试形态） |
| 引擎切换 | 复用 engine-switch 测试：`config.brepEngineId='smlib'` 会话下中立 op 正常、`engines:['occt']` op 执行前拒绝（`E_BREP_UNSUPPORTED` 含引擎名） |
| 链纪律 | smlib 会话下链上出现 smlib 不支持 op → 该 part 降级 mesh（`solidCache` 缺失），兄弟 part 不污染 |
| 三角化 | `meshShape` 的 `faceGroups` 与拓扑查询的 face hash 一致（拓扑 mesh == 显示 mesh 红线）；`wireframe` 的 `edgeGroups` 浮点单位（`topology/face-group-units.test.ts` 同断言扩展） |
| 一致性 | P4：smlib↔occt、smlib↔brepkit 双组 T1（`solid` 精确）+ T2（体积/面积/包围盒/质心 ≤1e-3 band，已知偏差双钉：当前值 + 目标值，band 只许收紧） |
| 面演化 | `cut/fuse/intersect WithHistory`（+ `filletWithHistory` 探针）的 `modified` 分段、`generated` 同构、`deleted` 扁平编码与 L1 契约一致（`phase0-kernel-probes` 同款断言） |
| 门禁 | `check-lib-layering.mjs` 对 `smlib-kernel/` 生效；`npm run doc-sync` 通过 |
| 微信端（如适用） | 复用 `wechat-demo` 特性矩阵页：`smlib_standalone.wasm.br` + 布尔链路在真机通过；**EH 兼容性（唯一未验证点）单独确认** |

## 8. 风险与红线

1. **wasm EH 兼容性**（最高风险）：`-fwasm-exceptions` 在微信运行时的支持未最终确认（loader 注释为唯一未验证兼容点）。缓解：P0 先跑 tiny 四变体特性矩阵（`wechat-demo` 已有页面）；若微信不支持，评估 `-sDISABLE_EXCEPTION_CATCHING=1`（SM_API 返回码已覆盖错误路径，异常仅作内核断言兜底）或错误码模式改造。
2. **无运行时回退红线**（faijs AGENTS.md）：smlib 引擎下能力缺口一律**执行前静态暴露**（`engines` 声明 / 实现内显式失败），禁止 try-catch 降级。
3. **布尔句柄生命周期**：原地消耗式若不处理会破坏 L1 调用方契约——`tool` 用户输入被吃（脚本复用崩溃）、返回句柄 == 原地 `prev` 导致链式 `release(prev)` 误释放结果。适配器统一副本化（§5.4.1），测试钉住"用户输入句柄操作后仍可用 + 链式 release 不伤结果"（对齐 occt/brepkit 现有行为，engine-switch 一致性由 P4 验证）。
4. **面 hash 的稳定性**：子形状 hash 是拓扑命名/面演化的地基，smlib 无原生 hash，自建方案必须与 `BREP_HASH_BOUND` 取模一致并跨操作稳定（brepkit 踩过 1e9 vs INT32_MAX 的坑，`types.ts:62`）。
5. **smlib 已知缺陷**：heal 假成功、remove_fillet 空转、闭合曲面 healing 误修——适配器层复核 + 测试钉住，不静默传坏体。
6. **双精度差异**：NURBS 精度与 occt/brepkit 的拟合差异导致度量级偏差（P4 用 band + 双钉，不追求逐位相等）。
7. **编译基线的可复现性**：wasm-probe 依赖 `C:\emsdk` 本机环境；vendor 资产后需把编译脚本一并纳入仓库（`compile-all.ps1` / `link.rsp` 迁移到 `packages/core/scripts/` 或 `scripts/`），保证可重建。
8. **版本号流程**：任何涉及包版本/依赖 range 的改动走 `set-version.mjs`（AGENTS.md 硬门禁），不手改。

## 9. 已决事项

| # | 事项 | 结论 |
|---|---|---|
| ① | 引擎 id | `'smlib'`（常量 `SMLIB_BREP_ENGINE_ID`），`BREP_ENGINE_IDS` 扩为 `['occt','brepkit','smlib','brep_mock']` |
| ② | 接入路径 | 与 brepkit 完全同构：`smlib-kernel/` + `adapters/smlib.ts` + `setSmlibWasmInitFn` 注入；`dispatchPath` / `brep-chain` / 引擎声明机制零改动 |
| ③ | 语义缺口 | 适配器可实现（阵列/hash/邻接索引）→ 实现；需探针 → 探针；真缺口（STEP/STL IO、ellipsoid）→ 显式失败 + P5 独立调研 |
| ④ | 面演化 | P3 落地 `cut/fuse/intersect/fillet WithHistory`（`SmTrackTopologyChanges` 内核桥）；其余按 `native-history.ts` 记不支持 |
| ⑤ | 一致性判据 | 复用 engine-compat T1（`solid` 精确）+ T2（band ≤1e-3 起步）+ 双钉；不做逐位相等 |
| ⑥ | 微信端 | 复用 `wechat-demo` 特性矩阵页；EH 兼容性为唯一未验证点，P0 先行确认 |

## 10. 明确不做

1. 不改 `SM_API` / `SMLib` 源码以迁就 faijs（仅 §5.5 的 P3 内核桥是极薄新增导出，若探针显示可避免则也不做）；内核缺陷走 `KNOWN_ISSUES` 已知清单，不绕过。
2. 不做运行时能力探测与运行时回退（faijs 红线）。
3. 不引入 USD / OpenUSD / `SM_API_USD` 到 wasm 编译范围（依赖过重；`BrepArray` 能力不在 faijs 契约内）。
4. 不在本方案内解决 STEP/STL IO（P5 独立调研后另行立项）。
5. 不做 `BrepEngine` 命名体系改动（沿用 2026-10-14 契约结论：`getBrepEngine(id 必填)` / `getActiveBrepEngine()` / `getBrepApi()` 三出口不变）。
6. 不发布任何包版本（本方案仅文档；实施阶段若涉版本号，走 `set-version.mjs`）。

## 附：事实与出处（供复核）

- smlib 源码：`C:\git\new\usd-brep`（README.md / AGENTS.md / VERSION=1.0.0 / LICENSE=Apache-2.0 / KNOWN_ISSUES.md）
- SM_API 头文件：`source/SM_API/inc/`（14 个，行数见 §4.1 表）
- wasm 实验：`wasm-probe/`（compile-all.ps1 / link-probe.ps1 / link.rsp / exports-api.json / out/ 产物 / tiny/ / wechat/smlib-loader.js）
- 微信 demo：`wechat-demo/`（preview-qr v1–v9 / packages/cad/*.wasm.br / pages/index 特性矩阵）
- faijs 侧：`packages/core/src/brep/engine/{types,primitives,registry}.ts`、`brep/engine/adapters/{occt,brepkit,brep-mock}.ts`、`brepkit-kernel/{brepkitWasm,brepkitKernel}.ts`、`cad-runtime/backend-dispatch.ts`、`brep/brep-chain.ts`、`docs/plans/2026-10-13-brepkit-engine-declaration-plan.md`、`docs/plans/2026-10-14-brep-kernel-access-and-capability-contract.md`

## P0 实施记录（2026-10-26）

> 用户原话（2026-10-26）："好的，现在开始移植"——按本方案 P0–P4 推进。本节记录 P0 实施过程与结论修正。

### P0.1 交付物

| 项 | 落盘位置 | 说明 |
|---|---|---|
| wasm 资产 | `packages/core/vendor/smlib-wasm/smlib_standalone.wasm`（6,766,357 B，195 导出 / 249 imports）、`smlib_opt.wasm.br`（2,014,966 B） | 与 `wasm-probe` 记录一致 |
| 编译基线 | `packages/core/scripts/smlib-wasm/{compile-all.ps1, link.rsp, link-probe.ps1, exports-api.json}` | 可复现重建 |
| 装载器 | `packages/core/src/smlib-kernel/smlibWasm.ts` | 镜像 brepkitWasm 的 globalThis 注入模式（`setSmlibWasmInitFn/initSmlibWasm/resetSmlibWasm/isSmlibInitialized` + `SmlibKernel`） |
| 冒烟 | `packages/core/test/smlib-kernel/smlib-wasm-smoke.test.ts` | 装载 / context / createBox / booleanUnion / reset，**5/5 全绿** |

### P0.2 根因实证：invoke_* stub 破坏 call_indirect 转发（最高风险 1 的关键修正）

初版装载器把 `env.invoke_*` 全部 stub 为 `() => 0`，`SmApiCreateBox` 恒返回 **0**（非任何合法状态码；`SM_SUCCESS=1000`，`SM_ERR_*≥1002`，见 `SmMessages.h`）。系统化探针（import 调用轨迹 + wasm 二进制解析 + wat 反汇编）定位：

1. **导出函数签名正常**：`_Z14SmApiCreateBoxRK10SmVector3ddddRP6SmBrep` 的真实 wasm 类型是 `(i32, f64, f64, f64, i32) -> i32`（用 Python 解析 type/import/function/export 段验证；**导出索引需减去 249 个 import 函数占位**才是 Function Section 下标，`func#2607 → $2358`）。
2. **invoke_* 是 call_indirect 的 EH 包装，SmApi* 内部必触发**（虚函数/vtable 调用）。`$2358` 体内三条 invoke 链：
   - `invoke_iiddi(121, SmBrep*, SM_USE_DEFAULT, SM_USE_DEFAULT, 0)` → **SmBrep 构造**（`9876543.21 = SM_USE_DEFAULT`，`SmMath.h:50`）；
   - `invoke_iiiii(122, $5, $6, 0, 0)` → **SmPrimitiveCreation 构造**，返回值赋 `$6`（stub 返回 0 → **$6=0**）；
   - `invoke_iidddi(305, $6, dx, dy, dz, refFrame)` → **CreateBox 虚调用**（`$6=0` → this=0 → 全链路失败）。
3. **结论**：stub 返回 0 = 被调函数从未执行 + 构造指针变 0。`createBox st=0` 不是"返回非法状态码"，而是**调用链从未走通**。

**修复**（已落装载器）：invoke_* 必须真实转发——`table.get(index)(...args)` + try/catch（`WebAssembly.Exception` → `_emscripten_stack_restore` + `setThrew(1,0)` + 按返回类型给默认值；其余异常 rethrow 暴露）。**关键技巧**：`__indirect_function_table` 是**导出**（instantiate 后才可得），用**闭包延迟绑定**（`let instanceRef` → instantiate 后赋值 → invoke 实际执行时再取导出），绕过"instantiate 前 table 不可得"的鸡生蛋问题。修复后：`createBox st=1000, out=5510416`；`booleanUnion st=1000`，冒烟全绿。

### P0.3 微信真机验证缺陷修正（风险 1 证据力修正）

`wechat-demo/pages/index/index.js` 的"内核加载 ✅ / 布尔并集 ✅"**不校验返回码**：`fused.toString(16)` 在 `fused=0` 时仍显示 `brep=0x0` 并记 PASS——**真机验证只证明了"不抛异常"，未证明几何正确**。此前基于该页面得出的"EH 兼容性已跑通"结论需降级：**P0 后微信端必须改为返回码校验式验证**（`st===1000 && out!==0`），并确认 invoke 转发在微信 `WXWebAssembly` 下可用（微信不暴露 `__indirect_function_table` 的 `.get`？——待真机复核；若受限，退路是 P1 起用 glue 版 `smlib.js+smlib.wasm` 或重编译去掉 `-fwasm-exceptions`）。Node 22 侧 invoke 转发已验证通过。

### P0.4 P0 验收结论

- Node 侧冒烟：**5/5 全绿**（装载 / context / createBox / booleanUnion / reset）；产物大小与 `wasm-probe` 记录一致。
- `smlibWasm.ts` typecheck 通过（core 包全量 typecheck 仅剩 42 个**既有测试文件**存量错误——`validate/brepkit/group-call/manifest-timing` 等，与本次改动无关，未顺手修改）。
- 风险 1 更新：`-fwasm-exceptions` 的 invoke imports 在 **Node 22 已确证可转发**；微信运行时为唯一未验证点（需返回码校验式真机验证，见 P0.3）。

## P1 实施记录（2026-10-26）

> 用户原话（2026-10-26）："继续，请自动完成所有的全部的任务"——P1（task #6）自动推进至验收全绿。本节记录 P1 实施过程与结论修正。

### P1.1 交付物

| 项 | 落盘位置 | 说明 |
|---|---|---|
| 桥 C++ | `C:\git\new\usd-brep\wasm-probe\src\SmApiBridgeEx.cpp`（13 个桥导出）+ `SmApiTessellateEx.cpp` | 权威源在 usd-brep 仓库，未拷入 faijs |
| wasm 资产 | `packages/core/vendor/smlib-wasm/smlib_standalone.wasm`（重链多次，当前 205 导出） | 与 `wasm-probe/out` 同步 |
| 编译基线 | `packages/core/scripts/smlib-wasm/{exports-api.json, link.rsp}` | 与 wasm-probe 同步（单行紧凑 JSON） |
| 适配器 | `packages/core/src/smlib-kernel/smlibKernel.ts`（P1 实现集 + 其余 unsupported 桩） | 对象字面量实现 BrepEngineApi |
| 注册面 | `packages/core/src/brep/engine/adapters/smlib.ts`、`brep/engine/types.ts`（BREP_ENGINE_IDS 加 'smlib'） | 幂等注册 + `_AssertSmlibApi` 编译期守卫 |
| 正式测试 | `packages/core/test/smlib-kernel/smlib-tessellate-bridge.test.ts`（6 例）+ `smlib-wasm-smoke.test.ts`（5 例）= **11/11 绿**；`test/brep/engine/engine-switch-smlib.test.ts`（2 例）**全绿** | P1 验收通过 |

### P1.2 桥族建设（SmApiBridgeEx）

TS 无法构造 `SmTArray<T*>&` 出参（vtable + SmObject 基类布局），一次补齐 13 个薄桥：

- `SmApiGetFacesEx` / `SmApiGetEdgesEx`：u32 句柄数组（malloc，caller free；API 错误时把 SmApiStatus 写入 pCount 供诊断）。
- `SmApiDeleteBrepEx`：SM_API 无删除原语，直接 `delete pBrep`。
- `SmApiTessellateBoundariesEx`：**8 字节 header {numEdges, numPoints} 保证 f64 8 对齐**（否则 JS Float64Array 抛 RangeError）。
- `SmApiFaceBoundaryLoopsEx`：面边枚举（face→edge 查询，smApiFaceGetBoundaryLoops 展平，seam 重复保留；布局 u32[3]{numLoops,numOcc,numOcc} + loopCounts + edges + orientations）。
- `SmApiSurfaceTypeEx` / `SmApiCurveTypeEx`：dynamic_cast 判别。**顺序考究**：SmCylinder 继承 SmCone、SmPlane 继承 SmBSplineSurface（surface：0=plane/1=cylinder/2=cone/3=sphere/4=torus/5=bspline/6=other）；SmCircle 继承 SmEllipse 继承 SmBSplineCurve、SmLine 继承 SmBSplineCurve（curve：0=line/1=circle/2=ellipse/3=bspline/6=other）。
- `SmApiFaceUvBoundsEx`（GetSTEPUVDomain）、`SmApiPointOnSurfaceEx`（EvaluatePoint）、`SmApiSurfaceNormalEx`（EvaluateNormal）。
- 边几何五件套：`SmApiCurveParametersEx`（GetInterval）、`SmApiCurveLengthEx`（Length）、`SmApiCurvePointAtParamEx`（EvaluatePoint）、`SmApiCurveTangentEx`（Evaluate 1st deriv）、`SmApiCurveIsClosedEx`（IsClosed）。

编译链路（每次改桥必走）：`emcc.bat <src> -o obj ... -DSM_NO_DEBUG_CODE -DSM_NO_GFX_OUTPUT_CODE -DSM_GRAPHICS_CALLBACKS=1 -DNDEBUG -DNOMINMAX -std=c++17 -sDISABLE_EXCEPTION_CATCHING=0 -O2 -c` → 追加导出名到 `exports-api.json`（**必须单行紧凑 JSON**）→ `emcc.bat @link.rsp`（后台 2–5 分钟）→ 同步 vendor 三文件。

### P1.3 三处关键 bug 修正（实证）

1. **SmApiStatus 成功值 = SM_SUCCESS = 1000（不是 0）**：SMLib 方法（`SmSurface::EvaluatePoint/EvaluateNormal`、`SmCurve::Length/Evaluate`、`SmApiFaceGetBoundaryLoops`）成功返回 1000。初版桥用 `st != 0` 判断失败 → 成功 1000 走失败分支 → 返回 `(1000|1000)=1000` 且不写 out → JS 误判成功读到未初始化垃圾（e-309）。**修复：SMLib 方法统一 `st != SM_SUCCESS`，失败返回 `(unsigned int)st`**。
2. **release 语义 = 释放句柄引用，不是删除内核对象**（brepkit GC 型契约）：初版 `release` 对登记 solid 调 `SmApiDeleteBrepEx` → `buildTopology` 的 transient 释放（transient 含 `getSubShapes(shape,'solid')` 返回的实体句柄，topologyExt.ts:737）把 `solidCache` 仍持有的 box2 误删 → 后续 `buildNamingInput` 的 `subShapeHashes(box2)` 报 `GetFacesEx st=SM_ERR=1001`。**修复：release 全 no-op**；SmBrep 删除只发生在布尔消耗（SmApiBoolean 内建）与 booleanOp 失败分支。
3. **面边枚举必须走 `SmApiFaceGetBoundaryLoopsEx`**：`getSubShapes(face,'edge')` 传 SmFace* 给 `SmApiGetEdgesEx`（期望 SmBrep*）类型错配 → bridge failed。判别：`solidHandles.has(shape)` → 体级 GetEdgesEx；否则面级 BoundaryLoopsEx。

### P1.4 语义实证（写入适配器/测试的常量）

- box(10,20,30)：volume=6000、area=2200、bbox≈[-2e-5..10.00002]（loose bbox ±2e-5 容差）；translate 后 min=(0.99998,1.99998,2.99998)。
- scale 是 **3 向量非标量**（`SmApiScaleByPt(brep, refPt, scaleVec)`，写 1 个 double 返回 SM_ERR_INVALID_INPUT=1007）；rotate 是**角度制**（`SmApiRotate(brep, refPt, axis, angleDeg)`，适配器弧度→度）。
- cylinder(r=5,h=10) center=**底面中心**，volume=785.3981684763414（≈250π）；sphere(r=5) volume=523.5987814313048。
- box 三角化：12 PolyFace（每三角形一个）/ 6 原始面；`GetFacesEx` 6、`GetEdgesEx` 12、`TessellateBoundariesEx` 12 边且 counts 总和 = numPoints。
- 命名路径：box 面 surfaceType 全 plane、uv=[0,20,0,10] 类、centroid 精确如 (5,10,0)；`EvaluateNormal` 对 plane 返回零向量（P4 一致性钉，命名系统对 plane 用 mesh 法线兜底，不受影响）。

### P1.5 P1 验收结论

- `smlib-kernel/` 两测试文件 **11/11 绿**；`engine-switch-smlib.test.ts` **2/2 绿**（box×2→union→part0.keep 全链 + 布尔副本化：part0/part1 句柄 union 后仍可查询）。
- src 层 typecheck 0 错误；core 包全量 typecheck 仅剩既有测试文件基线错误（validate/brepkit/after-statement/group-call-forms 等，与本次无关）。
- runtime 级复现探针（`wasm-probe/tiny/probe-runtime.ts`）确认 box1 / box2 / box1+box2 三段脚本全过。
- 风险 1 更新：P1 的 invoke 转发在 Node 22 持续验证通过；微信真机返回码校验式验证仍未做（P0.3 遗留，非 P1 范围）。

## P2 实施记录（2026-10-26）

> 用户原话（2026-10-26）："继续，请自动完成所有的全部的任务"——P2（task #7）自动推进。本节记录 P2 全 API 对账接线的实施过程、探针结论与验收结果。P2 前用户锁定三处口径（已直录 §2）：布尔语言层已对齐 keepHidden 已取消、仅句柄生命周期契约需副本化；无 STEP/STL IO（P5 独立立项）；无子形状 hash 与顶点枚举=适配器自建。

### P2.1 交付物

| 项 | 落盘位置 | 说明 |
|---|---|---|
| 桥 C++ | `C:\git\new\usd-brep\wasm-probe\src\SmApiBridgeEx.cpp`（P2 新增 **21 个导出** + 6 个曲线查询桥改造为支持裸曲线句柄） | 权威源仍在 usd-brep 仓库 |
| wasm 资产 | `packages/core/vendor/smlib-wasm/smlib_standalone.wasm`（当前 **222 导出**） | 与 wasm-probe/out 同步 |
| 适配器接线 | `packages/core/src/smlib-kernel/smlibKernel.ts`（辅助/造型/曲线/拓扑/求值/修复区段全部接线） | unsupported 仅剩 C 缺口与 P3/P5 项 |
| 正式测试 | `packages/core/test/smlib-kernel/smlib-p2-ops.test.ts`（**32 例全绿**） | P2 验收通过 |

### P2.2 桥扩展（P2 新增 21 导出 + 6 改造）

P2 桥全部吃 **SmTArray 出入参展平数组**（TS 无法构造 SmTArray 出参，P1 同款理由）。编译踩坑实证：`SmTArray::Append(x)` 只接受整数组追加（`const SmTArray&`），**单元素一律 `SmTArray::Add(x)`**（返回新下标）——第一批 18 桥全量 `.Append(` → `.Add(` 后编译通过（`SmTArray.h` 签名）。

- 曲线提取：`SmApiEdgeToCurveEx`（边→GetCurve 曲线句柄）、`SmApiEdgeVerticesEx`（f64[6] 两端点）。
- 造型：`SmApiCreatePlanarFacesEx`（曲线数组→面，**曲线不消耗**）、`SmApiMergeBrepsEx`（深拷贝每入参 + op：**SM_BO_UNION=1 非 0**，实证见 P2.4）、`SmApiCreateLinearSweepEx` / `SmApiCreateRotationalSweepEx`（曲线数组+方向/轴+距离/角度度+封盖）、`SmApiCreateSkinPrimitiveEx`（截面计数+全曲线+degree+封盖）。
- 倒角：`SmApiFilletEdgesEx`（选边+半径+xsect=1 circular+cont=1 G1，原地）、`SmApiChamferFilletEx`（原地，全体边自动斜切）。
- 抽壳/分割/修复：`SmApiShellBrepFullEx`（const 入参+面集合→新体）、`SmApiIntersectBrepWithPlaneEx`（malloc u32 曲线数组）、`SmApiUnifyNormalsEx`（**P2 修正：桥自动取 GetFaces()[0] 当 pStartFace**——SMLib 对 startFace=NULL 的已一致朝向封闭体返回 SM_ERR_INVALID_INPUT=1007，实证见 P2.4）、`SmApiStitchEx`、`SmApiStitchIntoSolidEx`（u32[2]{solidFlag,stitchedEdges}+f64[2]{vgap,egap}）、`SmApiHealBrepEx`（原地）、`SmApiCutEx`（原地）。
- 曲线构造：`SmApiCreateSurfaceFromOrderedPointsEx`（f64[3N]+rows+cols）、`SmApiCreateCurveInterpPointsEx`（≥4 点+paramType）、`SmApiCreateCurveApproxPointsEx`、`SmApiCreateCanonicalCurveEx`（点+knots+multiplicities+weights 可选+degree+form）、`SmApiTransformMatrixEx`（3×4 行主序→SmAxis2Placement.SetFrom4x4 列主序填充，可编码反射）。
- 6 个曲线查询桥改造：`CurveTypeEx/CurveParametersEx/CurveLengthEx/CurvePointAtParamEx/CurveTangentEx/CurveIsClosedEx` 从只吃 `SmEdge*` 改为 `dynamic_cast<SmEdge*> → GetCurve()`，否则 `dynamic_cast<SmCurve*>` **裸曲线句柄直通**（smAObject 基类判别）——适配器造的裸曲线（makeLineEdge 等）无需包边即可查询。

### P2.3 JS 接线（smlibKernel 各区段）

| 区段 | 接线方式 | 说明 |
|---|---|---|
| 辅助 | `newWire`（**WIRE_TAG=0x200000000 合成 wire 句柄**，wasm 堆指针 <4GB 永不撞）+ `edgeToCurve`/`faceOuterCurves`（**face 或单面 brep 判别**：solidHandles 命中→GetFacesEx 第一面）/`ptsToMemory`/`normVec`/`cross`/`dot`/`circlePlacementMatrix`（center+normal→3×4 局部系矩阵）/`createPlanarFaces`/`applyMatrix`（3×4 行主序→SmApiTransformMatrixEx）/`threePointArc`/`createCanonicalCurve` | wire 是 L1 句柄契约（makeFace/loft/getSubShapes 复用），smlib 无 wire 类型→合成句柄登记曲线数组 |
| 造型 | makeRectangle（4 线段环→CreatePlanarFaces）、extrude（face→外环曲线→LinearSweep）、revolveVec（RotationalSweep 角度制直通）、loft（wire 曲线数组→SkinPrimitive，ruled→degree 1）、shell（ShellBrepFull）、bsplineSurface（CreateSurfaceFromOrderedPoints）、makeSolid（StitchIntoSolid 复核后返原句柄） | makeEllipsoid/makeVertex/sweep/sew/sewAndSolidify/hullFromPoints/thicken **保留显式 unsupported**（C 缺口或语义不完整，§5.6） |
| 曲线 | makeLineEdge（CreateLineSegment）、makeCircleEdge/makeCircleArc（XY 平面造→**circlePlacementMatrix 变换到 center+normal 平面**）、makeArcEdge（三点外接圆→CreateArc→变换）、makeBezierEdge（**满重 B-spline：唯一 knots=[0,1] 各满重 degree+1**——初版误传分段 knots 导致 1001）、makeBSplineEdge（**全 1 weights 归一化为 undefined**）、makeHelixWire（CreateHelix→变换）、approximatePoints/interpolatePoints | makeBezierEdge/BSpline 共用 `createCanonicalCurve`（SmApiCreateCanonicalCurveEx，form=6 SM_CF_UNSPECIFIED） |
| 拓扑 | makeWire（合成句柄）、makeFace（wire 曲线→CreatePlanarFaces）、buildTriFace（3 线→面）、getSubShapes 补 **wire**（查表）与 **vertex**（**EdgeVerticesEx 边端点坐标去重 + VERTEX_TAG 合成句柄**，vertexPosition 查表）、edgeToFaceMap/adjacentFaces/sharedEdges（BoundaryLoops 边交集）、getLength（去重边弧长和） | 顶点枚举=适配器自建（用户口径）；vertexPosition 对合成句柄查表返回坐标 |
| 修复 | healSolid（副本化+HealBrepEx+**修复后复核 IsManifoldSolid**——KNOWN_ISSUES 假成功护栏）、fixShape（降级 heal）、fixFaceOrientations（副本化+UnifyNormalsEx） | isValid 仍以 isSolid 近似 |

### P2.4 语义实证（探针结论，落测试）

1. **SM_BO_UNION=1**（SmCoreTypes.h 枚举：UNKNOWN=0, UNION=1, INTERSECTION=2, DIFFERENCE=3, XOR=4, MERGE=5）——初版传 op=0（UNKNOWN）→ 1007。
2. **CreatePlanarFaces 返回单面 brep 非闭合流形**：`isSolid(makeRectangle()) = false`，但可被 extrude 等造型消费；三角化 2 三角/单面。**faceOuterCurves 需判别 solidHandles**：makeRectangle/extrude 输入是单面 brep → 先 GetFacesEx 取第一面再 BoundaryLoops。
3. **CreateCanonicalCurve 的 knots 是"唯一值数组"**（L1 契约同款）：测试误传展开序列 `[0,0,1,1]` + mults `[2,2]`（长度不匹配）→ 1001；正确 `knots=[0,1]` + mults=[2,2]。Bezier 满重：唯一 knots=[0,1] 各满重 degree+1（3 控制点二次 → mults=[3,3]）。
4. **SmApiRotate 第四参 angleDeg 是 f64 数值非指针**：初版传 `p+48` 指针地址被当度数（乱旋转）；修正传数值后 90° 语义精确（box 平移后绕 Z 90° → x'=−y）。
5. **SmApiCut 输出是开口壳**：splitByPlane 两半 bbox 精确覆盖原范围（positive 法向侧 x∈[0,5]、negative x∈[5,10]）但 **volume=0（非闭合流形）**——L1 splitByPlane 的"两闭合实体"语义 smlib 原生不满足，P2 记录为语义缺口（后续评估 cut+heal 组合）。
6. **UnifyNormals 对 startFace=NULL 的已一致朝向封闭体返回 1007**：桥修正为自动取 GetFaces()[0] 当 pStartFace（重编后验证）。
7. **CreateSkinPrimitive 要求各截面曲线首尾成环且截面不共面**：loft 两矩形截面必须错开高度（共面 → 1007）。
8. **三点圆弧长度语义**：三点 (0,0)/(0,1)/(1,0) 外接圆 r=0.707，经 mid 的弧 = 270°（len=3.332）——CreateArc 顺时针语义 + mid 相对位置，非 π/2。
9. **全 1 weights 显式传参在 vitest 下偶发 1001、tsx 下成功**：makeBSplineEdge 归一化全 1 weights → undefined（非有理=省略等价），消除双路径（探测差异，归一化后稳定）。

### P2.5 P2 验收结论

- `smlib-p2-ops.test.ts` **32/32 全绿**（造型 8 / 曲线 9 / 变换阵列 4 / 布尔分割倒角 4 / 拓扑 5 / 修复 3）；P1 两文件回归不受影响。
- 桥导出 **222**（exports-api.json 单行紧凑校验通过）；vendor 三文件同步。
- P2 对账（§4.3）A 直通≈一半（图元/旋转扫掠/缝合/抽壳/三角化/求值/测量/heal），B 换算落地（布尔副本化/extrude/loft/逐边倒角/平面分割/法向统一/矩阵方言），C 缺口清单更新：STEP/STL IO（P5）/ subShape hash 自建（已做）/ 顶点枚举自建（已做）/ point-contains / compound（gridPattern 依赖）/ curveSplit / thicken / hullFromPoints / ellipsoid / chamferDistAngle / filletVariable（缺 SmTArray 桥）/ splitByPlane 闭合实体语义 / variable-radius fillet。
- 风险 2 更新：P2 接线未触碰任何用户 WIP 文件（`export-model.ts/step.ts/adapt.ts`、truck 文档、scan-probe.mts）。
