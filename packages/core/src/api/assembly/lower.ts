/**
 * api/assembly/lower — faijs 约束 → brepjs SolverConstraint 降级（P1，方案 §3.7.2 / §4.2）
 *
 * 关键简化（方案 §3.7.3）：不自写合成器、不自写拓扑调度——
 * - mate  → concentric + dep 侧 axis 编码取反法向（flip 是贴合语义的正解：
 *           A 的外法向 = B 的内法向）；
 * - align → concentric + 两侧 axis 编码不取反；
 * - coincident/concentric/distance/angle → 直译；
 * - parallel/perpendicular → angle 0°/90° 语法糖。
 *
 * 禁止把复合语义拆成多条 SolverConstraint——每节点只被定位一次（方案 §3.7.1）。
 */

import type { SolverConstraint, SolverEntity } from '../../vendored/brepjs/kernel/solverAdapter'
import type { ResolvedFaceGeometry } from '../topo-resolve'
import type { AssemblyVec3, EntityRef, StructuralConstraint } from './types'
import { resolveFaceGeometryOfRef, resolveSolverEntity, type EntityResolutionEnv } from './entities'

/**
 * 面 → 有向轴实体（§3.7.2 轴编码）。flip=true 取内法向（贴合语义）。
 * origin = 面中心：dep 侧是本地坐标，ref 侧由 brepjs transformEntity 转世界。
 *
 * @param f - the resolved face geometry (center + normal).
 * @param flip - when true, negate the normal (mate encoding on the dependent side).
 * @returns the directed axis entity.
 */
export function axisFromFace(f: ResolvedFaceGeometry, flip: boolean): SolverEntity {
  const n = f.normal
  return {
    type: 'axis',
    origin: f.center,
    direction: flip ? ([-n[0], -n[1], -n[2]] as AssemblyVec3) : n,
  }
}

/** 降级产物：SolverConstraint + dependent 实体 origin（作 AssemblyTransform 的 pivot）。 */
export interface LoweredConstraint {
  constraint: SolverConstraint
  /** dependent 侧实体 origin（本地坐标）；fixed 约束无。 */
  depOrigin?: AssemblyVec3
}

/** 直译定位约束的形状（a/b 必有，value 可选）。 */
interface PairSpec {
  type: 'coincident' | 'concentric' | 'distance' | 'angle'
  value?: number
  a: EntityRef
  b: EntityRef
}

/** 直译定位约束：解析两侧实体后原样翻译。 */
function lowerPair(c: PairSpec, env: EntityResolutionEnv): LoweredConstraint {
  const entityA = resolveSolverEntity(c.a, env)
  const entityB = resolveSolverEntity(c.b, env)
  const constraint: SolverConstraint = {
    type: c.type,
    entityA: { node: c.a.part, entity: entityA },
    entityB: { node: c.b.part, entity: entityB },
  }
  if (c.value !== undefined) constraint.value = c.value
  return { constraint, depOrigin: [entityB.origin[0], entityB.origin[1], entityB.origin[2]] }
}

/**
 * 把一条规范化约束降级为 brepjs SolverConstraint（§4.2 步骤 3）。
 *
 * @param c - the normalized structural constraint.
 * @param env - the entity resolution environment (kernel + member lookup).
 * @returns the lowered solver constraint with the dependent origin.
 */
export function lowerStructuralConstraint(c: StructuralConstraint, env: EntityResolutionEnv): LoweredConstraint {
  switch (c.type) {
    case 'mate':
    case 'align': {
      // 贴合/对齐：两侧都必须是面引用；轴编码进 concentric（§3.7.2）
      const geomA = resolveFaceGeometryOfRef(c.a, env)
      const geomB = resolveFaceGeometryOfRef(c.b, env)
      const flip = c.type === 'mate'
      return {
        constraint: {
          type: 'concentric',
          entityA: { node: c.a.part, entity: axisFromFace(geomA, false) },
          entityB: { node: c.b.part, entity: axisFromFace(geomB, flip) },
        },
        depOrigin: geomB.center,
      }
    }
    case 'parallel':
      return lowerPair({ type: 'angle', value: 0, a: c.a, b: c.b }, env)
    case 'perpendicular':
      return lowerPair({ type: 'angle', value: 90, a: c.a, b: c.b }, env)
    case 'fixed':
      // solver 对 fixed 只读 entityA.node；entity 占位满足 SolverConstraint 形状
      return {
        constraint: {
          type: 'fixed',
          entityA: { node: c.part, entity: { type: 'point', origin: [0, 0, 0] } },
        },
      }
    case 'coincident':
    case 'concentric':
    case 'distance':
    case 'angle':
      return lowerPair(c, env)
  }
}
