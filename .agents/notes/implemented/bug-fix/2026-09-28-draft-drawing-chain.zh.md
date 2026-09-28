# Agent Note：Draft 绘图链从来没有真正跑起来过

Status: implemented

[English](2026-09-28-draft-drawing-chain.md) | 中文

## 问题

计划 A4 把 FreeCAD 的 Draft 对象（`Part::Part2DObjectPython`）翻译成 `cad.draw`
会话。翻译写完了、产物也转换出来了，但**没有人执行过一个**。真正跑一遍（本项目唯一
承认的判据）后：**15 个转换成功的画图产物里有 11 个根本跑不起来**，其中 10 个报
`[parser] AST nesting depth exceeds 100`。

背后是三个缺陷，前两个被「代码看着挺合理」遮住了；第四个要等前三个修完、产物能跑到
不同的地方失败时才**可达且可见**：

1. **`wireframe().edgeGroups` 不是遍历序。** `extractDraftDrawing` /
   `renderDrawSession` 把**相邻数组项**当作相邻边串链。该数组是整形状级的
   `TopExp::MapShapes` 序。实测 `Clone2D.Shape.brp`（单 wire、15 条边）：14 个相邻对
   只有 3 对共享端点，其余相距**最大 3.43 mm**。于是每条 Draft wire 都被炸成逐边碎片
   ——8 个产物里 145 个对象被报成 **781 条轮廓**，其中 95% 是「开口」的，即根本构不出面。
2. **连续性容差低于噪声底。** `wireframe()` 返回 `Float32Array`；同一顶点的两次独立细分
   可差 ~1 ulp ——实测 |coord| ≈ 300 时 float32 步长 **6.1e-5**。旧常数是 `1e-6`，所以
   **即便顺序对了链也接不上**。相关地：`closed` 是按**单条边**判的，而单边只有在整圆
   边时才闭合——「95% 开口」这个数字正来源于此。
3. **pen API 从未被真正调用过。** 发出的链用 `pen.moveTo(x, y)` 与
   `pen.lineTo(x, y)`。`BaseSketcher2d` 没有 `moveTo`（叫
   `movePointerTo(point: Point2)`），`lineTo` 收的是元组，`close()` 是终止子。
   `cliCheck` 会放行这种产物，因为它只做 parse + schema 预检。
4. **放置调用没声明 `inputs`。** `lower()` 的根聚合来自
   `consumed = calls.flatMap(c => c.inputs)`。`inputs: []` 让每条轮廓变量都显得
   **没被消费**，于是根 `cad.compound` 把裸的已绘 `Blueprint`（无 BREP 句柄）扫进了
   成员表，`Chair` 死在
   `E_BREP_UNSUPPORTED: compound members are not all on the BREP chain`。只有执行才能
   暴露它：发射出来的文本语法上完美。光加 `inputs` 还不够——`renderArgs` 会把 `inputs`
   按**位置参数**渲染，于是调用变成 `cad.sketchOnPlane(v0, v1, …)`；而
   `cad.sketchOnPlane` 只收命名参数，所以必须同时带 `noPositionalArgs`
   （`cad.compound` 的 `members` 用的同一组合）。

还有一个计划直接假设掉的**能力缺口**：A4 写的「draw → `sketchOnPlane` → `extrude`」，
但**全仓没有任何 op 能把 `cad.draw` 的产物变成 Shape**。`cad.draw` 产出的纯数据 2D
轮廓没有 OCCT 句柄；实测 `cad.extrude(drawn, dir)` 报
`E_BREP_INPUT: argument carries no BREP handle`，`cad.sweep(drawn, …)` 报
`INVALID_SHAPE_ID`。也没有第二条路——全仓没有 op 接纳它。

## 决定

四处改动，各自对应上面一项：

1. **`packages/fcstd/src/draft-draw.ts`** —— 改从真实拓扑重建轮廓：走
   `getSubShapes(shape, 'wire')`（一 wire = 一轮廓），wire 内**按端点匹配**排序边
   （`chainWireContours`），而不是按数组位置。匹配容差由数据推导
   （`draftTolerance`：`1e-5 × 坐标量级`），对 float32 最坏情形留 ~25× 余量，同时比
   真正不同顶点间的毫米级间距小 ~1000×。`closed` 改为**整条轮廓**的性质；走链遇到
   接不上的边会**重开一条**而不是丢掉。
2. **`BaseSketcher2d.polyline(points, close)`** —— 一次调用画完整条轮廓。AST 深度上限
   使这件事成为**必须**而非便利：成员链每段深一层，而这些轮廓有几百到几千个点
   （实测某对象单环 7823 点）。
3. **`toContourBlueprints`**（`api/profile.ts`）—— `contours` 现在除段环数据形态外还
   接纳**已绘制轮廓**（`Blueprint` 或其数组）；`cad.profile` 与 `cad.sketchOnPlane`
   共用。这就是 A4 假设存在、实际缺失的放置桥。两种形态混用抛
   `E_PROFILE_MIXED_CONTOURS`，不做半读。
4. **`codegen.ts`** —— **每条轮廓一次 `cad.draw`**（一个会话是单轮廓 flood pen：
   一旦有曲线，`movePointerTo` 拒绝抬笔；实测某对象带 61 条环），再用一次
   `cad.sketchOnPlane` 收口，`contours` 就是这些已绘轮廓、`plane` 取对象自己的
   Placement。放置调用把轮廓变量列进 `inputs`（标记为已消费，根聚合就不会再扫到它们）
   并置 `noPositionalArgs: true`（保持只是登记，调用仍渲染成 `{ contours, plane }`）。
   对象自己的变量成为放置后的 Shape，因此下游用法
   （`cad.sweep(Clone2D001, Clone2D002)`、`cad.extrude(Clone2D005, …)`）完全不变。

## 实测效果

- `Kitchen_cabinet_base`、`Chair`、`Beds`、`Sideboard`、`Kitchen_cabinet_sink`、
  `Living_room_cabinet`、`Bedroom_closet`、`Bathroom_cabinet_sink`：轮廓重建从
  **781 条幻影轮廓**（逐边碎片）变成一 wire 一轮廓，闭环现在被判为闭合。
- pen 链变成每条轮廓一次 `polyline([…])` 调用，AST 深度不再随点数增长。
- `Chair` **端到端跑通**（两个 `Shape2DView` 各翻译成 `draft-draw(17 contours)`，产物
  写出 STEP）；此前退化成死 `shape-asset` 导入的对象现在走画图链。
- `draft-chain-e2e.test.ts` 在两个语料文档上钉住：**两者**的发射都带画图链、坏形态
  `pen.moveTo` / `pen.lineTo` 已**消失**（而非被取代）、且没有裸 `…__draw` 变量漏进
  根 `cad.compound`；`Chair` 还要求真的执行产物并写出 STEP。

## 已知阻塞（不是本链的缺陷）

在把语料画图端到端跑起来的过程中发现的；**只记录、不顺手改**，因为两者都不是 Draft
缺陷，且都是既有问题：

- **`cad.sweep` 拒绝 FreeCAD 的 `Transition`。** `sweepFns.ts` 对任何
  `transitionMode !== 'right'` 故意返回 `SWEEP_TRANSITION_UNSUPPORTED`
  （「not supported after selfhosting (only 'right' default)」），而
  `feature-translate.ts` 忠实地把 FreeCAD 的 `Transformed`/`Round` 枚举映射成
  `'transformed'`/`'round'`。因此 `Kitchen_cabinet_base` 跑不起来：它的第一个 sweep
  （`Sweep001`，输入是两个**普通草图**而非 Draft 对象）就撞上该守卫。修法要么把
  transition 参数重新接进内核调用，要么让转换器报缺口、而不是发出一个它明知会被拒
  的模式——这是设计决策，所以 `draft-chain-e2e.test.ts` 用 `it.fails` 钉住现状，
  而不是假装它通过。

## 考虑过的替代方案

- **Draft 改发 `cad.profile`。** 今天就能跑、零新 API——实测同一批折线确实能挤出。被
  项目所有者否决：`cad.profile` 明确定位为最后兜底的死结果，而 Draft 对象是画图。
  「已绘制轮廓变不成 Shape」这个能力缺口要用**补能力**回答，不是绕开。
- **整张图放一个 `cad.draw` 会话、用 `moveTo` 抬笔。** 构造上不可能：一旦有曲线
  `BaseSketcher2d` 拒绝移笔。这是执行验证的结论，不是读代码的推断。
- **每条轮廓一次 `cad.draw`，再用 `cad.compound` 合并。** 否决：`cad.compound` 是 3D
  op，要求每个成员都有 BREP 句柄，而已绘轮廓没有——与 `cad.extrude` 同一种失败。
- **保留 `1e-6` 容差 / 用精确相等匹配。** 否决：在画图尺度上低于 float32 步长，这正
  是原链从来接不上的原因。
- **把多轮廓 `Blueprint` 按曲线连续性拆开，而不是每轮廓一个会话。** 否决：拓扑本来
  就能从 `getSubShapes(…, 'wire')` 拿到，用启发式反推轮廓边界是多余的。

## 后果

- Draft 对象现在要求消费宿主**注册 `draw` 库**。`@faicad/faijs-fcstd` 已经声明
  `@faicad/faijs-draw` 为运行时依赖；`.fai.zip` 消费方必须把
  `mergeDrawNamespace()` 并进 `cad` 命名空间，否则产物会在第一条轮廓处报
  `cad.draw is not a function`。`manifest.json` **尚无**库需求字段——只读 manifest 的
  宿主无从得知；另案跟踪。
- 旧名 `renderDrawSession` 已移除；`DraftDrawing` 现在带 `contours` 而非 `edges`。
- 轮廓仍是对源曲线的**折线近似**——冻结的 `.brp` 不含构造数据，所以 Draft 对象不可能
  变成参数化草图。这个区别正是它是 `cad.draw` 而不是 `cad.sketch` 的原因。

## 文件

- `packages/fcstd/src/draft-draw.ts` —— wire 走链、容差、轮廓渲染。
- `packages/fcstd/src/draft-draw.test.ts` —— 走链/容差/渲染单测。
- `packages/fcstd/src/codegen.ts` —— 每轮廓一 `cad.draw` + 放置调用。
- `packages/core/src/geometry2d/pen-sketcher.ts` —— `polyline`。
- `packages/core/src/api/profile.ts` —— `toContourBlueprints`、`DrawnContours`。
- `packages/core/src/api/sketch-on-plane.ts` —— 接纳已绘制轮廓。
- `packages/fcstd/src/draft-chain-e2e.test.ts` —— 语料 e2e，执行产物
  （sweep 阻塞用 `it.fails` 钉住）。
- `packages/fcstd/scripts/probe-{draw-design,edge-continuity,wire-topology,edge-walk,contour-closure,emitted-source,stmt-window}.ts`
  —— 各根因背后的测量探针（以及定位运行时错误所报语句的工具）。
