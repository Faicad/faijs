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
import { nameOf } from '../runtime-state'
import type { BrepEngineApi } from '../brep/engine/primitives'
import type { BrepHandle } from '../brep/engine/types'
import { HASH_UPPER_BOUND } from '../brep/face-evolution'
import { runtimeLineage } from '../topology/naming/lineage'
import { resolveViaLineage } from '../topology/naming/lineage-resolve'
import { asStmtId } from '../identity'
import {
  resolveTopoRef,
  captureFaceHint,
  captureEdgeHint,
  faceRowToHint,
  TopoRefError,
  type FaceTopoRef,
  type ResolutionContext,
  type FaceHint,
  type AxisHint,
  type EdgeCandidateEntry,
  type RoleTable,
} from '../topology/naming'

/** 求解面需要的当前几何（执行期派生）：与旧契约 fixedFace/movingFace 的 surfaceType/center/normal 同形。 */
export interface ResolvedFaceGeometry {
  surfaceType?: string
  center: [number, number, number]
  normal: [number, number, number]
  /** 圆柱/回转面的轴（装配轴约束用；平面/球面缺省，mesh 行快照由宿主注入）。 */
  axis?: AxisHint
}

/**
 * roleTable miss 时沿血缘回走重算（1.10 前置③：缓存降级）。
 *
 * 「产物上的 roleTable 不再是身份的唯一来源」的落点：精确解析读不到
 * `roleTable[origin][role]` 时，按血缘 DAG 从 origin 语句回走推进到当前 part，
 * 产出该 role 的 hash 集合并**回填缓存**——miss 可恢复，不再是无名错误。
 * 回走失败（链断 / 无演化）返回 undefined，调用方落到几何兜底（既有三态语义不变）。
 *
 * @param ref - the face TopoRef being resolved.
 * @param shape - the live part shape being resolved against.
 * @param kernel - the OCCT kernel (hash 换算需要；null 时回走不可用).
 * @returns the recomputed hash list, or undefined when lineage re-walk cannot produce one.
 */
function recomputeViaLineage(
  ref: FaceTopoRef,
  shape: object,
  kernel: BrepEngineApi | null,
): readonly number[] | undefined {
  if (!kernel) return undefined
  const part = nameOf(shape)
  if (!part) return undefined
  const result = resolveViaLineage(runtimeLineage, asStmtId(ref.origin), ref.role, part, {
    // 回走链上的中间产物句柄：优先血缘图旁挂（本仓 op 执行时记录），
    // 兜底读 runtime 全局 nameOf 反查（slot.solid）。
    brepOf: (p) => {
      const stmt = runtimeLineage.stmtOf(p)
      const h = stmt ? runtimeLineage.outputHandleOf(stmt) : undefined
      if (h !== undefined) return h
      return undefined
    },
    faceHashes: (handle) =>
      Array.from(kernel.subShapeHashes(handle as BrepHandle, 'face', HASH_UPPER_BOUND)),
    roleTableOf: (p) => {
      const stmt = runtimeLineage.stmtOf(p)
      return stmt ? runtimeLineage.outputTableOf(stmt) : undefined
    },
  })
  if (!('hashes' in result)) return undefined
  return result.hashes
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
  // 1.10 前置③：roleTable 权威落点在血缘图旁挂（part 键），slot 缓存字段已删。
  const part = nameOf(shape)
  const roleTable = (part ? runtimeLineage.tableOfPart(part) : undefined) as RoleTable | undefined

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
  // 1.10 前置③：roleTable 权威落点在血缘图旁挂（part 键），slot 缓存字段已删。
  const edgePart = nameOf(shape)
  const roleTable = (edgePart ? runtimeLineage.tableOfPart(edgePart) : undefined) as RoleTable | undefined
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
  // 1.10 前置③：roleTable 是解析缓存。origin/role 条目 miss 时先沿血缘回走
  // 重算并回填（miss 可恢复），再进解析——不再是"缓存 miss = 无名"。
  let ctx = buildShapeResolutionContext(kernel, shape)
  if (!ctx) {
    throw new TopoRefError(
      'E_TOPO_NOT_FOUND',
      'face',
      `no naming context on input shape (origin=${ref.origin}, role=${ref.role})`,
    )
  }
  // 1.10 前置③：roleTable 是解析缓存。origin/role 条目 miss 时先沿血缘回走
  // 重算并回填（miss 可恢复），再进解析——不再是"缓存 miss = 无名"。
  if (ctx.roleTable && kernel) {
    const entry0 = ctx.roleTable.get(ref.origin)?.get(ref.role)
    if (entry0 === undefined) {
      const recomputed = recomputeViaLineage(ref, shape, kernel)
      if (recomputed) {
        const merged = new Map(ctx.roleTable as ReadonlyMap<string, ReadonlyMap<string, readonly number[]>>)
        merged.set(ref.origin, new Map([...(ctx.roleTable.get(ref.origin) ?? new Map()), [ref.role, recomputed]]))
        ctx = { ...ctx, roleTable: merged as unknown as typeof ctx.roleTable }
      }
    }
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
  // BREAK 现场：capture 出当前法向/中心（圆柱面含轴）
  if (entry.handle && ctx.kernel) {
    const hint = captureFaceHint(ctx.kernel, entry.handle)
    return {
      surfaceType: hint.surfaceType,
      center: hint.center ?? [0, 0, 0],
      normal: hint.normal ?? [0, 0, 1],
      ...(hint.axis ? { axis: hint.axis } : {}),
    }
  }
  // mesh/行快照：直接用行几何（axis 由宿主行注入，缺省 undefined）
  const ext = entry.row
  const hint = ext ? faceRowToHint(ext) : undefined
  return {
    surfaceType: hint?.surfaceType,
    center: hint?.center ?? [0, 0, 0],
    normal: hint?.normal ?? [0, 0, 1],
    ...(hint?.axis ? { axis: hint.axis } : {}),
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