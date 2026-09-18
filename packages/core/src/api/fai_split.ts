/**
 * stdlib split — 分割库函数（返回具名对象 { front, back }）
 *
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
} from './brep-mirror/joinery-brep'
import { computeBasisFromNormal } from '../mesh/fai_split'
import { getBackends } from '../runtime-state'
import { solid, fromBrep, brepOf } from '../shape'
import { defineOp } from '../sdk'
import { assertNonZeroVec3 } from './assert'
import type { BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'

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
  const kernel = getBackends().kernel.brep as BrepEngineApi | null
  if (!kernel) throw new Error('[stdlib/split] no OCCT kernel')
  const inputSolid = brepOf(input) as BrepHandle | undefined
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

  let frontSolid: BrepHandle
  let backSolid: BrepHandle

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

  const result = await cad.fai_splitWithParams({
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

/**
 * 分割几何，返回具名对象 { front, back } 两个独立零件。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual warn
 * @name fai_split
 * @deprecated `fai_` 前缀 op 是 ../3d_editor 项目特有的操作，不属于 faijs 平台面；将来会迁往该项目并从 faijs 删除。新代码请勿使用。
 * @returns { front: Shape; back: Shape } 必须用解构 `const { front: partA, back: partB } = await cad.fai_split(...)` 取出两个零件。
 * @param input - 目标几何。type:Shape required:true
 * @param params.cutMode - 切割模式。type:'plane' | 'dovetail' | 'dowel' | 'tenon' | 'straight-tenon' | 'straight' 默认 'plane'
 * @param params.normal - 切割面法向。type:[x,y,z] 默认 [0,0,1]
 * @param params.offset - 切割面沿法向偏移（过 bbCenter）。type:number 默认 0
 * @param params.inPlaneAngleDeg - 切割面面内旋转角（度）。type:number 默认 0
 * @param params.bbCenter - 包围盒中心（缺省自动推导）。type:[x,y,z] 默认 自动
 * @param params.bboxSize - 包围盒尺寸（缺省自动推导）。type:[x,y,z] 默认 自动
 * @param params.applyExplode - 是否将两侧沿法向分离位移（bbox 对角线 2% + 榫卯深度一半）。type:boolean 默认 true
 * @param params.grooveDepth - 燕尾槽深（cutMode='dovetail'）。type:number
 * @param params.grooveWidth - 燕尾槽宽（cutMode='dovetail'）。type:number
 * @param params.grooveDepthTolerance - 燕尾槽深公差。type:number
 * @param params.grooveWidthTolerance - 燕尾槽宽公差。type:number
 * @param params.grooveFlapsAngle - 燕尾槽翼角（度）。type:number
 * @param params.dowelDiameter - 定位销直径（cutMode='dowel'）。type:number
 * @param params.dowelDiameterTolerance - 定位销直径公差。type:number
 * @param params.dowelHeight - 定位销高度。type:number
 * @param params.dowelHeightTolerance - 定位销高度公差。type:number
 * @param params.tenonSideLength - 直榫边长（cutMode='tenon'/'straight-tenon'）。type:number
 * @param params.tenonSideLengthTolerance - 直榫边长公差。type:number
 * @param params.tenonHeight - 直榫高度。type:number
 * @param params.tenonHeightTolerance - 直榫高度公差。type:number
 * @param params.selectedSections - 参与榫卯的截面下标。type:number[]
 * @note 切割面统一用 `normal`/`offset`/`inPlaneAngleDeg` 描述；早期文本层曾与执行层键名断裂（planeRotation/planePosition），已修并统一为上述键名。
 * @example
 * const { front: part1, back: part2 } = await cad.fai_split(part0, { normal: [0, 0, 1], offset: 5, cutMode: 'dovetail', grooveDepth: 3, grooveWidth: 5 })
  */
export const fai_split = defineOp({
  mesh: (input: Shape, params: Record<string, unknown> = {}) => {
    if (!input) throw new Error('[stdlib/split] no input geometry')
    if (params.normal !== undefined && params.normal !== null) {
      assertNonZeroVec3(params.normal, 'split.normal')
    }
    return splitMeshPath(input, params)
  },
  brep: (input: Shape, params: Record<string, unknown> = {}) => {
    if (!input) throw new Error('[stdlib/split] no input geometry')
    if (params.normal !== undefined && params.normal !== null) {
      assertNonZeroVec3(params.normal, 'split.normal')
    }
    return splitBrepPath(input, params)
  },
  outputs: ['front', 'back'],
})
