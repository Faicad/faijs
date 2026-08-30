/**
 * stdlib primitives — 基本体创建库函数（box/sphere/cylinder/cone/wedge）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * dispatchPath 静态判定 brep/mesh，产物经 solid()/fromBrep() 构造器创建。
 */

import type { Shape } from '@faicad/faijs-core/mesh/types'
import { cad } from '@faicad/faijs-core/mesh'
import { primitiveToBrepSolid } from '@faicad/faijs-core/primitives/brep-primitives'
import { solidToShape } from '@faicad/faijs-core/brep/brep-ops'
import { getBackends } from '@faicad/faijs-core/runtime-state'
import { solid, fromBrep } from '@faicad/faijs-core/shape'
import { dispatchPath } from '@faicad/faijs-core/cad-runtime/backend-dispatch'
import { assertPositiveNumber, assertNonNegativeNumber, assertNumberOrVec3 } from './assert'
import type { BrepEngineApi } from '@faicad/faijs-core/brep/engine/primitives'

// ── per-op 参数自校验（Phase 2.2；stdlib 被直接 import 时的防御层） ──

/** box: size 必填（number 或 vec3），> 0。 */
export function assertBoxParams(params: Record<string, unknown>): void {
  assertNumberOrVec3(params.size, 'box.size')
}

/** sphere: radius 必填，> 0。 */
export function assertSphereParams(params: Record<string, unknown>): void {
  assertPositiveNumber(params.radius, 'sphere.radius')
}

/** cylinder: radius/height 必填，> 0。 */
export function assertCylinderParams(params: Record<string, unknown>): void {
  assertPositiveNumber(params.radius, 'cylinder.radius')
  assertPositiveNumber(params.height, 'cylinder.height')
}

/** cone: radiusBottom/height 必填 > 0，radiusTop >= 0。 */
export function assertConeParams(params: Record<string, unknown>): void {
  assertPositiveNumber(params.radiusBottom, 'cone.radiusBottom')
  assertNonNegativeNumber(params.radiusTop, 'cone.radiusTop')
  assertPositiveNumber(params.height, 'cone.height')
}

/** wedge: width/height/angle/length 必填，> 0。 */
export function assertWedgeParams(params: Record<string, unknown>): void {
  assertPositiveNumber(params.width, 'wedge.width')
  assertPositiveNumber(params.height, 'wedge.height')
  assertPositiveNumber(params.angle, 'wedge.angle')
  assertPositiveNumber(params.length, 'wedge.length')
}

/** BREP 实现标记（dispatchPath 判定用；primitives 有 OCCT 精确构造） */
const brepImpl = primitiveToBrepSolid

/** BREP 路径：OCCT 精确构造 + 三角化 + fromBrep 登记（基本体无面演化）。 */
function primitiveBrep(op: string, params: Record<string, unknown>): Shape {
  const kernel = getBackends().kernel.brep as BrepEngineApi | null
  if (!kernel) throw new Error('[stdlib/box] no OCCT kernel')
  const type = op === 'box' ? 'cube' : op
  const result = primitiveToBrepSolid(kernel, type as 'cube' | 'sphere' | 'cylinder' | 'cone' | 'wedge', params as never)
  return fromBrep(
    solidToShape(kernel, result.solid, params.segments as number | undefined),
    { solid: result.solid },
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
export function box(params: Record<string, unknown>): Shape {
  assertBoxParams(params)
  const path = dispatchPath([], brepImpl)
  if (path === 'brep') return primitiveBrep('box', params)
  return solid(cad.box(params as never))
}

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
export function sphere(params: Record<string, unknown>): Shape {
  assertSphereParams(params)
  const path = dispatchPath([], brepImpl)
  if (path === 'brep') return primitiveBrep('sphere', params)
  return solid(cad.sphere(params as never))
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
 * @param params.segments - 细分度（影响面数）。type:number 默认 32
 * @param params.center - 中心位置。type:[x,y,z] 默认 [0,0,0]（原点）。
 * @example
 * const c = cad.cylinder({ radius: 5, height: 40 })
  */
export function cylinder(params: Record<string, unknown>): Shape {
  assertCylinderParams(params)
  const path = dispatchPath([], brepImpl)
  if (path === 'brep') return primitiveBrep('cylinder', params)
  return solid(cad.cylinder(params as never))
}

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
export function cone(params: Record<string, unknown>): Shape {
  assertConeParams(params)
  const path = dispatchPath([], brepImpl)
  if (path === 'brep') return primitiveBrep('cone', params)
  return solid(cad.cone(params as never))
}

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
export function wedge(params: Record<string, unknown>): Shape {
  assertWedgeParams(params)
  const path = dispatchPath([], brepImpl)
  if (path === 'brep') return primitiveBrep('wedge', params)
  return solid(cad.wedge(params as never))
}
