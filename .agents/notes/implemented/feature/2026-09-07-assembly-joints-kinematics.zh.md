# Agent Note: 运动副与运动学查询（P3）

Status: implemented

[English](2026-09-07-assembly-joints-kinematics.md) | 中文

## Problem

P2 交付的装配层是静态的：约束只做一次性位姿求解（`solveAssembly`），没有任何表达机构的途径——没有 revolute/prismatic 运动副与驱动值，也查不了正解、轨迹、逆解或自由度。宿主（3d_editor）需要在 `asm.solve()` 之后拿到每成员位姿来做动画与导出；module 与 direct 两个执行器必须走同一条 kinematics 通道（R11② 同源纪律）。vendored brepjs 源码里本就有零修改的运动学内核（`jointFns.js` 正解、`ikFns.js` 轨迹/逆解、`mechanismDOF`），faijs 此前没有把它暴露出来。

## Decision

在 `packages/core/src/api/assembly/` 的约束层旁新增可序列化的运动副面：

- **JointSpec**（`joints.ts`）：JSON 可序列化的联合记录 `{ type, parent, child, … }`——`revolute` / `prismatic` 携带 `axis: { origin, direction }`、以度为单位的 `min` / `max` / `value`、可选 `offset: { position, rotation }`（`rotation` 为 faijs `[x,y,z,w]` 四元数；brepjs 内部 `[w,x,y,z]` 的换序只在 `pose.ts` 发生）。多 DOF 类型（`cylindrical`、`planar`、`spherical`）在装配构造期被 **`buildJoint` 以明确错误拒绝**——绝不静默降级（D-P3-4：per-DOF range 待定）。
- **校验**（`buildKinematicTree` 内 fail-fast）：成员名为空、`parent`/`child` 不在 `members`、一个 child 被两个 joint 驱动——都带着成员表 / 重复 child 上下文抛错（R7 纪律）；`drive` 键不是 joint 的 child 也抛错（笔误而非静默忽略）。
- **求解**（`solveKinematics`）：`buildKinematicTree` → vendored `forwardKinematics` → 过滤合成根 `'__asm_root'`；全部成员拿到终态位姿（`KinematicsPose`），只有非恒等成员输出变换（与约束求解同语义）。
- **合并语义**（D-P3-1，`solveAssemblyAndKinematics`）：先跑约束求解、再跑 `solveKinematics`；同名成员的 joint 位姿**覆盖**约束解，每条覆盖记一条 warning。运动学结果不参与 `converged` / `dof` 统计。
- **消费通道**：**没有 `asm.kinematics()` 方法**——保持 R0（无返回值）语句形态。带 joints 时引擎把每成员位姿写进 `ExecutionResult.kinematics: Map<PartName, { position, rotation }>`，经 pending 通道（`setPendingAssemblyKinematics` / `takePendingAssemblyKinematics`）；runtime-state 不 import api 层类型（用可结构匹配的 `AssemblyKinematicsPose`）。**两个执行器都写**（module `ExecBookkeeping.kinematics`、direct `kinematicsOut`），由 J12 锁定。
- **查询面**（`cad.*`，纯函数、无 receiver）：`jointTrajectory`（轨迹采样，faijs 序 rotation）、`inverseKinematics`（target.rotation 按 `[x,y,z,w]` → brepjs 换序）、`mechanismDOF`。走完三源同步六步（op → 命名空间键 → `gen-symbol-table.ts` → `api/index.ts` 导出 → `op-set-consistency.test.ts` 绿 → `gen-ops-api-inventory`）。
- **arg-spec 同步**：五条被 skip 的 vendored 函数（`addJoint`、`forwardKinematics`、`mechanismDOF`、`inverseKinematics`、`jointTrajectory`）的 reason 全部更新为实际去向——尤其中 `forwardKinematics` 现指向 `ExecutionResult.kinematics` + `cad.mechanismDOF` / 库面 `solveKinematics`，不再是已删除的 `asm.kinematics()`。
- `assembly({ joints, drive })` 接受新参数；codegen roundtrip 测试覆盖 joints+drive 与多 DOF 文本（文本层不 reject）。

## Alternatives considered

- **加一个返回值的 `asm.kinematics()` 方法。** 拒绝：`.fai.js` 是声明式重放模型，有返回值的成员方法破坏 R0 语句形态（与删除 `asm1.drive()` 同一个理由）。位姿改走 `ExecutionResult`。
- **让引擎再做一次运动学求解。** 拒绝：库侧一次性合并约束 + 运动学（`solveAssemblyAndKinematics`）并同时登记两个通道；引擎侧二次求解 = 二次求解、二次登记。
- **P3 直接交付多 DOF。** 拒绝：per-DOF range 尚未定义；静默的部分支持违反不回退红线——构造期显式报错才是契约。
- **隐式放行任意 `drive` 键。** 拒绝：未知键是笔误，静默忽略会藏住错误，所以带 joint-children 列表抛错。
- **只让 module 执行器写 kinematics。** 拒绝：direct 执行器是一等执行路径（R11②）；J12 断言两者产出一致。

## Consequences

- `docs/api-contract.md` §12 增补运动副契约（JointSpec、drive 覆盖合并语义、双执行器共同的 `ExecutionResult.kinematics` 通道、`cad.*` 查询面）；`docs/ops-api-inventory.md` §6.1 以新 skip reason 重新生成。
- `ExecutionResult` 增加可选 `kinematics` 字段；宿主从中只读消费（P3 只读：DOF 显示经 `mechanismDOF`、滑杆改 `drive` 语句参数后重放）。
- vendored `jointFns.js` / `ikFns.js` 源码保持零修改（`packages/core/src/vendored` 零 diff）。

## Verification

- `joints.test.ts`（J1/J1b/J2/J3/J4）：单 DOF `revolute`/`prismatic` 工厂映射、axis 透传、value clamp、多 DOF 显式抛错、offset 四元数往返、重复 child 与成员关系/空名错误。
- `kinematics.test.ts`（J5–J8）：单 revolute 手算位姿、两级链合成、drive clamp、joints 覆盖约束且恰一条 warning。
- `joints-ik.test.ts`（J9–J11）：平面二连杆 IK 收敛且 FK(解) ≈ target、轨迹步数/时刻、`mechanismDOF`、browser 门面导出。
- `packages/tests/faijs/assembly/assembly-kinematics.test.ts`（J12）：`.fai.js` 重放 kinematics 与库面直调一致；module 与 direct 双执行器一致；无 joints 装配 `kinematics` 留空。
- `codegen-assembly-constraints.test.ts` 增补 joints+drive 与多 DOF roundtrip；符号表重新生成（61 条）后 `op-set-consistency.test.ts` 绿。
- 全量：core 与 `packages/tests` 装配相关套件全绿（core 87 + 集成 8）；typecheck/lint/CI 归入 P3 验收。