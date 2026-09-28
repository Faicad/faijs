# Agent Note: FCStd 参数化翻译——草图、画图对象与升格参数

Status: implemented

[English](2026-09-28-fcstd-parametric-translation.md) | 中文

## Problem

FCStd 转换把每个源对象都压平成了非参数化结果，且产出的容器格式已被读取方
按设计拒绝。

- `Sketcher::SketchObject` 在 convert 期用 planegcs 后端求解，然后发射成
  `cad.profile({contours})`——一个锁在 z = 0 的死轮廓。约束集与参数化本质
  双双被丢弃：生成的脚本不可编辑、不可重解、也不可被参数驱动。
- `ContourSeg` 只有 line 与 arc。bspline 控制点被采样成折线，整椭圆被
  `segEnds` 的 default 分支直接丢段——「不丢几何」这条都未满足。
- Draft 画图对象（`Part::Part2DObject` 及子类——wire 点列、circle、arc、
  polyline）带 `Proxy`，被判定为 `python-opaque` 后烘焙，从未被重建为笔链。
- FreeCAD 的可驱动标量——`Spreadsheet::Sheet` 别名单元格、`App::VarSet`
  变量、具名尺寸草图约束——以及引用它们的 `ExpressionEngine` 绑定，全部在
  convert 期求值一次并烘焙成字面量。值是对的，但没有任何东西作为参数留存，
  因此运行时不可编辑。
- 磁盘上已有产物是 manifest `format: 1`（单 `entry` 字符串），统一容器读取
  方按设计拒绝它。

## Decision

`@faicad/faijs-fcstd` 按源对象的**参数化程度**分路，并把可驱动标量升格为
脚本一等参数。

### 分路：参数化程度决定入口

| FCStd 源对象 | faijs 入口 |
|---|---|
| `Sketcher::SketchObject`（几何 + 约束） | `cad.sketch` |
| Draft / `Part::Part2DObject` 画图对象（死坐标） | `cad.draw` |
| 不可解、几何超能力、或附着在曲面上的草图 | `cad.profile`（仅兜底） |

`cad.profile` 不再是默认：只有草图无法参数化表达时才落到它，且每个兜底都在
`mapping.json` 里带显式 reason（如 `sketch-unsupported-geom`、
`sketch-on-curved-face-unsupported`）。

### 求解时机从 convert 期搬到 run 期

convert 期现在只做解析、投影与预检。`classifySketch` 从「决定是否烘焙死轮廓」
降格为**保真预检**：它的判定（`solved` / `underconstrained` / `redundant` /
`conflicting`）记入 `mapping.json`，但每个非 `failed` 判定仍然发射
`cad.sketch`。只有 `failed`、或求解器能力之外的几何，才落 profile 兜底。
求解发生在 `cad.sketch` 内的 run 期，用的是同一个 planegcs 后端——能力没丢，
只多了参数化。

`@faicad/faijs-sketch` 新增 `fromFreeCadConstraints`，即从 FCStd 整数
`ConstraintType` + `(geoId, pos)` 引用到 canonical `SketchConstraint` 的反向
投影（此前缺的那一半）。它与既有的 `fromFreeCadGeoms` 配对。负 `geoId`
（`-1` HAxis、`-2` VAxis、`<= -3` 外部）投影为对应 canonical 引用或显式标为
不可投。

### 放置：平面走 `sketchOnPlane`，平面面走 `sketchOnFace`

草图放置归一为两路。附着在 datum/命名平面的草图变成 `sketchOnPlane(plane)`；
附着在别的特征某面上的草图变成 `sketchOnFace(on, face)`。旧的 `cad.place`
重定向 hack 已删除。`sketchOnFace` **只支持平面面**——附着在曲面上的草图落
兜底并带显式 reason `sketch-on-curved-face-unsupported`（`fixWireOnFace` 未
实现）；不伪造支持。

### 叶子参数升格为顶层 `const p_*`

三类叶子参数升格为 faijs 顶层 `const` 声明
（`param = const <name> = <literal>`），在所有对象之前预分配，因此可编辑、
可重解：

- `Spreadsheet::Sheet` 别名单元格，
- `App::VarSet` 变量，
- 具名尺寸草图约束（length / radius / diameter / distance / angle）。

取值在 convert 期用 `evalWithDoc` 求解一次，写入 `const` 右值（同一个值驱动
用于 parity 的几何真值）。纯几何约束（coincident / horizontal / parallel /
tangent …）与非具名尺寸约束仍内嵌在草图的 `constraints` 数组里。

引用已升格参数的 `ExpressionEngine` 绑定被**内联**进消费它的 op 调用——
`Pad.Length = width * 2` 变成 `cad.extrude(sk, [0, 0, p_width * 2])`——而不是
烘焙成常数、也不是抽成独立 `const`。faijs 的位置表达式本就支持参数，因此零新
语法。无法归约成「升格参数 + 算术」的绑定维持 `undefined` 并按属性降级上报；
不做任何猜测。

命名统一 `p_` 前缀 + codegen `emitVar` 去重后缀；每个参数的来源记入
`mapping.json` 的 `mapping.params: [{ name, source }]`，供 UI 列出可改参数。

### 重转换从源文件重生成，不打 manifest 补丁

旧容器不原地打补丁。v3 迁移用升级后的转换器把源 FCStd 语料再跑一遍，一趟同时
解决容器格式与参数化翻译两件事；只打 manifest 补丁会留下两套互不一致的产物。

## Alternatives considered

- **保留 convert 期求解，发射已解死轮廓 + 一份参数清单。** 拒绝：约束图才是
  草图可编辑的根据；已解轮廓 + 脱钩的数值无法在参数变动时重解，而这正是参数
  层的全部意义。
- **把内联表达式抽成独立 `const`（`const Pad_Length = p_width * 2`）。**
  拒绝：faijs 位置表达式已接受参数，多一个 helper `const` 只多一个名字和一跳
  间接，不换来任何能力。表达式就内联。
- **把 `cad.sketch` 的 `plane` 从命名平面字符串拓宽为任意 frame，并删掉
  `sketchOnPlane`/`sketchOnFace`。** 拒绝：任意 frame 表达不了「附着在别的
  特征某个面」，且平面/面两分已是下游既定的分工。`cad.sketch` 上的命名平面
  只作为捷径保留。
- **把 `format: 1` 的 manifest 补丁升级到 v3。** 拒绝：它只反映格式变更、不
  反映翻译升级，产出的 v3 容器内容仍在说「死 profile」。
- **把无法解析的表达式绑定烘焙成它的求解值。** 拒绝：既不能归约到升格参数、
  也不能归约到算术的绑定，没有诚实的参数形态；烘焙它等于悄悄冻结一个用户仍
  以为可改的值。改为按属性降级上报。

## Consequences

- `Sketcher::SketchObject` 现发射 `cad.sketch({ geoms, constraints, plane })`，
  canonical 约束集完整保留并在 run 期重解；Draft 对象发射 `cad.draw` 笔链。
  `cad.profile` 只出现在兜底分支，且每个兜底都写着原因。
- `extractContours` 丢失整椭圆的 bug 已修；剩余的精确曲线工作（bspline /
  椭圆抬成精确边而非采样折线）属 parity 跟进项，不再是硬 bug。
- 叶子参数以顶层 `const p_*` 与内联表达式出现在生成脚本中，`mapping.params`
  记录各自来源；改参数重跑即重算几何，且 default 值与 convert 期求解值一致。
- **GOTCHA——同表引用的前导点。** 真实语料的单元格写作 `=.G3` 而非 `=G3`；
  只剥 `=` 会留下 `.G3`，解析成 `. ( 24.1 )` 失败，使别名解析**静默**失败——
  整批 spreadsheet 驱动的模型产出 `params: []` 且 Pad 长度被烘焙。`cellBody`
  仅在点后跟字母时剥掉前导 `.`。
- 旧的 `format: 1` 产物必须先由源文件重生成，任何基于 `openContainer` 的读取
  方才能打开。
