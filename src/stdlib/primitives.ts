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
import { getBackends } from '../runtime-state'
import { solid, fromBrep } from './shape'
import { dispatchPath } from '../cad-runtime/backend-dispatch'
import { assertPositiveNumber, assertNonNegativeNumber, assertNumberOrVec3 } from './assert'

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
  const kernel = getBackends().kernel.occt as import('occt-wasm').OcctKernel | null
  if (!kernel) throw new Error('[stdlib/box] no OCCT kernel')
  const type = op === 'box' ? 'cube' : op
  const result = primitiveToBrepSolid(kernel, type as 'cube' | 'sphere' | 'cylinder' | 'cone' | 'wedge', params as never)
  return fromBrep(
    solidToShape(kernel, result.solid, params.segments as number | undefined),
    { solid: result.solid },
  )
}

export function box(params: Record<string, unknown>): Shape {
  assertBoxParams(params)
  const path = dispatchPath([], brepImpl)
  if (path === 'brep') return primitiveBrep('box', params)
  return solid(cad.box(params as never))
}

export function sphere(params: Record<string, unknown>): Shape {
  assertSphereParams(params)
  const path = dispatchPath([], brepImpl)
  if (path === 'brep') return primitiveBrep('sphere', params)
  return solid(cad.sphere(params as never))
}

export function cylinder(params: Record<string, unknown>): Shape {
  assertCylinderParams(params)
  const path = dispatchPath([], brepImpl)
  if (path === 'brep') return primitiveBrep('cylinder', params)
  return solid(cad.cylinder(params as never))
}

export function cone(params: Record<string, unknown>): Shape {
  assertConeParams(params)
  const path = dispatchPath([], brepImpl)
  if (path === 'brep') return primitiveBrep('cone', params)
  return solid(cad.cone(params as never))
}

export function wedge(params: Record<string, unknown>): Shape {
  assertWedgeParams(params)
  const path = dispatchPath([], brepImpl)
  if (path === 'brep') return primitiveBrep('wedge', params)
  return solid(cad.wedge(params as never))
}
