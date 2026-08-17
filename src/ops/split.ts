/**
 * 分割操作分派器
 *
 * BREP 路径：用 OCCT cut + common（平面分割 + 榫卯布尔序列）
 * Mesh 路径：用 manifold-3d mesh-CSG
 *
 * 静态分派：链活跃时必走 BREP 路径（开发期写死），异常冒泡上报。
 */

import type { Shape, Vec3 } from '../mesh/types'
import type { ShapeHandle } from 'occt-wasm'
import { cad } from '../mesh'
import {
  splitBrep,
  solidToShape,
} from '../brep/brep-ops'
import {
  dovetailBooleanSplitBrep,
  dowelOrTenonBooleanSplitBrep,
  type JoineryBasis,
  type GrooveParams,
  type DowelOrTenonParams,
} from '../brep/brepjs-mirror/joinery-brep'
import { computeBasisFromNormal } from '../mesh/split'
import type { OpContext } from './types'
import { canUseBrep } from './types'

/**
 * 执行分割操作
 */
export async function executeSplit(ctx: OpContext): Promise<Shape> {
  const { stmt, inputGeometries, args } = ctx

  if (inputGeometries.length === 0) {
    throw new Error(`[ReplayValidator] split statement "${stmt.id}" has no input geometry`)
  }
  const shape = inputGeometries[0]
  const cutMode = (args.cutMode as string) ?? 'plane'
  const normal = (args.normal as [number, number, number]) ?? [0, 0, 1]
  const offset = typeof args.offset === 'number' ? args.offset : 0
  const inPlaneAngleDeg = typeof args.inPlaneAngleDeg === 'number' ? args.inPlaneAngleDeg : 0
  const bbCenter = (args.bbCenter as [number, number, number]) ?? cad.bboxCenter(shape)
  const bboxSize = (args.bboxSize as [number, number, number]) ?? cad.boundingBox(shape).max.map(
    (v, i) => v - (cad.boundingBox(shape).min[i]),
  ) as [number, number, number]

  // 链不活跃 → mesh 路径（链已在前面静态断掉，正常继续）
  if (!canUseBrep(ctx)) {
    return executeSplitMesh(ctx, shape, cutMode, normal, offset, inPlaneAngleDeg, bbCenter, bboxSize)
  }

  // 链活跃 → BREP 路径（直接执行，不包 try-catch！异常 = 未预期错误，冒泡上报）
  return executeSplitBrep(ctx, cutMode, normal, offset, inPlaneAngleDeg, bbCenter, bboxSize)
}

/**
 * 将世界坐标的点转换为几何体局部坐标（含单位缩放）。
 *
 * cad.load 返回的几何体在原始文件坐标系中（无居中偏移、无单位缩放），
 * 而 UI 记录的 bbCenter / bboxSize 是世界坐标（含 mesh.position 居中偏移
 * 和单位缩放）。
 *
 * localPos = (worldPos - position) / scale
 */
function worldToLocalVec3(
  worldPos: [number, number, number],
  partTransform: { position: [number, number, number]; scale?: [number, number, number] } | undefined,
): [number, number, number] {
  const offset = partTransform?.position
  if (!offset) return worldPos
  const scale = partTransform?.scale
  if (scale && (scale[0] !== 1 || scale[1] !== 1 || scale[2] !== 1)) {
    return [
      (worldPos[0] - offset[0]) / scale[0],
      (worldPos[1] - offset[1]) / scale[1],
      (worldPos[2] - offset[2]) / scale[2],
    ]
  }
  return [
    worldPos[0] - offset[0],
    worldPos[1] - offset[1],
    worldPos[2] - offset[2],
  ]
}

/**
 * Mesh 路径：用 manifold-3d mesh-CSG
 */
async function executeSplitMesh(
  ctx: OpContext,
  shape: Shape,
  cutMode: string,
  normal: Vec3,
  offset: number,
  inPlaneAngleDeg: number,
  bbCenter: Vec3,
  bboxSize: Vec3,
): Promise<Shape> {
  const { stmt, args, outputCache, brepChain } = ctx

  // 将 UI 记录的世界坐标 bbCenter / bboxSize 转换为局部坐标
  // （cad.load 返回的几何体在原始文件坐标系中，无单位缩放）
  const localBbCenter = worldToLocalVec3(bbCenter, brepChain?.partTransform)
  const scale = brepChain?.partTransform?.scale
  const hasScale = scale && (scale[0] !== 1 || scale[1] !== 1 || scale[2] !== 1)
  const localBboxSize: Vec3 = hasScale
    ? [bboxSize[0] / scale![0], bboxSize[1] / scale![1], bboxSize[2] / scale![2]]
    : bboxSize

  const result = await cad.splitWithParams({
    shape,
    cutMode: cutMode as 'plane' | 'dovetail' | 'dowel' | 'straight-tenon' | 'tenon' | 'straight',
    normal,
    offset,
    inPlaneAngleDeg,
    bbCenter: localBbCenter,
    bboxSize: localBboxSize,
    groove: args.grooveDepth !== undefined ? {
      depth: args.grooveDepth as number,
      depthTolerance: (args.grooveDepthTolerance as number) ?? 0,
      width: (args.grooveWidth as number) ?? 0,
      widthTolerance: (args.grooveWidthTolerance as number) ?? 0,
      flapsAngle: (args.grooveFlapsAngle as number) ?? 0,
    } : undefined,
    dowel: args.dowelDiameter !== undefined ? {
      diameter: args.dowelDiameter as number,
      diameterTolerance: (args.dowelDiameterTolerance as number) ?? 0,
      height: (args.dowelHeight as number) ?? 0,
      heightTolerance: (args.dowelHeightTolerance as number) ?? 0,
    } : undefined,
    tenon: args.tenonSideLength !== undefined ? {
      sideLength: args.tenonSideLength as number,
      sideLengthTolerance: (args.tenonSideLengthTolerance as number) ?? 0,
      height: (args.tenonHeight as number) ?? 0,
      heightTolerance: (args.tenonHeightTolerance as number) ?? 0,
    } : undefined,
    selectedSections: args.selectedSections as number[] | null | undefined,
    applyExplode: (args.applyExplode as boolean | undefined) ?? true,
  })

  if (stmt.outputs && stmt.outputs.length >= 2 && outputCache) {
    outputCache.set(stmt.outputs[0], result.front)
    outputCache.set(stmt.outputs[1], result.back)
  }

  const side = args.side as string | undefined
  return side === 'back' ? result.back : result.front
}

/**
 * BREP 路径：用 OCCT 执行分割（按 cutMode 分派）
 */
async function executeSplitBrep(
  ctx: OpContext,
  cutMode: string,
  normal: Vec3,
  offset: number,
  inPlaneAngleDeg: number,
  bbCenter: Vec3,
  _bboxSize: Vec3,
): Promise<Shape> {
  const { stmt, args, brepChain } = ctx
  if (!brepChain?.kernel) throw new Error('[executeSplit] no kernel')

  const upstreamSolid = brepChain.solidCache.get(stmt.inputs[0])
  if (!upstreamSolid || !brepChain.kernel) {
    // 不变量错误：链活跃时上游必有 solid，缺失即 bug
    throw new Error(`[executeSplit] upstream solid not found for statement "${stmt.id}" (input: ${stmt.inputs[0]}) — invariant violation: chain is active but upstream solid is missing`)
  }

  // 从 normal + offset + bbCenter 派生切割平面参数
  const planeCenter: Vec3 = [
    bbCenter[0] + offset * normal[0],
    bbCenter[1] + offset * normal[1],
    bbCenter[2] + offset * normal[2],
  ]
  const originOffset = normal[0] * planeCenter[0] + normal[1] * planeCenter[1] + normal[2] * planeCenter[2]

  // 从 normal + inPlaneAngleDeg 派生基向量
  const { widthDir, depthDir } = computeBasisFromNormal(normal, inPlaneAngleDeg)

  const basis: JoineryBasis = {
    normal: normal as Vec3,
    widthDir: widthDir as Vec3,
    depthDir: depthDir as Vec3,
    planeCenter: planeCenter as Vec3,
    originOffset,
  }

  const kernel = brepChain.kernel
  let frontSolid: ShapeHandle
  let backSolid: ShapeHandle

  if (cutMode === 'dovetail') {
    // 燕尾分割
    const groove: GrooveParams = {
      depth: (args.grooveDepth as number) ?? 0,
      depthTolerance: (args.grooveDepthTolerance as number) ?? 0,
      width: (args.grooveWidth as number) ?? 0,
      widthTolerance: (args.grooveWidthTolerance as number) ?? 0,
      flapsAngle: (args.grooveFlapsAngle as number) ?? 0,
    }
    const result = dovetailBooleanSplitBrep(kernel, upstreamSolid, basis, groove)
    frontSolid = result.front
    backSolid = result.back
  } else if (cutMode === 'dowel' || cutMode === 'straight-tenon' || cutMode === 'tenon') {
    // 定位销 / 直榫分割
    const shape: 'dowel' | 'tenon' = cutMode === 'dowel' ? 'dowel' : 'tenon'
    let params: DowelOrTenonParams
    if (cutMode === 'dowel') {
      params = {
        size: (args.dowelDiameter as number) ?? 0,
        sizeTolerance: (args.dowelDiameterTolerance as number) ?? 0,
        height: (args.dowelHeight as number) ?? 0,
        heightTolerance: (args.dowelHeightTolerance as number) ?? 0,
      }
    } else {
      params = {
        size: (args.tenonSideLength as number) ?? 0,
        sizeTolerance: (args.tenonSideLengthTolerance as number) ?? 0,
        height: (args.tenonHeight as number) ?? 0,
        heightTolerance: (args.tenonHeightTolerance as number) ?? 0,
      }
    }
    const selectedSections = args.selectedSections as number[] | null | undefined
    const result = dowelOrTenonBooleanSplitBrep(
      kernel, upstreamSolid, basis, shape, params, selectedSections ?? null,
    )
    frontSolid = result.front
    backSolid = result.back
  } else {
    // 平面分割 (plane / straight / default)
    const splitResult = splitBrep(kernel, upstreamSolid, {
      normal: normal as Vec3,
      originOffset,
      planeCenter: planeCenter as Vec3,
    })
    frontSolid = splitResult.front
    backSolid = splitResult.back
  }

  const side = args.side as string | undefined
  const primarySolid = side === 'back' ? backSolid : frontSolid
  const secondarySolid = side === 'back' ? frontSolid : backSolid

  brepChain.solidCache.set(stmt.id, primarySolid)
  // 多输出：存入 solidCache 和 outputCache 的 mesh shape 对应（供下游使用）
  if (stmt.outputs && stmt.outputs.length >= 2 && ctx.outputCache) {
    brepChain.solidCache.set(stmt.outputs[0], frontSolid)
    brepChain.solidCache.set(stmt.outputs[1], backSolid)
    // 同时把 front/back 的 mesh shape 存入 outputCache
    //（runtime.replay 只会把返回值存入 stmt.id == outputs[0]，
    //  所以 outputs[1] (back) 必须在此显式存入）
    const frontShape = solidToShape(kernel, frontSolid)
    const backShape = solidToShape(kernel, backSolid)
    ctx.outputCache.set(stmt.outputs[0], frontShape)
    ctx.outputCache.set(stmt.outputs[1], backShape)
    // 返回 front（== stmt.id == outputs[0]）
    return side === 'back' ? backShape : frontShape
  } else {
    // 没有声明 outputs，释放非主 solid
    kernel.release(secondarySolid)
  }
  return solidToShape(kernel, primarySolid)
}
