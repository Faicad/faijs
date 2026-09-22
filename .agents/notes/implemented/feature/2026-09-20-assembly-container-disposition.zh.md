# Agent Note: 装配/导入容器类型 → preserved-only（container-link）

Status: implemented

English | [中文](2026-09-20-assembly-container-disposition.md)

## Problem

SubShape/基准类型 triage 之后，剩余首因第一是 `type-not-whitelisted`
（7 个文件）：AssemblyExample（装配容器 + App::Link）、ProjectTest
（App::InventorObject 导入占位）、TestVRMLTextures（App::VRMLObject），以及
all_objects（额外 FEM 约束族）。这些对象引用或内嵌其他/外部几何，自身不产生
建模语义——用它们阻塞整文件等于惩罚合法建模内容，正是 FEM 处置已修过的
同一模式。

## Decision

- `convert.ts` 新增导出集 `STRUCTURAL_TYPES_EXTENDED`：`App::Link`、
  `App::LinkElement`、`Assembly::AssemblyObject`、`Assembly::JointGroup`、
  `App::InventorObject`、`App::VRMLObject` → `preserved-only`、reason
  `container-link`。
- FEM 集补全（all_objects 语料）：`Fem::ConstraintFluidBoundary`、
  `Fem::ConstraintGear`、`Fem::ConstraintHeatflux`、
  `Fem::ConstraintInitialTemperature`——与已分类约束族同一仿真语义。
- **建模特征刻意不入集**：`Part::Mirroring`（2 文件）、
  `PartDesign::AdditiveSphere`（1 文件）保持显式 `type-not-whitelisted`
  缺口——它们是要翻译的真实几何（H7 工作），搭车结构集会伪造转换成功
  （测试锁定）。

## Alternatives considered

- **Part::Mirroring/AdditiveSphere 也 preserved-only** — 否决：与容器/链接
  不同，它们带建模语义；preserved-only 台账行会把未实现的翻译藏在
  「按原样保留」标签后面，败坏驱动 H7 优先级的缺口指标。
- **把 App::Link 当形状引用去解析** — 延后：解析链接文档需要链接文件加载
  方案；corpus 的链接指向同文档或我们不带的外部文件。

## Consequences

- 56 样本 sweep：ok 39→**42**（AssemblyExample、ProjectTest、
  TestVRMLTextures + FEM 尾随文件），gap 17→14，`cliCheck` 失败 0。
  剩余 14 文件全部是真实几何/求解工作：sketch-not-solved 4、
  type-not-whitelisted 3（draft_test_objects 的 Draft 对象、EngineBlock、
  all_objects 聚合件）、单例 7。
- 测试：fem-disposition.test.ts +2 例（FEM 族补全；container-link GOTCHA
  含建模特征不入集的锁定）。fcstd 套件 13 文件 / 130 用例绿。
