# Agent Note: 外部几何 SubShape 源回退（shapeBrpFile）

Status: implemented

## Problem

hole_puzzle 的外部几何草图全部报 `external-geometry-unresolved: no links`
——有误导性：这些草图明明带 ExternalGeometry 链接（Chamfer002 Edge13、
Pocket002 Edge44…）。`wireframeOf` 只经 `Shape` 属性查源对象的 `.brp` 成员；
PartDesign 特征（Chamfer/Pocket）的结果缓存在 `SubShape` 里、没有 `Shape`
属性 → 每条链接报 "source shape not loadable" → `usable` 为空 → 判定坍缩成
"no links" 兜底文案。

## Decision

- 新增导出辅助 `shapeBrpFile(obj)`：有 `Shape` 用 `Shape`，否则 `SubShape`
  ——与 shapeCarriers 收集端用同一对属性（「对象的形状在哪」的单一事实源）。
- `wireframeOf` 改用该辅助。失败原因现按链接逐条浮现，不再被兜底文案掩盖。
- **外部曲线投影保持留档缺口**：Sketch011 的 Edge110 解析出 630 点弧线
  polyline，被 `polyline.length === 2` 直线过滤**按设计**丢弃（只收 2 点
  线段）。接受 polyline 会把镶嵌误差悄悄冻进模型。正规支持 = 把精确曲线
  （弧/圆）作为独立线段类型投影进 sketch 通道——特性级工作，下一阶段
  候选。
- 测试：新建 `external-geo.test.ts`（3 个合成用例：Shape 优先、SubShape
  回退 GOTCHA、无文件 undefined）。

## Alternatives considered

- **接受多点 polyline 作为外部线段** — 否决：sketch 通道消费的是 2 点直线
  引用；630 点弧会撑爆生成草图并把镶嵌误差固化进模型。正规支持 = 精确曲线
  （弧/圆）按独立线段类型投影——特性工作，下一阶段候选。
- **解析 PartDesignExample 的迁移版 ExternalGeo 内联几何** — 延后：格式不同
  （GeometryList + ExternalTypes + shadow 属性），corpus 压力仅此一文件。

## Consequences

- hole_puzzle 的直线外参考（Sketch003/004/005/006）现已解析；文件仍卡
  Sketch011（弧线外参考）——现在是真实且被正确报告的能力缺口。
- 56 样本 sweep：ok 维持 46、checkFail 0（净转换数不变——本修消除的是被
  掩盖的失败类并锐化报告）。
- fcstd 套件 13 文件 / 137 用例绿（+3）。
