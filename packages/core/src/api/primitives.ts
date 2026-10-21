/**
 * api primitives — 基本体创建库函数（box/sphere/cylinder/cone/wedge）
 *
 *
 * dispatchPath 静态判定 brep/mesh，产物经 solid()/fromBrep() 构造器创建。
 */

import type { Shape } from '../mesh/types'
import { clampNRad, BREP_TESS, BREP_LAZY_TESS } from '../mesh/types'
// B3 correction (2026-10-06): no library-face cad aggregate — import the impl from its own module.
import * as meshPrimitives from '../mesh/primitives'
import { primitiveToBrepSolid } from '../primitives/brep-primitives'
import { getBackends, getCurrentStmt, getTessellation, getTessellationTiming, setPendingMeshSolid, setPendingMeshTopology } from '../runtime-state'
import type { MeshSolidBackend } from '../brep/mesh-solid'
import { normalizeMeshSolid } from '../brep/mesh-solid'
import { getBrepApi } from '../brep/handle-bridge'
import { fromBrep, fromMeshSolid } from '../shape'
import { assignRoles } from '../topology/naming/roles'
import type { BrepLazyTessDescriptor } from '../brep/deferred-tess'
import type { Provenance } from '../topology/naming/lineage'
import { asPartName } from '../identity'
import { defineOp } from '../sdk'
import { assertPositiveNumber, assertNonNegativeNumber } from './assert'
import type { BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'

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
function primitiveBrep(op: string, params: Record<string, unknown>): Shape {  const kernel = getBrepApi()
  const type = op === 'box' ? 'cube' : op
  const result = primitiveToBrepSolid(kernel, type as 'cube' | 'sphere' | 'cylinder' | 'cone' | 'wedge', params as never)
  // §3.2：链根建表——语义命名器按 op 类型给面命名（semantic 'top'/'lateral' 等，
  // Phase 1.7 已删 'box:' 前缀与位置兜底）。
  // Phase 1.6：origin 用链根语句的 StmtId（当前语句 id，§2.2/§4.1）——变量名会被
  // 改名/复用，StmtId 全局唯一，保证多个同类型 primitive 不撞 origin。
  const origin = String(getCurrentStmt()?.id ?? op)
  const roles = assignRoles(kernel, result.solid, op)
  // Explicit segments/nRad wins ($fn override); otherwise derive from the global
  // tessellation knob (proposal 2026-10-07) — default still 2π/64 ≈ 64 segments.
  const rawSegments = (params.nRad ?? params.segments) as number | undefined
  const segments = clampNRad(rawSegments ?? (2 * Math.PI) / getTessellation().angularDeflection)
  // P4 面级：brep 链基本体挂 faceRanges（编辑器默认 brep 链——setFaceColor 必须可用）。
  // faceRanges 直接取 meshShape 的 faceGroups（内核枚举序、索引单位 /3 → 三角形单位），
  // **不重排 indices**：显示 mesh 的三角形顺序与拓扑面表行序因此同源同序（I2/I3）。
  // 面身份跨内核是 FaceTopoRef{origin, role}；数字面号只是"本次执行、本内核的面表行号"，
  // 既不承诺方向也不承诺跨内核（方案 2026-10-20 §1 规则三 / I5）。
  const { shape, faceRanges } = brepPrimitiveMesh(kernel, result.solid, op, segments)
  if (faceRanges) shape.faceRanges = faceRanges
  return fromBrep(
    shape,
    { solid: result.solid, roleTable: new Map([[asPartName(origin), roles]]) },
  )
}

/**
 * 三角化基本体，把同一份三角化结果挂到 shape 的内部 {@link BREP_TESS} 槽，
 * 并按 `faceGroups` 直接透传 faceRanges（**不做任何重排**）。
 *
 * faceGroups 三元组 = [triStart, triCount, faceHash]，前两元是索引单位
 * （brep-ops.ts 注释）→ 三角形单位 = 索引/3。faceRanges 与拓扑面表
 * （`faceRuns.faceRow`）同源同序，因此：
 * - 显示 mesh 的三角形区间 ↔ 拓扑面表行区间一致（I2/I3）；
 * - 跨内核身份是 FaceTopoRef{origin, role}，数字面号只是本执行/本内核的行号。
 *
 * 挂 BREP_TESS 后，runtime 用**这一份**三角化结果构建拓扑，不再二次 meshShape
 * （否则显式 `segments` 会让两次三角化不同源 → 面行区间与显示 mesh 错位）。
 */
function brepPrimitiveMesh(
  kernel: BrepEngineApi,
  solid: BrepHandle,
  op: string,
  segments: number,
): { shape: Shape; faceRanges?: Shape['faceRanges'] } {
  const angularDeflection = (2 * Math.PI) / Math.max(3, segments)
  // 延迟三角化（'defer'，方案 2026-10-21-weapp-tessellation-defer-plan §2）：基本体
  // 与 solidToShape 同一时机语义——产出不三角化，挂 BREP_LAZY_TESS 描述符（物化参数
  // 与 eager 分支一致），由 runtime 在收尾时对终端物化；物化时按 primitiveOp 补挂
  // faceRanges（面白名单与下方 eager 分支一致）。
  if (getTessellationTiming() === 'defer') {
    const shape: Shape = { positions: new Float32Array(0), indices: new Uint32Array(0) }
    ;(shape as unknown as Record<symbol, unknown>)[BREP_LAZY_TESS] = {
      kernel,
      solid,
      linearDeflection: getTessellation().linearDeflection,
      angularDeflection,
      ...(op === 'box' || op === 'cylinder' || op === 'cone' ? { primitiveOp: op } : {}),
    } satisfies BrepLazyTessDescriptor
    return { shape }
  }
  const mesh = kernel.meshShape(solid, {
    linearDeflection: getTessellation().linearDeflection,
    angularDeflection,
  })
  // 显示 mesh 与挂载给拓扑的三角化结果共用同一份 positions/indices（零额外拷贝）——
  // 规则 1 的字面落实：拓扑只能由用户看到的这份 mesh 生成。
  const positions = new Float32Array(mesh.positions)
  const indices = new Uint32Array(mesh.indices)
  const shape: Shape = { positions, indices }
  ;(shape as unknown as Record<symbol, unknown>)[BREP_TESS] = {
    positions,
    indices,
    normals: new Float32Array(mesh.normals),
    vertexCount: mesh.vertexCount,
    triangleCount: mesh.triangleCount,
    ...(mesh.faceGroups ? { faceGroups: new Int32Array(mesh.faceGroups) } : {}),
    ...(mesh.faceCount !== undefined ? { faceCount: mesh.faceCount } : {}),
  }
  const fg = mesh.faceGroups
  if (!fg) return { shape }
  // 面结构完整（面数 ≥ 2）的参数化基本体挂 faceRanges；box/cylinder/cone 是当前
  // setFaceColor 的可用面集（sphere/wedge 面结构尚未建模，保持不挂）。
  if (op !== 'box' && op !== 'cylinder' && op !== 'cone') return { shape }
  const faceRanges: NonNullable<Shape['faceRanges']> = []
  for (let f = 0; f * 3 + 2 < fg.length; f++) {
    faceRanges.push({ start: fg[f * 3] / 3, count: fg[f * 3 + 1] / 3 })
  }
  return { shape, faceRanges }
}

/**
 * 网格实体基本体（2026-10-22 weapp mesh 链）：已装配网格后端时，把同一份确定性
 * 三角数据（`meshPrimitives.*` 产物——纯 JS 参数化几何：mm、Z-up、BASE 锚点，与
 * manifold 路径**同源**）规范化成**网格实体**（显示 mesh == 拓扑 mesh，规则 1）。
 *
 * 未装配网格后端 → 原样返回 manifold 网格数据（web/manifold 宿主历史行为）。
 * 这是**装配事实**（宿主装了什么在 execute 前已定），不是运行时回退：分派已按模式
 * 选定 mesh 实现，本函数只按「后端是否装配」决定产物形态（与 load.ts 的
 * `buildMeshPart` 同一条口径）。
 *
 * 句柄 + 近似拓扑经 pending 通道登记（同 load/boolean），引擎在语句执行后收编。
 *
 * @param params - the (asserted) primitive params.
 * @param make - 构造确定性三角数据（meshPrimitives 对应函数）。
 * @returns the mesh solid shape (or manifold mesh data when no mesh backend is assembled).
 */
function meshSolidPrimitive(params: Record<string, unknown>, make: () => Shape): Shape {
  const backend = getBackends().kernel.meshSolid as MeshSolidBackend | undefined
  if (!backend) return make()
  const tri = make()
  const result = normalizeMeshSolid(backend, { positions: tri.positions, indices: tri.indices })
  const part = getCurrentStmt()?.outputs[0]
  if (part) {
    setPendingMeshSolid(part, result.solid)
    setPendingMeshTopology(part, backend.buildTopologyData(result))
  }
  return fromMeshSolid(
    { positions: result.mesh.positions, indices: result.mesh.indices },
    { meshSolid: result.solid },
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
 * @param params.at - 底面中心（BASE 语义，与 cylinder/cone 一致；与 centered 同给时以 at 为中心）。type:[x,y,z] 可选
 * @param params.centered - 无 at 时是否居中到原点（type:boolean 默认 false，角点在原点）。
 * @param params.segments - 细分度（影响三角化）。type:number 默认 64（= brepjs standard 等效，P0 §5.0/§5.1）
 * @example
 * const part0 = cad.box(10 * MM, 20 * MM, 30 * MM)
 * const part1 = cad.box(30 * MM, 20 * MM, 10 * MM, { at: [15 * MM, 10 * MM, 0], segments: 64 })
 *
 * 位置原生（§4.1/§6.2）：`box(width, depth, height)` 与 `box(10 * MM, 20 * MM, 30 * MM, { at: [1, 2, 3] })`
 * 有量纲位必须写单位字面量（基准单位亦然，`10` 裸数字被 D8 R2 拒）。
 * 归一到同一对象（D11 位置→对象 + 尾参 options 合并）。旧 `{ size }` 对象形态已废弃（裁决 3），
 * 传入会抛 `E_ARGS_FORM`（错误提示 ≠ 兼容，§4.1）。
 * 锚点（2026-10-16 统一 BASE）：默认角点在原点、底面贴地，`box(w, d, h)` ≡ `box(w, d, h, { at: [w/2, d/2, 0] })`。
   */
export const box = defineOp({
  name: 'box',
  mesh: (params: Record<string, unknown>) => {
    assertBoxParams(params)
    return meshSolidPrimitive(params, () => meshPrimitives.box(params as never))
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
  paramDims: { width: 'length', depth: 'length', height: 'length', segments: 'plain' },
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
    return meshSolidPrimitive(params, () => meshPrimitives.sphere(centerParams(params) as never))
  },
  brep: (params: Record<string, unknown>) => {
    assertSphereParams(params)
    return primitiveBrep('sphere', centerParams(params))
  },
  schema: { radius: 'number', segments: 'number?', center: 'vec3?', at: 'vec3?' },
  // D11: `sphere(10)` == `sphere({ radius: 10 })`; 尾参 options（{at, segments}）
  // 经 dual-form-args 的尾参合并规则归一（裁决 4，§6.2）。
  slotMap: { keys: ['radius'] },
  paramDims: { radius: 'length', segments: 'plain' },
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
 * const c = cad.cylinder(5, 40, { at: [0, 0, 20], segments: 64 })
 *
 * 位置原生（§4.1/§6.2）：`cylinder(5, 40)` 与 `cylinder(5, 40, { at: [0, 0, 20] })`
 * 归一到同一对象（D11 位置→装箱 + 尾参 options 合并）。旧 `{ center }` 对象形态已废弃
 * （裁决 3），传入会抛 `E_ARGS_FORM`（错误提示 ≠ 兼容，§4.3）。
  */
export const cylinder = defineOp({
  name: 'cylinder',
  mesh: (params: Record<string, unknown>) => {
    assertCylinderParams(params)
    return meshSolidPrimitive(params, () => meshPrimitives.cylinder(params as never))
  },
  brep: (params: Record<string, unknown>) => {
    assertCylinderParams(params)
    return primitiveBrep('cylinder', params)
  },
  schema: { radius: 'number', height: 'number', at: 'vec3?', centered: 'boolean?', segments: 'number?' },
  // D11（§4.1/§6.2）：`cylinder(5, 40)` 两个标量装箱成 { radius, height }；尾参 options
  // 经 dual-form-args 尾参合并并入。
  slotMap: { keys: ['radius', 'height'] },
  paramDims: { radius: 'length', height: 'length', segments: 'plain' },
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
 * const c = cad.cone(10, 0, 30, { at: [0, 0, 20], segments: 64 })
 * 位置原生（§4.1/§6.2）：`cone(10, 4, 30)` 与 `cone(10, 4, 30, { at: [0, 0, 20] })`
 * 归一到同一对象（D11 位置→装箱 + 尾参 options 合并）。旧 `{ center }`/`{ size }` 对象形态
 * 已废弃（裁决 3），传入会抛 E_ARGS_FORM（错误提示 ≠ 兼容）。
  */
export const cone = defineOp({
  name: 'cone',
  mesh: (params: Record<string, unknown>) => {
    assertConeParams(params)
    return meshSolidPrimitive(params, () => meshPrimitives.cone(params as never))
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
  paramDims: { radiusBottom: 'length', radiusTop: 'length', height: 'length', segments: 'plain' },
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
    return meshSolidPrimitive(params, () => meshPrimitives.wedge(params as never))
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
