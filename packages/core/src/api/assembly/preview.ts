/**
 * api/assembly/preview — 装配约束预览纯函数入口（P2-f3，方案 §2.3）
 *
 * 动机：3d_editor 预览需要**与执行同源**的轻量入口（P2-f5 已删除旧预览专用数学）；
 *
 * 同源性保证：内部复用 lowerEntities（与 lowerStructuralConstraint 同编码规则）
 * 与 vendored brepjs solveConstraints——不另写数学。
 *
 * **输入约定**：一律是"未编码"的实体（SolverEntity，纯数据）——
 * 面 → {type:'plane', origin:center, normal}，圆柱/圆锥面与边 →
 * {type:'axis', origin, direction}，点 → {type:'point', origin}；
 * `mate`/`align` 的 flip 由 solvePreview 内部负责（mate：dep 侧法向取反；
 * align：不取反），宿主不需要知道自己该不该 flip。
 *
 * 仅支持"恰好定位一个 dependent"的单条约束；`fixed`（无位移语义）与
 * `parallel`/`perpendicular`（请用 `angle` 0/90 显式表达）不支持，报错。
 */

import type { SolverConstraint, SolverEntity } from '../../vendored/brepjs/kernel/solverAdapter'
import type { AssemblyTransform } from '../../runtime-state'
import { solveConstraints } from '../../vendored/brepjs/kernel/solverAdapter'
import { lowerEntities } from './lower'
import { poseToAssemblyTransform } from './pose'
import type { AssemblyVec3 } from './types'

/** 预览支持的约束类型（fixed 无位移语义 → 抛错；parallel/perpendicular → angle 糖）。 */
export type PreviewConstraintType =
  | 'mate' | 'align' | 'coincident' | 'concentric' | 'distance' | 'angle'

/**
 * 单约束预览：给定两条实体的几何（SolverEntity，纯数据），
 * 走与 solveAssembly 完全相同的 lower → solveConstraints 链路，
 * 返回 dependent 侧成员的位姿（AssemblyTransform，index 固定 -1，
 * pivot = dep 实体 origin）。
 *
 * @param type - the constraint type.
 * @param refEntity - the reference-side solver entity.
 * @param depEntity - the dependent-side solver entity.
 * @param value - distance/angle 用（定距 mm / 夹角 deg）。
 * @returns the dependent-side AssemblyTransform (index = -1).
 * @throws Error on entity type mismatch / non-convergence / dep not positioned.
 */
export function solvePreview(
  type: PreviewConstraintType,
  refEntity: SolverEntity,
  depEntity: SolverEntity,
  value?: number,
): AssemblyTransform {
  const { constraint, depOrigin } = lowerEntities(
    type,
    { node: '__ref', entity: refEntity },
    { node: '__dep', entity: depEntity },
    value,
  )
  const r = solveConstraints(['__ref', '__dep'], [constraint as SolverConstraint])
  if (!r.converged) {
    throw new Error(
      `[assembly:preview] constraint did not converge; unsupported: ${r.unsupported.join(', ') || '(no detail)'}`,
    )
  }
  const pose = r.transforms.get('__dep')
  if (!pose) throw new Error('[assembly:preview] dependent was not positioned')
  return poseToAssemblyTransform(pose, depOrigin ?? [0, 0, 0], -1)
}

/**
 * 宿主拾取数据 → SolverEntity（预览时几何就在手上，不经过 TopoRef 解析）。
 *
 * @param g - 宿主拾取的几何数据（plane/axis/point，带 kind 判别）。
 * @returns 可供求解器消解的 SolverEntity（plane/axis/point）。
 */
export function entityFromGeometry(
  g:
    | { kind: 'plane'; center: AssemblyVec3; normal: AssemblyVec3 }
    | { kind: 'axis'; origin: AssemblyVec3; direction: AssemblyVec3 }
    | { kind: 'point'; origin: AssemblyVec3 },
): SolverEntity {
  switch (g.kind) {
    case 'plane':
      return { type: 'plane', origin: g.center, normal: g.normal }
    case 'axis':
      return { type: 'axis', origin: g.origin, direction: g.direction }
    case 'point':
      return { type: 'point', origin: g.origin }
  }
}