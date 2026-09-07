/**
 * api/assembly/entities — EntityRef → SolverEntity 实体抽取（P1，方案 §3.6 / §5.2）
 *
 * 三要素范式（与 chamfer 同构，方案 §3.5）：
 * 1. 引用可序列化：EntityRef 进 .fai.js；
 * 2. 解析在执行期：TopoRef 复用 topo-resolve 的解析通道（BREP 现场 / mesh 行快照）；
 * 3. 句柄是瞬态：解析出的几何立即转成纯数据 SolverEntity，句柄不跨语句。
 *
 * 输出契约对齐 brepjs solverAdapter 的 SolverEntity：{ type: 'plane'|'axis'|'point',
 * origin, normal?/direction? }。dependent 侧填本地坐标（部件自身坐标系），
 * reference 侧世界变换由 solverAdapter 的 transformEntity 负责——本层不做。
 *
 * 缺轴（mesh 行快照无宿主注入的 axis、sphere 等无轴面类型）→ 抛
 * E_TOPO_NOT_FOUND（方案 R4/P0 验收③：绝不静默降级）。
 */

import type { Shape } from '../../mesh/types'
import type { BrepEngineApi } from '../../brep/engine/primitives'
import type { PartName } from '../../identity'
import type { SolverEntity } from '../../vendored/brepjs/kernel/solverAdapter'
import { TopoRefError, type AxisHint } from '../../topology/naming'
import { resolveTopoRef, captureEdgeAxis, captureFaceHint } from '../../topology/naming'
import {
  buildShapeResolutionContext,
  buildEdgeResolutionContext,
  resolveFaceGeometry,
  type ResolvedFaceGeometry,
} from '../topo-resolve'
import type { EntityRef, AssemblyVec3 } from './types'

/** 实体抽取环境：内核（null = mesh/primitive 行快照路径）+ 成员查找。 */
export interface EntityResolutionEnv {
  kernel: BrepEngineApi | null
  /** part 变量名 → 成员 Shape。 */
  memberOf: (part: string) => Shape | undefined
}

/** 无轴可用的报错信息后缀（E_TOPO_NOT_FOUND）。 */
function missingAxisReason(geom: ResolvedFaceGeometry): string {
  return `face needs an axis (surfaceType=${geom.surfaceType ?? 'unknown'}) but none is available ` +
    `(BREP path: captureFaceHint; mesh path: host must inject axis into the naming row)`
}

/**
 * 面几何 → SolverEntity（方案 §5.2 抽取规则表）。
 * 平面 → plane；圆柱/圆锥（有轴）→ axis；其它/缺轴 → E_TOPO_NOT_FOUND。
 *
 * @param geom - the resolved face geometry (live BREP or mesh row snapshot).
 * @returns the solver entity (plane or axis).
 * @throws TopoRefError with code E_TOPO_NOT_FOUND when the surface has no usable axis or is unsupported.
 */
export function faceGeometryToSolverEntity(geom: ResolvedFaceGeometry): SolverEntity {
  const st = geom.surfaceType
  if (st === 'cylinder' || st === 'cone') {
    if (!geom.axis) {
      throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', missingAxisReason(geom))
    }
    return { type: 'axis', origin: geom.axis.origin, direction: geom.axis.direction }
  }
  if (!st || st === 'plane') {
    return { type: 'plane', origin: geom.center, normal: geom.normal }
  }
  throw new TopoRefError(
    'E_TOPO_NOT_FOUND',
    'face',
    `unsupported surface type for an assembly entity: ${st}` +
      (geom.axis ? '' : ` (${missingAxisReason(geom)})`),
  )
}

/** 快照形态 FaceRef → ResolvedFaceGeometry（无 axis——贴合语义只需 center+normal）。 */
function snapshotFaceGeometry(face: { surfaceType?: string; center: AssemblyVec3; normal: AssemblyVec3 }): ResolvedFaceGeometry {
  return { surfaceType: face.surfaceType, center: face.center, normal: face.normal }
}

/**
 * 解析一个 EntityRef 的面几何（mate/align 降级路径用：只需 center + normal，
 * 圆柱面轴不参与贴合——方案 §3.7.4 适用边界）。
 *
 * @param ref - the entity reference (must be a face reference).
 * @param env - the resolution environment.
 * @returns the resolved face geometry.
 * @throws Error when the ref is not a face reference or the part is unknown.
 */
export function resolveFaceGeometryOfRef(ref: EntityRef, env: EntityResolutionEnv): ResolvedFaceGeometry {
  if (!('face' in ref)) {
    throw new Error('[assembly] mate/align constraints require face references on both sides')
  }
  const shape = env.memberOf(ref.part)
  if (!shape) throw new Error(`[assembly] constraint references unknown part: ${ref.part}`)
  const face = ref.face as { topoRef?: unknown; center?: AssemblyVec3; normal?: AssemblyVec3; surfaceType?: string }
  if (face.topoRef) {
    return resolveFaceGeometry(env.kernel, shape, face.topoRef as Parameters<typeof resolveFaceGeometry>[2])
  }
  if (!face.center || !face.normal) {
    throw new Error('[assembly] face snapshot requires center and normal')
  }
  return snapshotFaceGeometry(face as { surfaceType?: string; center: AssemblyVec3; normal: AssemblyVec3 })
}

/** 边 TopoRef → 轴（BREP 现场；mesh 无邻接能力 → E_TOPO_NOT_FOUND）。 */
function resolveEdgeAxisFromTopoRef(
  kernel: BrepEngineApi,
  shape: Shape,
  edgeTopoRef: Parameters<typeof resolveTopoRef>[0],
  part: PartName,
): AxisHint {
  const ctx = buildEdgeResolutionContext(kernel, shape)
  if (!ctx) {
    throw new TopoRefError(
      'E_TOPO_NOT_FOUND',
      'edge',
      `edge entity needs a BREP naming context (part=${part}); mesh parts have no edge adjacency`,
    )
  }
  const resolved = resolveTopoRef(edgeTopoRef, ctx)
  const entry = ctx.edges?.[resolved.ordinal - 1]
  if (!entry?.handle) {
    throw new TopoRefError(
      'E_TOPO_NOT_FOUND',
      'edge',
      `resolved edge ordinal ${resolved.ordinal} has no live handle (part=${part})`,
    )
  }
  const axis = captureEdgeAxis(kernel, entry.handle)
  if (!axis) {
    throw new TopoRefError(
      'E_TOPO_NOT_FOUND',
      'edge',
      `edge ordinal ${resolved.ordinal} is not a line or circle — no axis entity available`,
    )
  }
  return axis
}

/**
 * 解析一个 EntityRef → SolverEntity（coincident/concentric/distance/angle 直译路径）。
 *
 * @param ref - the entity reference.
 * @param env - the resolution environment.
 * @returns the solver entity (pure data).
 * @throws TopoRefError / Error on unresolvable or unsupported references.
 */
export function resolveSolverEntity(ref: EntityRef, env: EntityResolutionEnv): SolverEntity {
  const shape = env.memberOf(ref.part)
  if (!shape) throw new Error(`[assembly] constraint references unknown part: ${ref.part}`)

  if ('point' in ref) {
    return { type: 'point', origin: ref.point }
  }
  if ('face' in ref) {
    return faceGeometryToSolverEntity(resolveFaceGeometryOfRef(ref, env))
  }
  if ('faceIndex' in ref) {
    // 序号简写（1 起，调试用）：直接按 ordinal 取候选面几何（不走 TopoRef 打分）
    const ctx = buildShapeResolutionContext(env.kernel, shape)
    if (!ctx) {
      throw new TopoRefError(
        'E_TOPO_NOT_FOUND',
        'face',
        `faceIndex ${ref.faceIndex} has no naming context on part ${ref.part}`,
      )
    }
    const entry = ctx.faces[ref.faceIndex - 1]
    if (!entry) {
      throw new TopoRefError(
        'E_TOPO_NOT_FOUND',
        'face',
        `faceIndex ${ref.faceIndex} out of range (part ${ref.part} has ${ctx.faces.length} faces)`,
      )
    }
    return faceGeometryToSolverEntity(faceGeometryFromContextEntry(env, entry, ref.part))
  }
  // edge 引用
  const edge = ref.edge as { topoRef?: unknown; axis?: { origin: AssemblyVec3; direction: AssemblyVec3 } }
  if (edge.axis) {
    return { type: 'axis', origin: edge.axis.origin, direction: edge.axis.direction }
  }
  if (!env.kernel) {
    throw new TopoRefError(
      'E_TOPO_NOT_FOUND',
      'edge',
      `edge TopoRef needs a live kernel (part=${ref.part}); mesh path supports only axis snapshots`,
    )
  }
  const axis = resolveEdgeAxisFromTopoRef(env.kernel, shape, edge.topoRef as Parameters<typeof resolveTopoRef>[0], ref.part)
  return { type: 'axis', origin: axis.origin, direction: axis.direction }
}

/**
 * faceIndex 简写的面几何（从解析上下文候选行直接取）：
 * BREP 候选（活句柄）→ captureFaceHint 现场；行快照候选 → 行几何。
 */
function faceGeometryFromContextEntry(
  env: EntityResolutionEnv,
  entry: { handle?: unknown; row?: unknown },
  part: PartName,
): ResolvedFaceGeometry {
  if (entry.handle && env.kernel) {
    const hint = captureFaceHint(env.kernel, entry.handle as Parameters<typeof captureFaceHint>[1])
    return {
      surfaceType: hint.surfaceType,
      center: hint.center ?? [0, 0, 0],
      normal: hint.normal ?? [0, 0, 1],
      ...(hint.axis ? { axis: hint.axis } : {}),
    }
  }
  const hint = entry.row as
    | { surfaceType?: string; center?: AssemblyVec3; normal?: AssemblyVec3; axis?: AxisHint }
    | undefined
  if (!hint?.center || !hint?.normal) {
    throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', `faceIndex row has no geometry (part=${part})`)
  }
  return {
    surfaceType: hint.surfaceType,
    center: hint.center,
    normal: hint.normal,
    ...(hint.axis ? { axis: hint.axis } : {}),
  }
}
