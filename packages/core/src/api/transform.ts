/**
 * stdlib transform — 变换对象库函数（translate/rotate_euler/scale/scale3d）
 *
 *
 * dispatchPath 静态判定 brep/mesh，
 * BREP 路径用 brepOf(input) 取输入实体、fromBrep 登记输出实体。
 */

import type { Shape, Vec3 } from '../mesh/types'
import { cad } from '../mesh'
import { translateBrep, rotateBrep, scaleBrep, solidToShape } from '../brep/brep-ops'
import { identityEvolution, identityHashEvolution } from '../brep/face-evolution'
import { getBackends } from '../runtime-state'
import { fromBrep, brepOf, getSlot } from '../shape'
import { propagateAllOrigins } from '../topology/naming/roles'
import type { RoleTable } from '../topology/naming/types'
import { defineOp } from '../sdk'
import { assertVec3, assertPositiveNumber } from './assert'
import type { BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'

/** BREP 路径：变换 solid + 恒等面演化 + 三角化 + fromBrep 登记。 */

/**
 * Validate translate parameters: `offset` must be a vec3.
 * @param params - the raw translate operation parameters.
 */
export function assertTranslateParams(params: Record<string, unknown>): void {
  assertVec3(params.offset, 'translate.offset')
}

/**
 * Validate rotate_euler parameters: `anglesDeg` must be a vec3, and `pivot`
 * (if provided) must also be a vec3.
 * @param params - the raw rotate_euler operation parameters.
 */
export function assertRotateParams(params: Record<string, unknown>): void {
  assertVec3(params.anglesDeg, 'rotate_euler.anglesDeg')
  if (params.pivot !== undefined && params.pivot !== null) {
    assertVec3(params.pivot, 'rotate_euler.pivot')
  }
}

/**
 * Validate scale parameters (brepjs contract, §4.6 裁决 2): `factor` must be a
 * positive number (uniform). The non-uniform array form belongs to `scale3d` —
 * any `scale(p, { factor: [x,y,z] })` call throws an explicit `E_ARGS_FORM`
 * error pointing at `scale3d` (error hint ≠ compatibility).
 * @param params - the raw scale operation parameters.
 */
export function assertScaleParams(params: Record<string, unknown>): void {
  if (Array.isArray(params.factor)) {
    throw new Error(
      '[faijs/args] scale: E_ARGS_FORM: uniform scaling takes a single number ' +
      '(scale(p, s, { center? })). Non-uniform scaling uses scale3d(p, [x,y,z]).',
    )
  }
  assertPositiveNumber(params.factor, 'scale.factor')
}

/**
 * Validate scale3d parameters (P6: factor locked to Vec3): `factor` must be a
 * vec3. The uniform scalar form belongs to `scale` — any `scale3d(p, 2)` call
 * throws an explicit `E_ARGS_FORM` error pointing at `scale` (§4.6 裁决 2).
 * @param params - the raw scale3d operation parameters.
 */
export function assertScale3dParams(params: Record<string, unknown>): void {
  if (typeof params.factor === 'number') {
    throw new Error(
      '[faijs/args] scale3d: E_ARGS_FORM: factor must be a vec3 [x, y, z]. ' +
      'Uniform scaling now uses scale(p, 2) (§4.6 裁决 2).',
    )
  }
  assertVec3(params.factor, 'scale3d.factor')
}

/** BREP 路径：变换 solid + 恒等面演化 + 恒等 roleTable 传播 + 三角化 + fromBrep 登记。 */
function transformBrep(op: string, input: Shape, params: Record<string, unknown>): Shape {
  const kernel = getBackends().kernel.brep as BrepEngineApi | null
  if (!kernel) throw new Error('[stdlib/transform] no OCCT kernel')
  const inputSolid = brepOf(input) as BrepHandle | undefined
  if (!inputSolid) throw new Error('[stdlib/transform] input is not BREP')

  let resultSolid: BrepHandle
  if (op === 'translate') {
    resultSolid = translateBrep(kernel, inputSolid, params.offset as Vec3)
  } else if (op === 'rotate_euler') {
    resultSolid = rotateBrep(kernel, inputSolid, params.anglesDeg as Vec3, params.pivot as Vec3 | undefined)
  } else {
    // op is 'scale' | 'scale3d'：统一走 带不动点的 scaleBrep（factor number|Vec3）。
    resultSolid = scaleBrep(kernel, inputSolid, params.factor as number | Vec3, params.center as Vec3 | undefined)
  }

  // §2.4/§3.3：刚体变换面 1:1 保留——hash 恒等传播 roleTable（所有 origin）
  const inputTable = getSlot(input)?.roleTable as RoleTable | undefined
  let roleTable: RoleTable | undefined
  if (inputTable && inputTable.size > 0) {
    roleTable = propagateAllOrigins(inputTable, identityHashEvolution(kernel, inputSolid, resultSolid))
  }

  return fromBrep(solidToShape(kernel, resultSolid), {
    solid: resultSolid,
    // 变换不改变拓扑，面 ordinal 不变（与旧路径一致）
    faceEvolution: identityEvolution(kernel, resultSolid),
    roleTable,
  })
}

/**
 * 平移几何体。
 * @group 变换
 * @inputs 1
 * @async false
 * @qual ok
 * @name translate
 * @returns Shape 平移后的几何，装配的相对位置靠成员的变换语句表达。
 * @param input - 目标几何。type:Shape required:true
 * @param params.offset - 平移向量（mm）。type:[x,y,z] required:true
 * @example
 * const p1 = cad.translate(part0, { offset: [10, 0, 0] })
  */
export const translate = defineOp({
  name: 'translate',
  mesh: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[stdlib/translate] no input geometry')
    assertTranslateParams(params)
    return cad.translate(input, params.offset as Vec3)
  },
  brep: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[stdlib/translate] no input geometry')
    assertTranslateParams(params)
    return transformBrep('translate', input, params)
  },
  // D11: `translate(p, 10, 0, 0)` == `translate(p, { offset: [10, 0, 0] })`;
  // `offset` is a vec3 slot sitting after the single leading Shape argument.
  slotMap: { keys: ['offset'], vec3Keys: ['offset'], shapeArity: 1 },
})

/**
 * 绕轴旋转几何体。anglesDeg 为欧拉角（度，XYZ 顺序）。
 * @group 变换
 * @inputs 1
 * @async false
 * @qual ok
 * @name rotate_euler
 * @returns Shape 旋转后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param params.anglesDeg - 欧拉角（度，XYZ 顺序）。type:[x,y,z] required:true
 * @param params.pivot - 旋转中心。type:[x,y,z] 默认 原点
 * @example
 * const p2 = cad.rotate_euler(part0, { anglesDeg: [0, 0, 45] })
 * const p3 = cad.rotate_euler(part0, { anglesDeg: [0, 0, 45], pivot: [0,0,0] })
 */
export const rotate_euler = defineOp({
  name: 'rotate_euler',
  mesh: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[stdlib/rotate_euler] no input geometry')
    assertRotateParams(params)
    return cad.rotate_euler(input, params.anglesDeg as Vec3, params.pivot as Vec3 | undefined)
  },
  brep: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[stdlib/rotate_euler] no input geometry')
    assertRotateParams(params)
    return transformBrep('rotate_euler', input, params)
  },
  // D11: `rotate_euler(p, 0, 0, 45)` == `rotate_euler(p, { anglesDeg: [0, 0, 45] })`.
  slotMap: { keys: ['anglesDeg'], vec3Keys: ['anglesDeg'], shapeArity: 1 },
})

/**
 * 等比缩放几何体（brepjs 契约，§4.6 裁决 2）。factor 只收 number；不动点默认
 * 原点（与 vendored `scale(shape, factor, { center? })` 一致），`center` 可选。
 * @group 变换
 * @inputs 1
 * @async false
 * @qual ok
 * @name scale
 * @returns Shape 缩放后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param params.factor - 等比缩放系数（> 0）。type:number required:true
 * @param params.center - 缩放不动点（p 保持不动）。type:[x,y,z] 默认 [0,0,0]（原点）
 * @example
 * const p4 = cad.scale(part0, 2)
 * const p5 = cad.scale(part0, { factor: 2, center: [10, 0, 0] })
 */
export const scale = defineOp({
  name: 'scale',
  mesh: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[stdlib/scale] no input geometry')
    assertScaleParams(params)
    return cad.scale(input, params.factor as number, params.center as Vec3 | undefined)
  },
  brep: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[stdlib/scale] no input geometry')
    assertScaleParams(params)
    return transformBrep('scale', input, params)
  },
  // L3 schema: factor/center for codegen/UI panels.
  schema: { factor: 'number', center: 'vec3?' },
  // D11（§4.6）：`scale(p, 2)` == `scale(p, { factor: 2 })`（标量槽）；尾参 options
  // （{center}）经 dual-form-args 尾参合并并入。
  slotMap: { keys: ['factor'], shapeArity: 1 },
})

/**
 * 非等比缩放几何体（faijs 语义，§1.4.4 裁决 2）。factor 定死 vec3 — 等比缩放请用
 * `scale(p, s)`，`scale3d(p, [x,y,z])` 才可非等比。`center` 为不动点（默认原点）。
 * @group 变换
 * @inputs 1
 * @async false
 * @qual ok
 * @name scale3d
 * @returns Shape 缩放后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param params.factor - 三轴缩放系数（均 > 0）。type:[x,y,z] required:true
 * @param params.center - 缩放不动点。type:[x,y,z] 默认 [0,0,0]（原点）
 * @example
 * const p4 = cad.scale3d(part0, { factor: [2, 1, 1] })
 * const p5 = cad.scale3d(part0, [2, 1, 1], { center: [10, 0, 0] })
 */
export const scale3d = defineOp({
  name: 'scale3d',
  mesh: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[stdlib/scale3d] no input geometry')
    assertScale3dParams(params)
    return cad.scale3d(input, params.factor as Vec3, params.center as Vec3 | undefined)
  },
  brep: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[stdlib/scale3d] no input geometry')
    assertScale3dParams(params)
    return transformBrep('scale3d', input, params)
  },
  // L3 schema: factor/center for codegen/UI panels.
  schema: { factor: 'vec3', center: 'vec3?' },
  // D11（裁决 2）：`scale3d(p, [1,2,3])` == `scale3d(p, { factor: [1,2,3] })`；
  // 标量 factor（如 `scale(p, 2)`）由 assertScale3dParams 拒绝并提示 `scale`。
  slotMap: { keys: ['factor'], vec3Keys: ['factor'], shapeArity: 1 },
})
