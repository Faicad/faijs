/**
 * stdlib transform — 变换库函数（translate/rotate/scale）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 *
 * 从 src/ops/transform.ts 迁出并改写为 stdlib 形态：
 * `(input, params, exec) => Promise<Shape>`，resolvePath 静态判定 brep/mesh，
 * BREP 路径用 exec.getSolid(input) 取输入实体、exec.setSolid 挂输出实体。
 */

import type { Shape, Vec3 } from '../mesh/types'
import { cad } from '../mesh'
import { translateBrep, rotateBrep, scaleBrep, solidToShape } from '../brep/brep-ops'
import { identityEvolution } from '../brep/face-evolution'
import { solid } from './shape'
import { resolvePath } from './internal/resolve-path'
import { assertVec3, assertPositiveNumber, assertNumberOrVec3 } from './assert'
import type { ExecContext } from '../cad-runtime/exec-context'

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

/** BREP 路径：变换 solid + 恒等面演化 + 三角化 + 身份槽挂 solid。 */
function transformBrep(op: string, input: Shape, params: Record<string, unknown>, exec: ExecContext): Shape {
  const kernel = exec.kernels.occt
  if (!kernel) throw new Error('[stdlib/transform] no OCCT kernel')
  const inputSolid = exec.getSolid(input)
  if (!inputSolid) throw new Error('[stdlib/transform] input is not BREP')

  let resultSolid: import('occt-wasm').ShapeHandle
  if (op === 'translate') {
    resultSolid = translateBrep(kernel, inputSolid, params.offset as Vec3)
  } else if (op === 'rotate') {
    resultSolid = rotateBrep(kernel, inputSolid, params.anglesDeg as Vec3, params.pivot as Vec3 | undefined)
  } else {
    resultSolid = scaleBrep(kernel, inputSolid, params.factor as number | Vec3)
  }

  const shape = solid(solidToShape(kernel, resultSolid))
  exec.setSolid(shape, resultSolid)
  // 变换不改变拓扑，面 ordinal 不变（与旧路径一致）
  exec.setFaceEvolution(shape, identityEvolution(kernel, resultSolid))
  return shape
}

export function translate(input: Shape, params: Record<string, unknown>, exec: ExecContext): Shape {
  if (!input) throw new Error('[stdlib/translate] no input geometry')
  assertTranslateParams(params)
  const path = resolvePath(exec, [input], brepImpl)
  if (path === 'brep') return transformBrep('translate', input, params, exec)
  return solid(cad.translate(input, params.offset as Vec3))
}

export function rotate(input: Shape, params: Record<string, unknown>, exec: ExecContext): Shape {
  if (!input) throw new Error('[stdlib/rotate] no input geometry')
  assertRotateParams(params)
  const path = resolvePath(exec, [input], brepImpl)
  if (path === 'brep') return transformBrep('rotate', input, params, exec)
  return solid(cad.rotate(input, params.anglesDeg as Vec3, params.pivot as Vec3 | undefined))
}

export function scale(input: Shape, params: Record<string, unknown>, exec: ExecContext): Shape {
  if (!input) throw new Error('[stdlib/scale] no input geometry')
  assertScaleParams(params)
  const path = resolvePath(exec, [input], brepImpl)
  if (path === 'brep') return transformBrep('scale', input, params, exec)
  return solid(cad.scale(input, params.factor as number | Vec3))
}
