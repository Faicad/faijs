/**
 * api/assembly/joints — 运动副声明与运动学解算（P3）
 *
 * JointSpec 是 .fai.js 可序列化子集（派生字段 dofs 由 vendored 工厂构造，
 * 与 brepjs Joint.dofs 的组合顺序对齐：cylindrical → [rotation, translation]、
 * planar → [u, v, rotation]、spherical → [x, y, z]）。
 *
 * P3 首期只实现 revolute / prismatic 两种单 DOF 运动副；cylindrical / planar /
 * spherical 在 buildJoint 里显式抛错（绝不静默降级成单 DOF），待 per-DOF ranges
 * 启用（JointSpec.dofs 已按此预留）。
 *
 * 链路：JointSpec[] → buildJoint（vendored 工厂）→ buildKinematicTree（建树三步
 * + 校验）→ solveKinematics（vendored forwardKinematics）→ per-member 位姿。
 *
 * cad.* 查询函数（jointTrajectory / inverseKinematics / mechanismDOF）是无副作用
 * 纯函数：输入纯数据、输出纯数据，不挂在 assembly receiver 上。
 *
 * 四元数顺序：faijs 对外 [x,y,z,w]，brepjs [w,x,y,z]——只经 ./pose 的转换函数
 * 换序，禁止在本模块手写分量重排。
 */

import {
  revoluteJoint,
  prismaticJoint,
  forwardKinematics as brepjsForwardKinematics,
  mechanismDOF as brepjsMechanismDOF,
  jointTrajectory as brepjsJointTrajectory,
  inverseKinematics as brepjsInverseKinematics,
  addJoint,
  type Joint,
  type JointPose,
  type IKResult as BrepjsIKResult,
  type IKOptions as BrepjsIKOptions,
  type IKTarget as BrepjsIKTarget,
} from '../../vendored/brepjs/index'
import { createAssemblyNode, addChild, type AssemblyNode } from '../../vendored/brepjs/index'
import {
  fromBrepjsQuat,
  toBrepjsQuat,
  jointPoseToAssemblyTransform,
  isIdentityPose,
  type FaijsQuat,
} from './pose'
import type { AssemblyTransform } from '../../runtime-state'
import type { AssemblyVec3 } from './types'

// ── JointSpec（.fai.js 可序列化子集）──

/** 运动副类型：P3 首期只实现 revolute / prismatic。 */
export type JointType = 'revolute' | 'prismatic' | 'cylindrical' | 'planar' | 'spherical'

/** 单 DOF 范围（主 DOF 镜像字段 min/max/value）。 */
export interface JointDofSpec {
  min: number
  max: number
  value: number
}

/**
 * 可序列化运动副声明（.fai.js 对象字面量）。派生字段（dofs）由 buildJoint 内
 * vendored 工厂构造——脚本里只写纯数据。
 */
export interface JointSpec {
  type: JointType
  /**
   * 参考体（不动）；child 相对它运动。必须是 members 里的**变量名**（字符串——
   * `.fai.js` 可序列化子集；members 也是字符串名数组）。buildKinematicTree
   * 校验二者 ∈ members。
   */
  parent: string
  /** 从动体（同样是 members 里的变量名）。 */
  child: string
  /** 主轴：origin 是所有旋转 DOF 的枢轴锚点。 */
  axis: { origin: AssemblyVec3; direction: AssemblyVec3 }
  /** 主 DOF 范围与当前值（revolute 单位 deg / prismatic 单位 mm；由 type 决定）。 */
  min: number
  max: number
  value: number
  /**
   * 多 DOF 运动副（cylindrical 2 / planar 3 / spherical 3）的逐 DOF 范围，
   * **长度必须与 type 的 DOF 数一致，顺序 = brepjs `Joint.dofs` 的组合顺序**：
   *   cylindrical → [rotation, translation]
   *   planar      → [u, v, rotation]
   *   spherical   → [x, y, z]
   * P3 首期只实现 revolute/prismatic，此字段随多 DOF 类型一起启用。
   */
  dofs?: JointDofSpec[]
  /** planar 专用：面内 u 参考方向（brepjs 会投影到平面并归一化）。 */
  uDirection?: AssemblyVec3
  /** 静态连杆偏置（childWorld = parentWorld ∘ jointTransform ∘ offset），可选。 */
  offset?: { position?: AssemblyVec3; rotation?: FaijsQuat }
}

// ── buildJoint：JointSpec → brepjs Joint ──

/**
 * 由 JointSpec 构造 brepjs Joint。
 *
 * revolute/prismatic 走 vendored 工厂（主 DOF 的 value 在工厂内 clamp 到
 * [min,max]）；cylindrical/planar/spherical 显式抛错（多 DOF 未启用，绝不
 * 静默降级）。offset 的四元数经 toBrepjsQuat 换序（faijs [x,y,z,w] → brepjs
 * [w,x,y,z]）。
 *
 * @param spec - the serializable joint declaration.
 * @returns the vendored brepjs Joint (with offset attached when declared).
 * @throws Error on multi-DOF joint types and unknown joint types.
 */
export function buildJoint(spec: JointSpec): Joint {
  const axis = { origin: spec.axis.origin, direction: spec.axis.direction }
  const options = { min: spec.min, max: spec.max, value: spec.value }
  let joint: Joint
  switch (spec.type) {
    case 'revolute':
      joint = revoluteJoint(String(spec.parent), String(spec.child), axis, options)
      break
    case 'prismatic':
      joint = prismaticJoint(String(spec.parent), String(spec.child), axis, options)
      break
    case 'cylindrical':
    case 'planar':
    case 'spherical':
      throw new Error(`[assembly] joint type '${spec.type}' is not supported yet; per-DOF ranges pending`)
    default: {
      const exhaustive: never = spec.type
      throw new Error(`[assembly] unknown joint type '${String(exhaustive)}'`)
    }
  }
  if (spec.offset) {
    const rotation = spec.offset.rotation
      ? ([...toBrepjsQuat(spec.offset.rotation)] as [number, number, number, number])
      : ([1, 0, 0, 0] as [number, number, number, number])
    joint = {
      ...joint,
      offset: {
        position: spec.offset.position ?? ([0, 0, 0] as [number, number, number]),
        rotation,
      },
    }
  }
  return joint
}

// ── buildKinematicTree：建树三步 + 校验 ──

/**
 * 由成员名 + JointSpec[] 构建 kinematic AssemblyNode 树（vendored
 * forwardKinematics 只接受单个根；多成员必须有唯一合成根）。
 *
 * 校验（求解前，绝不静默）：
 * - 成员名空串 → 抛错（与约束求解 R7 同源）；
 * - parent/child 必须在 members 里 → 抛错并附成员名全集；
 * - 同一 child 不得被两个 joint 驱动（brepjs forwardKinematics 对重复 child
 *   静默跳过——faijs 侧必须在求解前显式失败）。
 *
 * 建树三步：
 * ① 合成根 '__asm_root'（不带 shape）；② 全部成员挂成子节点（未被 joint 驱动
 * 的成员靠这一步拿到 identity 位姿；addChild 返回新节点必须重新赋值）；③ 每个
 * joint 经 addJoint 挂到树上（FK 用 walkAssembly 收集 node.joints，位姿按
 * joint.parent/child 的名字图传播，与树边无关）。
 *
 * @param memberNames - member variable names (the tree covers every member).
 * @param joints - raw joint declarations.
 * @returns the assembled kinematic tree root.
 * @throws Error on empty member names, unknown joint parts, or duplicate child drive.
 */
export function buildKinematicTree(memberNames: string[], joints: JointSpec[]): AssemblyNode {
  memberNames.forEach((name, i) => {
    if (!name) {
      throw new Error(
        `[assembly] member at index ${i} has an empty name — members are referenced by name in joints`,
      )
    }
  })
  const memberSet = new Set(memberNames)
  const driven = new Set<string>()
  for (const j of joints) {
    if (!memberSet.has(String(j.parent))) {
      throw new Error(
        `[assembly] joint parent '${String(j.parent)}' is not a member — members: ${memberNames.join(', ')}`,
      )
    }
    if (!memberSet.has(String(j.child))) {
      throw new Error(
        `[assembly] joint child '${String(j.child)}' is not a member — members: ${memberNames.join(', ')}`,
      )
    }
    if (driven.has(String(j.child))) {
      throw new Error(
        `[assembly] joint child '${String(j.child)}' is driven by more than one joint — each child must be driven by exactly one joint`,
      )
    }
    driven.add(String(j.child))
  }
  // 建树三步（见函数头注释）
  let root = createAssemblyNode('__asm_root')
  for (const m of memberNames) root = addChild(root, createAssemblyNode(m))
  for (const j of joints) root = addJoint(root, buildJoint(j))
  return root
}

// ── solveKinematics：正解 ──

/** per-member 运动学位姿（rotation 为 faijs [x,y,z,w]）。 */
export interface KinematicsPose {
  position: AssemblyVec3
  rotation: FaijsQuat
}

/** 运动学解算结果：装配变换（被驱动成员）+ 全成员位姿表。 */
export interface KinematicsSolveResult {
  /** 被 joints 定位（非恒等）的成员装配变换；index = 成员下标。 */
  transforms: AssemblyTransform[]
  /** 全部成员的终态位姿（含恒等，链根也在此）；键 = 成员名。 */
  kinematics: Record<string, KinematicsPose>
}

/** 从 joints 推导查询场景的成员名全集（parent ∪ child，保序去重）。 */
function specMemberNames(joints: JointSpec[]): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const j of joints) {
    for (const n of [String(j.parent), String(j.child)]) {
      if (!seen.has(n)) {
        seen.add(n)
        names.push(n)
      }
    }
  }
  return names
}

/**
 * 运动学正解：buildKinematicTree → vendored forwardKinematics → per-member 位姿。
 *
 * 校验（求解前）：成员名空串 / parent-child ∈ members / child 唯一驱动（都收在
 * buildKinematicTree 内）；drive 键必须 ∈ joints 的 child 集（多余键是笔误，
 * 显式失败而非静默忽略）。
 *
 * forwards 返回的 Map 含合成根 '__asm_root'——本函数按 memberNames 过滤掉，
 * 只输出成员位姿。transforms 只含非恒等（被驱动）成员，恒等成员不输出（引擎
 * 不做无谓重算，与约束求解语义一致）；kinematics 则覆盖全部成员（含恒等），
 * 供宿主动画/导出读取完整骨架。
 *
 * @param memberNames - member variable names.
 * @param joints - raw joint declarations.
 * @param drive - per-child DOF value overrides (number for the primary DOF, or
 *   a per-DOF array); keyed by child member name.
 * @returns the per-member kinematics result.
 * @throws Error on empty member names, unknown joint parts, duplicate child drive,
 *   or a drive key that is not a joint child.
 */
export function solveKinematics(
  memberNames: string[],
  joints: JointSpec[],
  drive?: Record<string, number | number[]>,
): KinematicsSolveResult {
  if (drive) {
    const jointChildren = new Set(joints.map((j) => String(j.child)))
    for (const key of Object.keys(drive)) {
      if (!jointChildren.has(key)) {
        throw new Error(
          `[assembly] drive key '${key}' does not name a joint child — joint children: ${[...jointChildren].join(', ')}`,
        )
      }
    }
  }
  const tree = buildKinematicTree(memberNames, joints)
  const poses = brepjsForwardKinematics(tree, drive)
  const transforms: AssemblyTransform[] = []
  const kinematics: Record<string, KinematicsPose> = {}
  memberNames.forEach((name, index) => {
    const pose = poses.get(name)
    if (!pose) return
    const rotation = fromBrepjsQuat(pose.rotation)
    kinematics[name] = {
      position: [pose.position[0], pose.position[1], pose.position[2]],
      rotation,
    }
    if (!isIdentityPose(pose)) transforms.push(jointPoseToAssemblyTransform(pose, index))
  })
  return { transforms, kinematics }
}

// ── cad.* 查询函数（纯函数，无副作用；输入输出都是纯数据）──

/** `cad.jointTrajectory({ joints, from, to, steps })` 参数。 */
export interface JointTrajectoryParams {
  joints: JointSpec[]
  from: Record<string, number | number[]>
  to: Record<string, number | number[]>
  steps: number
}

/** 轨迹采样（poses 的 rotation 已换序为 faijs [x,y,z,w]）。 */
export interface FaijsTrajectorySample {
  /** 归一化路径参数 ∈ [0,1]。 */
  t: number
  /** 该步的逐 DOF 值（键 = child 成员名）。 */
  values: Record<string, number[]>
  /** 该步全成员世界位姿。 */
  poses: Map<string, KinematicsPose>
}

/**
 * `cad.jointTrajectory({ joints, from, to, steps })` — 关节空间直线路径采样。
 * 产出 steps+1 个采样（含两端点）；joints 缺省值在两端取存储值。
 * 无 endEffector 参数（关节空间插值，不追踪端点）。
 *
 * @param p - trajectory query parameters.
 * @returns the sampled trajectory (poses with faijs-order quaternions).
 */
export function jointTrajectory(p: JointTrajectoryParams): FaijsTrajectorySample[] {
  const memberNames = specMemberNames(p.joints)
  const tree = buildKinematicTree(memberNames, p.joints)
  return brepjsJointTrajectory(tree, p.from, p.to, p.steps).map((s) => ({
    t: s.t,
    values: s.values,
    poses: new Map(
      [...s.poses.entries()].map(([name, pose]) => [
        name,
        {
          position: [pose.position[0], pose.position[1], pose.position[2]],
          rotation: fromBrepjsQuat(pose.rotation),
        },
      ]),
    ),
  }))
}

/** `cad.inverseKinematics({ joints, endEffector, target, options? })` 参数。 */
export interface InverseKinematicsParams {
  joints: JointSpec[]
  /** 末端执行器 = child 成员名。 */
  endEffector: string
  /** 目标位姿（rotation 对外 faijs [x,y,z,w]，内部 toBrepjsQuat 换序）。 */
  target: { position: AssemblyVec3; rotation?: FaijsQuat }
  options?: BrepjsIKOptions
}

/** IK 结果（与 vendored IKResult 同构；values 键 = child 成员名）。 */
export interface IKResult {
  values: Record<string, number[]>
  converged: boolean
  iterations: number
  error: number
}

/**
 * `cad.inverseKinematics({ joints, endEffector, target, options? })` —
 * damped-least-squares IK：求使末端到达 target 的关节值。关节范围在每个迭代
 * clamp；不可达目标返回 converged:false 与最优配置。纯函数，无副作用。
 *
 * @param p - IK query parameters.
 * @returns the solved joint values plus convergence diagnostics.
 */
export function inverseKinematics(p: InverseKinematicsParams): IKResult {
  const memberNames = specMemberNames(p.joints)
  const tree = buildKinematicTree(memberNames, p.joints)
  const target: BrepjsIKTarget = {
    position: p.target.position,
    ...(p.target.rotation ? { rotation: toBrepjsQuat(p.target.rotation) } : {}),
  }
  const result: BrepjsIKResult = brepjsInverseKinematics(tree, p.endEffector, target, p.options)
  return {
    values: result.values,
    converged: result.converged,
    iterations: result.iterations,
    error: result.error,
  }
}

/** `cad.mechanismDOF({ joints })` 参数。 */
export interface MechanismDOFParams {
  joints: JointSpec[]
}

/**
 * `cad.mechanismDOF({ joints })` — 开链机构自由度 = 各 joint DOF 数之和
 * （revolute/prismatic 各 1；串联两 revolute = 2）。纯函数，无副作用。
 *
 * @param p - DOF query parameters.
 * @returns the mechanism's total degree of freedom.
 */
export function mechanismDOF(p: MechanismDOFParams): number {
  const memberNames = specMemberNames(p.joints)
  const tree = buildKinematicTree(memberNames, p.joints)
  return brepjsMechanismDOF(tree)
}

// re-export：查询函数对外的类型面（IKOptions 透传给宿主）。
export type { JointPose, BrepjsIKOptions as IKOptions }