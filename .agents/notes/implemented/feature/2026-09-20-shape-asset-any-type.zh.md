# Agent Note: 非白名单类型带 Shape 资产 → shape-asset 导入

Status: implemented

English | [中文](2026-09-20-shape-asset-any-type.md)

## Problem

ArchDetail 卡 `compound-missing-members`：其 compound 引用的 Draft 线
（`Part::Part2DObjectPython`）带着真实 `Shape` `.brp` 成员。H7 shape-asset
路径只覆盖 `Part::Feature`（及 SubShape 结果缓存）；其余非白名单类型即使
几何已存在为资产，也落进 `type-not-whitelisted`。

## Decision

- `translateObject` 的非白名单分支中，命中 `shapeCarriers`（Shape 或
  SubShape 的 `.brp` 成员存在）即判 `cad.import_shape` + `shape-asset`
  ——「几何是既有事实」的理由从 Part::Feature 扩展到任意非白名单类型。
- 白名单类型刻意不受影响：Box/Pad 等保持参数化翻译路径（测试锁定不劫持）。
- 同轮 triage 另两个单例，均留档不修：
  - **Drilling_1 `unsupported-constraint`**：约束 Type=15 是
    InternalAlignment（椭圆极点对齐，InternalAlignmentType 1–4，宿主为
    椭圆/弧）。支持它属 planegcs 后端的特性工作；丢弃该约束会改变草图
    语义。
  - **TestSketchCarbonCopyReverseMapping `delta-exceeds-t1`**：carbon-copy
    外部映射容差；真实求解器/校验工作，不动。

## Alternatives considered

- **把 `Part::Part2DObjectPython` 加进白名单** — 否决：它是语义任意的
  Python 类型；我们真正消费的是冻结的 Shape 资产，所以资产路径（而非类型
  谎言）才是诚实分类。
- **支持 InternalAlignment（Type=15）** — 延后：需在 planegcs-backend 里做
  椭圆/弧极点处理；corpus 仅单文件。

## Consequences

- 56 样本 sweep：ok 46→**47**（ArchDetail 转出）、gap 10→9、checkFail 0。
  剩余首因：sketch-not-solved 2（BIM 策略/相切拓扑）、external-geometry 2
  （曲线投影/迁移格式）、单例 5（EngineBlock 挤出基准、all_objects 的
  Draft 类型、Drilling_1 InternalAlignment、CarbonCopy delta、
  TestTangentMode）。
- fcstd 套件 13 文件 / 138 用例绿（+1 GOTCHA 测试：非白名单 shape-asset +
  白名单不劫持锁定）。
