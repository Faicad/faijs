/**
 * api solidFromFaces — 面集一次成型为实体（手写平台 op engines:['occt']）
 *
 * @platform occt — 本文件 import occt-kernel（`getOcctKernel().buildSolidFromFaces`）：
 * 该原生方法在 L1 契约 `brep/engine/primitives.ts` 里**没有对应成员**（L1 只有
 * `sewAndSolidify`），故 op 声明 `engines: ['occt']`（D11）。守卫 ① 要求平台
 * import 自证身份（本头注）；调用方 op 声明 `engines` 由守卫 ② 校验。
 *
 * 与 `sewAndSolidify` / `sew` 的分工（方案 §4.5 去重表）：
 * - `sewAndSolidify(faces, {tolerance})` — **中立** op，走 L1 契约的
 *   「面 → 缝合 → 固化」两步链，两引擎（occt / brepkit）同实现；
 * - `solidFromFaces(faces, {tolerance})` — **平台** op，直调 occt 原生一次性
 *   构造器 `buildSolidFromFaces`（`BRepBuilderAPI_*` 单次成型，自带缝合容差）。
 *
 * 二者并存不是双轨：一个是引擎中立的可切换路径，一个是 occt 原生的一次成型
 * 入口（真值来源是 occt-wasm 的两个不同内核方法）。新增 op 前已对照 §4.5 表。
 *
 * 产物形态：实体（solid），经 `fromBrep` 收养；面演化由内核给出 ⇒
 * `naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } }`（同 sew 族口径）。
 */

import type { Shape } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'
import { solidToShape } from '../brep/brep-ops'
import { getBrepApi } from '../brep/handle-bridge'
import { brepOf, fromBrep } from '../shape'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import { getOcctKernel } from '../occt-kernel/occtKernel'

/** `cad.solidFromFaces` 参数。 */
export interface SolidFromFacesParams {
  /** 缝合容差（mm，可选；缺省 = occt 原生默认 1e-6）。 */
  tolerance?: number
}

/** BREP 路径：借入面句柄 → occt 原生 buildSolidFromFaces（一次成型）→ fromBrep 收养。 */
function solidFromFacesBrep(faces: Shape[], params?: SolidFromFacesParams): Shape {
  if (!Array.isArray(faces) || faces.length === 0) {
    throw new Error('E_SOLID_FROM_FACES_NO_FACES: solidFromFaces requires a non-empty array of faces')
  }
  const tolerance = params?.tolerance
  if (tolerance !== undefined && (typeof tolerance !== 'number' || !(tolerance > 0))) {
    throw new Error('E_SOLID_FROM_FACES_BAD_TOLERANCE: tolerance must be a positive number')
  }
  const handles = faces.map((s) => {
    const h = brepOf(s) as BrepHandle | undefined
    if (!h) throw new Error('E_SOLID_FROM_FACES_NO_BREP: solidFromFaces input shape is not BREP')
    return h
  })
  const kernel = getBrepApi()
  const occt = getOcctKernel()
  const handle = (
    tolerance === undefined
      ? occt.buildSolidFromFaces(handles as never)
      : occt.buildSolidFromFaces(handles as never, tolerance)
  ) as unknown as BrepHandle
  return fromBrep(solidToShape(kernel, handle), { solid: handle })
}

/**
 * 面集一次成型为实体：把一组共享边界的面缝合成一个实体（occt 原生一次构造）。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name solidFromFaces
 * @note 平台 op：仅 occt 引擎（原生 buildSolidFromFaces，L1 契约无对应成员）。
 *       非 occt 引擎执行前报错；brep_mock 不拦截。中立路径见 `sewAndSolidify`。
 * @returns Shape 缝合固化后的实体。
 * @param faces - 面集合（共享边界、构成闭合壳）。type:Shape[] required:true
 * @param params.tolerance - 缝合容差（mm，默认 occt 1e-6）。type:number required:false
 * @example
 * const solid = await cad.solidFromFaces([f0, f1, f2, f3, f4, f5])
 */
export const solidFromFaces = defineOp({
  name: 'solidFromFaces',
  paramDims: { 'params.tolerance': 'length' },
  brep(faces: Shape[], params?: SolidFromFacesParams) {
    return solidFromFacesBrep(faces, params)
  },
  engines: ['occt'],
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } } as Provenance,
})
