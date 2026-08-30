/**
 * stdlib knurl — 滚花库函数（mesh-only）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2/P4
 *
 * knurl 无 BREP 实现（mesh-only）——dispatchPath 在 brep 模式下调用前抛错。
 * part-brep-lost 事件由引擎统一发（P4，库不再 emit）。
 */

import type { Shape, Vec3 } from '@faicad/faijs-core/mesh/types'
import { cad } from '@faicad/faijs-core/mesh'
import { solid } from '@faicad/faijs-core/shape'
import { reconcileBrepInputs } from './reconcile'
import { dispatchPath } from '@faicad/faijs-core/cad-runtime/backend-dispatch'
import { assertPositiveNumber } from './assert'

/** knurl: knurlTextureHeight 必填 > 0。 */
export function assertKnurlParams(params: Record<string, unknown>): void {
  assertPositiveNumber(params.knurlTextureHeight, 'knurl.knurlTextureHeight')
}

/**
 * 施加滚花（顶点位移，非布尔）。mesh-only。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual warn
 * @name knurl
 * @note knurl 无 BREP 实现（mesh-only），本质是顶点位移（网格操作），网格参数可接受；brep 模式下调用前抛 BrepUnsupportedError。面锚定建议用几何引用。
 * @returns Shape 滚花后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param params.knurlTextureHeight - 纹路高度（mm）。type:number 默认 0.5
 * @param params.knurlScaleU - 纹路 U 向频率。type:number 默认 0.15
 * @param params.knurlScaleV - 纹路 V 向频率。type:number 默认 0.15
 * @param params.knurlInvertDisplacement - 反向位移。type:boolean 默认 false
 * @param params.knurlRefineLength - 细分长度（mm）。type:number 默认 1.0
 * @param params.knurlMappingMode - UV 映射模式。type:number 默认 5
 * @param params.faceCenter - 面锚点中心。type:[x,y,z] 默认 bboxCenter
 * @param params.faceNormal - 面法向。type:[x,y,z] 默认 [0,0,1]
 * @example
 * const p = await cad.knurl(part0, { knurlTextureHeight: 0.5, knurlScaleU: 0.15, knurlScaleV: 0.15, knurlInvertDisplacement: false, knurlRefineLength: 1.0, knurlMappingMode: 5 })
  */
export async function knurl(input: Shape, params: Record<string, unknown>): Promise<Shape> {
  if (!input) throw new Error('[stdlib/knurl] no input geometry')
  assertKnurlParams(params)
  // mesh-only：无 brepImpl；brep 模式下 dispatchPath 调用前抛 BrepUnsupportedError
  dispatchPath([input], undefined)
  // 断链时刻（用户点名场景）：BREP 建模的模型最后做滚花 → BREP 输入必须先归约为
  // 合法 2-manifold 网格再进 mesh 路径（reconcileBrepInputs 对 mesh 侧输入原样透传）
  const [meshInput] = reconcileBrepInputs([input])
  return solid(await cad.knurl(meshInput, {
    face: {
      center: (params.faceCenter as Vec3 | undefined) ?? cad.bboxCenter(meshInput),
      normal: (params.faceNormal as Vec3 | undefined) ?? [0, 0, 1],
    },
    knurlTextureHeight: (params.knurlTextureHeight as number | undefined) ?? 0.5,
    knurlInvertDisplacement: (params.knurlInvertDisplacement as boolean | undefined) ?? false,
    knurlRefineLength: (params.knurlRefineLength as number | undefined) ?? 1.0,
    knurlScaleU: (params.knurlScaleU as number | undefined) ?? 0.15,
    knurlScaleV: (params.knurlScaleV as number | undefined) ?? 0.15,
    knurlMappingMode: (params.knurlMappingMode as number | undefined) ?? 5,
  }))
}
