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
import { identityEvolution } from '../brep/face-evolution'
import { getBackends } from '../runtime-state'
import { solid, fromBrep, brepOf } from './shape'
import { dispatchPath } from '../cad-runtime/backend-dispatch'
import { assertVec3, assertPositiveNumber } from './assert'

/** BREP 实现标记（transform 有 OCCT 精确变换） */
const brepImpl = true

// ── per-op 参数自校验（Phase 2.2；stdlib 被直接 import 时的防御层） ──

/** translate: offset 必填 vec3。 */
export function assertTranslateParams(params: Record<string, unknown>): void {
  assertVec3(params.offset, 'translate.offset')
}

/** rotate: anglesDeg 必填 vec3；pivot（如有）为 vec3。 */
export function assertRotateParams(params: Record<string, unknown>): void {
  assertVec3(params.anglesDeg, 'rotate.anglesDeg')
  if (params.pivot !== undefined && params.pivot !== null) {
    assertVec3(params.pivot, 'rotate.pivot')
  }
}

/** scale: factor 必填（number > 0 或 vec3）。 */
export function assertScaleParams(params: Record<string, unknown>): void {
  if (typeof params.factor === 'number') {
    assertPositiveNumber(params.factor, 'scale.factor')
  } else {
    assertVec3(params.factor, 'scale.factor')
  }
}

/** BREP 路径：变换 solid + 恒等面演化 + 三角化 + fromBrep 登记。 */
function transformBrep(op: string, input: Shape, params: Record<string, unknown>): Shape {
  const kernel = getBackends().kernel.occt as import('occt-wasm').OcctKernel | null
  if (!kernel) throw new Error('[stdlib/transform] no OCCT kernel')
  const inputSolid = brepOf(input) as import('occt-wasm').ShapeHandle | undefined
  if (!inputSolid) throw new Error('[stdlib/transform] input is not BREP')

  let resultSolid: import('occt-wasm').ShapeHandle
  if (op === 'translate') {
    resultSolid = translateBrep(kernel, inputSolid, params.offset as Vec3)
  } else if (op === 'rotate') {
    resultSolid = rotateBrep(kernel, inputSolid, params.anglesDeg as Vec3, params.pivot as Vec3 | undefined)
  } else {
    resultSolid = scaleBrep(kernel, inputSolid, params.factor as number | Vec3)
  }

  return fromBrep(solidToShape(kernel, resultSolid), {
    solid: resultSolid,
    // 变换不改变拓扑，面 ordinal 不变（与旧路径一致）
    faceEvolution: identityEvolution(kernel, resultSolid),
  })
}

export function translate(input: Shape, params: Record<string, unknown>): Shape {
  if (!input) throw new Error('[stdlib/translate] no input geometry')
  assertTranslateParams(params)
  const path = dispatchPath([input], brepImpl)
  if (path === 'brep') return transformBrep('translate', input, params)
  return solid(cad.translate(input, params.offset as Vec3))
}

export function rotate(input: Shape, params: Record<string, unknown>): Shape {
  if (!input) throw new Error('[stdlib/rotate] no input geometry')
  assertRotateParams(params)
  const path = dispatchPath([input], brepImpl)
  if (path === 'brep') return transformBrep('rotate', input, params)
  return solid(cad.rotate(input, params.anglesDeg as Vec3, params.pivot as Vec3 | undefined))
}

export function scale(input: Shape, params: Record<string, unknown>): Shape {
  if (!input) throw new Error('[stdlib/scale] no input geometry')
  assertScaleParams(params)
  const path = dispatchPath([input], brepImpl)
  if (path === 'brep') return transformBrep('scale', input, params)
  return solid(cad.scale(input, params.factor as number | Vec3))
}
