/**
 * topo-resolve — 运行期 TopoRef 解析（装配/钻孔等面引用 op 共享，§6.2）
 *
 * 与 core/topology/naming 的分工：
 * - naming（core）负责纯解析：给 ReactsContext + FaceTopoRef → ordinal/handle；
 * - 本模块（stdlib）是「活 Shape → React块(ResolutionContext)」的引擎胶水：
 *   从 Shape 身份槽读出运行期数据（BREP 活句柄 + RoleTable，或 setTopology 注入的
 *   面 hint 快照），并把解析结果还原成求解需要的几何（center/normal/surfaceType）。
 *
 * 这样 drill（面 → 法向）与 compound/assembly（约束固定/移动面 → 几何）共用同一
 * 条「TopoRef 执行期派生」通道，且不动 core 的纯 naming 层职责。
 *
 * 任何一步定不了案 → 抛 TopoRefError（三态错误码），绝不静默拿序号硬取。
 */

import type { Shape } from '../mesh/types'
import { getSlot } from '../shape'
import type { BrepEngineApi } from '../brep/engine/primitives'
import type { BrepHandle } from '../brep/engine/types'
import { HASH_UPPER_BOUND } from '../brep/face-evolution'
import {
  resolveTopoRef,
  captureFaceHint,
  captureEdgeHint,
  faceRowToHint,
  TopoRefError,
  type FaceTopoRef,
  type ResolutionContext,
  type FaceHint,
  type EdgeCandidateEntry,
  type RoleTable,
} from '../topology/naming'

/** 求解面需要的当前几何（执行期派生）：与旧契约 fixedFace/movingFace 的 surfaceType/center/normal 同形。 */
export interface ResolvedFaceGeometry {
  surfaceType?: string
  center: [number, number, number]
  normal: [number, number, number]
}

/**
 * 从活 Shape 的组装槽构建 ResolutionContext（BREAK 或 mesh/primitive 两条路）。
 *
 * - BREAK：`slot.solid` + `slot.roleTable` → 内核现场句柄 + hash（exact 路径）；
 * - mesh/primitive：`slot.faceHints`（setTopology 注入时提炼写入）→ 行快照（geometric 路径）。
 *
 * 无命名槽 → undefined（调用方按 not-found 抛错）。
 *
 * @param kernel - the OCCT kernel (null on the mesh/primitive path).
 * @param shape - the live input shape whose naming slot is read.
 * @returns the resolution context (live BREP or hint rows), or undefined when the shape has no naming slot.
 */
export function buildShapeResolutionContext(
  kernel: BrepEngineApi | null,
  shape: object | undefined,
): ResolutionContext | undefined {
  if (!shape) return undefined
  const slot = getSlot(shape)
  if (!slot) return undefined
  const roleTable = slot.roleTable as RoleTable | undefined

  const solid = slot.solid as BrepHandle | undefined
  if (kernel && solid) {
    const handles = kernel.getSubShapes(solid, 'face')
    const hashes = Array.from(kernel.subShapeHashes(solid, 'face', HASH_UPPER_BOUND))
    const faces = handles.map((handle, i) => ({ ordinal: i + 1, hash: hashes[i] ?? 0, handle }))
    return { kernel, faces, roleTable }
  }

  const hints = slot.faceHints as FaceHint[] | undefined
  if (Array.isArray(hints) && hints.length > 0) {
    const faces = hints.map((row, i) => ({ ordinal: i + 1, row }))
    return { kernel: null, faces, roleTable }
  }
  return undefined
}

/**
 * 为 BREP 现场构建带边候选与邻接表的 ResolutionContext（edge TopoRef 解析用）。
 *
 * 与 `buildBrepResolutionContext` 的面候选同源（同一枚举序），并补充：
 * - `edges`：边候选表（ordinal 1 起，含活句柄 + length/midpoint hint）；
 * - `faceEdgeAdjacency` / `edgeFaceAdjacency`：邻接表（edge lineage 解析用，M3）。
 *
 * 只支持 BREP 现场（edge lineage 需要 face→edge 邻接）；mesh/primitive 路径
 * 没有邻接能力（build-mesh-topology.ts:262，§5.3）→ 返回 undefined，调用方
 * 按 E_TOPO_NOT_FOUND 处理。
 *
 * @param kernel - the OCCT kernel.
 * @param shape - the live input shape whose naming slot is read.
 * @returns the edge-enabled resolution context, or undefined when the shape has
 *   no BREP naming slot.
 */
export function buildEdgeResolutionContext(
  kernel: BrepEngineApi,
  shape: object | undefined,
): ResolutionContext | undefined {
  if (!shape) return undefined
  const slot = getSlot(shape)
  if (!slot) return undefined
  const roleTable = slot.roleTable as RoleTable | undefined
  const solid = slot.solid as BrepHandle | undefined
  if (!solid) return undefined

  const faceHandles = kernel.getSubShapes(solid, 'face')
  const faceHashes = Array.from(kernel.subShapeHashes(solid, 'face', HASH_UPPER_BOUND))
  const faces = faceHandles.map((handle, i) => ({ ordinal: i + 1, hash: faceHashes[i] ?? 0, handle }))

  const edgeHandles = kernel.getSubShapes(solid, 'edge')
  const edges: EdgeCandidateEntry[] = edgeHandles.map((handle, i) => ({
    ordinal: i + 1,
    handle,
    hint: captureEdgeHint(kernel, handle),
  }))
  const liveEdges = edges.filter((e): e is EdgeCandidateEntry & { handle: BrepHandle } => e.handle !== undefined)

  // face → 邻接 edges（ordinal 1 起）。mesh 无 face→edge 邻接，这里 BREP 现场直取。
  const faceHandlesArr = faceHandles.map((h, hi) => ({ handle: h, ordinal: hi + 1 }))

  const faceEdgeAdjacency = faceHandlesArr.map(({ handle }) => {
    const sub = kernel.getSubShapes(handle, 'edge')
    return sub
      .map((eh) => liveEdges.find((e) => kernel.isSame(eh, e.handle))?.ordinal)
      .filter((v): v is number => v !== undefined)
  })
  const edgeFaceAdjacency = liveEdges.map(({ handle }) => {
    const adj: number[] = []
    for (const f of faceHandlesArr) {
      if (kernel.getSubShapes(f.handle, 'edge').some((fe) => kernel.isSame(fe, handle))) {
        adj.push(f.ordinal)
      }
    }
    return adj
  })

  return { kernel, faces, edges, roleTable, faceEdgeAdjacency, edgeFaceAdjacency }
}

/**
 * 从 BREP 现场句柄建带边候选/邻接的 ResolutionContext（twoDistances 逐边重建用）。
 *
 * 与 `buildEdgeResolutionContext` 相同，但直接接收 live solid 句柄而非 Shape 槽——
 * 用于真机逐边构建后，输入已从上一次结果演化，Shape 槽里的 roleTable/hash 不再
 * 与当前句柄对应（§3.6 逐边构建，后续边要重新 resolve）。
 *
 * @param kernel - the OCCT kernel.
 * @param solid - the live BREP solid handle.
 * @param roleTable - optional role table to carry over (not used for strict matching).
 * @returns the edge-enabled resolution context (faces/edges/adjacency live from `solid`).
 */
export function buildEdgeContextFromSolid(
  kernel: BrepEngineApi,
  solid: BrepHandle,
  roleTable?: RoleTable,
): ResolutionContext {
  const faceHandles = kernel.getSubShapes(solid, 'face')
  const faces = faceHandles.map((handle, i) => ({ ordinal: i + 1, hash: undefined, handle }))
  const edgeHandles = kernel.getSubShapes(solid, 'edge')
  const edges: EdgeCandidateEntry[] = edgeHandles.map((handle, i) => ({
    ordinal: i + 1,
    handle,
    hint: captureEdgeHint(kernel, handle),
  }))
  const liveEdges = edges.filter((e): e is EdgeCandidateEntry & { handle: BrepHandle } => e.handle !== undefined)
  const faceHandlesArr = faceHandles.map((h, hi) => ({ handle: h, ordinal: hi + 1 }))
  const faceEdgeAdjacency = faceHandlesArr.map(({ handle }) => {
    const sub = kernel.getSubShapes(handle, 'edge')
    return sub
      .map((eh) => liveEdges.find((e) => kernel.isSame(eh, e.handle))?.ordinal)
      .filter((v): v is number => v !== undefined)
  })
  const edgeFaceAdjacency = liveEdges.map(({ handle }) => {
    const adj: number[] = []
    for (const f of faceHandlesArr) {
      if (kernel.getSubShapes(f.handle, 'edge').some((fe) => kernel.isSame(fe, handle))) adj.push(f.ordinal)
    }
    return adj
  })
  return { kernel, faces, edges, roleTable, faceEdgeAdjacency, edgeFaceAdjacency }
}

/**
 * 解析一个 face TopoRef 到「当前几何」，并从解析出的候选面派生求解几何。
 *
 * 结果与命名行的 surfaceType/center/normal 同口径（BREAK 现场 captureFaceHint /
 * mesh 行快照），保证两侧派生值一致。
 *
 * @param kernel - the OCCT kernel (can be null on the mesh/primitive path).
 * @param shape - the live input shape whose naming slot is being resolved.
 * @param ref - the FaceTopoRef captured earlier.
 * @returns the current face geometry (center/normal/surfaceType).
 */
export function resolveFaceGeometry(
  kernel: BrepEngineApi | null,
  shape: Shape,
  ref: FaceTopoRef,
): ResolvedFaceGeometry {
  const ctx = buildShapeResolutionContext(kernel, shape)
  if (!ctx) {
    throw new TopoRefError(
      'E_TOPO_NOT_FOUND',
      'face',
      `no naming context on input shape (origin=${ref.origin}, role=${ref.role})`,
    )
  }
  const entity = resolveTopoRef(ref, ctx)
  const entry = ctx.faces[entity.ordinal - 1]
  if (!entry) {
    throw new TopoRefError(
      'E_TOPO_NOT_FOUND',
      'face',
      `resolved ordinal ${entity.ordinal} has no candidate in context (origin=${ref.origin}, role=${ref.role})`,
    )
  }
  // BREAK 现场：capture 出当前法向/中心
  if (entry.handle && ctx.kernel) {
    const hint = captureFaceHint(ctx.kernel, entry.handle)
    return {
      surfaceType: hint.surfaceType,
      center: hint.center ?? [0, 0, 0],
      normal: hint.normal ?? [0, 0, 1],
    }
  }
  // mesh/行快照：直接用行几何
  const ext = entry.row
  const hint = ext ? faceRowToHint(ext) : undefined
  return {
    surfaceType: hint?.surfaceType,
    center: hint?.center ?? [0, 0, 0],
    normal: hint?.normal ?? [0, 0, 1],
  }
}

/**
 * FaceMateConstraint 面的等价重载：face 参数对象（`{topoRef}` 或旧快照）的守卫。
 *
 * @param v - the value to test.
 * @returns true when the value is a FaceTopoRef (kind === 'face').
 */
export function isFaceTopoRef(v: unknown): v is FaceTopoRef {
  return !!v && typeof v === 'object' && (v as { kind?: unknown }).kind === 'face'
}