/**
 * capture-topo-ref.ts — 由命名行构造 TopoRef（§3.7 根门面导出，纯函数、不含前端状态）
 *
 * 宿主拾取到 Reference（序号）→ 经 ExecutionResult.naming 定位命名行 →
 * captureTopoRef(row) → 可直接塞进 op 参数的 TopoRef。
 * ReferenceId/ordinal 的解析与命名行定位由宿主完成（§6.1），本函数只做纯构造。
 */

import { TopoRefError, type EdgeNaming, type FaceNaming, type TopoRef } from './types'

/** 结构守卫：EdgeNaming（hint.kind === 'edge'）。 */
function isEdgeNaming(row: FaceNaming | EdgeNaming): row is EdgeNaming {
  return row.hint.kind === 'edge'
}

/**
 * 由命名行构造 TopoRef。
 *
 * - FaceNaming → FaceTopoRef{kind:'face', origin, role, hint}；
 * - EdgeNaming → EdgeTopoRef{kind:'edge', faces, hint}。
 *
 * EdgeNaming.faces 为 null（mesh 无邻接，§5.3 能力边界）时无法构造 lineage，
 * 显式抛 TopoRefError（E_TOPO_NOT_FOUND）——绝不静默产出残缺引用。
 *
 * @param row - the naming row (face or edge) to convert.
 * @returns the corresponding TopoRef.
 */
export function captureTopoRef(row: FaceNaming | EdgeNaming): TopoRef {
  if (isEdgeNaming(row)) {
    if (!row.faces) {
      throw new TopoRefError(
        'E_TOPO_NOT_FOUND',
        'edge',
        'edge naming has no adjacent-face lineage (mesh limitation)',
      )
    }
    return { kind: 'edge', faces: row.faces, hint: row.hint }
  }
  // Phase 1.6/1.8：无身份行（origin/role=null，mesh 或未追踪面）不能构造 FaceTopoRef
  // ——身份字段是引用的主键，伪造空值正是被删除的静默降级（G6）。
  if (row.origin === null || row.role === null) {
    throw new TopoRefError(
      'E_TOPO_NOT_FOUND',
      'face',
      'face naming row has no identity (mesh path or untracked face on the BREP chain)',
    )
  }
  return { kind: 'face', origin: row.origin, role: row.role, hint: row.hint }
}
