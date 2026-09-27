# Agent Note: FCStd bspline 节点向量展开 + 构造几何 —— fillet edgeRef 失败

Status: implemented

[English](2026-09-27-fcstd-bspline-knots-and-construction-geometry.md) | 中文

## Problem

`Mannequin_mp-dummy-1850mm-standing-000.FCStd` 能转换，但隔离出的 `Body022` 产物在运行期失败：

```
cad.fillet(Groove032, { edges: [cad.edgeRef(Groove032, 2)], radius: 6 })
→ edgeRef: edge 2 has 1 adjacent face(s); an EdgeTopoRef needs a two-face pair
```

FreeCAD 的 `Fillet032` `Base` 是 LinkSub `Groove032 + Edge2`（Document.xml），转换器忠实地
发出了 `cad.edgeRef(Groove032, 2)`。而引擎自己算的 `Groove032`（=
`subtract(Revolution040, groove-sphere)`）是 **13 面 / 30 边**、序号 2 落在「只有 1 个相邻面」
的接缝边上；FreeCAD 的形状里 Edge2 是普通的两面边 —— 边**序号**对不上，是因为**几何**对不上。

根因 A（本次报告的问题）：`Sketch075` 带 6 个半径 1 的圆，它们是 FreeCAD 的**构造几何**——
落在轮廓顶点上的内部对齐/标记圆。它们只通过现代形式
`<GeoExtension type="Sketcher::SketchGeometryExtension" geometryModeFlags="…"
internalGeometryType="9"/>` 标记，而不是 `sketch-parse.ts` 所找的 legacy
`<Construction value="1"/>` 兄弟元素。该语料的 `Document.xml` 里 `<Construction>` 出现
**0 次**，于是标记圆漏进轮廓，回转体多出面/边，FreeCAD 的 `Edge2` 落到接缝边上。

修掉这个泄漏后**整个语料回归**（139 translated / 0 gaps → 85 / 54，`ok:false`）。因为该
泄漏一直遮着另外两个独立缺陷：

根因 B —— 节点重数被丢弃。`sketch-parse.ts` 从属性 `Multiplicity` 读节点重数，而 FCStd 写的是
**`Mult`**（500 文件语料扫描：3190/3190 个 `<Knot>` 元素都是 `Mult`，从无 `Multiplicity`）。
于是每个节点向量都被塌缩成**去重值**（长度 ≪ poles + degree + 1），`bspline.ts` 拿着一个维度
非法的向量去求值：当 `长度 < degree + 2` 时它静默退化成控制多边形（其端点恰好与极点重合，短的
样条*看起来*是对的）；否则 `evalBSpline` 把整个定义域夹到单一参数、返回一个退化代理。标记圆此前
一直在提供虚假的自闭合轮廓来满足 `extractContours`；一旦被过滤，直线+样条的轮廓产出**零**个环，
其 Revolution/Groove/Pad 消费方级联成 `sketch-solved-no-closed-loop` / `*-missing-base`。

根因 C —— 右边界跨度查找。节点向量展开后，`evalBSpline` 的跨度查找
`knots[k] <= u < knots[k+1]` 在右边界 `u === hi` 永不匹配，于是落到默认值 `k = degree`
—— **第一个**跨度 —— 并外插出了前段控制多边形。`sampleBSpline` 恰好把 `t = hi` 采为最后一点，
所以每条样条代理的**末端**都跳出曲线（Sketch075：最后采样 `(620.5, 385.9)`，而非极点
`(15.9, 0)`），`extractContours` 也因此链不上。既有测试全部用**单跨度**样条
（`poles.length === degree + 1`），此时最后跨度的下标正好等于 `degree`——即旧的默认值——所以
这个 bug 一直不可见。

## Decision

三处修复，一因一修，都在读取/展平层（不改引擎）：

1. **构造几何从每种编码读取**（`packages/fcstd/src/sketch-parse.ts`）。
   `isConstructionGeometry(child)` 同时识别 (a) legacy `<Construction value≠0/>` 兄弟元素，
   与 (b) 现代 `<GeoExtension>` 的 `internalGeometryType ≠ 0`（BSpline 控制/节点点、直径辅助）
   以及 `geometryModeFlags` 的**第 1 位**（`GeometryMode { Blocked = 0, Construction = 1 }`，
   从右往左数位）。`extractContours` 早已按 `g.construction` 过滤，只需修解析侧。
2. **节点重数从 `Mult` 读取**（`sketch-parse.ts`），保留 `Multiplicity` 作为手写 fixture 的
   兜底。展开后的（clamped）节点向量正是 `BSplineCurveData.knots` 文档所述、也是 `bspline.ts`
   所假设的形式，故展开的唯一落点是解析层。
3. **`evalBSpline` 正确跨右边界**（`packages/sketch/src/bspline.ts`）：`k` 的默认值取最后跨度
   `n - 1`（而非 `p`），于是 `t = hi` 求到最后极点。该默认值只在边界处触达；内部查找逻辑不变。

## Alternatives considered

- **放宽 `extractContours` 的 `JOIN_TOL`。** 拒绝：连接失败不是容差问题——代理末端偏离极点
  数十毫米。放宽容差会把无关点「连」成环。
- **只继续认 legacy `<Construction/>`。** 拒绝：那正是本次报告的 bug；标记圆留在轮廓里，边序号
  继续错。
- **在 `contour.ts` 里特判半径 1 的圆。** 拒绝：以形状属性做启发式，而非读取构造**语义**，并且
  会一并误删合法的小圆。
- **在 `bspline.ts` 里展开节点向量。** 拒绝：`knots` 契约上就是展开后的 clamped 向量，且解析
  出的几何同时喂给求解器；在解析层展开才能保持单一事实来源。
- **只加强 `knots.length < p + 2` 的兜底，不修边界。** 拒绝：那个兜底是给真正退化输入的；真实
  的多跨度样条需要真实求值。

## Consequences

- `Body022` 可跑：`{"ok":true,"checkErrors":[],"threw":false}`，导出 STEP（1097 实体）。
- 10 个文件的 `Mannequin_mp` 家族恢复干净转换 —— 9 × 139 + 1 × 88 translated，**0 gaps**，
  与修复前基线一致，但几何是正确的。
- 样条轮廓现在携带正确展平的折线（Sketch061/062/075 家族为 19–37 段直线），而非控制多边形或退化
  代理，因此每条样条草图都获得保真度提升，而不只是原本会 gap 的那些。
- 构造过滤是语料级行为变更：任何此前靠构造标记「凑出」闭合环的草图，现在除非真实几何闭合，否则
  会正确报 `sketch-solved-no-closed-loop`。这正是应有的信号，也正是它暴露了根因 B。

## Verification

- 新增回归测试：
  - `packages/fcstd/src/bspline.test.ts` —— `Mult` fixture、多跨度
    `evalBSpline(d, hi) === 最后极点` 用例、多跨度 `sampleBSpline` 末端用例，以及
    `Multiplicity` 兜底用例。
  - `packages/fcstd/src/construction-geometry-gotcha.test.ts` —— 现代
    `geometryModeFlags` 第 1 位 / `internalGeometryType` 标记构造，且构造圆被排除出轮廓。
- 测试套件：`packages/fcstd` 22 文件 / 248 测试通过；`packages/sketch` 通过；
  `packages/tests faijs/sketch-constraint faijs/edge-ref` 17 测试通过。
- 类型检查：`packages/fcstd` 与 `packages/sketch` 的 `tsc --noEmit` 退出码 0。
- 端到端：隔离 `Body022` 走 BREP 链（`tools/run-sweep-worker.ts`）→ `ok` + STEP；
  家族转换扫描 → 10/10 `ok`、0 gaps。
