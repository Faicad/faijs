# 移植 FreeCAD 草图与约束求解能力到 faijs 的可行性分析

> 日期：2026-09-15
> 分析对象：`D:\Faicad\FreeCAD`（`version.json` → 26.3.0-dev）、`D:\Faicad\faijs`
> 前序文档：`docs/analysis/2026-09-15-fcstd-to-fai-zip-feasibility.md`（下称「前文」）
> 状态：调研结论，未实施

---

## 1. 用户原始要求（原文引用）

> 请分析，能否把freecad依赖的草图和草图约束求解的功能移植过来，作为fcstd移植的前序步骤。

拆解为三条约束：

| 编号 | 约束 |
|---|---|
| C1 | 判断「能不能移植」——要给出技术依据，不是印象 |
| C2 | 移植对象是「草图 + 草图约束求解」，不是整个 Sketcher 工作台 |
| C3 | 要回答「是否应该作为 FCStd 移植的**前序步骤**」——即排期问题，不只是技术可行性 |

---

## 2. 结论摘要

**能移植，但范围必须严格限定：数学内核不必自己写，真正要写的是「语义桥」。**

| 问题 | 判定 | 依据 |
|---|---|---|
| 约束求解器数学内核能否获得 | **能，且已有现成 WASM 产物** | `@salusoft89/planegcs` v1.2.0（2026-07-06 发布），LGPL-2.0-or-later，unpacked 892,495 B；含全部几何与约束、TS 类型（§5 路线 A） |
| 自行 Emscripten 编译是否可行 | **可行，且比预想容易** | planegcs 对 Boost 的依赖只有 1 处 `connected_components`（`GCS.cpp:1785-1803`），可换并查集；Eigen 是 header-only（§4） |
| 用 TypeScript 重写 | **不建议** | 13,306 行 C++ 含 4 种非线性优化 + 两类 QR + 自由度/冗余诊断 + 子系统分解，重写等于自研求解器（§5 路线 C） |
| 整个 Sketcher 能否搬过来 | **不能，也不该** | `SketchObject.cpp` 深度耦合 `App::Document`/`Property`/`Expression`（`SketchObject.cpp:39-64`）；Gui 侧 81,452 行（§3 L2/L3） |
| **是否应作为 FCStd 的「前序步骤」** | **不应整体前置；但「求解器选型与可行性探针」必须前置** | FCStd 的 P1/P2 不依赖草图；但 P3 的可编辑性上限被求解器选型锁死（§8） |

三条硬结论：

1. **数学内核零成本可获得。** 移植不是「把 13k 行 C++ 翻成 TS」，而是「接一个 wasm + 重写 2.5–3.5k 行的语义桥」。这个认知差决定了整个项目的可行性判定。
2. **真正的成本在语义桥，不在求解器。** FreeCAD 的 `Sketch` 类（`Sketch.cpp` 5,833 行 / `Sketch.h` 899 行）承担「`Part::Geometry`（OCCT） ↔ GCS 参数」的双向同步，它与 OCCT 绑死，faijs 数据模型不同，必须重写（§3 L1）。
3. **许可问题是唯一的实质性障碍，且与项目现状冲突。** faijs 目前未发布 npm、待专利申请（AGENTS.md 末节）。LGPL-2.0-or-later 的 WASM 产物如何合规打包，需要法务结论，**这不是技术问题，不能用技术手段绕过**（§11 R1）。

---

## 3. FreeCAD 草图能力的分层剖析（实测行数）

按「与 faijs 目标的相关度」把 Sketcher 切成四层。行数为本地源码 `wc -l` 实测。

| 层 | 内容 | 规模 | 与 OCCT 耦合 | 是否移植 |
|---|---|---|---|---|
| **L0 求解器** | `src/Mod/Sketcher/App/planegcs/` | **13,306 行** | 无 | **复用（不重写）** |
| **L1 语义桥** | `Sketch.cpp` + `Sketch.h` | **6,732 行** | 强（`Part::Geometry`） | **重写** |
| **L2 文档对象** | `SketchObject*.cpp`、`Constraint.cpp`、`PropertyConstraintList.cpp` 等 | ~8,000 行 | 强 + 耦合 App 文档模型 | **不移植** |
| **L3 交互/Gui** | `src/Mod/Sketcher/Gui/` | **81,452 行** | — | **不移植** |

### 3.1 L0：planegcs（13,306 行）

逐文件实测：

| 文件 | 行数 | 职责 |
|---|---|---|
| `GCS.cpp` | 5,816 | 求解主循环、4 种算法、QR 分解、自由度/冗余诊断、子系统分解 |
| `Constraints.h` | 1,400 | 约束类声明 |
| `Constraints.cpp` | 3,232 | 35 个约束类的残差与雅可比 |
| `Geo.h` / `Geo.cpp` | 416 / 1,147 | 几何图元与 `DeriVector2` 导数结构 |
| `GCS.h` | 699 | `System` 类接口 |
| `SubSystem.cpp/.h` | 349 / 97 | 子系统（分块求解） |
| `qp_eq.cpp/.h` | 74 / 34 | 等式约束二次规划（SQP 用） |
| `Util.h` | 42 | 工具 |

**几何图元 13 个**（`Geo.h:39-358`）：`Point`、`DeriVector2`、`Curve`、`Line`、`Circle`、`Arc`、`MajorRadiusConic`、`Ellipse`、`ArcOfEllipse`、`Hyperbola`、`ArcOfHyperbola`、`Parabola`、`ArcOfParabola`、`BSpline`。

**约束类 36 个**（`Constraints.h`，含基类 `Constraint`，即 35 个具体约束），典型：`ConstraintP2PDistance`、`ConstraintP2PAngle`、`ConstraintP2LDistance`、`ConstraintPointOnLine`、`ConstraintParallel`、`ConstraintPerpendicular`、`ConstraintL2LAngle`、`ConstraintTangentCircumf`、`ConstraintPointOnEllipse`、`ConstraintInternalAlignmentPoint2Ellipse`、`ConstraintSnell`、`ConstraintAngleViaPoint`、`ConstraintC2CDistance`、`ConstraintArcLength`、`ConstraintSlopeAtBSplineKnot`、`ConstraintPointOnBSpline` 等。

**求解算法**（`GCS.h:62-68` 的 `Algorithm` 枚举）：`BFGS`、`LevenbergMarquardt`、`DogLeg`，另加 SQP。回退链在 `Sketch.cpp:4986-5015`——默认算法失败后依次尝试其余三种，`Sketch.cpp:5045-5060` 起是回退循环。

**QR 分解**（`GCS.h:76-79`）：`EigenDenseQR`（`FullPivHouseholderQR`）与 `EigenSparseQR`（`SparseQR` + `COLAMDOrdering`），由 `autoQRThreshold`（`GCS.h:245`）自动切换。

### 3.2 L1：Sketch 语义桥（6,732 行）——真正的移植对象

`Sketch` 类做的事：

1. **几何登记**：`addGeometry(const Part::Geometry*)`（`Sketch.h:88-97`）、逐类型 `addLine/addCircle/addArc/addEllipse/addArcOfEllipse/addArcOfHyperbola/addArcOfParabola/addBSpline/addPoint`（`Sketch.h:221-239`），把 OCCT 几何转成 GCS 的 `Line/Circle/Arc/...`。
2. **约束登记**：`addConstraint`（`Sketch.cpp:2026-2617`，**23 个 case 分支**）→ `Constraint::Type` → GCS 约束对象 + 参数指针（driving 参数进 `FixParameters`，非驱动进 `DrivenParameters`）。
3. **参数回写**：`updateGeometry()`（`Sketch.cpp:4709`、`Sketch.cpp:4737`）把解出的 GCS 参数写回 `Part::Geometry`。
4. **非驱动约束更新**：`updateNonDrivingConstraints()`（`Sketch.cpp:4934`）——把「测量值」写回约束的 `Value`。
5. **诊断**：`diagnose()`（`GCS.h:632`）+ `SketchAnalysis.cpp`（1,051 行，冗余/重复约束识别）。
6. **交互态**：`initMove`/`movePoint`/临时约束（拖拽专用，转换场景不需要）。

耦合证据：`Sketch.cpp:28-52` 引入 `BRepBuilderAPI_MakeWire`、`ShapeFix_Wire`、`TopoDS_*` 与 10 个 `Mod/Part/App/*Py.h`；`Sketch.h:27-29` 引入 `Base/Persistence.h`、`CXX/Objects.hxx`、`Mod/Part/App/TopoShape.h`。全文 `Part::Geom` 出现 21 次。

**结论：这一层不能照搬，必须按 faijs 的数据模型重写。**

### 3.3 L2：SketchObject（不移植）

`SketchObject.cpp:39-64` 引入 `App/Document.h`、`App/Expression.h`、`App/ObjectIdentifier.h`、`App/MappedName.h`、`Mod/Part/App/*`、`boost/geometry.hpp`。它承担：属性系统持久化、表达式绑定、`XLink` 外部几何、元素命名（拓扑命名）、Python 绑定（`SketchObjectPyImp.cpp` 2,842 行）。

这些职责在 faijs 侧由完全不同的机制承担（`.fai.js` 语句序列 + `topology/naming/`），无对应物，不需要移植。

### 3.4 L3：Gui（81,452 行，不移植）

`src/Mod/Sketcher/Gui/` 含绘制交互、约束气泡、拖拽手柄、编辑模式状态机。faijs 有自己的 UI 栈，完全无关。

### 3.5 一个需要纠正的认知

前文 §2 与 §5.3 提到「FreeCAD 用 `src/3rdParty/planegcs` 求解」。**该路径已失效**——planegcs 现位于 `src/Mod/Sketcher/App/planegcs/`。

另外，`src/3rdParty/OndselSolver` **是 git submodule 且本地未 checkout**（`src/3rdParty/CMakeLists.txt:23-27` 对缺失有 FATAL_ERROR）。它服务于 **Assembly 模块**（`src/Mod/Assembly/App/CMakeLists.txt:8`），与 Sketcher 无关。**OndselSolver 不是草图求解器的替代品，前文 R2 里把它列为 planegcs 的并列选项是错的**，本文更正。

---

## 4. planegcs 的可移植性：依赖剖析

`grep '#include'` 全量去重后的外部依赖：

```cpp
<Eigen/Core>  <Eigen/Dense>  <Eigen/QR>                    // header-only
<boost/graph/connected_components.hpp>                     // 见下
<boost/graph/graph_concepts.hpp>  <boost_graph_adjacency_list.hpp>
<boost/math/constants/constants.hpp>
<Base/Console.h>  <Base/Tools.h>                           // FreeCAD 日志/工具
<future>                                                   // 多线程 QR
<FCConfig.h>  <SketcherGlobal.h>                           // 导出宏
```

三个关键判断：

1. **Eigen 是 header-only**——不需要链接任何二进制，Emscripten 直接可编。
2. **Boost 只有一处实质使用**：`GCS.cpp:462` 定义 `boost::adjacency_list`，`GCS.cpp:1785-1803` 调 `boost::connected_components(g, &components[0])` 做**连通分量分解**（把约束图切成独立子系统）。这是标准并查集问题，自写约 40 行即可替换，`boost/math/constants` 也可以直接用 `M_PI`。**剥离 Boost 后，整个求解器只剩 Eigen 一个依赖。**
3. **`Base/Console.h` 只是日志**——提供一个空的 `Base::Console()` 宏/桩即可。
4. **`<future>` 多线程 QR**（`GCS.cpp` 中的 dense/sparse QR 并行）在单线程 WASM 下退化为同步调用，或走 SharedArrayBuffer + pthreads（需 COOP/COEP 响应头，浏览器部署有额外要求）。

**结论：planegcs 是一个几乎无外部依赖、可独立编译的求解器。移植到 WASM 的技术障碍接近于零。**

---

## 5. 三条技术路线对比

| 维度 | A. 用现成 `@salusoft89/planegcs` | B. 自编译 Emscripten | C. TS 重写 |
|---|---|---|---|
| 首次可用成本 | **低**（npm install + 封装） | 中–高（需 Emscripten/Docker 工具链） | **极高** |
| 实测事实 | v1.2.0（2026-07-06），unpacked **892,495 B**，license `LGPL-2.0-or-later` | 需自建构建；上游仓库用 Docker + emscripten 3.1.45 | 需重写 13,306 行 C++ 等价物 |
| 版本新鲜度 | 2026-04-25 有「upgrade planegcs」提交；**与本地 26.3.0-dev 的差距未实测** | 可对齐任意 FreeCAD tag | 永远落后 |
| 维护风险 | 依赖第三方（周下载 ~2.9K，非 FreeCAD 官方） | 自控 | 自控 |
| 许可 | LGPL（需法务） | LGPL（同源，需法务） | 无许可负担 |
| 能否裁剪（去掉 Gui/未用约束） | 不能 | **能** | 能 |
| 结论 | **推荐先验证** | **推荐作为长期方案** | **不推荐** |

**建议：A 先跑可行性探针（1–2 天），通过则先用 A 打通链路；若许可或版本漂移成为阻塞，切 B。** B 的壁垒比想象低——§4 已证明剥离 Boost 后只剩 Eigen。

`A → B` 的切换成本可控，因为两者都可以通过「同一套 TS 封装接口」隔离：faijs 只依赖自己定义的 `SketchSolver` 接口，wasm 实现是可替换的后端。

---

## 6. faijs 侧落点盘点（已有基建）

这部分决定「移植过来放在哪」。实测：

| 资产 | 位置 | 规模/能力 |
|---|---|---|
| **2D 曲线与蓝图** | `packages/core/src/vendored/brepjs/2d/` | **7,105 行**（其中 `blueprints/` 4,599 行） |
| 曲线构造 | `2d/lib/makeCurves.ts` | 线段 `:22`、三点弧 `:37`、切线弧 `:68`、圆 `:99`、椭圆 `:108`、椭圆弧 `:133`、Bezier `:162` |
| 2D 布尔/偏移/装配 | `2d/blueprints/{boolean2D,blueprintOffset,segmentAssembly,intersectionSegments}.ts` | 2D 并交差、偏移、线段装配成环 |
| 草图式 API | `2d/blueprints/baseSketcher2d.ts`（495 行）、`genericSketcher.ts`（414 行） | `lineTo` `:152`、`line` `:158`、`ellipseTo` `:299`、`ellipse` `:328`、`bezierCurveTo` `:360` |
| 平面/面上草图 | `2d/blueprints/blueprintFns.ts` | `sketchOnPlane2D`、`sketchOnFace2D` |
| **2D→3D 双链路范式** | `packages/core/src/api/svgExtrude.ts` | **dual-op 范例**：`defineOp({mesh, brep})`，`mesh:` 在 `:62`、`brep` 走 OCCT `svgToSolid`（`:40`） |
| BREP 拉伸 | `api/generated/operations.ts:148-154` | `extrude(face, height)` |
| wasm 基建 | `occt-kernel/occtKernel.ts` | `initOcctWasm()` 已在用，加载链路成熟 |
| 拓扑命名 | `topology/naming/` | 前文的 R1 缓解手段 |

几个关键判断：

1. **`Blueprint` 不依赖 OCCT 内核**（`boolean2D.ts` 内无 kernel/occt 引用）——它是纯 TS 2D 数据结构。这意味着**草图求解结果可以同时喂给 brep 与 mesh 两条链**，正好满足 faijs 的双链路要求。
2. **`svgExtrude` 是现成的「2D 轮廓 → 3D 实体」双链路模板**。草图功能不应另起炉灶，应照此模式实现 `sketch → extrude/revolve` 的 dual-op（mesh 侧：2D 三角化 + 挤出；brep 侧：`curvesAsEdgesOnPlane` → OCCT wire/face → 拉伸）。
3. **曲线类型基本够用**：线段/圆/弧/椭圆/椭圆弧/Bezier 都有。缺双曲线与抛物线、B 样条（可用 Bezier 分段近似，或后续补 `Curve2D` 类型）。
   **2026-09-15 实测**：786 个草图几何的类型分布为 `GeomLineSegment` 652（83.0%）、`GeomCircle` 64、`GeomArcOfCircle` 57、`GeomPoint` 11、`GeomEllipse` 2；**椭圆弧/B 样条/双曲线/抛物线均为 0**。M3 只需实现 5 种几何。
4. **`cad` 脚本面无 `sketch`**（前文 G1 已确认），`revolve`/`sweep` 也未挂脚本面（前文 G2）。这两个是本次移植必须同时补的出口——**只做求解器不做「草图 → 立体」的出口，等于做了一半**。

---

## 7. 移植范围界定

| 层 | 源 | 规模（实测） | 移植方式 | 产出规模估计 |
|---|---|---|---|---|
| L0 求解器内核 | planegcs | 13,306 行 C++ | **复用 wasm，零重写** | 0 行 TS |
| L0' Boost 剥离 | `GCS.cpp:1785-1803` | 1 处 | 并查集替换（仅路线 B 需要） | ~40 行 C++ |
| L0'' wasm 封装 | — | — | TS 封装 + 类型 | ~300–500 行 TS |
| **L1 语义桥** | `Sketch.cpp/.h` | 6,732 行 | **按 faijs 数据模型重写** | **~2,500–3,500 行 TS** |
| L2 文档对象 | `SketchObject*` | ~8,000 行 | 不移植 | 0 |
| L3 Gui | `Sketcher/Gui` | 81,452 行 | 不移植 | 0 |
| faijs 集成层 | — | — | `cad.sketch` + dual-op 出口 + 脚本语法 | ~800–1,200 行 TS |

### 7.1 L1 重写的范围裁剪

`Sketch.cpp` 里有一大块是**交互式草图专用**，转换场景与 faijs 脚本场景都不需要：

| 功能 | 位置 | 是否需要 |
|---|---|---|
| `initMove` / 拖拽求解 / 临时约束 | `Sketch.h:176-213`、`Sketch.cpp:4990-4995` | 否 |
| `Block`（块约束）/ 组变换 | `Sketch.cpp` 中 `case Group:`、`captureGroupStates` | 否（初期） |
| `SnellsLaw`（折射） | `case SnellsLaw:` | 否 |
| `Text` 约束 | `case Text:` | 否 |
| 自动约束推断（绘制时吸附） | Gui 侧 | 否 |
| **几何登记 / 约束登记 / solve / 回写 / 诊断** | 主体 | **是** |

**裁剪后 L1 收敛到约 1,800–2,500 行 TS。** 若只做「FCStd 转换所需的只读求解通道」（§8），可进一步裁到 **~1,200–1,800 行**。

### 7.2 约束覆盖的推荐优先级

`Sketch::addConstraint` 的 23 个 case 中，按工程出现频率分档（分档为工程判断，非源码事实）：

- **P0（必须，覆盖绝大多数机械草图）**：`Coincident`、`Horizontal`、`Vertical`、`Parallel`、`Perpendicular`、`Tangent`、`Distance`、`DistanceX`、`DistanceY`、`Angle`、`Radius`、`Diameter`、`Equal`、`PointOnObject`、`Symmetric` —— 15 个
- **P1**：`InternalAlignment`（椭圆主轴/焦点、B 样条控制点）
- **P2（罕见，可显式回退）**：`SnellsLaw`、`Weight`、`Block`
- **`NumConstraintTypes` 是哨兵值**，非约束

---

## 8. 对 FCStd 移植的价值：一个关键区分

这是本文对 C3（排期）判断的核心依据。

**「FCStd 转换需要的草图能力」与「faijs 原生参数化草图」是两个不同规模的问题。**

| 维度 | 转换场景需要 | 原生建模需要 |
|---|---|---|
| 输入来源 | FCStd `<ConstraintList>` 已定义好的约束 | 用户在 `.fai.js` 里声明 |
| 需要求解 | **一次**（读档时求出几何） | 每次改参数都要解 |
| 需要拖拽求解 / 交互 | 否 | 是（未来 UI） |
| 需要自由度/冗余诊断 | 弱（原文件已解过，可信） | **强**（欠约束/过约束要报错） |
| 需要自动约束推断 | 否 | 未来需要 |
| 需要回写约束定义到文件 | 否（单向） | 是 |
| 输出 | 2D 轮廓（喂给 `extrude`） | 可编辑的草图对象 |

**推论：**

1. **转换只需要「只读求解通道」——读入约束 → 求解 → 得到 `Curve2D` 轮廓。** 这条通道的规模约为完整草图能力的 1/3（§7.1 的 1,200–1,800 行）。
2. 有了它，前文 §10 的 P3「草图降级通道（`dim: solved-baked`）」就能从**烘焙**升级为**参数化**：不再是把解硬编码成线段，而是把约束定义翻译成可再求解的草图。这是 `.fai.zip`「可编辑性」的质变点。
3. 但**求解器选型必须在 P3 之前定下来**——不是实现完，而是「选型 + 可行性探针」结论。因为如果求解器不可用，P3 的设计就要锁死在烘焙方案上，后面再改会推翻 P3 的成果。

---

## 9. 是否应作为「前序步骤」：判定

### 9.1 判定

**不建议把「草图能力移植」整体作为 FCStd 移植的前序步骤；但建议把「求解器选型 + 可行性探针」前置。**

### 9.2 理由

**反对整体前置（3 条）：**

1. **FCStd 的 P1/P2 不依赖草图。** P1 是容器与保留层（全部烘焙），P2 是基本体/布尔/变换/阵列/圆角翻译——这些都不需要求解器。把草图前置会无谓推迟第一个可用交付（P1 结束时就有完整可用的 `.fai.zip`）。
2. **草图能力对 faijs 有独立价值。** 它是原生参数化建模的底座，不该被绑在 FCStd 这辆车上。作为独立轨道推进，即使 FCStd 计划中止，草图能力仍然是有效资产。
3. **两者的共享基建有限。** 只共享 `freecad/` 影子备份与几何比对工具，耦合度低，没有强制串行理由。

**支持「选型与探针前置」（2 条）：**

1. **P3 的可编辑性上限被求解器选型锁死**（§8 推论 3）。选型不定，P3 无法设计。
2. **探针成本极低。** 1–2 天即可回答「wasm 能否加载 / 能否解一个三角形 / 版本差多少 / 体积可接受否」这四个决定性问题。这个信息量对排期的价值远大于成本。

### 9.3 推荐排期形态

```
FCStd 轨道：  P0 ─ P1 ─ P2 ─────────── P3（草图翻译）
                                        ↑ 依赖
草图轨道：    T0 探针 ─ T1 只读求解 ─ T2 cad.sketch ─ T3 交互式
                  ↑
            必须在 P3 启动前完成（1–2 天）
```

- **T0（前置，1–2 天）**：安装 `@salusoft89/planegcs`，在 faijs 的 Node 环境里加载 wasm，求解一个带 3–5 个约束的基准草图，记录：加载耗时、wasm 体积、与本地 FreeCAD 26.3.0-dev 的 API 差异。**产出是一份 go/no-go 结论。**
- **T1（可与 P1/P2 并行）**：只读求解通道（§7.1 裁剪版）。
- **T2**：`cad.sketch` + 双链路出口（`sketch → extrude/revolve` 的 dual-op，照 `svgExtrude` 模式）。
- **T3**：交互式草图（诊断、拖拽、自动约束）——优先级最低，可无限延后。

---

## 10. faijs 侧集成设计要点

给出落点，不涉及具体代码实现。

1. **隔离接口**：定义 `SketchSolver` 接口（输入几何图元 + 约束 → 输出求解后图元），wasm 只是其一个后端实现。保证路线 A→B 可切换。
2. **数据模型**：草图几何用 faijs 自有 `Curve2D` / `Blueprint`（`vendored/brepjs/2d/`），不引入 FreeCAD 的 `Part::Geometry` 概念。
3. **双链路**：草图求解出的 2D 轮廓必须能在 brep 与 mesh 两条链各自成体。照 `svgExtrude`（`api/svgExtrude.ts:62` mesh / `:40` brep）的 dual-op 范式实现 `defineOp({mesh, brep})`。
4. **脚本面**：`.fai.js` 是合法 JS 子集（`lang/metadata-extractor.ts`），草图应表达为可静态分析的语句序列。建议形态是「几何声明 + 约束声明」两段，与 faijs 现有的扁平语句模型一致，**不引入嵌套闭包**。
5. **缺口同步补齐**：`revolve` / `sweep` 需挂上 `cad` 脚本面（前文 G2），否则草图只能拉伸，价值减半。
6. **回退纪律**：任何求解失败（欠约束/过约束/奇异）必须**显式抛错**，禁止静默降级为烘焙——与前文 R7「禁止静默丢弃」同一条纪律。

---

## 11. 风险登记

| 编号 | 风险 | 影响 | 对策 |
|---|---|---|---|
| R1 | **LGPL-2.0-or-later 许可**：faijs 未发布、待专利申请（AGENTS.md）；wasm 产物的打包与分发合规性未定 | **可能是阻断性** | 法务前置；若不可接受，走路线 B 自编译（仍是 LGPL）或路线 C 自研。注意 npm 元数据写 `LGPL-2.0-or-later`、GitHub 页写 `LGPL-2.1`，以最保守者为准 |
| R2 | 版本漂移：第三方包的 planegcs 落后于本地 FreeCAD 26.3.0-dev，约束语义可能已变 | 翻译结果与原文件不一致 | T0 阶段做版本差异比对；长期切路线 B 自行对齐 tag |
| R3 | 第三方维护中断（周下载仅 ~2.9K，非官方） | 长期依赖风险 | 用 `SketchSolver` 接口隔离，保持可切换到自编译 |
| R4 | 双链路负担：草图必须在 mesh 链也可用，mesh 侧需 2D 三角化 | 工作量翻倍 | 复用 `Blueprint`（纯 TS，不依赖 OCCT）+ `svgExtrude` 的 mesh 路径 |
| R5 | 多线程 QR 需要 SharedArrayBuffer + COOP/COEP | 浏览器部署限制 | 单线程降级；性能敏感场景测量后再决定 |
| R6 | 曲线类型缺口：双曲线/抛物线/B 样条/椭圆弧 | 少数草图翻译不了 | 显式抛错 + 烘焙回退，不静默近似。**2026-09-15 实测：样本 786 个几何中这几类均为 0 条**，风险实际很低 |
| R7 | 草图求解是数值方法，初值敏感、可能收敛到错误分支 | 翻译出的几何与原文件不符 | 保留 `freecad/` 影子 BREP 做几何比对（前文 §9 判据 4） |
| R8 | 拓扑命名：草图元素在 FCStd 侧被后续特征引用 | 与前文 R1 同源 | 沿用前文对策（几何锚点 + `topology/naming/`） |

---

## 12. 未确认项（如实列出）

1. **`@salusoft89/planegcs` v1.2.0 的 planegcs 源码对应的 FreeCAD 版本未实测**——仓库最近一次源码升级是 2026-04-25，本地是 26.3.0-dev，具体差异（尤其是 `ConstraintSlopeAtBSplineKnot`、`ConstraintCenterOfGravity` 等新增约束是否在 wasm 里）需 T0 阶段核对。
2. **wasm 实际加载体积与初始化耗时未实测**——已知 npm unpacked size 为 892,495 B（含 TS 类型声明与 js 胶水），纯 wasm 体积与 `initOcctWasm()` 的对比数据待 T0 测量。
3. **许可文本不一致**：npm 元数据为 `LGPL-2.0-or-later`，GitHub 仓库页显示 `LGPL-2.1 license`。未核对仓库内 `LICENSE` 文件原文。
4. **本次未实际安装并运行 `@salusoft89/planegcs`**，其可用性判断基于 npm 元数据与仓库 README，属于二手证据。T0 探针是必需的验证步骤。
5. **Emscripten 编译 planegcs 未实测**——§4 的依赖分析（Boost 仅 1 处）基于 `grep` 全量检索，编译是否还有其他隐式依赖（如 `FCConfig.h` 生成的宏、`SketcherGlobal.h` 导出宏）需实际编译时验证。
6. ~~**§7.2 的约束优先级分档是工程判断，非源码事实**——未对真实 FCStd 样本做约束出现频率统计。~~
   **2026-09-15 已实测验证**：对 1,539 条约束统计后，P0 约束集（15 个）覆盖 **99.5%**，`SnellsLaw`/`Block`/`Weight`/`Text` 均 **0 条**，分档成立。完整分布见 `docs/plans/2026-09-15-fcstd-to-faijs-port-plan.md` §5.5.2。
7. **L1 重写的行数估计（2,500–3,500 行 TS）是外推值**，基于 `Sketch.cpp` 6,732 行中交互相关部分约占 40–50% 的判断，未经实际编码验证。

---

## 13. 对前文的更正

| 前文表述 | 更正 |
|---|---|
| §2 / §5.3：「FreeCAD 用 `src/3rdParty/planegcs` 求解」 | 路径已变更为 `src/Mod/Sketcher/App/planegcs/` |
| §7 R2：「长期需引入 2D GCS（FreeCAD `src/3rdParty/planegcs`、`OndselSolver`）」 | **`OndselSolver` 是 Assembly 模块的 3D 装配求解器**（`src/Mod/Assembly/App/CMakeLists.txt:8`），与 2D 草图求解无关，不应作为 planegcs 的替代选项 |
| §7 R2：「授权需法务确认」 | 范围收窄：只需确认 `planegcs` 一处的 LGPL 合规问题 |
