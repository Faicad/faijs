/**
 * api/assembly/solve-tree — 嵌套子装配求解（P4，方案 §4.2）
 *
 * flatten → solveGlobal → recompose：
 * 1. flatten：walkAssembly 收集叶 shape + qualified member name（如 `subassy.part`），
 *    构建扁平 members/memberNames；约束从各层收集（part 名用 qualified name，可跨层引用）。
 * 2. solve：调 solveGlobal 求解扁平问题。
 * 3. recompose：自顶向下将父变换（AssemblyNode.translate/rotate）与 solver 变换复合
 *    （parentTransform ∘ childLocalTransform），得到每个叶节点的世界变换。
 *
 * 语义对齐 CQ `Assembly.solve()`：每个对象的 `loc` 累积合成世界变换。
 * faijs Shape 不携带 placement → 求解器从 identity 初值求解；父变换在 recompose 阶段复合。
 */

import type { Shape } from '../../mesh/types'
import type { AssemblyTransform } from '../../runtime-state'
import type { AssemblyConstraint } from './types'
import type { SolveOptions } from './solvers/types'
import type { AssemblyNode } from './solvers/assembly-tree'
import { solveGlobal } from './solvers/global-solver'
import { poseToAssemblyTransform, isIdentityPose, type SolverPose } from './pose'
import { quatFromAxisAngle, quatRotate, quatMultiply } from './solvers/quat'

const DEG2RAD = Math.PI / 180

/** 嵌套子装配求解结果：per-leaf 世界变换 + 诊断量。 */
export interface AssemblyTreeSolveResult {
  /** 每个叶节点的世界变换（键 = qualified name）。 */
  transforms: Record<string, AssemblyTransform>
  /** 是否全部约束可解。 */
  converged: boolean
  /** 无法求解的约束明细。 */
  unsupported: string[]
  /** 逐约束最终残差。 */
  residuals: number[]
  /** 残差超阈值的约束逐条写入。 */
  warnings?: string[]
  /**
   * P7/D1-3：欠定自由度诊断（透传自 solveGlobal）。dof > 0 = 约束集欠定，
   * 终态位姿依赖优化器轨迹、无唯一「正确解」——判等方应走规范判等通道而非逐位比对。
   */
  underdetermined?: { dof: number; freeDirs?: number[][] }
}


/** 把 AssemblyNode 的 translate/rotate 转为 SolverPose（brepjs [w,x,y,z] 旋转）。 */
function nodeToPose(node: AssemblyNode): SolverPose {
  const position: [number, number, number] = node.translate
    ? [node.translate[0], node.translate[1], node.translate[2]]
    : [0, 0, 0]
  let rotation: [number, number, number, number] = [1, 0, 0, 0]
  if (node.rotate) {
    const axis: readonly [number, number, number] = node.rotate.axis
      ? [node.rotate.axis[0], node.rotate.axis[1], node.rotate.axis[2]]
      : [0, 0, 1]
    rotation = quatFromAxisAngle(axis, node.rotate.angle * DEG2RAD)
  }
  return { position, rotation }
}

/** 复合两个 pose：先应用 child，再应用 parent（p' = R_p·(R_c·p + T_c) + T_p）。 */
function composePose(parent: SolverPose, child: SolverPose): SolverPose {
  const rotatedT = quatRotate(parent.rotation, child.position)
  return {
    position: [
      parent.position[0] + rotatedT[0],
      parent.position[1] + rotatedT[1],
      parent.position[2] + rotatedT[2],
    ],
    rotation: quatMultiply(parent.rotation, child.rotation),
  }
}

interface FlatAssembly {
  members: Shape[]
  memberNames: string[]
  constraints: AssemblyConstraint[]
  /** 每个叶节点的累积父 pose（从 root 到该叶，含该叶自身 translate/rotate）。 */
  parentPoses: Map<string, SolverPose>
  /** P8：刚体分组（成员下标）——同一子装配的叶共享一个刚体块。 */
  rigidGroups: number[][]
}

/**
 * flatten：递归遍历装配树，收集叶 shape + qualified name + 约束 + 累积父 pose。
 *
 * qualified name = 从 root 的子节点到叶的 dot-separated 路径（如 `subassy.partB`）。
 * 约束从各层收集 as-is——约束中的 part 名应为 qualified name（可跨层引用）。
 */
function flattenTree(root: AssemblyNode): FlatAssembly {
  const members: Shape[] = []
  const memberNames: string[] = []
  const constraints: AssemblyConstraint[] = []
  const parentPoses = new Map<string, SolverPose>()
  // P8：子装配 → 叶下标分组（叶序号在收集时递增，组按收集序记录）。
  const rigidGroups: number[][] = []

  if (root.constraints) {
    for (const c of root.constraints) constraints.push(c)
  }

  function walk(node: AssemblyNode, prefix: string, accumulated: SolverPose, groupId: number | null): void {
    for (const child of node.children) {
      const qName = prefix ? `${prefix}.${child.name}` : child.name
      const childPose = nodeToPose(child)
      const childAccumulated = composePose(accumulated, childPose)

      // P8：子装配节点（有 children）开一个新刚体组——其自身 shape 叶（root 件）
      // 与全部成员叶同组。必须在建组后再 push 自身叶，否则 root 件落在外层
      // groupId（null）下、组内只剩成员叶，length>1 过滤会把整组丢掉
      // （nested_assy 实测：组 [b3] 被滤掉，b2 仍自由漂移）。
      const isSub = child.children.length > 0
      const myGroup = isSub ? rigidGroups.length : groupId
      if (isSub) rigidGroups.push([])

      if (child.shape) {
        members.push(child.shape)
        memberNames.push(qName)
        parentPoses.set(qName, childAccumulated)
        if (myGroup !== null) rigidGroups[myGroup].push(members.length - 1)
      }

      if (child.constraints) {
        for (const c of child.constraints) constraints.push(c)
      }

      if (isSub) {
        walk(child, qName, childAccumulated, myGroup)
      }
    }
  }

  const rootPose = nodeToPose(root)
  walk(root, '', rootPose, null)
  return { members, memberNames, constraints, parentPoses, rigidGroups }
}

/**
 * 求解嵌套子装配树：flatten → solveGlobal → recompose。
 *
 * @param root - 装配树根节点（root 的 shape 被忽略，仅作容器）。
 * @param opts - 求解选项（透传给 solveGlobal；默认 solver:'global'）。
 * @returns 每个叶节点的世界变换 + 诊断量。
 * @throws Error on empty members, unknown constraint parts, or non-convergence.
 */
export function solveAssemblyTree(
  root: AssemblyNode,
  opts?: SolveOptions,
): AssemblyTreeSolveResult {
  const flat = flattenTree(root)
  if (flat.members.length === 0) {
    return { transforms: {}, converged: true, unsupported: [], residuals: [] }
  }

  const solveOpts: SolveOptions = { solver: 'global', ...opts }
  // P8：子装配刚体分组传入求解器（同组叶共享一个 6 维状态块）。
  const groups = flat.rigidGroups.filter((g) => g.length > 1)
  if (groups.length > 0) solveOpts.rigidGroups = groups
  // P8 方案 A（CQ sublocs）：叶的累积 loc（含自身 translate/rotate）作为求解
  // 初位姿传入——约束 marker 取自成员本地系，绝对位姿 = initial ∘ delta 在
  // 求解器内部合成。无累积位姿（恒等）的叶不注入，保持旧语义。
  const initPoses: SolveOptions['initialPoses'] = []
  let hasInit = false
  for (let i = 0; i < flat.memberNames.length; i++) {
    const pp = flat.parentPoses.get(flat.memberNames[i]!)
    if (pp && !isIdentityPose(pp)) {
      initPoses[i] = {
        translation: [pp.position[0], pp.position[1], pp.position[2]],
        rotation: [pp.rotation[0], pp.rotation[1], pp.rotation[2], pp.rotation[3]],
      }
      hasInit = true
    }
  }
  if (hasInit) solveOpts.initialPoses = initPoses
  const result = solveGlobal(flat.members, flat.memberNames, flat.constraints, solveOpts)
  if (!result.converged) {
    throw new Error(
      '[assembly:tree] constraint solve did not converge; unsupported: ' +
        (result.unsupported.length > 0 ? result.unsupported.join(', ') : '(no detail)'),
    )
  }

  const transforms: Record<string, AssemblyTransform> = {}

  for (let i = 0; i < flat.memberNames.length; i++) {
    const name = flat.memberNames[i]
    const parentPose = flat.parentPoses.get(name)
    if (parentPose && !isIdentityPose(parentPose)) {
      transforms[name] = poseToAssemblyTransform(parentPose, [0, 0, 0], i)
    }
  }

  for (const t of result.transforms) {
    const name = flat.memberNames[t.index]
    if (!name) continue
    // P8 方案 A：solver 发射的已是绝对位姿（initial ∘ delta 在求解器内合成），
    // 直接采用——若再 compose parentPose 会把初 loc 算两遍。
    transforms[name] = t
  }

  return {
    transforms,
    converged: result.converged,
    unsupported: result.unsupported,
    residuals: result.residuals,
    warnings: result.warnings,
    // P7/D1-3：显式透传（此处是重建对象，spread 不会带上）。
    underdetermined: result.underdetermined,
  }
}