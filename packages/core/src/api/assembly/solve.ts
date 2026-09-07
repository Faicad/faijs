/**
 * api/assembly/solve — 装配求解入口（P1，方案 §4.2）
 *
 * 流程：规范化（normalize）→ 降级（lower）→ brepjs solveConstraints
 *（拓扑轮次调度 / DOF / converged 全部由 brepjs 提供，零 vendored 修改）→
 * per-member 终态 AssemblyTransform（修 L6：不再 per-constraint 增量叠加）。
 *
 * 不收敛 → 抛错（D3，错误信息带 unsupported 明细；对齐「绝不静默」约定）。
 * 恒等位姿的成员（锚定/链根）不输出变换——引擎不做无谓的几何重算。
 */

import type { Shape } from '../../mesh/types'
import type { BrepEngineApi } from '../../brep/engine/primitives'
import { getBackends } from '../../runtime-state'
import type { AssemblyTransform } from '../../runtime-state'
import { solveConstraints } from '../../vendored/brepjs/kernel/solverAdapter'
import { normalizeConstraint } from './normalize'
import { lowerStructuralConstraint } from './lower'
import { type EntityResolutionEnv } from './entities'
import { poseToAssemblyTransform, isIdentityPose, type SolverPose } from './pose'
import type { AssemblyConstraint, AssemblyVec3 } from './types'

/** 求解完整结果：per-member 终态变换 + 诊断量。 */
export interface AssemblySolveResult {
  /** 每个被定位成员一条终态变换（index = 成员下标；恒等位姿不输出）。 */
  transforms: AssemblyTransform[]
  /** unsupported 约束的自由度合计（诊断量；收敛时为 0）。 */
  dof: number
  /** 是否全部约束可解（不收敛时 solveAssembly 已抛错，此字段恒 true）。 */
  converged: boolean
  /** 无法求解的约束明细（entity 类型不匹配 / 参考不可达）。 */
  unsupported: string[]
}

/**
 * 求解装配：members + memberNames + constraints → per-member 终态。
 *
 * @param members - member shapes (compound children, aligned with memberNames).
 * @param memberNames - member variable names (R7: empty names throw before solving).
 * @param constraints - raw constraints from `cad.assembly({ constraints })`.
 * @returns the solve result (transforms + diagnostics).
 * @throws Error on empty member names, unknown constraint parts, or non-convergence.
 */
export function solveAssembly(
  members: Shape[],
  memberNames: string[],
  constraints: AssemblyConstraint[],
): AssemblySolveResult {
  // R7：成员名是 solver 的节点键，空串会让多成员互相覆盖——求解前断言
  memberNames.forEach((name, i) => {
    if (!name) {
      throw new Error(
        `[assembly] member at index ${i} has an empty name — members are referenced by variable name in constraints`,
      )
    }
  })

  const memberMap = new Map<string, Shape>()
  members.forEach((m, i) => {
    const name = memberNames[i]
    if (name && !memberMap.has(name)) memberMap.set(name, m)
  })
  // kernel 仅 TopoRef/边引用解析需要；backends 未配置（纯位姿场景/单测）→ null，
  // 此时快照引用仍可解，TopoRef 引用按 E_TOPO_NOT_FOUND 显式报错
  let kernel: BrepEngineApi | null = null
  try {
    kernel = getBackends().kernel.brep as BrepEngineApi | null
  } catch {
    // backends not configured — snapshot-form constraints still solvable
  }
  const env: EntityResolutionEnv = { kernel, memberOf: (p: string) => memberMap.get(p) }

  const lowered: ReturnType<typeof lowerStructuralConstraint>['constraint'][] = []
  const depOrigins = new Map<string, AssemblyVec3>()
  for (const raw of constraints) {
    const c = normalizeConstraint(raw)
    const { constraint, depOrigin } = lowerStructuralConstraint(c, env)
    lowered.push(constraint)
    if (depOrigin && constraint.entityB) depOrigins.set(constraint.entityB.node, depOrigin)
  }

  const result = solveConstraints([...memberNames], lowered)
  if (!result.converged) {
    throw new Error(
      `[assembly] constraint solve did not converge (dof=${result.dof}); unsupported: ` +
        (result.unsupported.length > 0 ? result.unsupported.join(', ') : '(no detail)'),
    )
  }

  // per-member 终态（L6 修复）：恒等位姿（锚定/链根）不输出，引擎不重算
  const transforms: AssemblyTransform[] = []
  for (const [node, rawPose] of result.transforms) {
    const pose: SolverPose = rawPose
    if (isIdentityPose(pose)) continue
    const index = memberNames.indexOf(node)
    if (index < 0) continue
    const pivot = depOrigins.get(node) ?? ([0, 0, 0] as AssemblyVec3)
    transforms.push(poseToAssemblyTransform(pose, pivot, index))
  }
  return { transforms, dof: result.dof, converged: result.converged, unsupported: result.unsupported }
}
