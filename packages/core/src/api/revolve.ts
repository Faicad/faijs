/**
 * revolve — 手写平台 op（E3 / Q13 路线①的 revolve 实例）
 *
 * 生成投影（`api/generated/operations.ts` 的 revolve）是 compat op：几何由
 * vendored brepjs 承载，但**没有可挂面命名的代码位置**，产物不带 roleTable，
 * 下游 `cad.edgeRef` 抛 "nameless shape"（ModelFromV021 缺陷）。
 *
 * 本文件按 `cut` 覆盖生成投影的同一先例（`api-namespace.ts`），用 defineOp 包住
 * 投影调用，并在产物登记处建链根 roleTable（origin = 语句 StmtId，与
 * `extrude.ts` / `import-brep.ts` 同源机制）。
 *
 * 词汇表沿用生成 spec 的 construct 声明：`bottom` / `top`（旋转轴两端的平面
 * 端面）+ `wall:<i>`（其余侧面，按枚举序）。判定口径与 extrude 相同——现场
 * 几何是唯一真值：平面法向与轴 |cos| ≈ 1 → 端面，按中心沿轴坐标分 bottom/top；
 * 其余（含圆柱等曲面侧面）→ wall:i。无法分类的面不进表（缺身份是显式状态）。
 */

import type { Shape } from '../mesh/types'
import { defineOp } from '../sdk'
import { getBackends, getCurrentStmt } from '../runtime-state'
import { brepOf } from '../shape'
import { adoptEntity, callBrepjs } from './internal/l3-bridge'
import { borrowDeep } from './internal/compat-op'
import { unwrapResult } from './internal/result-unwrap'
import { runtimeLineage } from '../topology/naming/lineage'
import { revolve as vendoredRevolve } from '../vendored/brepjs/operations/api.js'
import { formatRoleName, semantic, wall } from '../topology/naming/role-name'
import type { BrepEngineApi } from '../brep/engine/primitives'
import type { BrepHandle } from '../brep/engine/types'

/**
 * revolve 的 construct 词汇表：`bottom` / `top`（旋转轴两端的平面端面）+ `wall:<i>`。
 * 判定口径见 {@link revolveConstructRoles}。
 */

/** options.axis 的宽松形态（数组或 {x,y,z}）。 */
function axisVec(v: unknown): readonly [number, number, number] {
  if (Array.isArray(v) && v.length >= 3 && v.every((n) => typeof n === 'number')) {
    return [v[0]!, v[1]!, v[2]!]
  }
  if (typeof v === 'object' && v !== null && 'x' in (v as object)) {
    const o = v as { x: number; y: number; z: number }
    return [o.x, o.y, o.z]
  }
  return [0, 0, 1]
}

/**
 * revolve 的 construct 词汇枚举器（与 `extrudeConstructRoles` 同口径，轴来源不同：
 * extrude 从端面法向对差反推，revolve 直接用调用点声明的旋转轴）。
 *
 * @param kernel - the OCCT kernel.
 * @param solid - the revolved solid.
 * @param axis - the revolution axis (call-site declared; default [0,0,1]).
 * @returns role（线格式串）→ hash 子表。
 */
function revolveConstructRoles(
  kernel: BrepEngineApi,
  solid: BrepHandle,
  axisOpt: unknown,
): Map<string, number[]> {
  const roles = new Map<string, number[]>()
  const faceHandles = kernel.getSubShapes(solid, 'face')
  try {
    const hashes = kernel.subShapeHashes(solid, 'face', 2147483647)
    const [ax0, ax1, ax2] = axisVec(axisOpt)
    const axLen = Math.hypot(ax0, ax1, ax2)
    if (axLen < 1e-9) return roles
    const ax: readonly [number, number, number] = [ax0 / axLen, ax1 / axLen, ax2 / axLen]

    const caps: { idx: number; t: number }[] = []
    const isPlaneCap: boolean[] = faceHandles.map((f) => {
      if (kernel.surfaceType(f) !== 'plane') return false
      const uv = kernel.uvBounds(f)
      const n = kernel.surfaceNormal(f, (uv.uMin + uv.uMax) / 2, (uv.vMin + uv.vMax) / 2)
      const len = Math.hypot(n.x, n.y, n.z) || 1
      const cos = Math.abs(n.x * ax[0]! + n.y * ax[1]! + n.z * ax[2]!) / len
      return cos > 0.999
    })
    for (let i = 0; i < faceHandles.length; i++) {
      if (hashes[i] === undefined) continue
      if (isPlaneCap[i]) {
        const c = kernel.getSurfaceCenterOfMass(faceHandles[i]!)
        caps.push({ idx: i, t: c.x * ax[0]! + c.y * ax[1]! + c.z * ax[2]! })
      }
    }
    if (caps.length >= 2) {
      // 常规旋转体：轴两端平面端面 = bottom/top，其余面（含曲面侧面）wall:<i>
      let wallIdx = 0
      for (let i = 0; i < faceHandles.length; i++) {
        const hash = hashes[i]
        if (hash === undefined || isPlaneCap[i]) continue
        roles.set(formatRoleName(wall(wallIdx)), [hash])
        wallIdx++
      }
      caps.sort((p, q) => p.t - q.t)
      roles.set(formatRoleName(semantic('bottom')), [hashes[caps[0]!.idx]!])
      roles.set(formatRoleName(semantic('top')), [hashes[caps[caps.length - 1]!.idx]!])
    } else {
      // GOTCHA（退化形态，2026-09-23）：轮廓面在轴平面内（如 XY 草图绕 Z 转）
      // 时产物的面法向全部 ∥ 轴 → caps 判不出两端。此时退化为按枚举序
      // wall:<i> 命名全部面——身份是能力，退化形态不给名字就会重演 nameless
      // shape 缺陷；枚举序稳定（同 extrude 的 wall 序依据）。
      for (let i = 0; i < faceHandles.length; i++) {
        const hash = hashes[i]
        if (hash === undefined) continue
        roles.set(formatRoleName(wall(i)), [hash])
      }
    }
    return roles
  } finally {
    for (const h of faceHandles) {
      try { kernel.release(h) } catch { /* 已释放 */ }
    }
  }
}

/**
 * 旋转成形：把平面轮廓绕轴旋转（兼容生成投影签名）。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name revolve
 * @param face - 平面轮廓。type:Shape required:true
 * @param options - 旋转轴/点/角度（透传 vendored 语义）。type:RevolveOptions
 * @returns Shape 旋转体（带链根 roleTable：bottom/top/wall:i）。
 * @example
 * const p1 = await cad.revolve(part0, { axis: [0, 0, 1], at: [0, 0, 0], angle: 6.283185307179586 })
 */
export const revolve = defineOp({
  brep: async (face: Shape, options?: { axis?: unknown }) => {
    // vendored 语义经 l3-bridge 三步桥接（与 compatOp 的 adapter 相同步骤，
    // 但在这里执行以便在**同一处**收编产物并建链根 roleTable——compatOp 的
    // 自动 adoptOut 会先登记一次，二次 fromBrep 会让 edgeRef 读到残缺表）。
    const value = unwrapResult(
      await callBrepjs(vendoredRevolve as never, [borrowDeep(face, 0), borrowDeep(options ?? {}, 0)]),
      'revolve',
    )
    const s = adoptEntity(value, 'revolve') as Shape
    const kernel = getBackends().kernel.brep as BrepEngineApi | null
    const handle = kernel ? (brepOf(s) as BrepHandle | undefined) : undefined
    if (!kernel || !handle) return s
    // E3（Q13 路线①）：链根建 roleTable，origin = 语句 StmtId（Phase 1.6 口径）。
    // GOTCHA（2026-09-23）：不能对 adoptEntity 的产物再走一次 fromBrep——同语句的
    // registeredStmtId 去重会让第二次登记被吞（探针实测：outputTables 里没有本
    // 语句键）。直接经 runtimeLineage.recordOutput 落语句键表；define-op 包装层
    // 会在 impl 返回后把它传播到 part 键权威位（edgeRef 的读口）。
    const origin = String(getCurrentStmt()?.id ?? '')
    const table = new Map([[origin, revolveConstructRoles(kernel, handle, options?.axis)]])
    // GOTCHA：recordOutput 必须带第 4 参 part——part 键表（outputTablesByPart）
    // 是 op 实现与 edgeRef 解析的权威读口，只落语句键表时 part 键会保持
    // adoptEntity 时登记的空表（探针实测），下游仍报 no role lineage。
    const part = getCurrentStmt()?.outputs?.[0]
    runtimeLineage.recordOutput(origin as never, table, handle, part as never)
    return s
  },
  naming: {
    kind: 'construct',
    newFaces: {
      via: 'explicit',
      vocab: [
        { kind: 'semantic', name: 'top' },
        { kind: 'semantic', name: 'bottom' },
        { kind: 'wall', index: 0 },
      ],
    },
  } as never,
})
