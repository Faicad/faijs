/**
 * api/assembly/solvers/types — 纯 TS global 求解器的类型与契约（P1）
 *
 * 本模块是 pure-type / 轻量数据层，不依赖任何 brepjs 或运行时单例，
 * 供 solve.ts、global-solver.ts、compound.ts 共享。
 */

import type { AssemblyTransform } from '../../../runtime-state'

/** 求解风格：'chain'（链式拓扑解析，默认）/ 'global'（CadQuery 兼容全局最小二乘）。 */
export type SolverStyle = 'chain' | 'global'

/**
 * 求解选项（P1）：透传自 `cad.assembly({ solver })` / `AssemblyBehavior.solver`。
 * `name` 用于 B4 锚定（assembly.py:465 `name == self.name` 锁定）→ 从 behavior.name 注入。
 */
export interface SolveOptions {
  /** 默认 'chain'，向后零兼容。 */
  solver?: SolverStyle
  /** 装配名（B4 锚定用；cq-compat 的 buildAssembly 注入）。 */
  name?: string
  /**
   * P8：刚体分组（成员下标分组，如 [[0],[1,2],[3]]）。同组成员在求解变量系中
   * 共享一个 6 维状态块——子装配在 CQ 语义里是刚体（其成员相对位姿恒定），
   * 拆成独立自由成员会让未约束成员漂移（nested_assy 实测：b2 恒等漂离 ref）。
   */
  rigidGroups?: number[][]
  /**
   * P8 方案 A：成员初始位姿（下标 → 平移 + 四元数 [x,y,z,w]）。语义 = CQ sublocs：
   * 成员建模坐标是「装配前的本地系」，约束 marker 取自该本地系；求解器状态是
   * delta（初 loc 之上的增量），绝对位姿 = initialPose ∘ delta，penalty 拉 delta→0
   * 即倾向保持初 loc。solve-tree flatten 时把每叶的累积 parentPose 传入。
   */
  initialPoses?: { translation: [number, number, number]; rotation: [number, number, number, number] }[]
}

/**
 * global 求解器内部的本地系标记（local-frame marker）。
 *
 * 与 CQ solver.py 的 marker 同义：
 * - point：装配实体的局部坐标点；
 * - axis：轴上一点 + 单位方向（边/圆柱面法线）；
 * - plane：面中心 + 单位法向（face_mate / align / angle 用）。
 *
 * 所有坐标取自成员 Shape 的本地系（faijs Shape 不携带 placement → 本地系 == 建模系）。
 */
export type GlobalMarker =
  | { type: 'point'; p: [number, number, number] }
  | { type: 'axis'; origin: [number, number, number]; dir: [number, number, number] }
  | { type: 'plane'; center: [number, number, number]; normal: [number, number, number] }

/** global 求解结果（与 `AssemblySolveResult` 对齐的字段集，但新增 residuals）。 */
export interface GlobalSolveResult {
  /** 每个被定位成员一条终态变换（pivot 恒 [0,0,0]；恒等位姿不输出）。 */
  transforms: AssemblyTransform[]
  /** 恒 0（数值求解不做 DOF 分析，保留字段避免 undefined）。 */
  dof: number
  /**
   * P7/D1-3/D1-4：欠定自由度诊断（仅 global 路径）。dof > 0 = 约束集欠定，终态位姿
   * 依赖优化器轨迹、无唯一「正确解」——判等方应走规范判等通道而非逐位比对。
   * freeDirs = 零空间自由方向（变量系：每成员 6 维块 [tx,ty,tz,rx,ry,rz]，
   * 欧氏范数 1；D1-4），供判等方直接构造 canonical 扫描的轴/枢轴。
   */
  underdetermined?: { dof: number; freeDirs?: number[][] }
  /** LM 终止即 true（无论残差大小；裁定 4.6）。 */
  converged: boolean
  /** 仅约束类型无法映射为代价时填充。 */
  unsupported: string[]
  /** 逐约束最终残差（诊断，满足「绝不静默」）。 */
  residuals: number[]
  /** 残差超阈值（>1e-6·scale）的约束逐条写入（折中可见）。 */
  warnings?: string[]
}


// ── §5.6.1：chain 求解器类型迁入（原 brepjs kernel/solverAdapter.ts，已内化为第一方代码） ──

/** 3D vector（chain 求解器本地别名，与 quat.ts 同构）。 */
export type SolverVec3 = readonly [number, number, number]

/** A geometric entity (plane, axis, or point) referenced by a chain-solver constraint. */
export interface SolverEntity {
  type: 'plane' | 'axis' | 'point'
  origin: SolverVec3
  normal?: SolverVec3
  direction?: SolverVec3
}

/** A chain-solver constraint between two entities, with an optional scalar value. */
export interface SolverConstraint {
  type: 'coincident' | 'concentric' | 'distance' | 'angle' | 'fixed'
  entityA?: { node: string; entity: SolverEntity }
  entityB?: { node: string; entity: SolverEntity }
  value?: number
}

/** Result of the chain solver: per-node transforms, DOF count, and convergence. */
export interface SolverResult {
  transforms: Map<string, { position: SolverVec3; rotation: [number, number, number, number] }>
  dof: number
  converged: boolean
  /** Constraint types that were passed in but not solved (not yet implemented). */
  unsupported: string[]
}
