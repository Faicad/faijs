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
import { runtimeLineage, isHashEvolution } from '../topology/naming/lineage'
import { resolveViaLineage } from '../topology/naming/lineage-resolve'
import { asStmtId, type PartName, type StmtId } from '../identity'
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
 * 边路径「无血统邻面」恢复（1.10 前置③ 推广到边路径）。
 *
 * `edgeRef` 正查 `findOriginRole(table, ordinalToHash, fo)`（面 hash → `(origin, role)`）
 * 失败，通常因为**目标 part** 的 roleTable 缓存**残缺**（丢了该面的条目），而**根节点**
 * （名字的诞生处）的表是完整的：该面的 `(origin, role)` 真实存在，只是没被缓存到目标 part
 * 的表副本里（drift / 中间 op 原样带走旧 hash 表）。
 *
 * 与面路径 `recomputeViaLineage` 同构、方向相反——已知面 hash、不知道它属于哪个
 * `(origin, role)`。恢复策略：遍历血缘图所有候选 `(origin, role)`，沿 DAG 从根走到目标
 * part，把根序（该 role 的 hash 集）推进到目标序、换算成目标 hash 集，取**含该面当前 hash**
 * 者，即该面的真实身份。
 *
 * 推进规则（自带，不依赖 `resolveViaLineage` 的严格契约）：
 * - 中间节点有 ordinal 演化（Map）→ 照用；
 * - 中间节点是 identity 类（copy/place/transform）但**未挂演化**（既有缺口，见
 *   `place.ts` 经 compat 路径未 `attachEvolution`）→ 按 1:1 推进（语义正确：identity 不改
 *   面序）；
 * - 其余无演化 → 放弃该候选（不乱猜）。
 *
 * 命中即回填 `{origin, role}` 让 `resolveEdgeTopo` 继续（exact 或几何兜底）；未命中返回
 * undefined，调用方保持原 `no role lineage` 报错——零回归。仅跑在 `findOriginRole` 失败
 * 之后（错误路径），不进热路径。
 *
 * @param kernel - the OCCT kernel (hash 换算需要).
 * @param part - the live part whose adjacent face we are recovering.
 * @param faceOrdinal - the 1-based face ordinal whose role is missing.
 * @param ordinalToHash - the part's current face ordinal → hash array.
 * @returns the recovered `{origin, role}`, or undefined when no lineage walk matches.
 */
export function recoverEdgeFaceRole(
  kernel: BrepEngineApi,
  part: PartName,
  faceOrdinal: number,
  ordinalToHash: readonly number[],
): { origin: StmtId; role: string } | undefined {
  const targetHash = ordinalToHash[faceOrdinal - 1]
  if (targetHash === undefined) return undefined

  // 候选 (origin, role)：血缘图所有节点的输出表（根节点诞生名字处）
  const candidates: Array<{ origin: string; role: string }> = []
  for (const stmt of runtimeLineage.stmtIds()) {
    const tbl = runtimeLineage.outputTableOf(stmt)
    if (!tbl) continue
    for (const [origin, roles] of tbl) {
      for (const roleLine of roles.keys()) candidates.push({ origin, role: roleLine })
    }
  }

  for (const c of candidates) {
    const hashes = lineageHashesAt(kernel, c.origin, c.role, part)
    if (hashes && hashes.includes(targetHash)) return { origin: asStmtId(c.origin), role: c.role }
  }
  return undefined
}

/**
 * 沿血缘从 `(origin, role)` 的根走到 `targetPart`，把根序推进到目标序、换算成目标 hash 集。
 *
 * @returns the target part's face hashes for this role, or undefined when the
 *   chain cannot be walked (unreachable / non-identity node without evolution).
 */
function lineageHashesAt(
  kernel: BrepEngineApi,
  origin: string,
  roleLine: string,
  targetPart: PartName,
): readonly number[] | undefined {
  const root = runtimeLineage.node(asStmtId(origin))
  if (!root) return undefined
  const rootPart = root.outputs[0]
  if (!rootPart) return undefined
  const rootHandle = runtimeLineage.outputHandleOf(asStmtId(origin))
  const rootTable = runtimeLineage.outputTableOf(asStmtId(origin))
  if (rootHandle === undefined || !rootTable) return undefined

  const rootHashes = rootTable.get(origin)?.get(roleLine)
  if (rootHashes === undefined || rootHashes.length === 0) return undefined
  const rootAll = Array.from(kernel.subShapeHashes(rootHandle as BrepHandle, 'face', HASH_UPPER_BOUND))
  let ordinals: number[] = []
  for (const h of rootHashes) {
    const idx = rootAll.indexOf(h)
    if (idx >= 0) ordinals.push(idx + 1) // ordinal 1 起
  }
  if (ordinals.length === 0) return undefined

  // 逐节点推进：root → targetPart（带访问守卫，防异常 DAG 环路挂死执行）
  const seen = new Set<PartName>()
  let currentPart: PartName = rootPart
  while (currentPart !== targetPart) {
    if (seen.has(currentPart)) return undefined
    seen.add(currentPart)
    const consumer = runtimeLineage.nodeConsuming(currentPart)
    if (!consumer) return undefined
    const evo = consumer.evolution
    if (evo && !isHashEvolution(evo)) {
      ordinals = ordinals.flatMap((o) => evo.get(o) ?? [o])
    } else if (consumer.provenance.kind === 'identity') {
      // identity 类未挂演化 → 1:1 推进（语义正确）
    } else {
      return undefined
    }
    const carry = consumer.outputs.includes(targetPart) ? targetPart : consumer.outputs[0]!
    currentPart = carry
  }

  const targetHandle = runtimeLineage.outputHandleOf(runtimeLineage.stmtOf(targetPart) ?? asStmtId(''))
  if (targetHandle === undefined) return undefined
  const targetAll = Array.from(kernel.subShapeHashes(targetHandle as BrepHandle, 'face', HASH_UPPER_BOUND))
  const hashes: number[] = []
  for (const o of ordinals) {
    const h = targetAll[o - 1]
    if (h !== undefined) hashes.push(h)
  }
  return hashes.length > 0 ? hashes : undefined
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
 * 为**网格实体**构建带边候选的 ResolutionContext（近似拓扑的边解析入口）。
 *
 * 与 `buildEdgeResolutionContext` 的差别只有两点，两点都是"网格零件没有 role 层"
 * 的直接后果：
 * 1. 句柄来自 `slot.meshSolid`（网格实体句柄）而不是 `slot.solid`（BREP 句柄）；
 * 2. **刻意不给 `faceEdgeAdjacency` / `edgeFaceAdjacency`**。
 *
 * 第 2 点是有意的，不是省事：邻接表存在的意义是"两面之交 = 一条边"，
 * 而 `EdgeTopoRef.faces` 是两个 **RoleQualifier**——网格零件没有 role
 * （Phase 1.8：primitive/mesh 行 origin/role 显式为 null），限定符只是占位。
 * 带上邻接表反而会让 `resolveEdgeTopo` 走进"按角色取公共边"的分支并必然 not-found；
 * 不带它，解析就走「无 role 层 → 整个边表的纯几何匹配」（resolve-edge.ts 明写）。
 * 边身份只能几何，这是如实的能力边界。
 *
 * @param kernel - the mesh backend's L1 kernel (live edge handles come from it).
 * @param shape - the live mesh-solid shape whose naming slot is read.
 * @returns the edge-enabled resolution context, or undefined when the shape is not a mesh solid.
 */
export function buildMeshEdgeResolutionContext(
  kernel: BrepEngineApi,
  shape: object | undefined,
): ResolutionContext | undefined {
  if (!shape) return undefined
  const slot = getSlot(shape)
  const solid = slot?.meshSolid as BrepHandle | undefined
  if (!solid) return undefined

  const faceHandles = kernel.getSubShapes(solid, 'face')
  const faces = faceHandles.map((handle, i) => ({ ordinal: i + 1, handle }))
  const edges: EdgeCandidateEntry[] = kernel.getSubShapes(solid, 'edge').map((handle, i) => ({
    ordinal: i + 1,
    handle,
    hint: captureEdgeHint(kernel, handle),
  }))
  return { kernel, faces, edges }
}

/**
 * 为**网格实体**构建面解析上下文（`sketchOnFace` 的网格链入口）。
 *
 * 面候选直接来自 `slot.meshSolid` 的 `getSubShapes(solid,'face')` 现场句柄——
 * 与 `buildMeshEdgeResolutionContext` 的面表同源（同一枚举序）。**刻意不给
 * `roleTable` / 邻接**：网格零件没有 role 层（Phase 1.8），带上 roleTable 只会让
 * `resolveFaceTopo` 走进 exact 分支并必然落空；不带它，解析就走「全形状按 hint
 * 几何打分」（resolve-face.ts 步骤 2），命中即 `geometric-fallback`。
 *
 * 也因此，网格链上的面只能用**几何**识别（法向 / 中心 / 面积）——这是如实的能力
 * 边界，不是省事：同尺寸的两个平行面（如立方体的顶面与底面）在几何上无法区分，
 * 调用方应改用序号。
 *
 * @param kernel - the mesh backend's L1 kernel (live face handles come from it).
 * @param shape - the live mesh-solid shape whose naming slot is read.
 * @returns the face resolution context, or undefined when the shape is not a mesh solid.
 */
export function buildMeshFaceResolutionContext(
  kernel: BrepEngineApi,
  shape: object | undefined,
): ResolutionContext | undefined {
  if (!shape) return undefined
  const slot = getSlot(shape)
  const solid = slot?.meshSolid as BrepHandle | undefined
  if (!solid) return undefined

  const faces = kernel.getSubShapes(solid, 'face').map((handle, i) => ({ ordinal: i + 1, handle }))
  return { kernel, faces }
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