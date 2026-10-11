# Agent Note：SVG 视图投影引擎中立化（双方言通道、无门禁）

[English](2026-10-11-svg-view-projection-engine-neutral.md) | 中文

Status: implemented

## Problem

brepkit BREP 引擎下 `cad.projectView` / `cad.projectSheet` 产出**静默空 SVG**。投影层（`api/view/view-projection.ts#projectPolylines`）把引擎 `projectEdges` 的返回硬性断言为 occt-wasm 形态——6 组 compound arena id（`visibleSharp`/`hidden…`）——brepkit 下每个字段都是 `undefined`，序列化循环全部跳过。brepkit 内核其实实现了 `projectEdges`（L1 契约，`engine-method-map` 登记 `dialect`），但返回方言不同。

## Decision

`projectPolylines` 按引擎 id 分派（经 `getBackends().config.brepEngineId` 读取一次，与 `brep/export/export-model.ts` 的 STEP 导出通道同一模式）：

- **occt 通道**（现状，逐字节不变）：HLR compound 句柄 → `getSubShapes` → 3D 曲线采样（`curveParameters`/`curvePointAtParam`）→ 相机平面投影。
- **brepkit 原生通道**：内核返回 JSON 字符串 `{"visible":[[x,y,…],…],"hidden":[…]}` —— 每条折线为扁平 x,y 点对数组，**已投影**到相机平面（x 沿 `x_axis`，y 沿 `x_axis × view`；与 occt 输出坐标约定同构）。该通道解析后把每条折线直接序列化为 SVG path `d` 串；可见组实线、隐藏组虚线。无 compound 处理、无曲线采样。

沿用 STEP 引擎中立化决策的约束：

- **无门禁、缺特性不报错。** 视图 op 不带 `engines` 声明（从来如此）；实现体不做引擎身份断言。分派只选通道。
- **内核缺陷仍然抛错。** 原生通道收到非字符串或结构非法的 `projectEdges` 结果抛 `E_PROJECTION_DIALECT`——这是实现 bug，不是缺特性，隐瞒它违反静态分派红线。
- **单一序列化真源。** `viewBoxOfPaths` / `projectViewSvg` / `projectSheet` 两通道共用；只有折线**获取**方式不同。

产出形态以各自内核的投影为准（精度、隐藏线完整性）。faijs 不为 brepkit 重算 HLR。

## Alternatives considered

- **给视图 op 加 `engines: ['occt']`**（brepkit 下门禁拒绝）——否决：违背项目已对 STEP I/O 施行的"必须支持、无门禁"引擎中立化政策；内核有能力却硬报错，严格更差。
- **把 brepkit 输出适配成 occt 方言**（伪造 compound 句柄 / 假 arena id）——否决：brepkit 返回的是已投影 2D 折线，不是 3D 拓扑；造句柄会把两通道耦合，还得为 `getSubShapes`/`curveParameters` 造假面，无收益。
- **在 `brepkitKernel` 适配器内部分派**（返回 occt 形状对象）——否决：适配器必须如实映射内核方言，不能撒谎；map 条目保持 `dialect`，由消费方决定。

## Consequences

- SVG 视图投影在所有带 `projectEdges` L1 实现的 BREP 引擎上可用；brepkit 覆盖由 `packages/core/test/api/view/view-brepkit.test.ts` 钉住（非空 path、iso 隐藏虚线、10×20×30 box 的 front 投影 bbox 精确为 12×32、输入只读、图纸排布、auto 模式）。occt 行为由 `test/api/view/view.test.ts` 钉住不变。
- `E_PROJECTION_DIALECT` 是契约边界：引擎 id 分派是静态的，原生通道的 JSON 形态错误会大声暴露。
- `toPNG` / `toMultiviewPNG` 与 `toSVG` / `toMultiviewSVG` 族仍是 occt 专属（本轮范围外；它们是直调 occt 原生方法，不走 HLR 投影链）。
