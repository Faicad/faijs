/**
 * api faceFromWire — 平面 wire → face（组装矩阵「部件列表→容器」的 2D 格）
 *
 * 与 `cad.wireFromEdges`（边列表→wire）构成完整组装链 edges→wire→face，与
 * `cad.solidFromFaces` / `cad.sew` 同族。L1 `makeFace`（`brep/engine/primitives.ts`）
 * 两引擎 dialect（occt `makeFace` 平面路径 / brepkit `makeFaceFromWire`），
 * 故本 op 是中立 op。
 *
 * 平面限定：`surfaceType(face) !== 'plane'` 抛错——非平面 wire 走
 * `cad.nonPlanarFace`（occt-only），职责分离与库层 `brep-topology.face()` 一致。
 * 不闭合 wire 由内核 makeFace 报错直通。
 *
 * 产物必须走有网格收养（`fromBrep(solidToShape(...))`，sketchOnPlane 同款）：
 * 库层 `face()` 的 `wrapSolid`（EMPTY_MESH）无显示网格，脚本面最终产物会空白，
 * 不可复用。1D/2D 产物的统一契约：可显示、可消费、消费即消失（见
 * `docs/plans/2026-11-14-shape-api-extensions.md` §2.1）。
 */

import type { Shape } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'
import { solidToShape } from '../brep/brep-ops'
import { getBrepApi } from '../brep/handle-bridge'
import { brepOf, fromBrep } from '../shape'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'

/** BREP 路径：借入 wire 句柄 → L1 makeFace（平面路径）→ 平面校验 → （可选）加孔 → 有网格收养。 */
function faceFromWireBrep(wire: Shape, holes?: Shape[]): Shape {
  const wh = brepOf(wire) as BrepHandle | undefined
  if (wh === undefined) {
    throw new Error('E_FACE_FROM_WIRE_NO_BREP: faceFromWire input wire is not BREP')
  }
  const holeHandles = (holes ?? []).map((h) => {
    const hh = brepOf(h) as BrepHandle | undefined
    if (hh === undefined) throw new Error('E_FACE_FROM_WIRE_NO_BREP: faceFromWire hole shape is not BREP')
    return hh
  })
  const kernel = getBrepApi()
  let face = kernel.makeFace(wh)
  if (holeHandles.length > 0) {
    face = kernel.addHolesInFace(face, holeHandles)
  }
  if (kernel.surfaceType(face) !== 'plane') {
    throw new Error('E_FACE_FROM_WIRE_NOT_PLANAR: faceFromWire requires a planar wire (use cad.nonPlanarFace for non-planar boundaries)')
  }
  return fromBrep(solidToShape(kernel, face), { solid: face })
}

/**
 * 平面 wire → face：由闭合平面 wire 构造面（可选孔 wire）。
 * @group 创建
 * @inputs 1
 * @async false
 * @qual ok
 * @name faceFromWire
 * @note 中立 op：L1 makeFace 两引擎 dialect（brepkit 侧 makeFaceFromWire）。
 *       平面限定——非平面 wire 抛 E_FACE_FROM_WIRE_NOT_PLANAR（走 cad.nonPlanarFace）。
 * @returns Shape 平面 face（可显示、可被 extrude/revolve/thicken 消费）。
 * @param wire - 闭合平面 wire Shape（`cad.wire` / `cad.wireFromEdges` / `cad.outerWire` 等产物）。type:Shape required:true
 * @param holes - 可选孔 wire 列表（落在面内，经 addHolesInFace）。type:Shape[] required:false
 * @example
 * const rect = cad.wire([[0,0,0],[10,0,0],[10,6,0],[0,6,0]], { closed: true })
 * const face = cad.faceFromWire(rect)
 * const box = cad.extrude(face, 5)
 */
export const faceFromWire = defineOp({
  brep(wire: Shape, holes?: Shape[]) {
    return faceFromWireBrep(wire, holes)
  },
  naming: { kind: 'unmodeled', reason: 'no source-derived face role vocabulary' } as Provenance,

  paramDims: {},
})
