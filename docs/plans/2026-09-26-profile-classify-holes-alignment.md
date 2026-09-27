# profile 孔洞分类对齐 classifyHoles（消 H15）开发计划

状态：方案 v7（未实施，当前定案）。v1–v6 已废弃——v6 曾主张"sketchOnPlane/sketchOnFace/punchHole 等 3D 桥接方法不实装"，经用户纠正推翻：**本项目是 3D 建模，2D 图形的最终目的就是 3D；"面上画草图→拉伸"是必须支持的功能**，桥接方法是 2D 能力的出口，不是可砍的边角。

## 1. 用户原话（需求来源）

> （v5 定案）你为什么要自作主张呢？如果没有特定的理由，为什么不直接用别人的全套的算法？
>
> （v6 追问）我们是否需要 brepjs 的 blueprint 功能？
>
> （v7 定案）本项目是 3D 建模，2D 图形的最终目的就是 3D。类似在给定模型的平面上画草图，然后拉伸成实体，是必须支持的功能。目前 faijs 是否支持？是否可以采用 brepjs 的方案？

> brepjs 的 classifyHoles / organiseBlueprints 跑在 brepjs 自己的数据结构（Curve2D[]、Blueprint、它自己的 face/sketch 类型）上，不是 faijs 的 ProfileParams/ProfileLoop（segments: line/arc）。所以逐字"移植"不是 drop-in，输入得适配。
>
> 但是——这点最关键——faijs 仓库里已经有一份同样算法的实现了：packages/core/src/brep/svg/svg-to-solid.ts:757 的 classifyHoles，它就是"有符号面积 + 质心 + bbox 包含"判定。
>
> cad.profile 的 buildProfileShape（profile.ts:229）是另起炉灶对着 ProfileParams 写的，把分类逻辑又抄了一遍，却抄成了弱版本：用 polys[i][0]（每个环第一个点）当探针、没有 bbox 这道预筛。
>
> H15 包含判定偏脆弱（当前能过测试，但理论有漏洞）：用每个环第一个采样点当探针判父环，依赖"环间不共边"假设；父环判定用 loops[j].area <= loops[i].area 跳过相等——若两环面积相等且确有包含关系会漏判。

> （v3 定案）你的理由根本不成立。faijs 必须有正确的 2d 图形处理能力。要么你找到一个更好的实现，要么把 brepjs 的这部分代码迁移过来。不依赖 brepjs 仓库，不是禁止任何的 brepjs 代码。根本是两回事。

> （v4 定案）"直接全量搬 geometry2d.ts 不是最优起点……只需要其中一条纵切"——你明显理解错误。如果这些功能都是合理的，那么就都应该移植过来。目前 faijs 没有，只代表 faijs 的能力缺口，不是不需要。

> （v5 定案）你为什么要自作主张呢？如果没有特定的理由，为什么不直接用别人的全套的算法？

> brepjs 的 classifyHoles / organiseBlueprints 跑在 brepjs 自己的数据结构（Curve2D[]、Blueprint、它自己的 face/sketch 类型）上，不是 faijs 的 ProfileParams/ProfileLoop（segments: line/arc）。所以逐字"移植"不是 drop-in，输入得适配。
>
> H15 包含判定偏脆弱（当前能过测试，但理论有漏洞）：用每个环第一个采样点当探针判父环，依赖"环间不共边"假设；父环判定用 loops[j].area <= loops[i].area 跳过相等——若两环面积相等且确有包含关系会漏判。

> （v3 定案）你的理由根本不成立。faijs 必须有正确的 2d 图形处理能力。要么你找到一个更好的实现，要么把 brepjs 的这部分代码迁移过来。不依赖 brepjs 仓库，不是禁止任何的 brepjs 代码。根本是两回事。

## 2. brepjs 源码实测结论（2026-09-26，D:\Faicad\brepjs 实际核查）

**事实修正：brepjs 里没有 `classifyHoles`。** 全仓 grep 确认 src/ 仅有 `organiseBlueprints`（`src/2d/blueprints/lib.ts:138`）；`classifyHoles` 是 faijs SVG 模块（svg-to-solid.ts:757）的函数名，二者是独立实现。brepjs 侧真实对应物只有 `organiseBlueprints`。

### 2.1 brepjs 2D 几何体系结构（实测）

```
Blueprint.isInside (blueprint.ts:398)          ← 语义层：bbox 预筛 + isOnCurve 边界排除 + 射线计数
  └─ getKernel().intersectCurves2d(c1, c2, 1e-9)   ← 内核调用层（三后端可换）
       └─ intersectCurves2dFn (geometry2d.ts:536) ← 算法层：纯 TS，零依赖，零 import
```

- `geometry2d.ts`（1059 行）**单文件自包含**：`Curve2dObj` = 判别联合普通对象（line/circle/ellipse/bezier/bspline/trimmed），含求值 `evaluateCurve2d`、切线、`curveBounds`、bbox、序列化。
- 求交策略（geometry2d.ts:536-562）：line-line / line-circle / circle-circle（含同心圆特判）走**解析解**；一般曲线走 100 段采样粗搜（AABB 预筛）+ **Newton 迭代精化**（20 轮，自交情形有参数分离守卫）。
- `organiseBlueprints`（lib.ts:20-148）：Flatbush bbox 空间索引分组 → 探针 = 第一条 curve 参数中点（环边界上）→ `isInside` 精确判定 → `isIn.length` 分层（支持 ≥3 层嵌套、多外环拆分）。**无面积比较**——包含判定只靠 isInside。
- 已知局限（lib.ts:135 自认）：不处理 blueprint 相交/共边——但注意：**求交本身是精确的**，共边点会被正确求出；局限在分组策略层，不在几何判定层。

### 2.2 三实现对比

| 环节 | brepjs organiseBlueprints | faijs svg classifyHoles | faijs profile 现状 |
|---|---|---|---|
| 环模型 | Curve2D（精确解析曲线） | 采样多边形（SVG path 离散化） | 采样多边形（line/arc 离散化） |
| 包含判定 | 内核精确曲线求交射线计数 | 采样多边形 ray casting | 采样多边形 ray casting |
| 探针 | 第一条 curve 参数中点（边界上） | 顶点平均质心 | `polys[i][0]` 首采样点 |
| 预筛 | Flatbush bbox 相交 | bboxContains | 无 |
| 面积比较 | 无 | 面积降序 + `<=` 跳过 | `area <= area` 跳过 |

### 2.3 为什么 v2 的"采样多边形 + 边界中点探针"方案作废

v2 试图在弱算法上打补丁（换探针、补 bbox、删面积跳过），四个 H15 类漏洞只消掉两个，共边/非凸病态场景仍靠"声明不支持"兜底。而精确求交方案下：射线与环边界**精确求交**（弧是精确圆弧、不是采样折线），共边点、切点都能被正确求出并计数，`isOnCurve` 显式排除边界点——**H15 整类问题一次性消失**，且为 faijs 建立了正式的 2D 曲线求交能力（后续 SVG、sketch、布尔 2D 都能复用）。

## 3. 迁移合法性与惯例核查（2026-09-26）

- **许可证**：brepjs 是 Apache-2.0（package.json:13），faijs core 是 MIT。MIT 项目收录 Apache-2.0 代码的适配版可行，须在文件头保留版权与许可声明（Apache-2.0 §4 要求）。
- **既有先例**：faijs `svg-to-solid.ts:4` 文件头已写"适配自 brepjs `src/io/svgImportFns.ts`，保留核心算法和命名"——按"适配 + 注明出处"吸收 brepjs 代码是本项目既定惯例，本次迁移延续该惯例。
- **解耦守卫的真实含义**：`check-core-no-brepjs.mjs` 守卫的是 **core 不 import `@faicad/faijs-brepjs` 包 / 不存在 vendored 树**（包依赖与 vendor 目录），不禁止把 brepjs 算法以 faijs 自有代码形式收录（svg-to-solid 即为例证，该守卫对其从不报警）。

## 4. 方案（v7：2D 能力 + 2D→3D 桥接全量迁移）

### 4.0 前置事实（2026-09-26 实测）

**faijs 现状——"面上画草图再拉伸"不支持，是真实能力缺口**：

- `cad.profile` 产出的轮廓**锁死在全局 XY 平面（z=0）**：`ProfileLoop` 的 segments 只有 x/y 坐标，`buildProfileShape` 直接在 z=0 构面；profile.ts 中 grep `plane|origin` 零命中——没有"在指定平面上画"的入口。
- **曲面草图完全没有**：无任何 API 接受"face + 2D 轮廓 → 贴面 wire"。
- 现有 3D 路径只有：profile(z=0) → extrude 沿 Z 或自定义向量；`extrude upTo faceRef` 只是拉伸终止条件，不是草图放置。`packages/sketch/`（planegcs）是约束求解器，不解决 2D→3D 放置。

**brepjs 的 2D→3D 桥接实测（blueprint.ts:243-337 + 2d/curves.ts:23-38）——现成蓝图**：

```
sketchOnPlane(plane)                     Blueprint → SketchData{wire, origin, zDir}
  └─ curvesAsEdgesOnPlane(curves, plane)      逐曲线 3D 化（2d/curves.ts:24）
       └─ kernel.liftCurve2dToPlane(curve, origin, zDir, xDir)   ← OCCT 内核原语
  └─ assembleWire(edges)                                       ← 3D edges 合成 wire

sketchOnFace(face, scaleMode)            贴到任意面 UV（scaleMode: original/bounds/native）
  └─ kernel.buildEdgeOnSurface(curve, face.geomSurf)            ← OCCT 内核原语

punchHole(shape, face, {height, draftAngle})
  └─ subFace → kernel.draftPrism(...)                           ← 带拔模角的打孔
```

桥接核心是 `liftCurve2dToPlane` / `buildEdgeOnSurface` 两个 OCCT 内核原语 + 薄编排（逐 curve 调内核 → assembleWire）。faijs 的 occt-kernel 是同一套 OCCT WASM，原语有直接对应（个别未暴露的补暴露即可，薄工作）。

### 4.1 共享基座（全量迁移，无分歧）

- **`geometry2d.ts` 整文件移植**（1059 行 → `packages/core/src/geometry2d/curve2d.ts`）：Curve2dObj 六种曲线模型、求值/切线/bounds、构造族、变换族、intersectCurves2dFn（解析解 + Newton）、序列化、bbox。Apache-2.0 归属注记，导出面与 brepjs 同名一致。
- **`organiseBlueprints` 全套算法**（lib.ts:20-148）：Flatbush 空间索引（引入为 core 正式依赖，MIT/零传递/~2KB）+ union-find 分桶 + 边界中点探针 + isInside + cleanEdgeCases 多外环拆分 + ≥3 层嵌套递归。
- **`isInsideLoop`**（brepjs `Blueprint.isInside` 语义）：bbox 预筛 → isOnCurve 边界排除 → 精确求交射线计数（tol 1e-9）。
- **profile 消费方式**：分类段整体替换为 organiseBlueprints 调用；删除 faijs 自造 parent 链 / depthOf / 面积比较。
- **svg 侧**：选项 A（保留采样版 classifyHoles）或 B（统一到 organiseBlueprints），实施时按测试结果定。

### 4.2 Blueprint 数据类全量迁移（含 2D→3D 桥接）→ `packages/core/src/geometry2d/blueprint.ts`

**三个数据类整类迁移**（brepjs blueprint.ts 455 / compoundBlueprint.ts 189 / blueprints.ts 161 行），曲线句柄（brepjs `Curve2D` 内核句柄类）全部替换为 faijs 的 `Curve2dObj`（纯对象，curve 级求值/变换/克隆 geometry2d 已全量在位，Blueprint 级逐 curve 应用）：

| 成员组 | 处置 | brepjs 出处 |
|---|---|---|
| 构造 / curves / bbox 缓存 / clone / delete（faijs 侧为 dispose no-op 或省略） | 原样迁移 | blueprint.ts:80-170 |
| `orientation`（shoelace 近似方向判断） | 原样迁移（构面前方向归一要用） | blueprint.ts:140-171 |
| `isInside` / `isClosed` / `intersects` | 原样迁移（isInside 内核调用换 `intersectCurves2dFn`） | blueprint.ts:398-455 |
| 变换族 stretch/scale/rotate/translate/mirror | 原样迁移（curve 级变换 geometry2d:347-524 已在位） | blueprint.ts:174-242 |
| **`sketchOnPlane`** | **迁移**：`curvesAsEdgesOnPlane` + `liftCurve2dToPlane`（faijs occt-kernel 暴露或补暴露）+ assembleWire（faijs kernel.makeWire）；产物接 faijs `Shape`/wire 句柄 | blueprint.ts:243-263, 2d/curves.ts:24-31 |
| **`sketchOnFace`** | **迁移**：`buildEdgeOnSurface` + face.geomSurf 获取；scaleMode original/bounds/native 三种语义原样 | blueprint.ts:269-309, 2d/curves.ts:129+ |
| **`punchHole`** | **迁移**：subFace + `draftPrism`（faijs 侧对应 extrude/draft kernel 能力，缺则补暴露） | blueprint.ts:310-336 |
| toSVG* / toSVGPathD | 原样迁移（纯字符串输出，无内核依赖；svg.ts 33 行一并迁） | blueprint.ts:338-396, svg.ts |

**内核原语缺口处置**（实施第一项核对）：对 `liftCurve2dToPlane` / `buildEdgeOnSurface` / `draftPrism` 逐个检查 faijs `BrepEngineApi`/occt-kernel 是否暴露；未暴露的**补暴露**（OCCT WASM 本身有这些入口，投影是薄工作，记入 Agent Note）。

`CompoundBlueprint` 语义 = 外环 + 孔列表（faijs profile 的目标产物形态），`Blueprints` = 不相交 profile 集合——两者是 organiseBlueprints 的输出类型，构成完整分层产物链。

### 4.3 profile 分类重写（消 H15）——直接消费 organiseBlueprints

1. `ProfileLoop` → `Curve2dObj[]`：line seg → `Line2d`；arc seg → `TrimmedCurve2d{ basis: Circle2d }`（不再采样）。
2. 构造 Blueprint → `organiseBlueprints` → Blueprints。
3. 遍历产物构面：Blueprint = 单岛 face（faijs kernel 构面）；CompoundBlueprint = 外环 face + addHolesInFace(孔)；多元素 = compound。方向用 orientation 归一。
4. `as:'wire'`：取第一个（最大）外环；补丢弃语义注释。

### 4.4 2D→3D 接线（能力在位后，独立小 PR）

- `cad.profile` 增加可选 `plane` 参数（或新增 `cad.sketch` 入口）走 `sketchOnPlane`，解除 z=0 锁死 → extrude 任意平面草图。
- 贴面草图/`punchHole` 经 sketchOnFace/punchHole 直接可用（API 面经 `@faicad/faijs` 导出，具体形态实施时按 ops-api-inventory 惯例定）。
- **不夹带进本次 H15 修复 PR**：本次交付"2D 能力 + 桥接在位"（可测），API 接线另起（遵守一 PR 一主题）。

### 4.5 明确不做

- **② Sketcher 画图 DSL 不迁**（baseSketcher2d/genericSketcher/blueprintSketcher/cannedBlueprints 等 ~1400 行）：faijs 的画图入口是自己的 faijs 语言 + Sketcher/draw DSL，两套用户画图 API 定位冲突。若未来需要链式画图，另行评估。
- **③ 2D 布尔引擎不迁**（boolean2D/booleanOperations/segmentAssembly/intersectionSegments/blueprintOffset/booleanHelpers ~1900 行）：faijs 无 2D 布尔需求；对内核句柄依赖最深；独立大决策。
- ④ 中 ellipseUtils（245 行）暂不迁（organiseBlueprints/blueprint 均不引用；做椭圆 2D 布尔时再评估）；svg.ts 随 toSVG* 迁。
- 不改 ProfileParams schema（plane 参数在 §4.4 独立 PR 中加）、不改 op 注册签名、不动 `packages/brepjs`（保持删除状态）。

## 5. 任务清单（v7）

1. **内核原语缺口核对**：对 `liftCurve2dToPlane` / `buildEdgeOnSurface` / `draftPrism` 逐个检查 faijs `BrepEngineApi`/occt-kernel 暴露情况，缺的补暴露（Agent Note 记录）。
2. 新建 `packages/core/src/geometry2d/curve2d.ts`：**全量移植** brepjs `geometry2d.ts`（环模型 + 求值/切线/bounds + 构造族 + 变换族 + intersectCurves2dFn 解析解族 + numericalIntersect + 序列化 + bbox，Apache-2.0 归属注记）。
3. geometry2d 全量单元测试：求值/构造/变换/序列化往返 + 求交解析解族各类型 + Newton 兜底 + 已知病态（相切、同心、共线、自交守卫）——对照 brepjs 仓库跑真值固化断言，防迁移漂移。
4. **迁移三个数据类全量**（blueprint/compoundBlueprint/blueprints，Curve2D→Curve2dObj 适配）+ organiseBlueprints 全套（Flatbush 依赖）+ isInsideLoop + **2D→3D 桥接方法**（sketchOnPlane/sketchOnFace/punchHole，产物接 faijs Shape/wire 句柄），单元测试。
5. profile.ts：`loopToCurves` 适配 + 分类段整体替换为 `organiseBlueprints` 调用 + 删除自造 parent 链/depthOf/面积比较 + wire 分支注释。
6. profile 防回归测试（§6），GOTCHA 留档：旧首点探针 + `<=` 面积跳过 + 自造分层为何是坑。
7. svg classifyHoles 处置（§4.1 选项 A/B，实施时按测试结果定）。
8. 既有 profile/svg 全部测试通过 → 受影响包全量 → `scripts/ci.ps1`（只复跑失败项）。
9. Agent Note：v2→v7 决策修正链（用户历次纠正原话留档）+ 迁移出处与许可处理 + 内核原语缺口清单 + svg 侧选项记录。
10. 版本号更新（发布准备阶段约定）。
11. （独立 PR，不夹带）`cad.profile` 增加可选 `plane` 参数走 sketchOnPlane，解除 z=0 锁死；贴面草图/punchHole API 面接线。

## 6. 测试计划（关键验证落成可重复测试）

- **迁移保真（全量）**：geometry2d 单元测试覆盖全部导出函数——求值（六种曲线类型）、构造族（三点弧、切线弧）、变换族（translate/rotate/scale/mirror 各自的端到端断言）、序列化往返（serialize → deserialize → 求值一致）、求交（line-line / line-circle / circle-circle / 同心圆 / 一般曲线 Newton 路径 / 自交参数分离守卫）；断言值先在 brepjs 仓库内对同一输入跑出真值再固化（对照迁移无漂移）。
- **organiseBlueprints**：与 brepjs 仓库同输入对照（单环 / 双岛 / 岛-孔 / 三层嵌套 / 两个不相交的多环组 / bbox 重叠但互不包含），分层结果一致。
- **isInsideLoop**：凸多边形、凹月牙、含弧闭环、边界点（含切点）严格 false。
- **Blueprint 数据类**：变换族端到端（rotate 后 bbox/求值一致）、orientation（CW/CCW 识别）、toSVG* 输出与 brepjs 对照。
- **2D→3D 桥接**：sketchOnPlane（XY/XZ/自定义平面）→ wire 顶点坐标断言；sketchOnFace（圆柱面/平面，scaleMode 三种）→ wire 在面上；punchHole → 产物 volume 断言（含 draftAngle 拔模）；下游 cad.extrude(sketch 产物) 成实体。
- **H15 场景（profile 侧）**：
  - 首点探针失效场景（首采样点在父环边上）：精确判定正确分类。
  - 面积相等但存在包含（旋转 45° 等面积正方形嵌套）：无面积跳过，正确判定。
  - 强非凸环（月牙）：精确求交正确（采样质心会出环的病例不再存在）。
  - 三层嵌套（岛-孔-岛）：organiseBlueprints 分层正确、compound 面数正确。
  - 多岛各带孔：回归 Beds part16/39 语义。
  - 弧环与父环相切/共边：精确求交 + isOnCurve 排除下分类仍正确（旧采样 ray casting 的病态区，新方案的正确性优势场景）。
- stderr 零容忍遵守。

## 7. 风险与边界

- **Newton 数值路径的确定性**：仅 bezier/bspline 走；profile 只有 line/arc（全解析解），主链路无数值迭代风险。
- **迁移漂移**：以"在 brepjs 仓库对同一输入跑真值 → 固化为 faijs 测试断言"防漂移。
- **Flatbush 依赖**：core package.json 新增正式依赖（MIT、零传递、~2KB），`check-ghost-deps` 相应通过；若后续想去掉，可在保证测试等价前提下换简单实现（须 Agent Note 记录）。
- **内核原语缺口**：liftCurve2dToPlane/buildEdgeOnSurface/draftPrism 若有未暴露项，补暴露是薄工作但触及 `BrepEngineApi` 面（多引擎适配器都要实现）——任务 1 先核对，缺口大则如实上报再定。
- **sketchOnFace 的 Face 类型桥接**：brepjs 的 Face 是其内核句柄类，faijs 侧对应 BrepHandle/TopoRef——适配层需要从 faijs face 引用拿到 geomSurf；这是本次迁移里最主要的非常规适配点。
- **包图无环**：`geometry2d/` 不 import `api/`、`brep/`、`mesh/`（纯几何层，依赖只允许向外）；2D→3D 桥接需要触碰 kernel 的部分经依赖注入或放在 `geometry2d/` 与 kernel 的边界适配文件中，保持层次。
- **许可**：文件头 Apache-2.0 版权 + 出处注记；Agent Note 记录收录决策。
