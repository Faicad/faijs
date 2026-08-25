/**
 * 变换操作分派器（translate/rotate/scale）
 *
 * BREP 路径：变换 solid 句柄（精确，不损失几何精度）
 * Mesh 路径：烘焙顶点（cad.translate/rotate/scale 直接操作 positions）
 *
 * P5-2: BREP 路径执行后存储恒等面演化映射（变换不改变拓扑，面 ordinal 不变）。
 */

import type { Shape, Vec3 } from '../mesh/types'
import { cad } from '../mesh'
import {
  translateBrep, rotateBrep, scaleBrep,
  solidToShape,
} from '../brep/brep-ops'
import { identityEvolution } from '../brep/face-evolution'
import type { OpContext } from './types'
import { canUseBrep } from './types'
import { asPartName } from '../identity'

/**
 * 执行变换操作（translate/rotate/scale）
 */
export async function executeTransform(ctx: OpContext): Promise<Shape> {
  const { stmt, inputGeometries, args, brepChain } = ctx

  if (inputGeometries.length === 0) {
    throw new Error(`[ExecutionValidator] ${stmt.op} statement "${stmt.id}" has no input geometry`)
  }
  const shape = inputGeometries[0]

  // BREP 链路径：变换 solid 句柄
  if (canUseBrep(ctx) && stmt.inputs.length > 0 && brepChain?.kernel) {
    return executeTransformBrep(ctx)
  }

  // mesh 路径：烘焙顶点
  return executeTransformMesh(stmt.op, shape, args)
}

/**
 * BREP 路径：变换 solid 句柄
 */
async function executeTransformBrep(ctx: OpContext): Promise<Shape> {
  const { stmt, args, brepChain } = ctx
  if (!brepChain?.kernel) throw new Error('[executeTransform] no kernel')

  const upstreamSolid = brepChain.solidCache.get(stmt.inputs[0])
  if (!upstreamSolid) throw new Error('[executeTransform] no upstream solid')

  let resultSolid: import('occt-wasm').ShapeHandle
  if (stmt.op === 'translate') {
    resultSolid = translateBrep(brepChain.kernel, upstreamSolid, args.offset as Vec3)
  } else if (stmt.op === 'rotate') {
    resultSolid = rotateBrep(brepChain.kernel, upstreamSolid, args.anglesDeg as Vec3, args.pivot as Vec3 | undefined)
  } else {
    resultSolid = scaleBrep(brepChain.kernel, upstreamSolid, args.factor as number | Vec3)
  }
  brepChain.solidCache.set(asPartName(stmt.id), resultSolid)

  // P5-2: 存储恒等面演化映射（变换不改变拓扑，面 ordinal i → [i]）
  if (brepChain.faceEvolutionCache) {
    brepChain.faceEvolutionCache.set(asPartName(stmt.id), identityEvolution(brepChain.kernel, resultSolid))
  }

  return solidToShape(brepChain.kernel, resultSolid, undefined, brepChain, asPartName(stmt.id))
}

/**
 * Mesh 路径：烘焙顶点
 */
async function executeTransformMesh(
  op: string,
  shape: Shape,
  args: Record<string, unknown>,
): Promise<Shape> {
  if (op === 'translate') {
    return cad.translate(shape, args.offset as Vec3)
  } else if (op === 'rotate') {
    return cad.rotate(shape, args.anglesDeg as Vec3, args.pivot as Vec3 | undefined)
  } else {
    return cad.scale(shape, args.factor as number | Vec3)
  }
}
