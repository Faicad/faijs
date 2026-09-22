# Agent Note: Shape 资产证据优先于 python-opaque（EngineBlock）

Status: implemented

English | [中文](2026-09-20-shape-asset-precedes-python-opaque.md)

## Problem

EngineBlock 卡 `extrusion-missing-base`：其 Part::Extrusion 引用的 Draft 圆
（`Part::Part2DObjectPython`）同时带 `Proxy`（H10 的 python-opaque 证据）
和真实 `Shape` `.brp` 成员。上一阶段的 shape-asset 分支排在
`isPythonOpaque` 之后，圆被当 python-opaque 静默烘焙，Extrusion 找不到
变量。

排序即语义：python-opaque 的含义是「行为在 Python 代码里」——但当冻结的
Shape 资产存在时，几何是既有事实，导入胜过烘焙（烘焙只是「几何不可恢复」
对象的兜底）。

## Decision

- `translateObject` 非白名单分支中，shape-asset 检查（命中
  `shapeCarriers` → `cad.import_shape`）现置于 `isPythonOpaque` **之前**。
  Part::Feature 特例并入该分支（同一辅助 `shapeBrpFile()`：先 Shape 后
  SubShape）。
- 白名单类型仍绝不劫持（此前已测试锁定）。
- **修正上一条记录**：上一阶段「ArchDetail converts」不准确——当时 ok
  46→47 的增量来自别的文件；ArchDetail 仍卡其 `Part::Compound` 容器的
  成员解析（compound-missing-members）。Compounds 留下一阶段。
- all_objects 残余 `type-not-whitelisted` triage：还有 4 个 FEM 约束族
  （PlaneRotation/Pulley/Temperature/Transform）——同 preserved-only 语义，
  集合补充留下一阶段（机械性、低风险）。

## Alternatives considered

- **python-opaque 优先 + 仅 Part::Feature 走导入** — 即失败状态：排序必须
  按证据强度（冻结资产是「几何存在」的强证据，强于 Proxy 的「不可翻译」
  证据）。
- **同一提交里顺手加 4 个 FEM 约束类型** — 留后：每轮 sweep 只发一个经
  审查的变更；集合补充随下一阶段。

## Consequences

- 56 样本 sweep：ok 47→**48**（EngineBlock 转出；其 Extrusion 与下游
  Fusion002/Cut004 全部解析）、gap 9→8、checkFail 0。
- 剩余 8：sketch-not-solved 2（BIM 策略/相切拓扑）、external-geometry 2
  （曲线投影/迁移格式）、compound 1（ArchDetail 容器）、
  unsupported-constraint 1（InternalAlignment，已留档）、
  type-not-whitelisted 1（all_objects FEM 族，集合补充）、
  delta-exceeds-t1 1（已留档）。
- fcstd 套件 13 文件 / 140 用例绿（+2：Draft 圆导入排序 GOTCHA；
  Part::Feature import_shape 契约更新）。
