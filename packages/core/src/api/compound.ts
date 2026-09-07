/**
 * stdlib compound — group/assembly 库函数（compound Shape + AssemblyBehavior）
 *
 *
 * 从 src/ops/assemble.ts 迁出并改写为 stdlib 形态：
 * - `group(params)` → compound Shape（kind='compound'，children 为成员 Shape 引用）
 * - `assembly(params)` → compound Shape + AssemblyBehavior（约束列表 + solve 方法）
 * - 装配求解（P1 起）委派 api/assembly/（brepjs solverAdapter 内核）：
 *   do_assemble/solve 触发求解 → 引擎应用
 *   （mesh 顶点烘焙 + BREP 刚体变换 + 下游传播）。
 *   P2-f5：旧装配算法与自有四元数实现已删除，求解全链路走 api/assembly。
 *
 * compound 自身无独立 mesh——几何由 children 承载，意义是结构（层级）。
 * do_assemble 编译为 `await ctx.<asm>.do_assemble()`：调用 compound 的求解方法，
 * 对约束定位的成员施加装配变换（mesh 顶点烘焙 + BREP 刚体变换 + 下游传播）。
 */

import type { Shape } from '../mesh/types'
import { compound as makeCompound, ensureSlot, type CompoundShape } from '../shape'
import { keep, nameOf, setPendingAssemblyTransforms, setPendingAssemblyKinematics, type AssemblyTransform } from '../runtime-state'
import { solveAssemblyAndKinematics, type AssemblySolveResult } from './assembly/solve'
import { validateConstraints } from './assembly/validate'
import { buildKinematicTree, type JointSpec } from './assembly/joints'
import type { AssemblyConstraint } from './assembly/types'

// ── 参数类型（keep-syntax 设计 §2.5：成员保留由函数体 keep() 显式声明，不再靠类型标注） ──

/** Parameters for the `group` stdlib function: an optional name and ordered members. */
export interface GroupParams {
  name?: string
  /** Compound members: read-only references, never mutated by group/assembly. */
  members?: Shape[]
  memberNames?: string[]
}

/** Parameters for the `assembly` stdlib function: group params plus assembly constraints. */
export interface AssemblyParams extends GroupParams {
  constraints?: AssemblyConstraint[]
  /** P3：运动副声明（可选；parent/child 必须是 members 里的名字）。 */
  joints?: JointSpec[]
  /** P3：驱动值覆盖（键 = child 成员名；值 = 主 DOF 数值或多 DOF 数组）。 */
  drive?: Record<string, number | number[]>
}

// ── 约束类型（P1 起定义收口在 api/assembly/types，此处 re-export 保持既有导出面） ──

export type {
  AssemblyConstraint,
  FaceMateConstraint,
  FaceMateFace,
  EntityRef,
  FaceRef,
  EdgeRef,
  MateConstraint,
  AlignConstraint,
  CoincidentConstraint,
  ConcentricConstraint,
  DistanceConstraint,
  AngleConstraint,
  ParallelConstraint,
  PerpendicularConstraint,
  FixedConstraint,
  StructuralConstraint,
  AssemblyVec3,
} from './assembly/types'
export type { AssemblySolveResult } from './assembly/solve'

// ── 求解器 ──
// P2-f5：旧装配算法与自有四元数实现已整体删除——旋转计算一律走
// brepjs utils/quaternion.ts，输出经 api/assembly/pose.ts fromBrepjsQuat 重排。

// 应用变换（mesh 顶点烘焙）下沉到引擎侧 src/mesh/rigid-transform.ts（E-b：
// module-executor 不得 import stdlib/compound；公共 API 经本 re-export 保持）。
export { applyTransform } from '../mesh/rigid-transform'

// ── AssemblyBehavior ──

/** Behavior attached to an assembly compound: its members, constraints, and solver. */
export interface AssemblyBehavior {
  name?: string
  memberNames: string[]
  constraints: AssemblyConstraint[]
  /** P3：运动副声明（无 joints 时为空数组）。 */
  joints?: JointSpec[]
  /** P3：驱动值覆盖（键 = child 成员名；缺省 undefined = 用 joint 存储值）。 */
  drive?: Record<string, number | number[]>
  /** 只求解（P6）：返回"成员下标 → 变换"列表。不改写入参、不传播；可重复调用（幂等）。 */
  solve(): AssemblyTransform[]
  /** 只求解并带诊断量（P1）：transforms + dof/converged/unsupported（方案 P1⑤）；P3 增 kinematics/warnings。 */
  solveDetailed(): AssemblySolveResult
}

/**
 * 纯求解（P6：求解 ≠ 传播）：委派 api/assembly/solveAssembly（P1 起）。
 * 不修改任何输入、不触碰引擎状态——引擎负责应用变换并让下游失效重算（F2）。
 *
 * 约束形态（方案 §5）：
 * - 遗留 face_mate：规范化为 mate 后降级为 brepjs concentric + 轴编码求解（§3.7.2）；
 * - 新形态 mate/align/coincident/concentric/distance/angle/parallel/perpendicular/fixed；
 * - 面参数 `{ topoRef }` 执行期解析（BREP 现场/mesh 行快照），旧 `{ center, normal }`
 *   快照直接使用（兼容已持久化的历史脚本）；
 * - 输出为 per-member 终态（L6 修复），锚定成员不输出变换。
 */
function solveTransforms(members: Shape[], behavior: AssemblyBehavior): AssemblyTransform[] {
  return solveAssemblyAndKinematics(members, behavior.memberNames, behavior.constraints, behavior.joints ?? [], behavior.drive)
    .transforms
}

// ── group / assembly 库函数 ──

/**
 * 成员名推导：显式 memberNames 兼容旧手工构造 IR；否则经 keep() 反查
 * （P3 起经 keep()/nameOfShapes 反查成员名——库不再访问执行上下文，F1）。
 */
function memberNamesOf(params: { memberNames?: unknown }, members: Shape[]): string[] {
  if (Array.isArray(params.memberNames) && params.memberNames.length > 0) {
    return params.memberNames as string[]
  }
  return members.map((m) => {
    // 兼容字符串形态的 members（历史 IR 直传 partName）：字符串本身就是名字
    if (typeof m === 'string') return m
    return String(nameOf(m) ?? '')
  })
}

/**
 * `cad.group({ name, members })` → compound Shape。
 * members 是成员 Shape（编译产物 ctx.<var> 引用），成员名经 keep() 反查。
 *
 * 函数体 keep 声明（keep-syntax 设计 §2.5）：group 保留其成员且可见（R6）。
 */
/**
 * 分组：零约束，保持当前布局。结构语句，无几何输出，成员用变量名引用。
 * @group 结构
 * @inputs 1
 * @async false
 * @qual ok
 * @name group
 * @returns CompoundShape 复合几何（kind='compound'，children 为成员 Shape 引用）。
 * @param params.name - 组名。type:string
 * @param params.members - 成员（编译产物 ctx.<var> 引用；结构语句里是裸变量引用，非字符串数组）。type:Shape[]
 * @note members 在 .fai.js 里是裸变量引用（编译为 ctx.<var>），字符串数组形态的成员名经 keep() 反查兼容历史 IR。
 * @example
 * const part0 = cad.box(30, 20, 10, { centered: true })
 * cad.group({ name: '底板组', members: [part0] })
  */
export function group(params: GroupParams): CompoundShape {
  const members = (params.members as Shape[] | undefined) ?? []
  if (members.length > 0) keep(...members)
  const memberNames = memberNamesOf(params, members)
  const c = makeCompound(members)
  // 挂最小 behavior（memberNames 供 ExecutionResult.compounds 结构输出；group 无约束）
  ensureSlot(c).behavior = {
    memberNames,
    constraints: [],
    joints: [],
    solve: () => [],
    solveDetailed: () => ({ transforms: [], dof: 0, converged: true, unsupported: [] }),
  }
  return c
}

/**
 * 装配：成员 + 约束。结构语句，无几何输出，成员用变量名引用、实体用 EntityRef / 拓扑引用。
 * 求解内核复用 vendored brepjs solverAdapter.solveConstraints（链式拓扑调度 / DOF / converged /
 * unsupported 诊断）；输出为 per-member 终态变换（每成员一条，恒等位姿不输出）。
 * @group 结构
 * @inputs 1
 * @async false
 * @qual warn
 * @name assembly
 * @returns CompoundShape + AssemblyBehavior（含 do_assemble / solve 方法）。
 * @note 约束类型（a=参考、b=从动，移动 b 去贴合 a）：`mate` 面对面贴合（法向反向+面中心重合，遗留 face_mate 的新名，求解降级为 concentric + 轴编码）；`align` 同向对齐（法向同向+面中心重合）；`coincident` 共面/共点/共线（保留面内 2 个平移 DOF）；`concentric` 轴重合（孔轴配合，圆柱/圆锥面需 hint.axis，直边/圆边需 EdgeHint.axis）；`distance` 定距（mm，带 value）；`angle` 夹角（deg，带 value）；`parallel`/`perpendicular` 平行/垂直（angle 0°/90° 语法糖）；`fixed` 锚定部件（地基）；`face_mate` 为遗留别名（规范化为 mate，新代码不再使用）。
 * @note EntityRef 四种形态：`{ part, face: { topoRef } | { surfaceType?, center, normal } }`、`{ part, edge: { topoRef } | { axis: { origin, direction } } }`、`{ part, point: [x,y,z] }`、`{ part, faceIndex }`（1 起，仅调试简写）。
 * @note 不收敛（实体类型不匹配/环/参考不可达）→ 抛错并带 unsupported 明细；成员名为空串 → 求解前抛错；mesh 快照缺 axis 的圆柱/圆锥面作轴实体 → E_TOPO_NOT_FOUND（绝不静默降级）。`mate`（中心重合）与 `coincident`（只共面）是两种不同语义，不互相映射。
 * @note 早期文档/示例曾用 `fixedPartId`/`movingPartId`/`faceRowIndex`/`faceId`/`invalid`——这些键在代码中不存在。真实契约是 `fixedPartName`/`movingPartName` + `fixedFace`/`movingFace`（遗留 face_mate）。`faceId` 字段随 §6.2 移除，不再写入。
 * @param params.name - 装配名。type:string
 * @param params.members - 成员（裸变量引用）。type:Shape[]
 * @param params.constraints - 约束数组（遗留 face_mate 形态或上述新形态 { type, a, b }）。type:AssemblyConstraint[]
 * @example
 * let asm1 = cad.assembly({ name: '主轴组件', members: [part0, part1, part2], constraints: [ { type: 'fixed', part: 'part0' }, { type: 'mate', a: { part: 'part0', face: { topoRef: { kind: 'face', origin: 'part0', role: 'box:top', hint: { kind: 'face', surfaceType: 'plane' } } } }, b: { part: 'part1', face: { topoRef: { kind: 'face', origin: 'part1', role: 'box:bottom', hint: { kind: 'face', surfaceType: 'plane' } } } } }, { type: 'concentric', a: { part: 'part1', face: { topoRef: { kind: 'face', origin: 'part1', role: '', hint: { kind: 'face', surfaceType: 'cylinder' } } } }, b: { part: 'part2', face: { topoRef: { kind: 'face', origin: 'part2', role: 'cylinder:lateral', hint: { kind: 'face', surfaceType: 'cylinder' } } } } } ] })
 * asm1.solve()
  */
export function assembly(params: AssemblyParams): CompoundShape {
  const members = (params.members as Shape[] | undefined) ?? []
  const constraints = (params.constraints as AssemblyConstraint[] | undefined) ?? []
  const joints = (params.joints as JointSpec[] | undefined) ?? []
  const drive = params.drive as Record<string, number | number[]> | undefined

  // P2-f1：约束参数运行期校验（keep() 之前，fail-fast；规则见 api/assembly/validate.ts V1–V6）
  const memberNames = memberNamesOf(params, members)
  validateConstraints(constraints, memberNames)
  // P3：运动副构造期 fail-fast——parent/child ∈ members、child 唯一驱动、多 DOF 类型
  // 在 assembly() 构造时暴露（buildJoint/buildKinematicTree 复用同一份校验实现）
  if (joints.length > 0) buildKinematicTree(memberNames, joints)

  if (members.length > 0) keep(...members)
  const c = makeCompound(members)
  const behavior: AssemblyBehavior = {
    name: params.name as string | undefined,
    memberNames,
    constraints,
    joints,
    drive,
    solve: () => solveTransforms(members, behavior),
    solveDetailed: () =>
      solveAssemblyAndKinematics(members, behavior.memberNames, behavior.constraints, behavior.joints ?? [], behavior.drive),
  }
  ensureSlot(c).behavior = behavior
  // solve / do_assemble 完全同义（方案 §5.5 D2：solve 为新名，do_assemble 保留为别名）
  const solveAndRegister = (): void => {
    // P6：只求解并登记待应用变换；应用与下游失效由引擎做（F2：库不查询/修改 DAG）
    // P3：约束 + 运动副在库侧一次合并（solveAssemblyAndKinematics），transforms 与
    // kinematics 一起登记（禁止引擎侧两次求解/两次登记）
    const result = behavior.solveDetailed()
    if (result.transforms.length > 0) setPendingAssemblyTransforms(c, result.transforms)
    if (result.kinematics) setPendingAssemblyKinematics(c, result.kinematics)
  }
  ;(c as CompoundShape & { do_assemble?: () => void }).do_assemble = solveAndRegister
  ;(c as CompoundShape & { solve?: () => void }).solve = solveAndRegister
  // 统一成员调用 ABI：add_constraint 是 no-op（现状语义：约束由 assembly 语句 args.constraints 读取，
  // 编译产物机械发射 `ctx.<asm>.add_constraint({...})`，调用此方法不崩）
  ;(c as CompoundShape & { add_constraint?: () => void }).add_constraint = () => {
    // Phase 1 semantics: constraints are read from the assembly statement's args.constraints;
    // add_constraint is intentionally a no-op (kept for ABI uniformity).
  }
  return c
}
