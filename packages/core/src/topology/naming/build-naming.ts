/**
 * build-naming.ts — ExecutionResult.naming 生成（§3.7）
 *
 * 从「part 的面行 + RoleTable」生成 FaceNaming/EdgeNaming 命名行，供宿主 O(1)
 * 反查（拾取序号 → 命名行 → captureTopoRef）。序号(1起) ↔ 数组下标。
 *
 * Phase 1.6/1.7 换型（§4.1/§4.2）：
 * - RoleTable 外层键与 naming 行的 origin 一律是 **StmtId**（不再 PartName）。
 * - role 是 RoleName 的线格式串（无 'box:' 前缀）。
 * - **无身份面显式 `role: null`**——`''` 静默兜底已删（G6）；mesh 来源只填 hint。
 */

import type { StmtId, PartName } from '../../identity'
import type { RoleTable, FaceNaming, EdgeNaming, PartNaming, RoleQualifier } from './types'
import { faceRowToHint, edgeRowToHint } from './geom-hint'
import { roleOfOrdinal } from './roles'

/** 面的源行数据（FaceRow 子集，够生成 hint + 反查）。axis 为宿主注入的轴快照（装配轴约束用）。 */
export interface NamingFaceRow {
  readonly surfaceType?: string
  readonly normal?: readonly number[] | null
  readonly center?: readonly number[] | null
  readonly area?: number
  readonly axis?: { readonly origin?: readonly number[] | null; readonly direction?: readonly number[] | null } | null
}

/** 边的源行数据（EdgeRow 子集）。axis 为直边/圆边的轴快照（装配轴约束用）。 */
export interface NamingEdgeRow {
  readonly length?: number
  readonly center?: readonly number[] | null
  readonly axis?: { readonly origin?: readonly number[] | null; readonly direction?: readonly number[] | null } | null
}

/** 生成 PartNaming 的输入。 */
export interface PartNamingInput {
  readonly source: 'brep' | 'primitive' | 'mesh'
  /** 该 part 变量名（仅 UI 显示兜底用；身份一律走 roleTable 的 StmtId）。 */
  readonly partName: PartName
  /** 面命名源行（序号 1 起 ↔ 数组下标 0 起）。 */
  readonly faces: readonly NamingFaceRow[]
  /** 边命名源行（序号 1 起 ↔ 数组下标 0 起）。 */
  readonly edges: readonly NamingEdgeRow[]
  /** BREP：RoleTable（可能多 origin，键=StmtId）；mesh/primitive 缺省。 */
  readonly roleTable?: RoleTable
  /** BREP：subShapeHashes(shape,'face')，序号 → hash 对照（roleOfOrdinal 用）。 */
  readonly ordinalToHash?: readonly number[]
  /** 每条边的两邻面序号（1 起；来自 manifest faceEdgeRows/edgeFaceRows）。mesh 无邻接 → undefined。 */
  readonly edgeFaceOrdinals?: ReadonlyArray<readonly [number, number] | null>
}

/**
 * 逐 origin 反查一个面的 {origin, role}（布尔合流后 RoleTable 含多个 origin）。
 *
 * @param table - the RoleTable (may have several origins after a boolean merge; keys are StmtId strings).
 * @param ordinalToHash - ordinal → hash array (subShapeHashes).
 * @param ordinal - the face ordinal (1-based).
 * @returns the owning origin (StmtId) and role, or undefined when no origin tracks it.
 */
export function findOriginRole(
  table: RoleTable,
  ordinalToHash: readonly number[],
  ordinal: number,
): { origin: StmtId; role: string } | undefined {
  for (const [origin, roles] of table) {
    const role = roleOfOrdinal(roles, ordinalToHash, ordinal)
    if (role !== undefined) return { origin: origin as StmtId, role }
  }
  return undefined
}

/**
 * 生成一个 part 的命名数据（§3.7 ExecutionResult.naming 元素）。
 *
 * Phase 1.8（D6）：mesh 伪拓扑已删——primitive/mesh 来源**不再派生 role**
 * （拓扑身份是 BREP 专有能力，§3）；primitive 分支与 mesh 一致只填 hint。
 * G6：无身份面显式 `role: null`（`''` 兜底已删）。
 *
 * @param input - the part naming input.
 * @returns the PartNaming rows.
 */
export function buildPartNaming(input: PartNamingInput): PartNaming {
  const { source } = input
  const faceNaming: FaceNaming[] = []
  input.faces.forEach((row, i) => {
    const hint = faceRowToHint(row)
    if (source === 'brep' && input.roleTable && input.ordinalToHash) {
      const found = findOriginRole(input.roleTable, input.ordinalToHash, i + 1)
      if (found) {
        faceNaming.push({ origin: found.origin, role: found.role, hint })
        return
      }
      // BREP 链上未追踪的面：显式无身份（G6——不再伪造 role=''）
      faceNaming.push({ origin: null, role: null, hint })
      return
    }
    // primitive / mesh：拓扑身份是 BREP 专有能力（§3/D6）——只填 hint，origin/role 显式 null
    faceNaming.push({ origin: null, role: null, hint })
  })

  const edgeNaming: EdgeNaming[] = input.edges.map((row, i) => {
    const hint = edgeRowToHint(row)
    const pair = input.edgeFaceOrdinals?.[i]
    if (pair && input.roleTable && input.ordinalToHash) {
      const a = findOriginRole(input.roleTable, input.ordinalToHash, pair[0])
      const b = findOriginRole(input.roleTable, input.ordinalToHash, pair[1])
      if (a && b) {
        const qa: RoleQualifier = { origin: a.origin, role: a.role }
        const qb: RoleQualifier = { origin: b.origin, role: b.role }
        return { faces: [qa, qb], hint }
      }
    }
    return { faces: null, hint }
  })

  return { source, faceNaming, edgeNaming }
}
