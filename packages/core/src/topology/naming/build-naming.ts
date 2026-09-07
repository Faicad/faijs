/**
 * build-naming.ts — ExecutionResult.naming 生成（§3.7）
 *
 * 从「part 的面行 + RoleTable」生成 FaceNaming/EdgeNaming 命名行，供宿主 O(1)
 * 反查（拾取序号 → 命名行 → captureTopoRef）。序号(1起) ↔ 数组下标。
 *
 * - BREP：roleTable + roleOfOrdinal 反查每个面的 {origin, role}（布尔合流后
 *   一张表可能含多个 origin，逐 origin 反查）；hint 取自面行（与 BREP 现场
 *   同口径，见 geom-hint.ts）。
 * - primitive：role 由固定面序的语义命名器给出（M4 §5.2 接入；本函数留
 *   primitiveRoles 参数，M4 填充）。
 * - mesh：只填 hint、role=''、origin=该 part（§5.3：只能几何兜底）。
 */

import type { PartName } from '../../identity'
import type { RoleTable, FaceNaming, EdgeNaming, PartNaming } from './types'
import { faceRowToHint, edgeRowToHint } from './geom-hint'
import { roleOfOrdinal, boxRoleFromNormal } from './roles'

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
  /** 该 part 变量名（mesh/primitive 的 origin 兜底；BREP 用 role 的 origin）。 */
  readonly partName: PartName
  /** 面命名源行（序号 1 起 ↔ 数组下标 0 起）。 */
  readonly faces: readonly NamingFaceRow[]
  /** 边命名源行（序号 1 起 ↔ 数组下标 0 起）。 */
  readonly edges: readonly NamingEdgeRow[]
  /** BREP：RoleTable（可能多 origin）；mesh/primitive 缺省。 */
  readonly roleTable?: RoleTable
  /** BREP：subShapeHashes(shape,'face')，序号 → hash 对照（roleOfOrdinal 用）。 */
  readonly ordinalToHash?: readonly number[]
  /** primitive：按固定面序的语义 role（M4 填充）；缺省 → role=''。 */
  readonly primitiveRoles?: readonly string[]
  /** 每条边的两邻面序号（1 起；来自 manifest faceEdgeRows/edgeFaceRows）。mesh 无邻接 → undefined。 */
  readonly edgeFaceOrdinals?: ReadonlyArray<readonly [number, number] | null>
}

/**
 * 逐 origin 反查一个面的 {origin, role}（布尔合流后 RoleTable 含多个 origin）。
 *
 * @param table - the RoleTable (may have several origins after a boolean merge).
 * @param ordinalToHash - ordinal → hash array (subShapeHashes).
 * @param ordinal - the face ordinal (1-based).
 * @returns the owning origin and role, or undefined when no origin tracks it.
 */
export function findOriginRole(
  table: RoleTable,
  ordinalToHash: readonly number[],
  ordinal: number,
): { origin: PartName; role: string } | undefined {
  for (const [origin, roles] of table) {
    const role = roleOfOrdinal(roles, ordinalToHash, ordinal)
    if (role !== undefined) return { origin, role }
  }
  return undefined
}

/**
 * 为 primitive 假拓扑按面行几何命名语义 role（§5.2，与 BREP §3.2 同一套命名器）。
 *
 * primitive 无 OCCT solid，用「固定面序 + 面行几何」直接命名：
 * - plane + 法向主轴 → box 语义名（box:top/bottom/front/back/left/right）
 * - cylinder/cone/sphere 曲面 → lateral/surface 语义名
 * - 其余/认不出 → 位置名 `${partName}:face_${i}`（保证每面必有 role）
 *
 * 与 BREP assignRoles 的对照：cube 固定面序（+X,-X,+Y,-Y,+Z,-Z）命名一致
 * （f0→box:right、f1→box:left、f2→box:back、f3→box:front、f4→box:top、f5→box:bottom）。
 *
 * @param faces - the primitive's face rows (fixed enumeration order).
 * @param partName - the part variable name (positional-role prefix).
 * @returns one semantic role per face (same length as faces).
 */
export function assignPrimitiveFaceRoles(
  faces: readonly NamingFaceRow[],
  partName: PartName,
): string[] {
  return faces.map((row, i) => {
    const surfaceType = row.surfaceType
    const normal = row.normal
    if (surfaceType === 'cylinder') return 'cylinder:lateral'
    if (surfaceType === 'cone') return 'cone:lateral'
    if (surfaceType === 'sphere') return 'sphere:surface'
    if (surfaceType === 'plane' && normal && normal.length === 3) {
      const role = boxRoleFromNormal([normal[0], normal[1], normal[2]])
      if (role) return role
    }
    return `${partName}:face_${i}`
  })
}

/**
 * 生成一个 part 的命名数据（§3.7 ExecutionResult.naming 元素）。
 *
 * @param input - the part naming input.
 * @returns the PartNaming rows.
 */
export function buildPartNaming(input: PartNamingInput): PartNaming {
  const { source, partName } = input
  const faceNaming: FaceNaming[] = []
  input.faces.forEach((row, i) => {
    const ordinal = i + 1
    const hint = faceRowToHint(row)
    if (source === 'brep' && input.roleTable && input.ordinalToHash) {
      const found = findOriginRole(input.roleTable, input.ordinalToHash, ordinal)
      if (found) {
        faceNaming.push({ origin: found.origin, role: found.role, hint })
        return
      }
      // BREP 链上面应都被追踪；未命中 → role=''（理论不发生，显式兜底）
      faceNaming.push({ origin: partName, role: '', hint })
      return
    }
    if (source === 'primitive' && input.primitiveRoles) {
      faceNaming.push({ origin: partName, role: input.primitiveRoles[i] ?? '', hint })
      return
    }
    faceNaming.push({ origin: partName, role: '', hint })
  })

  const edgeNaming: EdgeNaming[] = input.edges.map((row, i) => {
    const hint = edgeRowToHint(row)
    const pair = input.edgeFaceOrdinals?.[i]
    if (pair && input.roleTable && input.ordinalToHash) {
      const a = findOriginRole(input.roleTable, input.ordinalToHash, pair[0])
      const b = findOriginRole(input.roleTable, input.ordinalToHash, pair[1])
      if (a && b) {
        return { faces: [{ origin: a.origin, role: a.role }, { origin: b.origin, role: b.role }], hint }
      }
    }
    return { faces: null, hint }
  })

  return { source, faceNaming, edgeNaming }
}
