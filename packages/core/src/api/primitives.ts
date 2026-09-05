/**
 * stdlib primitives — 基本体创建库函数（box/sphere/cylinder/cone/wedge）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * dispatchPath 静态判定 brep/mesh，产物经 solid()/fromBrep() 构造器创建。
 */

import type { Shape } from '../mesh/types'
import { clampNRad } from '../mesh/types'
import { cad } from '../mesh'
import { primitiveToBrepSolid } from '../primitives/brep-primitives'
import { solidToShape } from '../brep/brep-ops'
import { getBackends, getCurrentStmt } from '../runtime-state'
import { fromBrep } from '../shape'
import { assignRoles } from '../topology/naming/roles'
import { asPartName } from '../identity'
import { defineOp } from '../sdk'
import { assertPositiveNumber, assertNonNegativeNumber } from './assert'
import type { BrepEngineApi } from '../brep/engine/primitives'

// ── per-op 参数自校验（Phase 2.2；stdlib 被直接 import 时的防御层） ──

/**
 * Validate box parameters (brepjs contract, §4.1 A 决策): `width`, `depth` and
 * `height` must be positive numbers. The legacy `{ size }` object form is
 * removed — any call still passing `size` throws an explicit `E_ARGS_FORM`
 * error pointing at the new signature (error hint ≠ compatibility).
 * @param params - the raw box operation parameters.
 */
export function assertBoxParams(params: Record<string, unknown>): void {
  if (params.size !== undefined) {
    throw new Error(
      '[faijs/args] box: E_ARGS_FORM: the `box({ size })` object form is removed. ' +
      'box now uses `box(width, depth, height, { at?, centered?, segments? })`.',
    )
  }
  assertPositiveNumber(params.width, 'box.width')
  assertPositiveNumber(params.depth, 'box.depth')
  assertPositiveNumber(params.height, 'box.height')
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
 * Validate cone parameters (brepjs contract, §4.1 P 决策): `radiusBottom` and
 * `height` must be positive, `radiusTop` must be non-negative. The legacy
 * `{ center }` object key is removed — any call still passing `center` throws an
 * explicit `E_ARGS_FORM` error pointing at the new signature (error hint ≠
 * compatibility, 裁决 3).
 * @param params - the raw cone operation parameters.
 */
export function assertConeParams(params: Record<string, unknown>): void {
  if (params.center !== undefined || params.size !== undefined) {
    throw new Error(
      '[faijs/args] cone: E_ARGS_FORM: the legacy object form is removed. ' +
      'cone now uses `cone(bottomRadius, topRadius, height, { at?, centered?, segments? })`.',
    )
  }
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
    solidToShape(kernel, result.solid, clampNRad((params.nRad ?? params.segments) as number)),
    { solid: result.solid, roleTable: new Map([[asPartName(origin), roles]]) },
  )
}

/**
 * 创建长方体（brepjs 契约，§4.1 A 决策）。
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name box
 * @returns Shape 长方体几何，可作为后续 op 的输入。
 * @param params.width - X 方向边长（mm）。type:number required:true
 * @param params.depth - Y 方向边长（mm）。type:number required:true
 * @param params.height - Z 方向边长（mm）。type:number required:true
 * @param params.at - 中心点（CENTER 语义，优先于 centered）。type:[x,y,z] 可选
 * @param params.centered - 无 at 时是否居中到原点（type:boolean 默认 false，角点在原点）。
 * @param params.segments - 细分度（影响三角化）。type:number 默认 64（= brepjs standard 等效，P0 §5.0/§5.1）
 * @example
 * const part0 = cad.box(10, 20, 30)
 * const part1 = cad.box(30, 20, 10, { centered: true, at: [1, 2, 3], segments: 64 })
 *
 * 位置原生（§4.1/§6.2）：`box(width, depth, height)` 与 `box(10, 20, 30, {centered:true})`
 * 归一到同一对象（D11 位置→对象 + 尾参 options 合并）。旧 `{ size }` 对象形态已废弃（裁决 3），
 * 传入会抛 `E_ARGS_FORM`（错误提示 ≠ 兼容，§4.1）。
   */
export const box = defineOp({
  name: 'box',
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
  schema: {
    width: 'number',
    depth: 'number',
    height: 'number',
    at: 'vec3?',
    centered: 'boolean?',
    segments: 'number?',
  },
  // D11 位置→对象（§4.1/§6.2）：三个标量装箱成 { width, depth, height }，尾参
  // options 经 dual-form-args 的尾参合并（§6.2）并入。
  positional: { keys: ['width', 'depth', 'height'] },
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
 * @param params.segments - 细分度（影响面数）。type:number 默认 64（= brepjs standard 等效，P0 §5.0/§5.1）
 * @param params.center - 球心位置（at 的同义别名）。type:[x,y,z] 默认 [0,0,0]（原点）。
 * @param params.at - 球心位置（center 的同义别名，brepjs 契约；裁决 4 双形态合法）。
 * @example
 * const r = cad.sphere({ radius: 10 })
 * const r = cad.sphere(10, { at: [0, 0, 10], segments: 64 })
 * const r = cad.sphere({ radius: 10, segments: 64, center: [0,0,10] })
 */
export const sphere = defineOp({
  name: 'sphere',
  mesh: (params: Record<string, unknown>) => {
    assertSphereParams(params)
    return cad.sphere(centerParams(params) as never)
  },
  brep: (params: Record<string, unknown>) => {
    assertSphereParams(params)
    return primitiveBrep('sphere', centerParams(params))
  },
  // L3 metadata (D2): creator consumes no shape inputs.
  consumes: 'none',
  schema: { radius: 'number', segments: 'number?', center: 'vec3?', at: 'vec3?' },
  // D11: `sphere(10)` == `sphere({ radius: 10 })`; 尾参 options（{at, segments}）
  // 经 dual-form-args 的尾参合并规则归一（裁决 4，§6.2）。
  positional: { keys: ['radius'] },
})

/**
 * 位置归一：把 brepjs 契约的 `at`（= faijs 的 `center`，球心语义）归一为一个
 * `center` 输入，mesh/brep 两条消费路径共用（裁决 1/4，§4.2）。
 */
function centerParams(params: Record<string, unknown>): Record<string, unknown> {
  if (params.at !== undefined) return { ...params, center: params.at }
  return params
}

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
 * @param params.segments - 细分度（影响面数）。type:number 默认 64（= brepjs standard 等效，P0 §5.0/§5.1）
 * @param params.center - 中心位置。type:[x,y,z] 默认 [0,0,0]（原点）。
 * @example
 * const c = cad.cylinder({ radius: 5, height: 40 })
  */
export const cylinder = defineOp({
  name: 'cylinder',
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
  // D11: `cylinder(5, 40)` == `cylinder({ radius: 5, height: 40 })`.
  positional: { keys: ['radius', 'height'] },
})

/**
 * 创建圆锥体（brepjs 契约，§4.1 P 决策）。radiusTop 等于 radiusBottom 时即圆柱，0 为尖锥。
 * 锚点：`at` 是**底面轴心**（BASE 语义，默认 [0,0,0]，底面在原点、+Z 延伸）；`centered:true`
 * 指底面落到 −h/2（无 at 时居中到原点；与 `at` 同给时以 `at` 为中心）。
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name cone
 * @returns Shape 圆锥体几何，可作为后续 op 的输入。
 * @param params.radiusBottom - 底半径（mm）。type:number required:true
 * @param params.radiusTop - 顶半径（mm），0 为尖锥，非负，等于 radiusBottom 得圆柱。type:number required:true
 * @param params.height - 高度（mm），沿 +Z 轴。type:number required:true
 * @param params.at - 底面轴心（BASE 语义）。type:[x,y,z] 可选
 * @param params.centered - 是否居中（底面 −h/2；与 at 同给时以 at 为中心）。type:boolean 默认 false
 * @param params.segments - 细分度（影响三角化）。type:number 默认 64（= brepjs standard 等效，P0 §5.0/§5.1）
 * @example
 * const c = cad.cone(10, 4, 30)
 * const c = cad.cone(10, 0, 30, { centered: true, at: [0, 0, 20], segments: 64 })
 * 位置原生（§4.1/§6.2）：`cone(10, 4, 30)` 与 `cone(10, 4, 30, { centered: true })`
 * 归一到同一对象（D11 位置→装箱 + 尾参 options 合并）。旧 `{ center }`/`{ size }` 对象形态
 * 已废弃（裁决 3），传入会抛 E_ARGS_FORM（错误提示 ≠ 兼容）。
  */
export const cone = defineOp({
  name: 'cone',
  mesh: (params: Record<string, unknown>) => {
    assertConeParams(params)
    return cad.cone(params as never)
  },
  brep: (params: Record<string, unknown>) => {
    assertConeParams(params)
    return primitiveBrep('cone', params)
  },
  // L3 metadata (D2): creator consumes no shape inputs.
  consumes: 'none',
  schema: {
    radiusBottom: 'number',
    radiusTop: 'number',
    height: 'number',
    at: 'vec3?',
    centered: 'boolean?',
    segments: 'number?',
  },
  // D11（§4.1/§6.2）: `cone(10, 4, 30)` 三个标量装箱成 { radiusBottom, radiusTop, height }。
  // 尾参 options（{at, centered, segments}）经 dual-form-args 尾参合并并入。
  positional: { keys: ['radiusBottom', 'radiusTop', 'height'] },
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
  name: 'wedge',
  mesh: (params: Record<string, unknown>) => {
    assertWedgeParams(params)
    return cad.wedge(params as never)
  },
  brep: (params: Record<string, unknown>) => {
    assertWedgeParams(params)
    return primitiveBrep('wedge', params)
  },
  // D11: `wedge(30, 20, 45, 10)` == `wedge({ width: 30, height: 20, angle: 45, length: 10 })`.
  positional: { keys: ['width', 'height', 'angle', 'length'] },
})
