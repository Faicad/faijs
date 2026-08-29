/**
 * stdlib split — 分割库函数（返回具名对象 { front, back }）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * dispatchPath 静态判定 brep/mesh，双输出以具名对象返回（替代 outputCache 多输出写入）。
 */

import type { Shape, Vec3 } from '../mesh/types'
import { cad } from '../mesh'
import {
  splitBrep,
  solidToShape,
  translateBrep,
} from '../brep/brep-ops'
import {
  dovetailBooleanSplitBrep,
  dowelOrTenonBooleanSplitBrep,
  type JoineryBasis,
  type GrooveParams,
  type DowelOrTenonParams,
} from '../brep/brepjs-mirror/joinery-brep'
import { computeBasisFromNormal } from '../mesh/split'
import { getBackends } from '../runtime-state'
import { solid, fromBrep, brepOf } from './shape'
import { dispatchPath } from '../cad-runtime/backend-dispatch'
import { assertNonZeroVec3 } from './assert'

/** BREP 实现标记（split 有 OCCT 精确分割） */
const brepImpl = true

/** 世界坐标 → 局部坐标（含单位缩放）。 */
function worldToLocalVec3(
  worldPos: Vec3,
  partTransform: { position: [number, number, number]; scale?: [number, number, number] } | undefined,
): Vec3 {
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

/** BREP 路径：OCCT 平面/榫卯分割 + 分离位移。 */
function splitBrepPath(input: Shape, params: Record<string, unknown>): { front: Shape; back: Shape } {
  const kernel = getBackends().kernel.occt as import('occt-wasm').OcctKernel | null
  if (!kernel) throw new Error('[stdlib/split] no OCCT kernel')
  const inputSolid = brepOf(input) as import('occt-wasm').ShapeHandle | undefined
  if (!inputSolid) throw new Error('[stdlib/split] input is not BREP')

  const cutMode = (params.cutMode as string) ?? 'plane'
  const normal = (params.normal as Vec3) ?? [0, 0, 1]
  const offset = typeof params.offset === 'number' ? params.offset : 0
  const inPlaneAngleDeg = typeof params.inPlaneAngleDeg === 'number' ? params.inPlaneAngleDeg : 0
  const bbCenter = (params.bbCenter as Vec3) ?? cad.bboxCenter(input)
  const bboxSize = (params.bboxSize as Vec3) ?? cad.boundingBox(input).max.map(
    (v, i) => v - cad.boundingBox(input).min[i],
  ) as Vec3

  const partTransform = getBackends().config.partTransform
  const localBbCenter = worldToLocalVec3(bbCenter, partTransform)
  const scale = partTransform?.scale
  const hasScale = scale && (scale[0] !== 1 || scale[1] !== 1 || scale[2] !== 1)
  const localBboxSize: Vec3 = hasScale
    ? [bboxSize[0] / scale![0], bboxSize[1] / scale![1], bboxSize[2] / scale![2]]
    : bboxSize

  const planeCenter: Vec3 = [
    localBbCenter[0] + offset * normal[0],
    localBbCenter[1] + offset * normal[1],
    localBbCenter[2] + offset * normal[2],
  ]
  const originOffset = normal[0] * planeCenter[0] + normal[1] * planeCenter[1] + normal[2] * planeCenter[2]

  const { widthDir, depthDir } = computeBasisFromNormal(normal, inPlaneAngleDeg)
  const basis: JoineryBasis = {
    normal: normal as Vec3,
    widthDir: widthDir as Vec3,
    depthDir: depthDir as Vec3,
    planeCenter: planeCenter as Vec3,
    originOffset,
  }

  let frontSolid: import('occt-wasm').ShapeHandle
  let backSolid: import('occt-wasm').ShapeHandle

  if (cutMode === 'dovetail') {
    const groove: GrooveParams = {
      depth: (params.grooveDepth as number) ?? 0,
      depthTolerance: (params.grooveDepthTolerance as number) ?? 0,
      width: (params.grooveWidth as number) ?? 0,
      widthTolerance: (params.grooveWidthTolerance as number) ?? 0,
      flapsAngle: (params.grooveFlapsAngle as number) ?? 0,
    }
    const result = dovetailBooleanSplitBrep(kernel, inputSolid, basis, groove)
    frontSolid = result.front
    backSolid = result.back
  } else if (cutMode === 'dowel' || cutMode === 'straight-tenon' || cutMode === 'tenon') {
    const shape: 'dowel' | 'tenon' = cutMode === 'dowel' ? 'dowel' : 'tenon'
    let joineryParams: DowelOrTenonParams
    if (cutMode === 'dowel') {
      joineryParams = {
        size: (params.dowelDiameter as number) ?? 0,
        sizeTolerance: (params.dowelDiameterTolerance as number) ?? 0,
        height: (params.dowelHeight as number) ?? 0,
        heightTolerance: (params.dowelHeightTolerance as number) ?? 0,
      }
    } else {
      joineryParams = {
        size: (params.tenonSideLength as number) ?? 0,
        sizeTolerance: (params.tenonSideLengthTolerance as number) ?? 0,
        height: (params.tenonHeight as number) ?? 0,
        heightTolerance: (params.tenonHeightTolerance as number) ?? 0,
      }
    }
    const selectedSections = params.selectedSections as number[] | null | undefined
    const result = dowelOrTenonBooleanSplitBrep(
      kernel, inputSolid, basis, shape, joineryParams, selectedSections ?? null,
    )
    frontSolid = result.front
    backSolid = result.back
  } else {
    const splitResult = splitBrep(kernel, inputSolid, {
      normal: normal as Vec3,
      originOffset,
      planeCenter: planeCenter as Vec3,
    })
    frontSolid = splitResult.front
    backSolid = splitResult.back
  }

  // 分离位移：与 mesh 路径 finalizeExplode 同公式（bbox 对角线 2% + joinery 深度一半）
  const applyExplode = (params.applyExplode as boolean | undefined) ?? true
  if (applyExplode) {
    const bboxDiagonal = Math.sqrt(
      localBboxSize[0] * localBboxSize[0] + localBboxSize[1] * localBboxSize[1] + localBboxSize[2] * localBboxSize[2],
    )
    const baseOffset = bboxDiagonal * 0.02
    let joineryOffset = 0
    if (cutMode === 'dovetail') {
      joineryOffset = ((params.grooveDepth as number) ?? 0) / 2
    } else if (cutMode === 'dowel') {
      joineryOffset = ((params.dowelHeight as number) ?? 0) / 2
    } else if (cutMode === 'straight-tenon' || cutMode === 'tenon') {
      joineryOffset = ((params.tenonHeight as number) ?? 0) / 2
    }
    const frontOffset = baseOffset + joineryOffset
    const backOffset = -(baseOffset + joineryOffset)
    const frontTranslated = translateBrep(kernel, frontSolid, [
      normal[0] * frontOffset,
      normal[1] * frontOffset,
      normal[2] * frontOffset,
    ])
    const backTranslated = translateBrep(kernel, backSolid, [
      normal[0] * backOffset,
      normal[1] * backOffset,
      normal[2] * backOffset,
    ])
    kernel.release(frontSolid)
    kernel.release(backSolid)
    frontSolid = frontTranslated
    backSolid = backTranslated
  }

  const frontShape = fromBrep(solidToShape(kernel, frontSolid), { solid: frontSolid })
  const backShape = fromBrep(solidToShape(kernel, backSolid), { solid: backSolid })
  return { front: frontShape, back: backShape }
}

/** mesh 路径：manifold-3d mesh-CSG。 */
async function splitMeshPath(input: Shape, params: Record<string, unknown>): Promise<{ front: Shape; back: Shape }> {
  const cutMode = (params.cutMode as string) ?? 'plane'
  const normal = (params.normal as Vec3) ?? [0, 0, 1]
  const offset = typeof params.offset === 'number' ? params.offset : 0
  const inPlaneAngleDeg = typeof params.inPlaneAngleDeg === 'number' ? params.inPlaneAngleDeg : 0
  const bbCenter = (params.bbCenter as Vec3) ?? cad.bboxCenter(input)
  const bboxSize = (params.bboxSize as Vec3) ?? cad.boundingBox(input).max.map(
    (v, i) => v - cad.boundingBox(input).min[i],
  ) as Vec3

  const partTransform = getBackends().config.partTransform
  const localBbCenter = worldToLocalVec3(bbCenter, partTransform)
  const scale = partTransform?.scale
  const hasScale = scale && (scale[0] !== 1 || scale[1] !== 1 || scale[2] !== 1)
  const localBboxSize: Vec3 = hasScale
    ? [bboxSize[0] / scale![0], bboxSize[1] / scale![1], bboxSize[2] / scale![2]]
    : bboxSize

  const result = await cad.splitWithParams({
    shape: input,
    cutMode: cutMode as 'plane' | 'dovetail' | 'dowel' | 'straight-tenon' | 'tenon' | 'straight',
    normal,
    offset,
    inPlaneAngleDeg,
    bbCenter: localBbCenter,
    bboxSize: localBboxSize,
    groove: params.grooveDepth !== undefined ? {
      depth: params.grooveDepth as number,
      depthTolerance: (params.grooveDepthTolerance as number) ?? 0,
      width: (params.grooveWidth as number) ?? 0,
      widthTolerance: (params.grooveWidthTolerance as number) ?? 0,
      flapsAngle: (params.grooveFlapsAngle as number) ?? 0,
    } : undefined,
    dowel: params.dowelDiameter !== undefined ? {
      diameter: params.dowelDiameter as number,
      diameterTolerance: (params.dowelDiameterTolerance as number) ?? 0,
      height: (params.dowelHeight as number) ?? 0,
      heightTolerance: (params.dowelHeightTolerance as number) ?? 0,
    } : undefined,
    tenon: params.tenonSideLength !== undefined ? {
      sideLength: params.tenonSideLength as number,
      sideLengthTolerance: (params.tenonSideLengthTolerance as number) ?? 0,
      height: (params.tenonHeight as number) ?? 0,
      heightTolerance: (params.tenonHeightTolerance as number) ?? 0,
    } : undefined,
    selectedSections: params.selectedSections as number[] | null | undefined,
    applyExplode: (params.applyExplode as boolean | undefined) ?? true,
  })

  return { front: solid(result.front), back: solid(result.back) }
}

export async function split(input: Shape, params: Record<string, unknown> = {}): Promise<{ front: Shape; back: Shape }> {
  if (!input) throw new Error('[stdlib/split] no input geometry')
  if (params.normal !== undefined && params.normal !== null) {
    assertNonZeroVec3(params.normal, 'split.normal')
  }
  const path = dispatchPath([input], brepImpl)
  if (path === 'brep') return splitBrepPath(input, params)
  return splitMeshPath(input, params)
}
