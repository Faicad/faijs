/**
 * roles.ts — RoleTable 的生命周期纯逻辑（§3.2/§3.3/§3.4 移植 + 改造）
 *
 * - `assignRoles`：链根建表。语义优先（box/cylinder/cone/sphere 按法向/曲面类型
 *   给稳定名）、位置兜底（`${opType}:face_${i}`，保证每面必有 role）。
 * - `propagateRoles`：沿一次 hash 演化推进表（移植 brepjs updateRoles/nextHashes：
 *   deleted 丢弃、modified 全部后继替换、未变保留；generated 刻意不消费）。
 * - `mergeRoleTables`：布尔合流——A/B 两个来源的表各自传播后合并，缝面以本次
 *   语句 LHS 为新 origin 给位置名（§3.4）。
 * - `roleOfOrdinal`：序号 → role 反查（§3.7 生成 ExecutionResult.naming 用）。
 */

import type { BrepEngineApi } from '../../brep/engine/primitives'
import type { BrepHandle } from '../../brep/engine/types'
import type { HashEvolution } from '../../brep/face-evolution'
import type { PartName } from '../../identity'
import type { RoleTable } from './types'
import { captureFaceHint } from './geom-hint'

/** 主轴判定阈值：abs(component) > 0.9 视为轴对齐。 */
export const AXIS_THRESHOLD = 0.9

/** Re-export：hash 键演化（decodeHashEvolution 产出，见 brep/face-evolution.ts §2.4）。 */
export type { HashEvolution }

// ── 语义命名器（§3.2：faijs 单位/轴向契约，mm、+Z 向上）──

/**
 * box 面：按外法向主轴给语义名。
 *
 * @param n - the outward normal of the face (unit length expected).
 * @returns the cardinal role ('box:top' etc.), or undefined when no axis dominates.
 */
export function boxRoleFromNormal(n: readonly [number, number, number]): string | undefined {
  if (n[2] > AXIS_THRESHOLD) return 'box:top'
  if (n[2] < -AXIS_THRESHOLD) return 'box:bottom'
  if (n[1] > AXIS_THRESHOLD) return 'box:back'
  if (n[1] < -AXIS_THRESHOLD) return 'box:front'
  if (n[0] > AXIS_THRESHOLD) return 'box:right'
  if (n[0] < -AXIS_THRESHOLD) return 'box:left'
  return undefined
}

/** Z 轴端盖名：'+Z → :top'、'-Z → :bottom'（仅平面）。 */
function axialCapName(prefix: string, surfaceType: string, z: number): string | undefined {
  if (surfaceType !== 'plane') return undefined
  if (z > AXIS_THRESHOLD) return `${prefix}:top`
  if (z < -AXIS_THRESHOLD) return `${prefix}:bottom`
  return undefined
}

/** cylinder（Z 轴）：端盖 + 侧立面。 */
function cylinderRole(surfaceType: string, z: number): string | undefined {
  return surfaceType === 'cylinder' ? 'cylinder:lateral' : axialCapName('cylinder', surfaceType, z)
}

/** cone（Z 轴）：端盖 + 侧立面。 */
function coneRole(surfaceType: string, z: number): string | undefined {
  return surfaceType === 'cone' ? 'cone:lateral' : axialCapName('cone', surfaceType, z)
}

/** sphere：单球面。 */
function sphereRole(surfaceType: string): string | undefined {
  return surfaceType === 'sphere' ? 'sphere:surface' : undefined
}

/** 每基本体的语义命名器，按 opType 键控。 */
const ROLE_ASSIGNERS: Record<string, (surfaceType: string, normal: readonly [number, number, number]) => string | undefined> = {
  box: (_surfaceType, normal) => boxRoleFromNormal(normal),
  cylinder: (surfaceType, normal) => cylinderRole(surfaceType, normal[2]),
  cone: (surfaceType, normal) => coneRole(surfaceType, normal[2]),
  sphere: (surfaceType, _normal) => sphereRole(surfaceType),
}

/**
 * 给链根 shape 建 RoleTable（单个 origin 的表；§3.2）。
 *
 * 语义优先、位置兜底；assign 时只保留 hash + hint，不保留面句柄
 * （避免 wasm 句柄生命周期泄漏——读完几何量即弃）。
 *
 * @param kernel - the OCCT kernel.
 * @param shape - the chain-root solid (primitive / load STEP 产物).
 * @param opType - the chain-root operation type ('box'/'cylinder'/... 或 part 变量名).
 * @returns RoleTable — 只有 origin=opType 一个键（调用方负责包装成多 origin 表）。
 */
export function assignRoles(
  kernel: BrepEngineApi,
  shape: BrepHandle,
  opType: string,
): Map<string, number[]> {
  const roles = new Map<string, number[]>()
  const assigner = ROLE_ASSIGNERS[opType]
  const faceHandles = kernel.getSubShapes(shape, 'face')
  const hashes = kernel.subShapeHashes(shape, 'face', 2147483647)
  let index = 0
  for (let i = 0; i < faceHandles.length; i++) {
    const hint = captureFaceHint(kernel, faceHandles[i])
    const normal = hint.normal ?? [0, 0, 1]
    const surfaceType = hint.surfaceType ?? ''
    const semantic = assigner?.(surfaceType, normal)
    const role =
      semantic !== undefined && !roles.has(semantic)
        ? semantic
        : `${opType}:face_${index}`
    roles.set(role, [hashes[i]])
    index++
  }
  return roles
}

/**
 * 把一个 role 的 hash 列表推进一个演化步（移植 brepjs nextHashes）：
 * deleted 丢弃、modified 全部后继替换（1→多保留全部分片）、未变保留。
 *
 * @param hashes - the role's current face hashes.
 * @param evolution - the hash-keyed evolution record.
 * @returns the successor hashes.
 */
export function nextHashes(hashes: readonly number[], evolution: HashEvolution): number[] {
  const successors: number[] = []
  for (const hash of hashes) {
    if (evolution.deleted.has(hash)) continue
    const modified = evolution.modified.get(hash)
    const targets = modified !== undefined && modified.length > 0 ? modified : [hash]
    for (const h of targets) if (!successors.includes(h)) successors.push(h)
  }
  return successors
}

/**
 * 沿一次 hash 演化推进某个 origin 的 role 表（移植 brepjs updateRoles）。
 *
 * generated 刻意不消费（§1.3 事实：occt 系 generated hash 指向中间形、实测 0 存活）；
 * 生成面由 DerivedFaceTopoRef 以 lineage 命名。
 *
 * @param roles - the input role table (may be the single-origin map or full table).
 * @param origin - the origin whose roles to advance.
 * @param evolution - the hash-keyed evolution record for this op.
 * @returns a NEW RoleTable with the origin's roles advanced (immutable style).
 */
export function propagateRoles(
  roles: RoleTable,
  origin: PartName,
  evolution: HashEvolution,
): RoleTable {
  const originRoles = roles.get(origin)
  if (!originRoles) return roles
  const updated = new Map<string, number[]>()
  for (const [role, hashes] of originRoles) {
    const successors = nextHashes(hashes, evolution)
    if (successors.length > 0) updated.set(role, successors)
  }
  const result = new Map<PartName, ReadonlyMap<string, readonly number[]>>()
  for (const [key, value] of roles) {
    result.set(key, key === origin ? updated : value)
  }
  return result
}

/**
 * 布尔合流：合并两个来源的 role 表（§3.4，faijs 对 brepjs 的必要扩展）。
 *
 * 对 A、B 两张 hash 演化分别传播各自的表后合并；布尔新生成的缝面/刃面
 * 以本次布尔语句的 LHS 变量名（= outPart）为新 origin，位置名命名。
 *
 * @param targetTable - the target part's role table.
 * @param targetEvo - the target-side hash evolution (A 的 inHash 去向).
 * @param toolTable - the tool part's role table.
 * @param toolEvo - the tool-side hash evolution (B 的 inHash 去向).
 * @param outPart - the boolean statement's LHS variable name (new origin for seam faces).
 * @param seamCount - how many seam/generated faces to name positionally (0 表示不补).
 * @returns the merged RoleTable.
 */
export function mergeRoleTables(
  targetTable: RoleTable,
  targetEvo: HashEvolution,
  toolTable: RoleTable,
  toolEvo: HashEvolution,
  outPart: PartName,
  seamCount: number,
): RoleTable {
  const result = new Map<PartName, ReadonlyMap<string, readonly number[]>>()
  for (const [origin, roles] of targetTable) {
    const advanced = new Map<string, number[]>()
    for (const [role, hashes] of roles) {
      const successors = nextHashes(hashes, targetEvo)
      if (successors.length > 0) advanced.set(role, successors)
    }
    result.set(origin, advanced)
  }
  for (const [origin, roles] of toolTable) {
    if (result.has(origin)) {
      // 同一 origin 出现在两侧（理论上罕见：同一变量两次输入）——按 tool 侧演化推进后合并。
      const existing = result.get(origin)!
      const advanced = new Map<string, number[]>()
      for (const [role, hashes] of roles) {
        const successors = nextHashes(hashes, toolEvo)
        if (successors.length > 0) advanced.set(role, successors)
      }
      const merged = new Map<string, number[]>(existing as Map<string, number[]>)
      for (const [role, hs] of advanced) {
        const prev = merged.get(role)
        merged.set(role, prev ? [...new Set([...prev, ...hs])] : hs)
      }
      result.set(origin, merged)
    } else {
      const advanced = new Map<string, number[]>()
      for (const [role, hashes] of roles) {
        const successors = nextHashes(hashes, toolEvo)
        if (successors.length > 0) advanced.set(role, successors)
      }
      result.set(origin, advanced)
    }
  }
  if (seamCount > 0) {
    const seamRoles = new Map<string, number[]>()
    for (let i = 0; i < seamCount; i++) seamRoles.set(`${outPart}:face_${i}`, [])
    result.set(outPart, seamRoles)
  }
  return result
}

/**
 * 布尔缝面/刃面的位置名角色表（§3.4：以本次语句 LHS 为新 origin）。
 * 缝面的 hash 来自结果形状的 subShapeHashes（按生成序），此处仅分配 role 名——
 * hash 由调用方在拿到结果 shape 后填入（seam 面 hash 需结果 subShapeHashes 对照）。
 *
 * @param outPart - the boolean statement's LHS variable name.
 * @param count - the number of seam faces to name.
 * @returns a single-origin role map with positional roles.
 */
export function assignGeneratedPositionalRoles(outPart: string, count: number): Map<string, number[]> {
  const roles = new Map<string, number[]>()
  for (let i = 0; i < count; i++) roles.set(`${outPart}:face_${i}`, [])
  return roles
}

/**
 * 序号 → role 反查（§3.7 生成 ExecutionResult.naming 用）。
 *
 * 反查需要「序号 → hash」对照：subShapeHashes(shape,'face',B) 的数组下标 i 对应
 * 序号 i+1（§1.1 事实：getSubShapes ↔ subShapeHashes 同走 TopExp::MapShapes、
 * 逐位同序）。调用方传入该对照数组 + 该 origin 的 role 表，返回第 ordinal 个面
 * 的 role 名；不在表中 → undefined。
 *
 * @param roles - the role table for a single origin (role → hash list).
 * @param ordinalToHash - subShapeHashes(shape,'face') 数组：下标 i ↔ 序号 i+1 的 hash。
 * @param ordinal - the face ordinal (1-based).
 * @returns the role name, or undefined when the ordinal isn't tracked.
 */
export function roleOfOrdinal(
  roles: ReadonlyMap<string, readonly number[]>,
  ordinalToHash: readonly number[],
  ordinal: number,
): string | undefined {
  const hash = ordinalToHash[ordinal - 1]
  if (hash === undefined) return undefined
  for (const [role, hashes] of roles) {
    if (hashes.includes(hash)) return role
  }
  return undefined
}
