/**
 * stdlib primitives — 基本体创建库函数（box/sphere/cylinder/cone/wedge）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * dispatchPath 静态判定 brep/mesh，产物经 solid()/fromBrep() 构造器创建。
 */

import type { Shape } from '../mesh/types'
import { cad } from '../mesh'
import { primitiveToBrepSolid } from '../primitives/brep-primitives'
import { solidToShape } from '../brep/brep-ops'
import { getBackends, getCurrentStmt } from '../runtime-state'
import { fromBrep } from '../shape'
import { assignRoles } from '../topology/naming/roles'
import { asPartName } from '../identity'
import { defineOp } from '../sdk'
import { assertPositiveNumber, assertNonNegativeNumber, assertNumberOrVec3 } from './assert'
import type { BrepEngineApi } from '../brep/engine/primitives'

// ── per-op 参数自校验（Phase 2.2；stdlib 被直接 import 时的防御层） ──

/**
 * Validate box parameters: `size` must be a number or vec3 with positive values.
 * @param params - the raw box operation parameters.
 */
export function assertBoxParams(params: Record<string, unknown>): void {
  assertNumberOrVec3(params.size, 'box.size')
}

/**
 * Validate sphere parameters: `radius` must be a positive number.
 * @param params - the raw sphere operation parameters.
 */
export function assertSphereParams(params: Record<string, unknown>): void {
  assertPositiveNumber(params.radius, 'sphere.radius')
}

/**
 * Validate cylinder parameters: `radius` and `height` must be positive numbers.
 * @param params - the raw cylinder operation parameters.
 */
export function assertCylinderParams(params: Record<string, unknown>): void {
  assertPositiveNumber(params.radius, 'cylinder.radius')
  assertPositiveNumber(params.height, 'cylinder.height')
}

/**
 * Validate cone parameters: `radiusBottom` and `height` must be positive,
 * while `radiusTop` must be non-negative.
 * @param params - the raw cone operation parameters.
 */
export function assertConeParams(params: Record<string, unknown>): void {
  assertPositiveNumber(params.radiusBottom, 'cone.radiusBottom')
  assertNonNegativeNumber(params.radiusTop, 'cone.radiusTop')
  assertPositiveNumber(params.height, 'cone.height')
}

/**
 * Validate wedge parameters: `width`, `height`, `angle`, and `length` must be
 * positive numbers.
 * @param params - the raw wedge operation parameters.
 */
export function assertWedgeParams(params: Record<string, unknown>): void {
  assertPositiveNumber(params.width, 'wedge.width')
  assertPositiveNumber(params.height, 'wedge.height')
  assertPositiveNumber(params.angle, 'wedge.angle')
  assertPositiveNumber(params.length, 'wedge.length')
}

/** BREP 路径：OCCT 精确构造 + 三角化 + fromBrep 登记（基本体无面演化；链根建 roleTable）。 */
function primitiveBrep(op: string, params: Record<string, unknown>): Shape {
  const kernel = getBackends().kernel.brep as BrepEngineApi | null
  if (!kernel) throw new Error('[stdlib/box] no OCCT kernel')
  const type = op === 'box' ? 'cube' : op
  const result = primitiveToBrepSolid(kernel, type as 'cube' | 'sphere' | 'cylinder' | 'cone' | 'wedge', params as never)
  // §3.2：链根建表——语义命名器按 op 类型给面命名（'box'→box:top 等，其余位置名兜底）。
  // origin 用链根 part 变量名（当前语句 LHS，§2.2），保证多个同类型 primitive 不撞 origin。
  const origin = String(getCurrentStmt()?.outputs[0] ?? op)
  const roles = assignRoles(kernel, result.solid, op)
  return fromBrep(
    solidToShape(kernel, result.solid, params.segments as number | undefined),
    { solid: result.solid, roleTable: new Map([[asPartName(origin), roles]]) },
  )
}

/**
 * 创建长方体（或立方体）。size 给定三条边：传 number 为等边立方体，传 [x,y,z] 为长方体。
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name box
 * @returns Shape 长方体几何，可作为后续 op 的输入。
 * @param params.size - 尺寸（[x,y,z] 三边或 number 等边）。type:number | [x,y,z] required:true
 * @param params.center - 中心位置。type:[x,y,z] 默认 [0,0,0]（原点）。
 * @example
 * const part0 = cad.box({ size: 20 })
 * const part0 = cad.box({ size: [30, 20, 10], center: [0, 0, 5] })
   */
export const box = defineOp({
  mesh: (params: Record<string, unknown>) => {
    assertBoxParams(params)
    return cad.box(params as never)
  },
  brep: (params: Record<string, unknown>) => {
    assertBoxParams(params)
    return primitiveBrep('box', params)
  },
  // L3 metadata (D2): a creator consumes no shape inputs → operands stay in the
  // timeline; schema feeds codegen/UI parameter panels.
  consumes: 'none',
  schema: { size: 'number | [n,n,n]', center: 'vec3?' },
})

/**
 * 创建球体。
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name sphere
 * @returns Shape 球体几何，可作为后续 op 的输入。
 * @param params.radius - 半径（mm）。type:number required:true
 * @param params.segments - 细分度（影响面数）。type:number 默认 32
 * @param params.center - 球心位置。type:[x,y,z] 默认 [0,0,0]（原点）。
 * @example
 * const r = cad.sphere({ radius: 10 })
 * const r = cad.sphere({ radius: 10, segments: 64, center: [0,0,10] })
  */
export const sphere = defineOp({
  mesh: (params: Record<string, unknown>) => {
    assertSphereParams(params)
    return cad.sphere(params as never)
  },
  brep: (params: Record<string, unknown>) => {
    assertSphereParams(params)
    return primitiveBrep('sphere', params)
  },
})

/**
 * 创建圆柱体。
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name cylinder
 * @returns Shape 圆柱体几何，可作为后续 op 的输入。
 * @param params.radius - 底面半径（mm）。type:number required:true
 * @param params.height - 高度（mm），沿 Z 轴。type:number required:true
 * @param params.segments - 细分度（影响面数）。type:number 默认 32
 * @param params.center - 中心位置。type:[x,y,z] 默认 [0,0,0]（原点）。
 * @example
 * const c = cad.cylinder({ radius: 5, height: 40 })
  */
export const cylinder = defineOp({
  mesh: (params: Record<string, unknown>) => {
    assertCylinderParams(params)
    return cad.cylinder(params as never)
  },
  brep: (params: Record<string, unknown>) => {
    assertCylinderParams(params)
    return primitiveBrep('cylinder', params)
  },
  // L3 metadata (D2): creator consumes no shape inputs.
  consumes: 'none',
  schema: { radius: 'number', height: 'number', segments: 'number?', center: 'vec3?' },
})

/**
 * 创建圆锥体。radiusTop 等于 radiusBottom 时即圆柱。
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name cone
 * @returns Shape 圆锥体几何，可作为后续 op 的输入。
 * @param params.radiusBottom - 底半径（mm）。type:number required:true
 * @param params.radiusTop - 顶半径（mm），可传 0 得尖锥，传等于 radiusBottom 得圆柱。type:number required:true
 * @param params.height - 高度（mm），沿 Z 轴。type:number required:true
 * @param params.segments - 细分度（影响面数）。type:number 默认 32
 * @param params.center - 中心位置。type:[x,y,z] 默认 [0,0,0]（原点）。
 * @example
 * const c = cad.cone({ radiusBottom: 10, radiusTop: 4, height: 30 })
  */
export const cone = defineOp({
  mesh: (params: Record<string, unknown>) => {
    assertConeParams(params)
    return cad.cone(params as never)
  },
  brep: (params: Record<string, unknown>) => {
    assertConeParams(params)
    return primitiveBrep('cone', params)
  },
})

/**
 * 创建楔形体。唯一契约是 width/height/angle/length（width/height/angle 为正数，length 沿切割方向），
 * 旧文档的 size 形态已废弃，传 { size } 会抛错。
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name wedge
 * @note 曾与 UI 面板的 `size` 形态并存并写入文档，但断言层确认唯一合法契约是 width/height/angle/length；传 `{ size }` 直接抛错。已按真源收敛。
 * @returns Shape 楔形体几何，可作为后续 op 的输入。
 * @param params.width - 底面宽度（mm）。type:number required:true
 * @param params.height - 高度（mm）。type:number required:true
 * @param params.angle - 楔形角度（度）。type:number required:true
 * @param params.length - 沿切割方向的长度（mm）。type:number required:true
 * @example
 * const w = cad.wedge({ width: 30, height: 20, angle: 45, length: 10 })
  */
export const wedge = defineOp({
  mesh: (params: Record<string, unknown>) => {
    assertWedgeParams(params)
    return cad.wedge(params as never)
  },
  brep: (params: Record<string, unknown>) => {
    assertWedgeParams(params)
    return primitiveBrep('wedge', params)
  },
})
