# Agent Note: 纯 2D 几何移植与统一放置管线

Status: implemented

[English](2026-09-27-2d-geometry-and-bridge.md) | 中文

## Problem

faijs 一直没有纯的、与内核无关的 2D 几何层。`cad.profile` 直接从 2D 线段数据构 3D 边（`profile.ts` 的 loop-to-wire 旁路），带自造的孔洞分类（parent 链 + `depthOf` + 面积比较）。计划所需的 2D→3D 桥接原语（`sketchOnPlane`/`sketchOnFace`/`punchHole`）零实现，且内核契约（`BrepEngineApi`）不暴露任何曲线句柄体系。在此基座上加 3D 建模能力，意味着在 api 层重复实现 2D 几何逻辑。

## Decision

core 在 `packages/core/src/geometry2d/` 下获得一套与内核无关的纯 2D 几何基座，从 brepjs 移植（Apache-2.0，文件头注明出处）：

- `curve2d.ts` — `Curve2dObj` 六种曲线（line/circle/ellipse/bezier/bspline/trimmed）、求值/切线/bounds、构造族、变换族、序列化、`intersectCurves2dFn`、`CurveBBox2d`/`createCurveBBox2d`；brepjs 判别字段 `__bk2d` 改名 `kind2d`（`__bk2d_bbox` → `kind2d_b`），对齐 faijs 命名。
- `bbox2d.ts` — 纯数据 `BBox2d` 助手。
- `blueprint.ts`/`compound-blueprint.ts`/`blueprints.ts` — `Blueprint`/`CompoundBlueprint`/`Blueprints` 为纯对象容器（无内核句柄、无 `dispose()`）。
- `organise.ts` — `organiseBlueprints` 分类（bbox 重叠分组 + `isInside` 嵌套探针，走 `intersectCurves2dFn`）。
- `adapt.ts` — 从旧 `cad.profile` 线段形状（line/arc）到 `Curve2dObj` 的结构化适配，保留 `ccw` 方向与整圆。

`cad.profile`（F2）消费这条统一管线：`buildProfileShape` 现在把每个轮廓转成 `Blueprint` 并运行 `organiseBlueprints`，再从分类后的曲线构 3D line/arc/bezier 边。旧的 ad-hoc parent 链 / `depthOf` / 面积比较分类被删除。

2D→3D 桥接（`geometry2d/bridge/`）是该基座后续的放置步骤——按方案，桥接在 occt 平台面保留 occt-only 原语（`liftCurve2dToPlane`/`draftPrism`），组合在组合层完成。

嵌套环语义是决策而非偶然：嵌套=孔、不相交=独立岛、奇深=孔、偶深=再成岛。`organiseBlueprints` 复现它，并由迁移后的 profile 回归测试以 parity 形式强制。`ccw` 是几何方向字段、不是元数据：适配按方向推导弧扫（CW 正向扫角 = `startAngle − endAngle`），整圆保留为真 `circle`（三点构造过奇异起点/终点会退化）。

`organiseBlueprints` 用纯 union-find 的 bbox 重叠分组取代 brepjs 的 Flatbush 空间索引——不引入 Flatbush 依赖、纯 TS、无内核句柄。平面的 wire 组装复用 `makeWire`，从弧上三点重建真 `makeArcEdge`，bezier 走 `makeBezierEdge`；仅对非解析曲线（ellipse/bspline）用采样折线。

## Alternatives considered

- **把 Flatbush 作为 core 正式依赖引入。** 未采纳：不必要地重；纯 bbox-overlap union-find 就能达到同样分类，且已被迁移测试锁定，日后改动局部于 `organise.ts`。
- **保留 `cad.profile` 旧 parent-chain 分类。** 未采纳：ad-hoc，且无法推广到必须走同一管线的任意 `Curve2dObj` 输入（`cad.draw`/sketch）。
- **本轮直接交付完整桥接 SKU。** 未采纳：放置验收需要纯 2D 基座先落地且回归安全；桥接是对同一基座的后续。

## Consequences

- core 暴露 `@faicad/faijs/geometry2d/*` 子路径导出。
- 分类逻辑只存在于 `organiseBlueprints` 一处，`cad.profile` 与后续 `cad.draw`/sketch 族共用。
- 整圆、`ccw:false` 弧、多岛/岛中孔轮廓均通过迁移测试（33 geometry2d + 5 profile 多岛 + arc GOTCHA 护栏，另多引擎 parity `mismatches=0`）。
- 纯 2D 基座是 `geometry2d/bridge/` 放置（`sketchOnPlane`/`sketchOnFace`/`punchHole`）与 `@faicad/faijs-draw` 包的前置。
- `geometry2d/bridge/`（E2）落地平面抬升组合：`plane.ts`（`makePlane`/`namedPlane`/`lift` 帧）+ `lift-on-plane.ts`（`liftCurve2dToPlane`/`curvesAsEdgesOnPlane`/`assembleWire`）。内核类型取 `Pick<BrepEngineApi, makeLineEdge|makeArcEdge|makeBezierEdge|makeWire>`，调用方直接传 `getBrepApi()` 免强转；模块只 import 内核契约、绝不 import `api/`。
- `cad.sketchOnPlane`（E2+op）落地：与 `cad.profile` 相同轮廓环输入，置于命名或显式 `{origin, normal, xAxis}` 平面；`as:'face'`/`'wire'`；已注册进 cad 命名空间与符号表。
- 笔层（`BaseSketcher2d`）现驻 core `geometry2d/pen-sketcher.ts`（brepjs sketcher 的纯对象移植），作为 C 组 DSL 的临时落脚点；它只依赖 `geometry2d/*`，日后迁入 `@facade/faijs-draw` 是机械性的重新放置。
- SVG-style 椭圆弧以 `geometry2d/svg-ellipse.ts` 落地（`normalizeEllipseRadii`/`convertSvgEllipseParams`/`makeEllipseArcFromSvgParams`），产出以 `Ellipse2d` 为基的 `TrimmedCurve2d`（参数 = 扫掠角），解锁笔的 `ellipseTo`/`ellipse`/`halfEllipseTo`/`halfEllipse`。
- C2 以 `geometry2d/blueprint-sketcher.ts`（`BlueprintSketcher` → `done(): Blueprint`）与 `canned-blueprints.ts`（`polysidesBlueprint`/`roundedRectangleBlueprint`，圆角/椭圆角）落地。`BlueprintSketcher` 继承基类 `close(): Curve2dObj[]`；闭合轮廓的 `Blueprint` 由 `new Blueprint(pen.close())` 包装得到。
- `@facade/faijs-draw` 包（C3 底座）已建：`src/draw.ts` 提供链式 `draw(session)` 入口 + 建于 core `geometry2d` 之上的工厂命名空间 `draw.rectangle`/`draw.roundedRectangle`/`draw.polygon`/`draw.circle`，与 `src/drawing-factories.ts`；workspace/tsconfig/vitest 别名与全部发布门禁（顺序/lockstep/ghost-deps/export-jsdoc）通过，`npm run build` 出干净 dist。脚本侧运行时注册 `cad.draw` 符号推迟。
- 共享放置核心抽为 `buildShapeFromBlueprints(kernel, plane, blueprints, as)`（core `api/sketch-on-plane.ts`），`buildSketchOnPlaneWith` 改为先转 `ProfileLoop[] → Blueprint[]` 再调用。放置助手必须留在 `api/`（返回 `Shape` 且 import `fromBrep`/`solidToShape`）；`geometry2d/bridge` 模块禁止 import `api/`。core e2e 证 draw 包轮廓形状（`roundedRectangleBlueprint` 的 `Blueprint`）经 `buildShapeFromBlueprints` 放置 + kernel `extrude` 得正体积实体——即 F6「draw 入口 → 共享放置 → 拉伸」缝。
- C4 投影落地在 draw 包（`src/projection.ts`）：`projectPointToPlane`/`projectWire`/`drawFaceOutline`/`drawProjection` 将 3D 线框投影到平面坐标（命名平面或显式坐标轴）成绘制 `Blueprint`。投影是 core bridge `liftPointToPlane` 的严格逆（正交基下 `(p−o)·xDir/(p−o)·yDir`），内核无关，仅 import core `geometry2d`（平面坐标取自 `@facade/faijs/geometry2d/bridge/plane`）。roundtrip 测试钉住逆等价 GOTCHA；XZ 帧测试记录了「平躺在 XY 平面的线框在 XZ 帧上投影为平坦」（2D y 即帧的 y，只有在真正位于该平面的线框上才对应世界 Z）。
- draw 预制工厂集已完备，既作具名导出也可作 `draw.xxx` 命名空间成员：`rectangle`、`roundedRectangle`、`polygon`、`circle`、`ellipse`（全周 CCW `makeEllipse2d` 单曲线轮廓，暴露中心/长短半轴/旋转）。椭圆轮廓在放置期解构为采样折线，与 `circle` 单轮廓路径一致。
- 精确的 `parameterOfPoint(c, px, py, maxRatio=0.1)` 落地于 core `geometry2d/curve2d`（经 `@facade/faijs/geometry2d` 暴露）：N=80 粗网格 + Newton 收敛到垂直足 `(curve−P)·tangent=0`，越过几何范围比阈值返回 `null`。半径 5 的圆上它收敛到 ~1e-9（相对原始网格 ~0.06），正是 D1/D3（圆角/倒角/布尔/偏移）等待的参数点钩子；独立 `refineParam` 保持原 80 采样行为。
- 两个子曲线基元补全 D 组基座层：`trimCurve(c, tStart, tEnd)` 在 native 域参数区间上构造 `TrimmedCurve2d`（复用去一层 basis），`splitCurveAt(c, t)` 在内部 native 参数处把单曲线切成两段 trimmed 子曲线（非内部时返回 `null`）。与 `parameterOfPoint`、`intersectCurves2dFn` 合计，即 D1 2D 布尔与 D3 圆角/倒角所需的底层切割/拼接操作，全部纯实现、经 `@facade/faijs/geometry2d` 暴露。
- GOTCHA（数组坐标帧）：`.fai.js` 平面字面量以**数组**给帧（`{origin:[10,0,0],normal:[0,0,1]}`）；`toVec3` 必须归一化数组形式。只接受 `{x,y,z}` 会得到 `undefined` 坐标 → NaN wire → occt `makeFace` `CONSTRUCTION_FAILED`。