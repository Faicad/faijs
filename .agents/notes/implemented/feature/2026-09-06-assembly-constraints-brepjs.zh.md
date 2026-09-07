# Agent Note: 基于 brepjs 求解内核的装配约束

Status: implemented

[English](2026-09-06-assembly-constraints-brepjs.md) | 中文

## Problem

装配定位此前只有埋在 `compound.ts` 里的单一硬编码 `face_mate` 约束形态：临时比对面中心/法向、只支持零件对零件的平面贴合、无诊断输出，也无法表达装配器需要的约束词汇（concentric、distance、angle、parallel、perpendicular、fixed）。与此同时，vendored brepjs 源码里已带一个零依赖的解析约束求解器（`solverAdapter.solveConstraints`），具备拓扑轮次调度、DOF 分析与收敛诊断，而 faijs 完全没有使用。另外求解需要圆柱面与圆边的轴几何，但拓扑命名 hint 层没有采集任何轴信息。

## Decision

brepjs 的 `solverAdapter` 被整体采纳为 faijs 装配求解内核（不改动 vendored 代码），并在其上加一层新的装配层，位于 `packages/core/src/api/assembly/`：

- **类型**（`types.ts`）：`AssemblyVec3`、`FaceRef`/`EdgeRef`/`PointRef`/`FaceIndexRef` 实体引用，以及九种约束类型——`mate`、`align`、`coincident`、`concentric`、`distance`、`angle`、`parallel`、`perpendicular`、`fixed`——边界上同时接受遗留的 `face_mate` 形态。
- **归一化**（`normalize.ts`）：`face_mate` 重写为 `mate`（仅字段重排）；未知约束类型抛错。
- **实体解析**（`entities.ts`）：实体引用从实时拓扑或 hint 快照解析为 brepjs `SolverEntity`（`plane`/`axis`/`point`）；圆柱面成为 `axis` 实体，平面成为 `plane`，缺轴则硬报 `E_TOPO_NOT_FOUND`——绝不静默给出错误实体。
- **降级**（`lower.ts`）：`mate`/`align` 降级为单条 `concentric` 加轴编码（依赖侧 axis 编码法向反向，因此"法向相对的面中心重合 + 轴对齐"精确等价）；`parallel`/`perpendicular` 降级为 `angle` 0°/90°；`fixed` 用占位实体。不编写任何自创合成逻辑。
- **求解**（`solve.ts`）：`solveAssembly(members, memberNames, constraints)` 依次执行 normalize → lower → `solveConstraints`；不收敛抛错并携带求解器的 unsupported 明细；结果为每成员一个终态位姿（每节点只被定位一次——指向同一成员的多条约束由求解器组合，不按序逐条施加），恒等位姿不输出。成员名为空在求解前即抛错。
- **位姿换算**（`pose.ts`）：四元数换序（brepjs `[w,x,y,z]` ↔ faijs `[x,y,z,w]`）与 pivot 语义换算（`p' = R·(p−pivot) + pivot + t` ↔ brepjs `p' = R·p + position`）是内核之外仅有的数学；两者均用 200 组随机位姿做了性质测试。
- **结果应用**：compound 的 `assembly()` 行为暴露 `do_assemble` 与 `solve`（同义）以及 no-op 的 `add_constraint`；`solveTransforms` 委派 `solveAssembly(...).transforms`。direct 执行器模式下，`applyPendingAssemblyTransforms` 在单元执行后应用取出的待定变换（mesh 顶点烘焙、BREP 刚体变换、下游重算），无需 DAG 重建。
- **P0 hint 轴**：`FaceHint`/`EdgeHint` 增加可选 `axis: { origin, direction }`（`AxisHint`）。`geom-hint.ts` 采集圆柱面轴（与 `topologyExt` 同源的曲面参数算法）、直边轴（起点 + 切向）、圆边轴（三点采样定圆心、叉积求法向）；采集失败绝不伪造轴。行快照与 `resolveFaceGeometry` 均透传轴。
- **错误**：适用三态拓扑错误纪律——`E_TOPO_NOT_FOUND`（悬空引用）、`E_TOPO_DELETED`、`E_TOPO_AMBIGUOUS`；任何情况下都不静默解析到错误实体。

## Alternatives considered

- **自写 faijs 原生求解器**：否。brepjs 适配器已是完整的解析求解器（拓扑轮次、DOF、收敛），零内核依赖；重复实现等于多维护一个求解器且面临分叉风险。
- **用合成逻辑组合 face_mate 而非降级**：否。`mate` 与「一条 `concentric` + 轴编码（依赖侧 axis 携带法向反向）」精确等价，合成器只会用更多代码重复降级已表达的内容。
- **BREP 链不可用时运行时回退 mesh**：否。按项目红线，BREP 路径可用性在执行前由静态规则判定；基于实时 BREP 句柄的求解器不得静默降级。
- **逐条约束顺序施加变换**：否。节点由求解器一次定位（每成员终态）；顺序施加会重复叠加变换，且与内核的轮次调度矛盾。
- **为圆边轴扩展内核 `getEdgeCircleData`**：否。用 `curvePointAtParam` 采样做三点定圆已能精确求圆心，避免改动 vendored 内核。

## Consequences

- `cad` API 现在具备九类装配约束面（外加边界接受的遗留 `face_mate`），记录在生成的 `docs/ops-api-inventory.md` §6.1 与 `docs/api-contract.md` §12。
- `face_mate` 在边界仍被接受但被归一化消解；`compound.ts` 里旧的临时求解循环已删除。
- 拓扑命名 hint 模式扩展（`AxisHint`）；重新生成的 `mesh/api.d.ts` 包含它，产出 hint 的宿主现在可以附带轴数据。
- `assembly()`/group 行为新增 `solve`/`solveDetailed`；direct 模式在 `do_assemble`/`solve` 后立即应用待定变换，无需 DAG 重建。
- P2（语法层 `.fai.js` 语法糖与宿主适配）与 P3（运动副/IK）仍在范围之外；内核与降级层的设计为后续接纳它们留了空间。

## Verification

- `geom-hint-axis.test.ts`（8 例）：圆柱面轴采集（含 reversed 面）、直边轴、圆边轴、非圆曲线拒绝、缺半径拒绝。
- `pose.test.ts`：四元数往返与 pivot 换算，各 200 组随机位姿。
- `solve.test.ts`（20 例）：四组 fixture 上 `mate` ≡ 遗留 `solveFaceMate`、退化分支、三体链式装配、直译约束对照、不收敛抛错带明细、空成员名抛错、缺轴 `E_TOPO_NOT_FOUND`。
- `assembly-replay.test.ts`（3 例）：mesh module 与 direct 执行器变换逐分量一致、`mate`+`fixed` 经 `asm.solve()`、不重复叠加（L6）。
- `packages/tests/faijs/assembly/assembly-constraints.test.ts`（5 例，真实 OCCT）：hint 轴对真实 OCCT 几何的采集、新约束类型 e2e、悬空圆柱面 `E_TOPO_NOT_FOUND`。
- 全量：core 1260 passed | 10 skipped；`packages/tests` 1528 passed | 3 skipped；根/工作区 typecheck 与 lint 全绿。
