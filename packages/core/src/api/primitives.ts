/**
 * api primitives — 基本体创建库函数（box/sphere/cylinder/cone/wedge）
 *
 *
 * dispatchPath 静态判定 brep/mesh，产物经 solid()/fromBrep() 构造器创建。
 */

import type { Shape } from '../mesh/types'
import { clampNRad } from '../mesh/types'
// B3 correction (2026-10-06): no library-face cad aggregate — import the impl from its own module.
import * as meshPrimitives from '../mesh/primitives'
import { primitiveToBrepSolid } from '../primitives/brep-primitives'
import { getCurrentStmt } from '../runtime-state'
import { getBrepApi } from '../brep/handle-bridge'
import { fromBrep } from '../shape'
import { assignRoles } from '../topology/naming/roles'
import type { Provenance } from '../topology/naming/lineage'
import { asPartName } from '../identity'
import { defineOp } from '../sdk'
import { assertPositiveNumber, assertNonNegativeNumber } from './assert'
import type { BrepMeshResult, BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import { DEFAULT_LINEAR_DEFLECTION } from '../tolerance'
import { mm } from '../units'

// ── per-op 参数自校验（Phase 2.2；api 层被直接 import 时的防御层） ──

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
 * Validate cylinder parameters (brepjs contract, §4.3 A 决策): `radius` and
 * `height` must be positive. The legacy `{ center }` object key is removed — any
 * call still passing `center` throws an explicit `E_ARGS_FORM` error pointing at
 * the new signature (error hint ≠ compatibility, 裁决 3).
 * @param params - the raw cylinder operation parameters.
 */
export function assertCylinderParams(params: Record<string, unknown>): void {
  if (params.center !== undefined || params.size !== undefined) {
    throw new Error(
      '[faijs/args] cylinder: E_ARGS_FORM: the legacy object form is removed. ' +
      'cylinder now uses `cylinder(radius, height, { at?, centered?, segments? })`.',
    )
  }
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
  const kernel = getBrepApi()
  const type = op === 'box' ? 'cube' : op
  const result = primitiveToBrepSolid(kernel, type as 'cube' | 'sphere' | 'cylinder' | 'cone' | 'wedge', params as never)
  // §3.2：链根建表——语义命名器按 op 类型给面命名（semantic 'top'/'lateral' 等，
  // Phase 1.7 已删 'box:' 前缀与位置兜底）。
  // Phase 1.6：origin 用链根语句的 StmtId（当前语句 id，§2.2/§4.1）——变量名会被
  // 改名/复用，StmtId 全局唯一，保证多个同类型 primitive 不撞 origin。
  const origin = String(getCurrentStmt()?.id ?? op)
  const roles = assignRoles(kernel, result.solid, op)
  const segments = clampNRad((params.nRad ?? params.segments) as number)
  // P4 面级：brep 链基本体也挂契约序 faceRanges（编辑器默认 brep 链——
  // setFaceColor 必须可用）。box 的 OCCT 面枚举序（实测 0=−X,1=+Y,…）与契约
  // （+X/−X/+Y/−Y/+Z/−Z）不一致，按面法线重排 indices；cylinder/cone 的
  // OCCT 序与契约一致（实测锁定：cylinder 0=侧面,1=顶,2=底；cone radiusTop=0
  // 0=侧面,1=底），直接透传。
  const { shape, faceRanges } = brepPrimitiveMesh(kernel, result.solid, op, segments)
  if (faceRanges) shape.faceRanges = faceRanges
  return fromBrep(
    shape,
    { solid: result.solid, roleTable: new Map([[asPartName(origin), roles]]) },
  )
}

/** 面法线主轴向：用该面非退化三角形的法线和定轴与符号（OCCT 统一 outward 绕向）。 */
function faceNormalAxis(
  mesh: BrepMeshResult,
  triStart: number,
  triCount: number,
): { axis: 0 | 1 | 2; sign: 1 | -1 } | null {
  let sx = 0
  let sy = 0
  let sz = 0
  for (let t = 0; t < triCount; t++) {
    const i0 = mesh.indices[(triStart + t) * 3]
    const i1 = mesh.indices[(triStart + t) * 3 + 1]
    const i2 = mesh.indices[(triStart + t) * 3 + 2]
    const p0x = mesh.positions[i0 * 3]; const p0y = mesh.positions[i0 * 3 + 1]; const p0z = mesh.positions[i0 * 3 + 2]
    const p1x = mesh.positions[i1 * 3]; const p1y = mesh.positions[i1 * 3 + 1]; const p1z = mesh.positions[i1 * 3 + 2]
    const p2x = mesh.positions[i2 * 3]; const p2y = mesh.positions[i2 * 3 + 1]; const p2z = mesh.positions[i2 * 3 + 2]
    const ux = p1x - p0x; const uy = p1y - p0y; const uz = p1z - p0z
    const vx = p2x - p0x; const vy = p2y - p0y; const vz = p2z - p0z
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz)
    if (!Number.isFinite(len) || len < 1e-12) continue
    sx += nx; sy += ny; sz += nz
  }
  const ax = Math.abs(sx); const ay = Math.abs(sy); const az = Math.abs(sz)
  if (!Number.isFinite(ax + ay + az) || ax + ay + az < 1e-12) return null
  if (ax >= ay && ax >= az) return { axis: 0, sign: sx > 0 ? 1 : -1 }
  if (ay >= ax && ay >= az) return { axis: 1, sign: sy > 0 ? 1 : -1 }
  return { axis: 2, sign: sz > 0 ? 1 : -1 }
}

/**
 * 三角化基本体并附 P4 契约序 faceRanges。
 * faceGroups 三元组 = [triStart, triCount, faceHash]，前两元是索引单位
 * （brep-ops.ts 注释）→ 三角形单位 = 索引/3。
 * - box：6 面 → 按面法线重排 indices 到契约序（0=+X,1=−X,2=+Y,3=−Y,4=+Z,5=−Z）。
 * - cylinder/cone：OCCT 枚举序与契约一致（探针实测锁定），直接透传，不重排。
 * - wedge/sphere 及其它：无契约，不挂 faceRanges（setFaceColor 抛 E_FACE_UNAVAILABLE）。
 */
function brepPrimitiveMesh(
  kernel: BrepEngineApi,
  solid: BrepHandle,
  op: string,
  segments: number,
): { shape: Shape; faceRanges?: Shape['faceRanges'] } {
  const angularDeflection = (2 * Math.PI) / Math.max(3, segments)
  const mesh = kernel.meshShape(solid, {
    linearDeflection: DEFAULT_LINEAR_DEFLECTION.as(mm),
    angularDeflection,
  })
  const shape: Shape = {
    positions: new Float32Array(mesh.positions),
    indices: new Uint32Array(mesh.indices),
  }
  const fg = mesh.faceGroups
  if (!fg) return { shape }
  const faces: Array<{ triStart: number; triCount: number }> = []
  for (let f = 0; f < fg.length / 3; f++) {
    faces.push({ triStart: fg[f * 3] / 3, triCount: fg[f * 3 + 1] / 3 })
  }
  if (op === 'box' && faces.length === 6) {
    // 契约序重排：每面判向 → 契约 idx（+X=0,−X=1,+Y=2,−Y=3,+Z=4,−Z=5）
    const byContract: Array<(typeof faces)[number] | undefined> = new Array(6).fill(undefined)
    for (const f of faces) {
      const na = faceNormalAxis(mesh, f.triStart, f.triCount)
      if (!na) return { shape }
      const idx = na.axis === 0 ? (na.sign > 0 ? 0 : 1) : na.axis === 1 ? (na.sign > 0 ? 2 : 3) : (na.sign > 0 ? 4 : 5)
      if (byContract[idx] !== undefined) return { shape } // 法线判向歧义 → 不挂
      byContract[idx] = f
    }
    if (byContract.some((f) => f === undefined)) return { shape }
    const newIndices = new Uint32Array(mesh.indices.length)
    const faceRanges: NonNullable<Shape['faceRanges']> = []
    let outTri = 0
    for (let c = 0; c < 6; c++) {
      const f = byContract[c]!
      faceRanges.push({ start: outTri, count: f.triCount })
      for (let t = 0; t < f.triCount; t++) {
        newIndices[(outTri + t) * 3] = mesh.indices[(f.triStart + t) * 3]
        newIndices[(outTri + t) * 3 + 1] = mesh.indices[(f.triStart + t) * 3 + 1]
        newIndices[(outTri + t) * 3 + 2] = mesh.indices[(f.triStart + t) * 3 + 2]
      }
      outTri += f.triCount
    }
    return { shape: { ...shape, indices: newIndices }, faceRanges }
  }
  if ((op === 'cylinder' || op === 'cone') && faces.length >= 2) {
    // OCCT 枚举序 = P4a 契约序（探针实测）：0=侧面, 1=顶, 2=底（cone 无顶盖时 0=侧面,1=底）
    return { shape, faceRanges: faces.map((f) => ({ start: f.triStart, count: f.triCount })) }
  }
  return { shape }
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
 * const part0 = cad.box(10 * MM, 20 * MM, 30 * MM)
 * const part1 = cad.box(30 * MM, 20 * MM, 10 * MM, { centered: true, at: [1, 2, 3], segments: 64 })
 *
 * 位置原生（§4.1/§6.2）：`box(width, depth, height)` 与 `box(10 * MM, 20 * MM, 30 * MM, {centered:true})`
 * 有量纲位必须写单位字面量（基准单位亦然，`10` 裸数字被 D8 R2 拒）。
 * 归一到同一对象（D11 位置→对象 + 尾参 options 合并）。旧 `{ size }` 对象形态已废弃（裁决 3），
 * 传入会抛 `E_ARGS_FORM`（错误提示 ≠ 兼容，§4.1）。
   */
export const box = defineOp({
  name: 'box',
  mesh: (params: Record<string, unknown>) => {
    assertBoxParams(params)
    return meshPrimitives.box(params as never)
  },
  brep: (params: Record<string, unknown>) => {
    assertBoxParams(params)
    return primitiveBrep('box', params)
  },
  // schema feeds codegen/UI parameter panels.
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
  slotMap: { keys: ['width', 'depth', 'height'] },
  paramDims: { width: 'length', depth: 'length', height: 'length' },
  naming: { kind: 'construct', newFaces: { via: 'explicit', vocab: [{ kind: 'semantic', name: 'top' }, { kind: 'semantic', name: 'bottom' }, { kind: 'semantic', name: 'front' }, { kind: 'semantic', name: 'back' }, { kind: 'semantic', name: 'left' }, { kind: 'semantic', name: 'right' }] } } as Provenance,
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
    return meshPrimitives.sphere(centerParams(params) as never)
  },
  brep: (params: Record<string, unknown>) => {
    assertSphereParams(params)
    return primitiveBrep('sphere', centerParams(params))
  },
  schema: { radius: 'number', segments: 'number?', center: 'vec3?', at: 'vec3?' },
  // D11: `sphere(10)` == `sphere({ radius: 10 })`; 尾参 options（{at, segments}）
  // 经 dual-form-args 的尾参合并规则归一（裁决 4，§6.2）。
  slotMap: { keys: ['radius'] },
  paramDims: { radius: 'length' },
  naming: { kind: 'unmodeled', reason: 'sphere face vocabulary pending Phase 3' } as Provenance,
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
 * 创建圆柱体（brepjs 契约，§4.3 A 决策）。
 * 锚点：`at` 是**底面轴心**（BASE 语义，默认 [0,0,0]，底面在原点、+Z 延伸）；`centered:true`
 * 指底面落到 −h/2（无 at 时居中到原点；与 `at` 同给时以 `at` 为中心）。
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name cylinder
 * @returns Shape 圆柱体几何，可作为后续 op 的输入。
 * @param params.radius - 底面半径（mm）。type:number required:true
 * @param params.height - 高度（mm），沿 +Z 轴。type:number required:true
 * @param params.at - 底面中心（BASE 语义）。type:[x,y,z] 可选
 * @param params.centered - 是否居中（底面 −h/2；与 at 同给时以 at 为中心）。type:boolean 默认 false
 * @param params.segments - 细分度（影响三角化）。type:number 默认 64（= brepjs standard 等效，P0 §5.0/§5.1）
 * @example
 * const c = cad.cylinder(5, 40)
 * const c = cad.cylinder(5, 40, { centered: true, at: [0, 0, 20], segments: 64 })
 *
 * 位置原生（§4.1/§6.2）：`cylinder(5, 40)` 与 `cylinder(5, 40, {centered:true})`
 * 归一到同一对象（D11 位置→装箱 + 尾参 options 合并）。旧 `{ center }` 对象形态已废弃
 * （裁决 3），传入会抛 `E_ARGS_FORM`（错误提示 ≠ 兼容，§4.3）。
  */
export const cylinder = defineOp({
  name: 'cylinder',
  mesh: (params: Record<string, unknown>) => {
    assertCylinderParams(params)
    return meshPrimitives.cylinder(params as never)
  },
  brep: (params: Record<string, unknown>) => {
    assertCylinderParams(params)
    return primitiveBrep('cylinder', params)
  },
  schema: { radius: 'number', height: 'number', at: 'vec3?', centered: 'boolean?', segments: 'number?' },
  // D11（§4.1/§6.2）：`cylinder(5, 40)` 两个标量装箱成 { radius, height }；尾参 options
  // 经 dual-form-args 尾参合并并入。
  slotMap: { keys: ['radius', 'height'] },
  paramDims: { radius: 'length', height: 'length' },
  naming: { kind: 'construct', newFaces: { via: 'explicit', vocab: [{ kind: 'semantic', name: 'top' }, { kind: 'semantic', name: 'bottom' }, { kind: 'semantic', name: 'lateral' }] } } as Provenance,
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
    return meshPrimitives.cone(params as never)
  },
  brep: (params: Record<string, unknown>) => {
    assertConeParams(params)
    return primitiveBrep('cone', params)
  },
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
  slotMap: { keys: ['radiusBottom', 'radiusTop', 'height'] },
  paramDims: { radiusBottom: 'length', radiusTop: 'length', height: 'length' },
  naming: { kind: 'construct', newFaces: { via: 'explicit', vocab: [{ kind: 'semantic', name: 'top' }, { kind: 'semantic', name: 'bottom' }, { kind: 'semantic', name: 'lateral' }] } } as Provenance,
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
    return meshPrimitives.wedge(params as never)
  },
  brep: (params: Record<string, unknown>) => {
    assertWedgeParams(params)
    return primitiveBrep('wedge', params)
  },
  // D11: `wedge(30, 20, 45, 10)` == `wedge({ width: 30, height: 20, angle: 45, length: 10 })`.
  slotMap: { keys: ['width', 'height', 'angle', 'length'] },
  paramDims: { width: 'length', height: 'length', angle: 'angle', length: 'length' },
  naming: { kind: 'unmodeled', reason: 'wedge face vocabulary pending Phase 3' } as Provenance,
})
