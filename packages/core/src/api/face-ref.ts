/**
 * stdlib face-ref — 面引用查询：把「面序号」解析成 `FaceTopoRef`（1 起）
 *
 * extrude 的 `upTo` 参数（拉伸到面，PadTest UpToFace 链路）需要指向
 * 「某个实体上第 N 张面」的引用。外部格式（FCStd 的 `UpToFace` LinkSub 等）
 * 只给序号，本模块与 `edge-ref.ts` 同构：在内核现场枚举里取第 N 张面，
 * 经输入 Shape 的命名槽（RoleTable + subShapeHashes）反查它的
 * `{origin, role}` 血统，合成 `FaceTopoRef`。
 *
 * 序号语义（GOTCHA）：与 `edgeRef` 一致，1 起 == FreeCAD 的 `FaceN`
 * （`getSubShapes(solid,'face')` 用 TopExp::MapShapes + IndexedMap 枚举，
 * 与 `edge-ref.ts` 头注同源已记档）。
 *
 * 纯查询：同步、无副作用、不改 Shape；定不了案一律抛 `TopoRefError`，
 * 绝不静默拿序号硬取。
 */

import type { Shape } from '../mesh/types'
import { getBackends } from '../runtime-state'
import { brepOf } from '../shape'
import type { BrepEngineApi } from '../brep/engine/primitives'
import { captureFaceHint, findOriginRole, TopoRefError } from '../topology/naming'
import type { FaceTopoRef } from '../topology/naming'
import { buildEdgeResolutionContext } from './topo-resolve'

/**
 * 查询几何体第 N 张面的 `FaceTopoRef`，供 `cad.extrude` 的 `upTo` 等参数使用：
 * `cad.extrude(part0, { upTo: cad.faceRef(part0, 3) })`。
 *
 * 定不了案（无 BREP / 序号越界 / 面无 role 血统）抛 `TopoRefError`。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name faceRef
 * @returns FaceTopoRef 该面的拓扑引用（origin/role 血统 + 几何 hint）。
 * @param of - 目标几何（BREP 实体所在的 Shape）。type:Shape required:true
 * @param faceOrdinal - 面序号（1 起；等于 FreeCAD 的 `FaceN`）。type:number required:true
 * @note 序号 1 起，与命名层 `TopoRef.ordinal` 及 FreeCAD `FaceN` 同序（`getSubShapes(solid,'face')` 用 TopExp::MapShapes + IndexedMap 枚举）。
 * @example
 * const part1 = cad.extrude(sk, { upTo: cad.faceRef(part0, 3) })
 */
export function faceRef(of: Shape, faceOrdinal: number): FaceTopoRef {
  if (!Number.isInteger(faceOrdinal) || faceOrdinal < 1) {
    throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', `faceRef: faceOrdinal must be an integer >= 1 (got ${faceOrdinal})`)
  }
  const kernel = getBackends().kernel.brep as BrepEngineApi | null
  if (!kernel) throw new Error('[faceRef] no BREP kernel (face references are BREP-only)')
  if (!brepOf(of)) throw new Error('[faceRef] E_FACE_REF_NO_BREP: input shape has no BREP solid')

  const ctx = buildEdgeResolutionContext(kernel, of as object)
  if (!ctx) throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', 'faceRef: input has no BREP naming context')

  const face = ctx.faces.find((f) => f.ordinal === faceOrdinal)
  if (!face || face.handle === undefined) {
    throw new TopoRefError(
      'E_TOPO_NOT_FOUND',
      'face',
      `faceRef: face ordinal ${faceOrdinal} out of range [1, ${ctx.faces.length}]`,
    )
  }

  const table = ctx.roleTable
  if (!table) {
    throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', 'faceRef: input shape has no role table (nameless shape)')
  }
  const found = findOriginRole(table, ctx.faces.map((f) => f.hash ?? 0), faceOrdinal)
  if (!found) {
    throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', `faceRef: face ordinal ${faceOrdinal} has no role lineage`)
  }

  return { kind: 'face', origin: found.origin, role: found.role, hint: captureFaceHint(kernel, face.handle) }
}
