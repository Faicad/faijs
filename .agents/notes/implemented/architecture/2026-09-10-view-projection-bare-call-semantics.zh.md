# Agent Note: faijs 视图投影 op 与裸调用双语义

Status: implemented

[English](2026-09-10-view-projection-bare-call-semantics.md) | 中文

## Problem

1. faijs 脚本无法产出工程图（三视图 / 等轴测）或模型的截图。vendored OCCT kernel 提供了投影机制（`projectEdges` / `cameraFns` / `Drawing.toSVG`），但 `projectEdges` 在 arg-spec 登记时被跳过（Edge 句柄数组与 compound 生命周期不符合 faijs 单产物收养模型），仓库内也没有任何消费投影路径的代码。
2. 既有约定是"测量/截图不消费 shape，让其留在 canvas 上"。`computeLiveShapes` C3 对"赋值且输出非几何"的调用保证了这一点，但**无赋值的裸调用**（`projectView(part, 'front')`）会走 C5（positional 顶层 var-ref）消费 `part`——违反该约定。
3. 反向地，修改类 op 裸调用（`fai_drill(part0)`）会静默丢弃结果：`transformExpressionStatement` 对裸调用生成 `await <call>`（`writes=[]`），钻孔结果消失。

## Decision

### 视图投影面（路径 A + 路径 B）

- 新建 `api/view/` 模块，三个脚本面函数，在 arg-spec 登记为新的 `kind: 'faijs'`（手写库函数，非 compatOp/dual-op 产物）：
  - `viewCamera(view)` — 纯数据相机规格（direction + 可选 xAxis）；iso 方向为归一化 `(1,-1,1)`；未知视图名抛错。
  - `projectView(part, view, opts?)` — BREP-only 工程线稿：借入 OCCT 句柄，跑 `drawProjection`（HLR），把 `Drawing.toSVGPaths` 组装成手工 SVG（可见实线 + 隐藏 `stroke-dasharray`），返回 SVG 字符串。纯数据——绝不修改输入 shape。
  - `projectSheet(part, views, opts?)` — 多视图网格排布成一张 SVG，每格带标签。
- mesh/SDF shape 无 BREP 句柄：`projectView` 抛 `E_BREP_ONLY_INPUT`。这些形状由 3d_editor 用 `viewCamera` 相机参数 + 既有 `takeScreenshot`（three.js `canvas.toDataURL`）渲染，是 mesh/SDF 形状的唯一通道（路径 B）。

### 执行语义：裸调用（规则 1 + 规则 2）

- 规则 1（`live-shapes.ts` C4）：无赋值行（`hasAssignment === false`）永不消费 shape，无论调用是只读还是自赋值。插在 C5 之前。
- 规则 2（`direct-executor.ts`）：裸调用结果按运行时返回值区分——只读查询（返回纯数据，如 `bboxCenter`）放行不写回；修改类 op（返回几何且首参是几何）写回第一个 shape 位置实参；成员方法调用写回 receiver。静态通道（`writebackTarget`）选候选目标；生成代码用 `__isGeom(__r) && __isGeom(__ctx.<target>)` 守卫，非几何返回值永不覆盖。
- producer 精确化：原地写回的执行行被登记（`DirectExecutor.inplaceWrites`，行号 → 目标名）并传给 `computeLiveShapes`——写回前的旧消费不能取消新值的终端资格，写回后的真实消费仍然有效。

## Implementation

- `api/view/`（view-camera.ts / view-projection.ts / view-sheet.ts / index.ts）；arg-spec 加 `'faijs'` kind + 3 条；`gen-l3-surface.ts` 加 `renderFaijs` 分支（re-export 到 `api/view/`）并对 `'faijs'` 跳过基线检查；重跑生成器写出 `generated/view.ts`，更新 `script-face.ts` + manifest。
- `symbol-table.generated.ts` 重生成（覆盖 3 个新 cad 键）。
- `live-shapes.ts`：`inplaceWrites?` 输入、C4 规则、按行锚定 lastProducer。
- `direct-executor.ts`：`isGeomValue`、`writebackTarget`、裸调用写回代码生成、`__isGeom` 第三运行时参数、`inplaceWrites` 登记与访问器。
- `module-registry.ts` / `runtime.ts`：把 `getInplaceWrites()` 接入 `computeLiveShapes`（模块与 direct 执行两路）。

## Alternatives considered

- **禁止裸调用（语法错误）。** 用户否决：裸调用是合法脚本风格，修复必须保留它并给出正确语义。
- **metadata-extractor 静态投影 outputs 做 producer 精确化。** 否决：只读裸调用会把 producer 前移，错误取消"读取所观察值"的消费；只有执行期登记实际原地写回才精确。
- **mesh/SDF 也走同一 SVG 路径。** 否决：投影需要 BREP 句柄；mesh-only shape 走路径 B（编辑器截图）。

## Consequences

- `projectView` / `projectSheet` 返回 SVG 字符串（纯数据）；裸 `projectView(part, 'front')` 让 `part` 留在 canvas（规则 1）。
- 裸 `fai_drill(part0)` 现在把钻孔结果写回 `part0`（规则 2），与 `part0 = fai_drill(part0, …)` 完全一致——指纹相等测试验证。
- 裸写回行的 `ExecutionAnchor.outputs` 从 `[]` 变为 `[target]`；库函数体内 4 个 `getCurrentStmt()?.outputs[0]` 读取点（primitives/chamfer/boolean/fillet）现在读到写回目标名，与新值接收变量一致。
- 编辑器生成器（3d_editor `engine/script-engine`）生成的裸调用自动继承规则 2；其产出命名逻辑已审计，无需改动。
- 测试：`api/view/view.test.ts`（16）、live-shapes C4/inplaceWrites（+6）、direct-executor 裸写回（+7）、a14 parity 静态/运行时对拍（+2）；core 全量与集成全量全绿。
