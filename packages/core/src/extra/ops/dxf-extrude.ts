/**
 * faijs-extra dxfExtrude — DXF 轮廓挤出创建库函数（creator 函数，无输入）
 *
 * 与 `svgExtrude` 同一契约（贴面 / 负向 depth / 长边归一），唯一差别是轮廓来源：
 * DXF 是组码流实体（LINE/CIRCLE/ARC/LWPOLYLINE/POLYLINE），经本仓自带的
 * `brep/dxf/dxf-import.ts` 解析——**不依赖任何第三方 DXF 库**。
 *
 * dispatchPath 静态判定 brep/mesh；DXF 只有 BREP 实现（mesh 路径显式报错，
 * 与旧 engrave 的 dxf→mesh 拒绝同口径，不静默产出空体）。
 */

import type { Shape, Vec3 } from '../../mesh/types'
import type { AssetResolver } from '../../cad-runtime/ports'
import { dxfToSolid } from '../../brep/dxf/dxf-to-solid'
import { solidToShape } from '../../brep/brep-ops'
import { getBrepApi } from '../../brep/handle-bridge'
import { resolveAssetTextArg } from '../../api/internal/svg-asset-resolver'
import { getBackends } from '../../runtime-state'
import { placeOnFace } from '../../brep/text/face-place'
import { fromBrep } from '../../shape'
import { defineOp } from '../../sdk'
import type { Provenance } from '../../topology/naming/lineage'
import { assertNumber } from '../../api/assert'

/**
 * Validate dxfExtrude parameters: `dxf` is required and `depth` a finite number
 * (may be negative — a negative depth extrudes along -Z, i.e. a "concave" pocket
 * on the chosen face, the same mechanism as a sketch's negative-direction
 * extrusion, identical to `svgExtrude`).
 * @param params - the raw dxfExtrude operation parameters.
 */
export function assertDxfExtrudeParams(params: Record<string, unknown>): void {
  if (params.dxf === undefined || params.dxf === null || params.dxf === '') {
    throw new Error(`[extra/dxfExtrude] dxf is required, got ${JSON.stringify(params.dxf)}`)
  }
  assertNumber(params.depth, 'dxfExtrude.depth')
}

/** BREP 路径：DXF 组码解析 → OCCT wire/face → extrude + 贴面 + fromBrep 登记。 */
function dxfExtrudeBrep(params: Record<string, unknown>, dxfText: string): Shape {
  const kernel = getBrepApi()

  const solidHandle = dxfToSolid(kernel, dxfText, {
    depth: params.depth as number,
    targetLongSide: (params.targetLongSide as number | undefined) ?? 20,
  })

  // 面上放置（`faceCenter` 给定 = 用户先选了一张面）：居中 → 旋到法向 → 平移到面心，
  // 并沿法向推 `depth/2`（轮廓体厚度居中，不推则一半陷在面里）。与 `text` /
  // `svgExtrude` 共用 `placeOnFace`，三个入口同一张面朝向一致。
  if (params.faceCenter !== undefined && params.faceCenter !== null) {
    const faceCenter = params.faceCenter as Vec3
    const faceNormal = (params.faceNormal as Vec3 | undefined) ?? [0, 0, 1]
    const placed = placeOnFace(kernel, solidHandle, faceCenter, faceNormal, (params.depth as number) / 2)
    return fromBrep(solidToShape(kernel, placed), { solid: placed })
  }

  return fromBrep(solidToShape(kernel, solidHandle), { solid: solidHandle })
}

/**
 * 从二维 DXF 轮廓挤出零件（拓扑操作）。
 * @group 创建
 * @inputs 0
 * @async true
 * @qual warn
 * @name dxfExtrude
 * @note DXF 是外部资产，应优先用资产引用（`cad.asset(key)` 经 CallRefIR）而非整份文件内联拷贝。轮廓解析用本仓自带的 ASCII DXF 解析器（LINE/CIRCLE/ARC/LWPOLYLINE/POLYLINE + bulge 圆弧 + INSERT 展开），不引入任何第三方 DXF 库；尺寸语义由调用方给 `targetLongSide` 长边归一（DXF 图纸单位不可信，不读 $INSUNITS）。
 * @returns Shape DXF 挤出几何，生成独立零件。
 * @param params.dxf - DXF 内容：资产 key（推荐）或整份 DXF 文本（兼容）。type:string required:true
 * @param params.depth - 挤出深度（mm）；允许负值，负值=沿 -Z 负向拉伸（凹陷口袋，与草图负向拉伸同逻辑）。type:number required:true
 * @param params.targetLongSide - 长边目标尺寸（mm）。type:number 默认 20
 * @param params.faceCenter - 面心（给了就贴在该面上：轮廓中心落此处、厚度朝面外）。type:[x,y,z]
 * @param params.faceNormal - 面外法向（与 faceCenter 配套；缺省 [0,0,1]）。type:[x,y,z]
 * @note faceCenter 只有 BREP 实现：mesh 几何上传 faceCenter 会显式报错（不静默忽略）。不给 faceCenter 时保持历史行为（XY 居中、Z 底部对齐原点）。
 * @example
 * const s = cad.dxfExtrude({ dxf: 'logo.dxf', depth: 5, targetLongSide: 20 })
 * @example
 * const s = cad.dxfExtrude({ dxf: 'logo.dxf', depth: 5, targetLongSide: 20, faceCenter: [0, 0, 15], faceNormal: [0, 0, 1] })
  */
export const dxfExtrude = defineOp({
  mesh: async (params: Record<string, unknown>) => {
    assertDxfExtrudeParams(params)
    // DXF 只有 BREP 实现（`dxfToSolid` 走内核的面/拉伸）。mesh 几何上前端仍会进
    // 到这里 —— 静默忽略等于"选了个 DXF 但什么都没刻"，必须报错（与旧 engrave
    // 的 dxf mesh 拒绝同口径）。
    throw new Error('[extra/dxfExtrude] dxf source requires BREP geometry (input is mesh)')
  },
  brep: async (params: Record<string, unknown>) => {
    assertDxfExtrudeParams(params)
    const dxfText = await resolveAssetTextArg(params.dxf, { assets: getBackends().assets as AssetResolver | undefined }, 'DXF')
    return dxfExtrudeBrep(params, dxfText)
  },
  naming: { kind: 'construct', newFaces: { via: 'explicit', vocab: [] } } as Provenance,

  paramDims: { depth: 'length', targetLongSide: 'length', faceCenter: 'length', faceNormal: 'plain' },
})
