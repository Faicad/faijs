# Agent Note: FCStd 移植 M13-w — Offset2D 可行性探针（候选 1 判定不可行，2026-09-17）

## 结论：候选 1（wire-offset 解锁 22 个 Part::Offset2D）取消

探针（`scripts/probe-offset2d-feasibility.ts`，可重跑）实测全部 22 个
Offset2D 实例（全在 ArchDetail.FCStd）：

- Source 全部是 Draft Wire（`Part::Part2DObjectPython` 19 个、
  `Part::Feature` 1 个、Rectangle 2 个）
- **wire 顶点数据不在 Document.xml 里**：`Points` 属性 count=1 且无坐标
  子节点（Draft 几何存在 Python 代理对象，序列化不落 XML）；Part::Feature
  连 Points 属性都没有；Rectangle 无 Points
- Fill=true 占绝大多数（22/22），Join 混合（0/1/2），Mode 大多 0

## 为什么不可行

原计划「转换层读 Points → 偏移折线 → 产 cad.sketch」的前提不成立——
属性里没有可读的折线顶点。剩余路线只有「读烘焙 .brp → OCCT 提取 2D 边
→ 偏移 → 重建轮廓」，这是从 BREP 边数据做几何重建，且重建一致性无法用
属性校验（与 V3 零静默丢失口径冲突）。按纪律（不猜、不静默降级）判定
不可行，不上实现。

## GOTCHA

- Draft Wire / Part2DObjectPython 的几何属性（Points）在 FCStd XML 中
  不可读——扫描器见到 `Points count=1` 无子节点即此形态，勿当作单点。
- Offset2D 的 Fill=true 意味着即使可偏移还要产面，不止 wire 偏移。

## 覆盖率后续候选（更新后顺序）

1. M13.3 外部几何全量解锁（Drilling_1 类 L2 预判草图回 L1）
2. M10 遗留容器加载器（跨文件 `<Body>_out` 引用闭环）
3. Offset2D：仅当未来引入「.brp 边提取 + 2D 偏移重建」能力后重估
