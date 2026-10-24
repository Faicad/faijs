/**
 * faijs-extra split — 分割库函数（返回具名对象 { front, back }）
 *
 *
 * dispatchPath 静态判定 brep/mesh，双输出以具名对象返回（替代 outputCache 多输出写入）。
 */

import type { Shape, Vec3 } from '../../mesh/types'
import { splitWithParams as meshSplitWithParams, separationOffset } from '../mesh/fai_split'
import { bboxCenter, boundingBox } from '../../mesh/query'
import {
  splitBrep,
  solidToShape,
  translateBrep,
} from '../../brep/brep-ops'
import {
  dovetailBooleanSplitBrep,
  dowelOrTenonBooleanSplitBrep,
  type JoineryBasis,
  type GrooveParams,
  type DowelOrTenonParams,
} from '../../api/brep-operations/joinery-brep'
import { computeBasisFromNormal } from '../mesh/fai_split'
import { getBrepApi } from '../../brep/handle-bridge'
import { solid, fromBrep, brepOf } from '../../shape'
import { defineOp } from '../../sdk'
import type { Provenance } from '../../topology/naming/lineage'
import { assertNonZeroVec3 } from '../../api/assert'
import type { BrepHandle } from '../../brep/engine/types'

/** BREP 路径：OCCT 平面/榫卯分割 + 分离位移。 */
function splitBrepPath(input: Shape, params: Record<string, unknown>): { front: Shape; back: Shape } {
  const kernel = getBrepApi()
  const inputSolid = brepOf(input) as BrepHandle | undefined
  if (inputSolid === undefined) throw new Error('[extra/split] input is not BREP')

  const cutMode = (params.cutMode as string) ?? 'plane'
  const normal = (params.normal as Vec3) ?? [0, 0, 1]
  const offset = typeof params.offset === 'number' ? params.offset : 0
  const inPlaneAngle = typeof params.inPlaneAngle === 'number' ? params.inPlaneAngle : 0
  // 坐标契约（方向 A）：bbCenter/bboxSize 是模型局部空间值——宿主生成脚本时已把
  // 交互世界坐标转换好，本 op 不做 world→local（无 partTransform 依赖）。
  const bbCenter = (params.bbCenter as Vec3) ?? bboxCenter(input)
  const bboxSize = (params.bboxSize as Vec3) ?? boundingBox(input).max.map(
    (v, i) => v - boundingBox(input).min[i],
  ) as Vec3
  const planeCenter: Vec3 = [
    bbCenter[0] + offset * normal[0],
    bbCenter[1] + offset * normal[1],
    bbCenter[2] + offset * normal[2],
  ]
  const planeDistance = normal[0] * planeCenter[0] + normal[1] * planeCenter[1] + normal[2] * planeCenter[2]

  const { widthDir, depthDir } = computeBasisFromNormal(normal, inPlaneAngle)
  const basis: JoineryBasis = {
    normal: normal as Vec3,
    widthDir: widthDir as Vec3,
    depthDir: depthDir as Vec3,
    planeCenter: planeCenter as Vec3,
    planeDistance,
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
      planeDistance,
      planeCenter: planeCenter as Vec3,
    })
    frontSolid = splitResult.front
    backSolid = splitResult.back
  }

  // 分离位移：两侧沿切割面法向对开 ±V，V 由调用方显式给出（都不传 ⇒ V = 0 ⇒ 不分开）。
  // 唯一公式在 extra/mesh/fai_split.ts 的 separationOffset（brep 与 mesh 两路径共用）。
  const separation = separationOffset(
    {
      separationRatio: typeof params.separationRatio === 'number' ? params.separationRatio : undefined,
      separation: typeof params.separation === 'number' ? params.separation : undefined,
    },
    bboxSize,
  )
  if (separation !== 0) {
    const frontTranslated = translateBrep(kernel, frontSolid, [
      normal[0] * separation,
      normal[1] * separation,
      normal[2] * separation,
    ])
    const backTranslated = translateBrep(kernel, backSolid, [
      normal[0] * -separation,
      normal[1] * -separation,
      normal[2] * -separation,
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
  const inPlaneAngle = typeof params.inPlaneAngle === 'number' ? params.inPlaneAngle : 0
  const bbCenter = (params.bbCenter as Vec3) ?? bboxCenter(input)
  const bboxSize = (params.bboxSize as Vec3) ?? boundingBox(input).max.map(
    (v, i) => v - boundingBox(input).min[i],
  ) as Vec3
  // 坐标契约（方向 A）：bbCenter/bboxSize 是模型局部空间值（宿主生成脚本时已转），
  // 本 op 不做 world→local（无 partTransform 依赖）。

  const result = await meshSplitWithParams({
    shape: input,
    cutMode: cutMode as 'plane' | 'dovetail' | 'dowel' | 'straight-tenon' | 'tenon' | 'straight',
    normal,
    offset,
    inPlaneAngle,
    bbCenter,
    bboxSize,
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
    separationRatio: typeof params.separationRatio === 'number' ? params.separationRatio : undefined,
    separation: typeof params.separation === 'number' ? params.separation : undefined,
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
 * @deprecated **`../3d_editor` 消费面**（原 `@deprecated` 措辞已于 2026-09-22 校正）：`fai_` 前缀 op 为编辑器应用提供，不属 faijs 平台面，但**不是废弃项**——它服务真实负载。**变更其 API 形态必须同步更新 `../3d_editor`**。faijs 平台面不提供等价 op（需要时须按平台需求另行设计，不得直接搬用本 op）。
 * @returns { front: Shape; back: Shape } 必须用解构 `const { front: partA, back: partB } = cad.fai_split(...)` 取出两个零件。
 * @param input - 目标几何。type:Shape required:true
 * @param params.cutMode - 切割模式。type:'plane' | 'dovetail' | 'dowel' | 'tenon' | 'straight-tenon' | 'straight' 默认 'plane'
 * @param params.normal - 切割面法向。type:[x,y,z] 默认 [0,0,1]
 * @param params.offset - 切割面沿法向偏移（过 bbCenter）。type:number 默认 0
 * @param params.inPlaneAngle - 切割面面内旋转角（度）。type:number 默认 0
 * @param params.bbCenter - 包围盒中心（缺省自动推导）。type:[x,y,z] 默认 自动
 * @param params.bboxSize - 包围盒尺寸（缺省自动推导）。type:[x,y,z] 默认 自动
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
 * @param params.separationRatio - 分割后两半沿切割面法向对开的单侧距离中「占 bbox 对角线的比例」部分。**比值不是百分数**：0.02 表示 2%。type:number 默认 0
 * @param params.separation - 分割后两半沿切割面法向对开的单侧距离中的绝对追加量（mm），典型值 = 半个榫卯深度（不拉开至少半个榫长，榫头仍插在槽里）。type:number 默认 0
 * @note 切割面统一用 `normal`/`offset`/`inPlaneAngle` 描述；早期文本层曾与执行层键名断裂（planeRotation/planePosition），已修并统一为上述键名。
 * @example
 * const { front: part1, back: part2 } = cad.fai_split(part0, { normal: [0, 0, 1], offset: 5, cutMode: 'dovetail', grooveDepth: 3, grooveWidth: 5 })
  */
export const fai_split = defineOp({
  mesh: (input: Shape, params: Record<string, unknown> = {}) => {
    if (!input) throw new Error('[extra/split] no input geometry')
    if (params.normal !== undefined && params.normal !== null) {
      assertNonZeroVec3(params.normal, 'split.normal')
    }
    return splitMeshPath(input, params)
  },
  brep: (input: Shape, params: Record<string, unknown> = {}) => {
    if (!input) throw new Error('[extra/split] no input geometry')
    if (params.normal !== undefined && params.normal !== null) {
      assertNonZeroVec3(params.normal, 'split.normal')
    }
    return splitBrepPath(input, params)
  },
  outputs: ['front', 'back'],
  naming: { kind: 'subdivide' } as Provenance,
  // 脚本面参数量纲（单位系统 G3）：offset/木销/榫头/榫槽为 length，inPlaneAngle 为 angle。
  paramDims: {
    offset: 'length',
    inPlaneAngle: 'angle',
    grooveDepth: 'length',
    grooveWidth: 'length',
    dowelDiameter: 'length',
    dowelHeight: 'length',
    tenonSideLength: 'length',
    tenonHeight: 'length',
    // 分离位移：绝对追加量是长度；比例是显式无量纲（`0.02` = 2%，不是 2% 的字符串）。
    // 二者都必须出现在 paramDims —— 漏声明会让检查器跳过该槽位，裸数字就此溜过量纲系统。
    separation: 'length',
    separationRatio: 'plain',
    // 公差与主尺寸同量纲；翼角是角度；截面下标是无量纲索引。
    grooveDepthTolerance: 'length',
    grooveWidthTolerance: 'length',
    grooveFlapsAngle: 'angle',
    dowelDiameterTolerance: 'length',
    dowelHeightTolerance: 'length',
    tenonSideLengthTolerance: 'length',
    tenonHeightTolerance: 'length',
    selectedSections: 'plain',
  },
})
