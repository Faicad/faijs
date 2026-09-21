# Agent Note: FEM 工作台对象 → preserved-only（仿真语义，非建模几何）

Status: implemented

## Problem

无 Proxy 属性的 FEM 原生类落进 `type-not-whitelisted` 缺口，拖垮了建模内容
极简单的整文件：`box_static.FCStd` 就是一个 Part::Box + 材质 + 10 个仿真
对象；4 个 box/constraint FEM 语料文件（加 FEMExample、constraint_contact_*）
失败仅仅因为仿真语义不是建模语义。轮廓修复后的 19 个失败文件里 7 个是
FEM 系。

## Corpus 事实（探针，2026-09-20）

- FEM 对象分两路：Python 子类（`Fem::FemAnalysisPython`、
  `Fem::FemMeshObjectPython`、`Fem::FemSolverObjectPython`、
  `Fem::FemMeshShapeBaseObjectPython`、`Fem::FemResultObjectPython`、
  `Fem::FeaturePython`）带 Proxy → H10 已接住（`python-opaque` →
  `python-baked`）；原生类（`Fem::FemMeshObject`、`Fem::FemResultObject`、
  `Fem::FemAnalysis`、`Fem::FemPostPipeline`、
  `Fem::ConstraintFixed/Force/Pressure/Contact/Bearing/Displacement`）此前
  全部落缺口。
- 属性面是纯仿真语义：References（面引用）、Force/Pressure 数值、FemMesh
  网格数据、结果场数据（Displacement*、Eigenmode*、MaxShear…）。零建模
  几何语义。

## Decision

- `convert.ts` 新增 `FEM_STRUCTURAL_TYPES` 集（+导出 `isFemStructural()`）：
  FEM 容器/网格/求解器/结果/约束/后处理管道。`auditMapping` 将其判为
  `preserved-only`、reason `fem-simulation`——不再构成缺口。
- **可再生场数据不带入容器**：FemMesh 与结果的 `Data` 属性只留在源
  FCStd 里（它们是从形状/求解输出派生的，真实场景每文件可达数 MB）。
- **远期任务记录在案（用户决策，2026-09-20）：faijs 未来要移植 FreeCAD 的
  FEM 分析能力——独立特性。**本次分类只解决仿真对象阻塞转换的问题；届时
  FEM 的边界条件（按名字引用建模面）将依赖 `api/edge-ref.ts` GOTCHA 已
  留档的面命名稳定性。

## Alternatives considered

- **把网格/结果也带入容器** — 现阶段否决：派生数据、体积大、faijs 暂无
  消费者；随 FEM 移植一并回访。
- **显式缺口并给专用 reason（`fem-unsupported`）** — 否决：缺口意味着不出
  zip，等于用分析任务惩罚合法建模内容；preserved-only 与结构类型先例
  （App::Origin 等）一致。
- **只把约束当结构类型、网格/结果仍留缺口** — 否决：口径不一致；此处每个
  FEM 类都是仿真语义。

## Consequences

- 56 样本 sweep：ok 32→**37**；FEM 缺口文件归零；`cliCheck` 失败 0。
  首因现为：`type-not-whitelisted` 7（Draft/Assembly/VRML——批量阶段）、
  `sketch-not-solved` 4、`pocket-missing-dependency` 3、单例 5 类。
- 测试：`fem-disposition.test.ts`（2 例；GOTCHA：无 Proxy 的原生类才是缺口
  来源）。fcstd 套件 13 文件 / 123 用例绿。
