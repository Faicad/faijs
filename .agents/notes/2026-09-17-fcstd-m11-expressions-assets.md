# Agent Note: FCStd 移植 M11 — 表达式接入与资产收口（2026-09-17）

## 决策 1：ExpressionEngine 常量绑定覆盖 <Float>（M11.1）

`propNum()` 读取链改为：ExpressionEngine 绑定值优先，取不到（无绑定/绑定
非本属性）回落 `<Float>` 存储值。依据：FreeCAD 加载时按表达式重算被绑定
属性，存储值可能过期（测试断言 stored=999、expr=10mm → 取 10）。

**口径**：只有裸常量（数字 + 可选单位 mm/cm/m/in/deg…）可求值
（`evalConstantExpression`，M6.2 实现）；含标识符的算术（`2 * 5`）不算
常量——宁烘焙不估值。

## 决策 2：非常量表达式显式烘焙（M11.2）

`hasNonConstantBinding()` 检查 Pad/Pocket 的 Length 绑定；非常量 → 烘焙
reason `pad|pocket-length-expression-non-constant`。不做启发式估值（§12）。

## 决策 3：资产口径（M11.3/M11.4，D-B 落地）

- G7 测试：`assets/` 成员与 `mapping.json.artifacts` 中 assets 条目 **1:1**
  （双向集合相等），且逐字节等于 `freecad/` 影子成员（.brp 原样直存）。
- G9：L1/L2 草图落盘 `assets/<Sketch>.contour.json`（原始未解几何 +
  约束表 + 降级 reason），登记进 mapping artifacts。**实测语料三样本
  （PadTest/Crank/ProjectTest）均无 L1/L2 Sketcher 草图**（Crank 全是
  Part2DObjectPython/Part::Feature），落盘路径由转换脚本实现、
  mapping 登记接线完成，但真实语料触发 0 个 contour 资产（正确行为）——
  该路径目前只有代码路径保障，无真实样本断言，待语料扩充后补 e2e。

## GOTCHA

- `<ExpressionEngine>` 解析按 `Expression path="Length"` 的 path 匹配属性名，
  path 可能带前导点（`.Length`），匹配前需归一化。
- Crank.fcstd 的 16 个 baked 对象全是 `Part::Part2DObjectPython` /
  `Part::Feature`（Python 系），不是 Sketcher 草图——扫描/统计时勿混。

## 测试

- `feature-type.test.ts` +4 例：常量覆盖 stored 值、跨对象引用烘焙、
  Pocket 标识符算术烘焙、`2 * 5` 不算常量
- `build-fai-zip.test.ts` +1 例：G7 资产 1:1 + 字节等值
- fcstd 13 文件 / 97 用例 + e2e 三样本全绿（基线不变）
