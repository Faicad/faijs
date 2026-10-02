# Agent Note: CadQuery 选择器字符串语法 parity 落地到选择器引擎

Status: implemented

[English](2026-10-02-cadquery-selector-string-syntax.md) | 中文

## Problem

CadQuery 可链式调用的字符串选择器——`faces(">Z")`、`edges("|Z")`、
`vertices("<XY")`、集合运算（`and`/`or`/`except`/`not`）、索引（`>Z[k]`）、
多轴（`XY`）、向量、类型（`%PLANE`）、六个命名视角、以及逐级收窄
（`.faces("+Z").vertices("<XY")`）——是 CadQuery 建模的日常操作，但 faijs
此前只实现了 face 的一个子集。旧 face 路径依赖包围盒启发式，对
方向/平行/垂直类选择器会静默返回形体中心（`faces("|Z")` 只在中间落一个
对象，而不是落在两个平面面上），因此 vertex/edge 选择器与多级收窄完全缺失。

## Decision

整个字符串语法现已对齐 cadquery 2.8.0 的 `selectors.py`，在核心引擎中
clean-room 重写，且每条关键语法都有自动化测试锁定。适配器命名：
`parseSelector`（语法）、`resolveFaceSelector`（legacy，为既有单面路径保留）、
`resolveEdgeSelection`、`resolveFaceEdgeSelection`、`resolveVertexSelection`，
均从 `@faicad/faijs/api/cadquery-selectors` 导出。

- **引擎（core）：** `grammar.ts` + `types.ts` 把原子解析成 AST；
  `predicates.ts` 与 `resolve.ts` 对候选集求值。解析器为
  `resolveSelection(owner, [{ kind, sel }])`——一个（收集→过滤）的链式步骤；
  空的 `sel` 只收集不过滤（对应 CadQuery `.vertices()`）。分簇排序与容差上界对齐
  上游 `_NthSelector`。
- **语义：** `BaseDir_` 丢弃所有非平面/非直线实体（因此 `vertices("|Z")`
  为空、`>Z[1]` 抛错，与上游一致）；`>` 是 DirectionMinMax，
  `>>`/`<<` 在实体自身中心上运行，负索引回绕，`%` 按几何类型过滤。
  boot 阶段已对照 cadquery 2.8.0 验证：`faces("|Z")` → 2、`edges("|Z")` → 4、
  `vertices("|Z")` → 0、`vertices(">Z")` → 四个顶部角点。解析/类型错误
  （如 `%VERTEX`）抛 `ParseException`，与上游一致。
- **Workplane 接线：** `faces/edges/vertices` 改为追加带类型的 `selChain`
  而非丢弃选择派生；`eachpoint` 通过 `resolveSelection(owner, chain)` 解析链并
  在存活实体的 bbox 中心放置对象。所有工作平面重置点（`workplane()`、
  tagged、fillet/chamfer）都会清空链，避免壳层重置泄漏过期选择。
- **保留 legacy：** 旧 bbox 面启发式仅保留给不走链的既有单面路径，因此未触及
  的路径（如 `siblings`）不受影响。

## Verification

- 选择器引擎单元测试全绿（52 例）。
- cq-compat `vitest` 全绿，含 `selectors-narrowing.test.ts`——锁定
  `vertices(">Z")`、`>Z[1]` 抛错、`>>Z`、`BaseDir` 丢失、以及链式
  `faces("+Z").vertices("<XY")` → 最小 x+y 顶部角点，与端到端
  `faces("|Z").eachpoint` 放置两个 bumps（bbox ×1×1×1.1）。
- `test_selectors` 镜像集：43/45 PASS（唯一失败的导出是既有
  `prism`/`draft` extrude-kernel 用例导致的，与选择器无关）。
- 其余镜像 fixture 无回归；两个包 typecheck 通过。

## Alternatives considered

- **一开始就把整个 legacy 并进引擎。** 否决：`workplane.ts` 里若干私有助手
  （`selectFaceHandles` 等）已在消费旧 face 选择器；重写它们对
  `siblings`/fillet 的回归风险远超本次改动的价值，故留作后续精简。
- **完整复刻 cadquery 的类表（Perpendicular、Parallel、NearestToPoint…）。**
  否决：只有短式字符串语法在范围内；面向对象的 `Selector` 类和多对象
  （`wires`/`shells`/`solids`）目标均不在范围内，复刻整棵类树只会是死代码。
- **把探针逻辑漏进运行时。** 否决：所有探针派生的期望都固化在
  `*.test.ts`（引擎单测 + `selectors-narrowing.test.ts` + 镜像 fixture），
  因此探针真值保持可复现。

## Consequences

- `Workplane` 新增 `selChain` 字段；凡是以字面量构造 Workplane 的地方
  （测试夹具）需让 `selChain: undefined` 与其他选择槽一致。
- 后续可将 `shape-class.ts` 中剩余的字符串选择器类与 `workplane.ts` 三个私有
  解析器（供 `selectFaceHandles`/`selectEdgeHandles`/`selectFaceHandlesForRemoval`
  使用）折叠进中央引擎——现在参考实现的语义已收敛到单一模块。