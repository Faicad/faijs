/**
 * api selectors-to-refs — CadQuery 选择器 → TopoRef 桥（方案 2026-10-12 §3.2）
 *
 * 把 CadQuery 字符串选择器（`">Z"`、`"|Z"`、`"%PLANE"`、命名视图 `"top"`、
 * 集合表达式 `"|Z and %PLANE"` …）求值成内核句柄，再经命名层（RoleTable + 血缘）
 * 反查合成 `FaceTopoRef` / `EdgeTopoRef`，或直接投影成顶点坐标（`P3`）——让
 * `cad.*` op 的拓扑参数能吃下字符串选择器（AI 生成 faijs 代码的目标形态），
 * 而不破坏「选择器子系统与命名/TopoRef 系统物理隔离」的红线。
 *
 * 职责边界（方案 §3.2 R4）：本文件是选择器与命名系统之间**唯一的显式通道**。
 * 句柄 → TopoRef 反查复用 `edge-ref.ts` / `face-ref.ts` 已示范的路径
 * （`captureEdgeHint` / `captureFaceHint` / `findOriginRole` /
 * `recoverEdgeFaceRole`），不重写命名逻辑。
 *
 * 错误红线（方案 §3.2 R1，与 faijs 红线一致）：选择器选中的**无名实体**
 * （role 缺失，如 3MF 网格链）→ 抛 `TopoRefError`，不静默降级；网格零件没有
 * role 层，选择器/命名体系只服务精度链（网格链用序号是设计定论）。
 */

import type { Shape } from '../mesh/types'
import { getBrepApi } from '../brep/handle-bridge'
import { brepOf, hasBrep } from '../shape'
import { nameOf } from '../runtime-state'
import type { BrepEngineApi } from '../brep/engine/primitives'
import type { BrepHandle } from '../brep/engine/types'
import {
  captureEdgeHint,
  captureFaceHint,
  findOriginRole,
  TopoRefError,
  type EdgeTopoRef,
  type FaceTopoRef,
  type ResolutionContext,
  type RoleQualifier,
} from '../topology/naming'
import { buildEdgeResolutionContext, recoverEdgeFaceRole } from './topo-resolve'
import { resolveStepHandles } from './cadquery-selectors/resolve'
import type { P3 } from './cadquery-selectors/entity'

/** 桥的静态前置：shape 必须是带 BREP 的活实体（选择器服务精度链）。 */
function requireBrep(shape: Shape, what: string): BrepEngineApi {
  const kernel = getBrepApi()
  if (!kernel) {
    throw new TopoRefError(
      'E_TOPO_MESH_UNSUPPORTED',
      'face',
      `${what}: selector resolution is BREP-only (mesh path unsupported)`,
    )
  }
  if (!hasBrep(shape)) {
    throw new TopoRefError(
      'E_TOPO_MESH_UNSUPPORTED',
      'face',
      `${what}: input shape has no BREP solid (mesh shapes do not carry topology identity)`,
    )
  }
  return kernel
}

/** 取形状的 BREP solid 句柄（调用方已过 requireBrep，solid 必在）。 */
function solidOf(shape: Shape, what: string): BrepHandle {
  const solid = brepOf(shape) as BrepHandle | undefined
  if (solid === undefined) {
    throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', `${what}: input has no BREP solid`)
  }
  return solid
}

/**
 * 面句柄 → `FaceTopoRef`：在命名现场（ctx.faces）定位 ordinal → roleTable 反查
 * `{origin, role}`（miss 沿血缘回走恢复）→ 几何 hint。
 *
 * @param kernel - the active BREP engine.
 * @param shape - the live input shape (for nameOf lineage recovery).
 * @param ctx - the naming resolution context built from the shape.
 * @param handle - the selected face handle.
 * @returns the FaceTopoRef, or throws when the face has no role lineage.
 */
function faceHandleToRef(
  kernel: BrepEngineApi,
  shape: Shape,
  ctx: ResolutionContext,
  handle: BrepHandle,
): FaceTopoRef {
  const idx = ctx.faces.findIndex(
    (f) => f.handle !== undefined && kernel.isSame(f.handle, handle),
  )
  if (idx < 0) {
    throw new TopoRefError(
      'E_TOPO_NOT_FOUND',
      'face',
      'selector: resolved face is not in the naming context',
    )
  }
  const ordinal = ctx.faces[idx].ordinal
  const table = ctx.roleTable
  if (!table) {
    throw new TopoRefError(
      'E_TOPO_NOT_FOUND',
      'face',
      'selector: input shape has no role table (nameless shape)',
    )
  }
  const ordinalToHash = ctx.faces.map((f) => f.hash ?? 0)
  let found = findOriginRole(table, ordinalToHash, ordinal)
  if (!found) {
    // 与 face-ref.ts 同构：目标 part 的 roleTable 缓存残缺但血缘可回走 → 恢复。
    const part = nameOf(shape as object)
    if (part) found = recoverEdgeFaceRole(kernel, part, ordinal, ordinalToHash)
  }
  if (!found) {
    throw new TopoRefError(
      'E_TOPO_NOT_FOUND',
      'face',
      `selector: resolved face ordinal ${ordinal} has no role lineage`,
    )
  }
  return { kind: 'face', origin: found.origin, role: found.role, hint: captureFaceHint(kernel, handle) }
}

/**
 * 边句柄 → `EdgeTopoRef`：与 `edge-ref.ts` 同构——逐面枚举其边找邻面（不依赖
 * 邻接表下标对齐），两邻面的 role 对合成限定符 + 几何 hint。
 *
 * @param kernel - the active BREP engine.
 * @param shape - the live input shape (for nameOf lineage recovery).
 * @param ctx - the naming resolution context built from the shape.
 * @param handle - the selected edge handle.
 * @returns the EdgeTopoRef, or throws when the edge lacks a two-face role pair.
 */
function edgeHandleToRef(
  kernel: BrepEngineApi,
  shape: Shape,
  ctx: ResolutionContext,
  handle: BrepHandle,
): EdgeTopoRef {
  const faceOrdinals: number[] = []
  for (const f of ctx.faces) {
    if (f.handle === undefined) continue
    if (kernel.getSubShapes(f.handle, 'edge').some((eh) => kernel.isSame(eh, handle))) {
      faceOrdinals.push(f.ordinal)
    }
  }
  if (faceOrdinals.length < 2) {
    throw new TopoRefError(
      'E_TOPO_NOT_FOUND',
      'edge',
      `selector: edge has ${faceOrdinals.length} adjacent face(s); an EdgeTopoRef needs a two-face pair`,
    )
  }

  const table = ctx.roleTable
  if (!table) {
    throw new TopoRefError(
      'E_TOPO_NOT_FOUND',
      'edge',
      'selector: input shape has no role table (nameless shape)',
    )
  }
  const ordinalToHash = ctx.faces.map((f) => f.hash ?? 0)
  const quals: RoleQualifier[] = []
  for (const fo of faceOrdinals.slice(0, 2)) {
    let found = findOriginRole(table, ordinalToHash, fo)
    if (!found) {
      const part = nameOf(shape as object)
      if (part) found = recoverEdgeFaceRole(kernel, part, fo, ordinalToHash)
    }
    if (!found) {
      throw new TopoRefError(
        'E_TOPO_NOT_FOUND',
        'edge',
        `selector: adjacent face ordinal ${fo} has no role lineage`,
      )
    }
    quals.push({ origin: found.origin, role: found.role })
  }

  const [qa, qb] = quals as [RoleQualifier, RoleQualifier]
  return { kind: 'edge', faces: [qa, qb], hint: captureEdgeHint(kernel, handle) }
}

/**
 * 把面选择器字符串解析成 `FaceTopoRef[]`（选择器 → 句柄 → TopoRef 全链）。
 *
 * 示例：`">Z"`（Z 极值面）、`"|Z"`（法向平行 Z 的平面面）、`"%PLANE"`、
 * `"top"`（命名视图）、`"|Z and %PLANE"`（集合表达式）。
 *
 * @param shape - 目标几何（BREP 实体所在的 Shape；选择器服务精度链）。
 * @param sel - CadQuery 面选择器字符串。
 * @returns 选中面的 `FaceTopoRef[]`（保持选择器返回顺序）。
 * @throws {TopoRefError} 无 BREP / 选中面无 role 血统（不静默降级）。
 */
export function resolveSelectorToFaceRefs(shape: Shape, sel: string): FaceTopoRef[] {
  const kernel = requireBrep(shape, 'resolveSelectorToFaceRefs')
  const solid = solidOf(shape, 'resolveSelectorToFaceRefs')
  const ctx = buildEdgeResolutionContext(kernel, shape as object)
  if (!ctx) {
    throw new TopoRefError(
      'E_TOPO_NOT_FOUND',
      'face',
      'resolveSelectorToFaceRefs: input has no BREP naming context',
    )
  }
  const handles = resolveStepHandles(solid, 'face', sel)
  return handles.map((h) => faceHandleToRef(kernel, shape, ctx, h))
}

/**
 * 把边选择器字符串解析成 `EdgeTopoRef[]`（选择器 → 句柄 → TopoRef 全链）。
 *
 * 示例：`"|Z"`（切线平行 Z 的边）、`">Z"`（Z 极值边）、`"%LINE"`、
 * `"#Z"`（切线垂直 Z）。
 *
 * @param shape - 目标几何（BREP 实体所在的 Shape）。
 * @param sel - CadQuery 边选择器字符串。
 * @returns 选中边的 `EdgeTopoRef[]`（保持选择器返回顺序）。
 * @throws {TopoRefError} 无 BREP / 选中边邻面不足两面或无 role 血统。
 */
export function resolveSelectorToEdgeRefs(shape: Shape, sel: string): EdgeTopoRef[] {
  const kernel = requireBrep(shape, 'resolveSelectorToEdgeRefs')
  const solid = solidOf(shape, 'resolveSelectorToEdgeRefs')
  const ctx = buildEdgeResolutionContext(kernel, shape as object)
  if (!ctx) {
    throw new TopoRefError(
      'E_TOPO_NOT_FOUND',
      'edge',
      'resolveSelectorToEdgeRefs: input has no BREP naming context',
    )
  }
  const handles = resolveStepHandles(solid, 'edge', sel)
  return handles.map((h) => edgeHandleToRef(kernel, shape, ctx, h))
}

/**
 * 把顶点选择器字符串解析成顶点坐标 `P3[]`。
 *
 * 顶点没有角色身份（命名层只给面/边命名），故直接投影成世界坐标点——
 * 供未来需要「点」的 op（如打点/对齐）使用。
 *
 * @param shape - 目标几何（BREP 实体所在的 Shape）。
 * @param sel - CadQuery 顶点选择器字符串（如 `">Z"`、`"(0,0,0)"`，空串 = 全部）。
 * @returns 选中顶点的世界坐标（保持选择器返回顺序）。
 * @throws {TopoRefError} 无 BREP（顶点选择器只服务精度链）。
 */
export function resolveSelectorToVertexPts(shape: Shape, sel: string): P3[] {
  const kernel = requireBrep(shape, 'resolveSelectorToVertexPts')
  const solid = solidOf(shape, 'resolveSelectorToVertexPts')
  const handles = resolveStepHandles(solid, 'vertex', sel)
  return handles.map((h) => {
    const p = kernel.vertexPosition(h)
    return { x: p.x, y: p.y, z: p.z }
  })
}

// ── op 参数输入归一（string 顶层或数组元素 → refs 展开）──────────────────

/** 边选择器参数的一个条目：选择器字符串或 `EdgeTopoRef`。 */
export type EdgeSelectorEntry = EdgeTopoRef | string

/** 面选择器参数的一个条目：选择器字符串或 `FaceTopoRef`。 */
export type FaceSelectorEntry = FaceTopoRef | string

/**
 * 展开 op 的边选择器参数（顶层字符串或数组元素字符串）到 `EdgeTopoRef[]`。
 *
 * 形态（方案 D2-A）：`edges: "|Z"`、`edges: ["|Z"]`、`edges: ["|Z", refA]` 均可。
 * 数组里的 `EdgeTopoRef` 原样保留；字符串逐个经桥解析（保持出现顺序）。
 *
 * @param shape - 目标几何（BREP 实体所在的 Shape）。
 * @param edges - 边选择器参数（字符串 = 单一选择器；数组元素可为选择器字符串或 EdgeTopoRef）。
 * @returns 展开后的 `EdgeTopoRef[]`。
 */
export function expandEdgeSelectorRefs(
  shape: Shape,
  edges: EdgeSelectorEntry[] | string,
): EdgeTopoRef[] {
  if (typeof edges === 'string') return resolveSelectorToEdgeRefs(shape, edges)
  return edges.flatMap((e) => (typeof e === 'string' ? resolveSelectorToEdgeRefs(shape, e) : [e]))
}

/**
 * 展开 op 的面选择器参数（顶层字符串或数组元素字符串）到 `FaceTopoRef[]`。
 *
 * 形态（方案 D2-A）：`openFaces: ">Z"`、`faces: ["|Z"]`、`faces: ["|Z", refA]` 均可。
 *
 * @param shape - 目标几何（BREP 实体所在的 Shape）。
 * @param faces - 面选择器参数（字符串 = 单一选择器；数组元素可为选择器字符串或 FaceTopoRef）。
 * @returns 展开后的 `FaceTopoRef[]`。
 */
export function expandFaceSelectorRefs(
  shape: Shape,
  faces: FaceSelectorEntry[] | string,
): FaceTopoRef[] {
  if (typeof faces === 'string') return resolveSelectorToFaceRefs(shape, faces)
  return faces.flatMap((f) => (typeof f === 'string' ? resolveSelectorToFaceRefs(shape, f) : [f]))
}
