/**
 * stdlib transform — 变换库函数（translate/rotate/scale）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
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
 * Validate rotate parameters: `anglesDeg` must be a vec3, and `pivot`
 * (if provided) must also be a vec3.
 * @param params - the raw rotate operation parameters.
 */
export function assertRotateParams(params: Record<string, unknown>): void {
  assertVec3(params.anglesDeg, 'rotate.anglesDeg')
  if (params.pivot !== undefined && params.pivot !== null) {
    assertVec3(params.pivot, 'rotate.pivot')
  }
}

/**
 * Validate scale parameters: `factor` must be a positive number or a vec3.
 * @param params - the raw scale operation parameters.
 */
export function assertScaleParams(params: Record<string, unknown>): void {
  if (typeof params.factor === 'number') {
    assertPositiveNumber(params.factor, 'scale.factor')
  } else {
    assertVec3(params.factor, 'scale.factor')
  }
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
  } else if (op === 'rotate') {
    resultSolid = rotateBrep(kernel, inputSolid, params.anglesDeg as Vec3, params.pivot as Vec3 | undefined)
  } else {
    resultSolid = scaleBrep(kernel, inputSolid, params.factor as number | Vec3)
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
})

/**
 * 绕轴旋转几何体。anglesDeg 为欧拉角（度，XYZ 顺序）。
 * @group 变换
 * @inputs 1
 * @async false
 * @qual ok
 * @name rotate
 * @returns Shape 旋转后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param params.anglesDeg - 欧拉角（度，XYZ 顺序）。type:[x,y,z] required:true
 * @param params.pivot - 旋转中心。type:[x,y,z] 默认 原点
 * @example
 * const p2 = cad.rotate(part0, { anglesDeg: [0, 0, 45] })
 * const p3 = cad.rotate(part0, { anglesDeg: [0, 0, 45], pivot: [0,0,0] })
  */
export const rotate = defineOp({
  mesh: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[stdlib/rotate] no input geometry')
    assertRotateParams(params)
    return cad.rotate(input, params.anglesDeg as Vec3, params.pivot as Vec3 | undefined)
  },
  brep: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[stdlib/rotate] no input geometry')
    assertRotateParams(params)
    return transformBrep('rotate', input, params)
  },
})

/**
 * 缩放几何体。factor 传 number 为等比缩放，传 [x,y,z] 为非等比。
 * @group 变换
 * @inputs 1
 * @async false
 * @qual ok
 * @name scale
 * @returns Shape 缩放后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param params.factor - 缩放系数：number（等比）或 [x,y,z]（非等比，> 0）。type:number | [x,y,z] required:true
 * @example
 * const p4 = cad.scale(part0, { factor: 2 })
 * const p5 = cad.scale(part0, { factor: [2, 1, 1] })
  */
export const scale = defineOp({
  mesh: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[stdlib/scale] no input geometry')
    assertScaleParams(params)
    return cad.scale(input, params.factor as number | Vec3)
  },
  brep: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[stdlib/scale] no input geometry')
    assertScaleParams(params)
    return transformBrep('scale', input, params)
  },
})
