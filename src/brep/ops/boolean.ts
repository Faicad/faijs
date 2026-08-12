/**
 * 布尔操作分派器（union/subtract/intersect）
 *
 * BREP 路径：用 OCCT fuse/cut/common（通过 *WithHistory 封装，同时收集面演化映射）
 * Mesh 路径：用 manifold-3d mesh-CSG
 *
 * 静态分派：链活跃时必走 BREP 路径（开发期写死），异常冒泡上报。
 *
 * P5-2: BREP 路径改用 *WithHistory 封装，执行后将面演化映射存入 brepChain.faceEvolutionCache。
 */

import type { Shape } from '../../cad-core/types'
import type { ShapeHandle } from 'occt-wasm'
import { cad } from '../../cad-core'
import { solidToShape } from '../brep-ops'
import {
  cutWithHistoryBrep,
  fuseWithHistoryBrep,
  intersectWithHistoryBrep,
} from './face-evolution'
import type { OpContext } from './types'
import { canUseBrep } from './types'

/**
 * 执行布尔操作
 */
export async function executeBoolean(ctx: OpContext): Promise<Shape> {
  const { inputGeometries, args } = ctx
  const operation = args.operation as 'union' | 'subtract' | 'intersect'

  if (inputGeometries.length < 2) {
    if (inputGeometries.length === 1) return inputGeometries[0]
    throw new Error(`[ReplayValidator] boolean needs at least 1 input`)
  }

  // 链不活跃 → mesh 路径（链已在前面静态断掉，正常继续）
  if (!canUseBrep(ctx)) {
    return executeBooleanMesh(operation, inputGeometries)
  }

  // 链活跃 → BREP 路径（直接执行，不包 try-catch！异常 = 未预期错误，冒泡上报）
  return executeBooleanBrep(ctx)
}

/**
 * BREP 路径：用 OCCT fuse/cut/common（通过 *WithHistory 封装，同时收集面演化映射）
 */
async function executeBooleanBrep(ctx: OpContext): Promise<Shape> {
  const { stmt, args, brepChain } = ctx
  if (!brepChain?.kernel) throw new Error('[executeBoolean] no kernel')

  const operation = args.operation as 'union' | 'subtract' | 'intersect'
  const inputSolids: ShapeHandle[] = []
  for (const inputRef of stmt.inputs) {
    const s = brepChain.solidCache.get(inputRef)
    if (!s) {
      // 不变量错误：链活跃时所有输入必有 solid，缺失即 bug
      throw new Error(`[executeBoolean] input solid not found for "${inputRef}" in statement "${stmt.id}" — invariant violation: chain is active but input solid is missing`)
    }
    inputSolids.push(s)
  }

  let resultSolid: ShapeHandle
  let lastEvolution: Map<number, number[]> | undefined

  if (operation === 'union') {
    const { result, faceEvolution } = fuseWithHistoryBrep(brepChain.kernel, inputSolids[0], inputSolids[1])
    resultSolid = result
    lastEvolution = faceEvolution
    for (let i = 2; i < inputSolids.length; i++) {
      const prev = resultSolid
      const r = fuseWithHistoryBrep(brepChain.kernel, prev, inputSolids[i])
      resultSolid = r.result
      lastEvolution = r.faceEvolution
      brepChain.kernel.release(prev)
    }
  } else if (operation === 'subtract') {
    const { result, faceEvolution } = cutWithHistoryBrep(brepChain.kernel, inputSolids[0], inputSolids[1])
    resultSolid = result
    lastEvolution = faceEvolution
    for (let i = 2; i < inputSolids.length; i++) {
      const prev = resultSolid
      const r = cutWithHistoryBrep(brepChain.kernel, prev, inputSolids[i])
      resultSolid = r.result
      lastEvolution = r.faceEvolution
      brepChain.kernel.release(prev)
    }
  } else {
    const { result, faceEvolution } = intersectWithHistoryBrep(brepChain.kernel, inputSolids[0], inputSolids[1])
    resultSolid = result
    lastEvolution = faceEvolution
    for (let i = 2; i < inputSolids.length; i++) {
      const prev = resultSolid
      const r = intersectWithHistoryBrep(brepChain.kernel, prev, inputSolids[i])
      resultSolid = r.result
      lastEvolution = r.faceEvolution
      brepChain.kernel.release(prev)
    }
  }
  brepChain.solidCache.set(stmt.id, resultSolid)

  // P5-2: 存储面演化映射（最后一次二元操作的面演化，用于面引用稳定性验证和未来面迁移）
  if (lastEvolution && brepChain.faceEvolutionCache) {
    brepChain.faceEvolutionCache.set(stmt.id, lastEvolution)
  }

  return solidToShape(brepChain.kernel, resultSolid)
}

/**
 * Mesh 路径：用 manifold-3d mesh-CSG
 */
async function executeBooleanMesh(
  operation: 'union' | 'subtract' | 'intersect',
  inputGeometries: Shape[],
): Promise<Shape> {
  if (operation === 'union') return cad.union(inputGeometries[0], inputGeometries[1], ...inputGeometries.slice(2))
  if (operation === 'subtract') {
    let result = await cad.subtract(inputGeometries[0], inputGeometries[1])
    for (let i = 2; i < inputGeometries.length; i++) {
      result = await cad.subtract(result, inputGeometries[i])
    }
    return result
  }
  if (operation === 'intersect') {
    let result = await cad.intersect(inputGeometries[0], inputGeometries[1])
    for (let i = 2; i < inputGeometries.length; i++) {
      result = await cad.intersect(result, inputGeometries[i])
    }
    return result
  }
  throw new Error(`[ReplayValidator] unknown boolean operation: ${operation}`)
}
