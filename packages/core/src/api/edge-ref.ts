/**
 * stdlib edge-ref — 边引用查询：把「边序号」解析成 `EdgeTopoRef`（1 起）
 *
 * fillet / chamfer 的选边参数是 `EdgeTopoRef`（相邻两面的 role 对，见
 * `topology/naming`）；而外部格式（FCStd / STEP 编辑器 / 上游特征文件）通常只给
 * 「第 N 条边」。本模块是两者之间的桥：在内核现场枚举里取第 N 条边，再由输入
 * Shape 的命名槽（RoleTable + subShapeHashes）反查它两邻面的 `{origin, role}`，
 * 合成可直接喂给 `cad.fillet` / `cad.chamfer` 的 `EdgeTopoRef`。
 *
 * 序号语义（GOTCHA）：faijs 的 `getSubShapes(solid,'edge')` 与 `wireframe()` 同用
 * `TopExp::MapShapes` + `NCollection_IndexedMap`（`occt-kernel/topologyExt.ts` 已
 * 记档），故第 N 条边 == FreeCAD 的 `EdgeN`（fcstd-port/test/FreeCAD 的
 * external-geo corpus 测试实测 `wireframe.edgeGroups[k] == FreeCAD "Edge(k+1)"`；
 * 2026-09-20 随语料依赖测试迁至 fcstd-port）。这是 FCStd 移植选边的锚点。
 *
 * 与 `faceNormal`（`api/geom.ts`）的差异：`faceNormal` 的 `ordinal` 是 0 起
 * （直接下标 `faces[ordinal]`），而本函数是 1 起——与命名层 `TopoRef` 序号
 * （`ordinal` 1 起，见 `topology/naming/types.ts`）及 FreeCAD `EdgeN` 一致。
 *
 * 纯查询：同步、无副作用、不改 Shape；定不了案一律抛 `TopoRefError`（三态错误码），
 * 绝不静默拿序号硬取。
 */

import type { Shape } from '../mesh/types'
import { getBrepApi } from '../brep/handle-bridge'
import { brepOf } from '../shape'
import { nameOf } from '../runtime-state'
import type { BrepHandle } from '../brep/engine/types'
import { captureEdgeHint, findOriginRole, TopoRefError } from '../topology/naming'
import type { EdgeTopoRef, RoleQualifier } from '../topology/naming'
import { buildEdgeResolutionContext, recoverEdgeFaceRole } from './topo-resolve'

/**
 * 查询几何体第 N 条边的 `EdgeTopoRef`，供 `cad.fillet` / `cad.chamfer` 的 `edges` 使用：
 * `cad.fillet(base, { edges: [cad.edgeRef(base, 17)], radius: 2 })`。
 *
 * 定不了案（无 BREP / 序号越界 / 邻面不足两面 / 邻面无 role 血统）抛 `TopoRefError`。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name edgeRef
 * @returns EdgeTopoRef 该边的拓扑引用（相邻两面 role 对 + length/midpoint hint）。
 * @param of - 目标几何（BREP 实体所在的 Shape）。type:Shape required:true
 * @param edgeOrdinal - 边序号（1 起；等于 FreeCAD 的 `EdgeN`）。type:number required:true
 * @note 序号 1 起，与命名层 `TopoRef.ordinal` 及 FreeCAD `EdgeN` 同序（`getSubShapes(solid,'edge')` 用 TopExp::MapShapes + IndexedMap 枚举）。
 * @example
 * const part1 = cad.fillet(part0, { edges: [cad.edgeRef(part0, 1)], radius: 2 })
 */
export function edgeRef(of: Shape, edgeOrdinal: number): EdgeTopoRef {
  if (!Number.isInteger(edgeOrdinal) || edgeOrdinal < 1) {
    throw new TopoRefError('E_TOPO_NOT_FOUND', 'edge', `edgeRef: edgeOrdinal must be an integer >= 1 (got ${edgeOrdinal})`)
  }
  const kernel = getBrepApi()
  // Phase 1.9（D6/§3）：mesh 路径不支持拓扑引用——静态判定、显式抛错，不静默降级
  if (!kernel) {
    throw new TopoRefError('E_TOPO_MESH_UNSUPPORTED', 'edge', 'edgeRef: topology references are BREP-only (mesh path unsupported)')
  }
  if (!brepOf(of)) {
    throw new TopoRefError('E_TOPO_MESH_UNSUPPORTED', 'edge', 'edgeRef: input shape has no BREP solid (mesh shapes do not carry topology identity)')
  }

  const ctx = buildEdgeResolutionContext(kernel, of as object)
  if (!ctx) throw new TopoRefError('E_TOPO_NOT_FOUND', 'edge', 'edgeRef: input has no BREP naming context')

  const edge = ctx.edges?.find((e) => e.ordinal === edgeOrdinal)
  if (!edge || edge.handle === undefined) {
    throw new TopoRefError(
      'E_TOPO_NOT_FOUND',
      'edge',
      `edgeRef: edge ordinal ${edgeOrdinal} out of range [1, ${ctx.edges?.length ?? 0}]`,
    )
  }
  const handle = edge.handle

  // 该边的相邻面（现场：逐面枚举其边，与 handle 同体者即邻面）——不依赖
  // ctx.edgeFaceAdjacency 的数组下标对齐（那里按 liveEdges 过滤后建表）。
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
      `edgeRef: edge ${edgeOrdinal} has ${faceOrdinals.length} adjacent face(s); an EdgeTopoRef needs a two-face pair`,
    )
  }

  const table = ctx.roleTable
  if (!table) {
    throw new TopoRefError('E_TOPO_NOT_FOUND', 'edge', 'edgeRef: input shape has no role table (nameless shape)')
  }
  const ordinalToHash = ctx.faces.map((f) => f.hash ?? 0)
  const quals: RoleQualifier[] = []
  for (const fo of faceOrdinals.slice(0, 2)) {
    let found = findOriginRole(table, ordinalToHash, fo)
    if (!found) {
      // 1.10 前置③ 推广到边路径：目标 part 的 roleTable 缓存残缺，但根节点（名字
      // 诞生处）的表完整、血缘可回走 → 遍历候选 (origin,role) 重算 hash 集找回身份。
      const part = nameOf(of as object)
      if (part) found = recoverEdgeFaceRole(kernel, part, fo, ordinalToHash)
    }
    if (!found) {
      throw new TopoRefError('E_TOPO_NOT_FOUND', 'edge', `edgeRef: adjacent face ordinal ${fo} has no role lineage`)
    }
    quals.push({ origin: found.origin, role: found.role })
  }

  const [qa, qb] = quals as [RoleQualifier, RoleQualifier]
  return { kind: 'edge', faces: [qa, qb], hint: captureEdgeHint(kernel, handle as BrepHandle) }
}
