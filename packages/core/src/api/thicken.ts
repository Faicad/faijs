/**
 * stdlib thicken — 加厚：把面（或壳）沿法向偏置成等厚实体（手写平台 op，Phase 4 → G5 core 直连）
 *
 * @platform occt — 实现走 occt-wasm 原生 `thicken`（BRepOffsetAPI_MakeThickSolid；
 * engine-method-map 里 `thicken` 为 occt-only）⇒ 平台 op：defineOp 声明
 * `engines: ['occt']`（D11）。
 *
 * core-decouple G5：vendored `thicken`（brepjs modifierFns，thickenWithHistory）
 * 替换为 occt-wasm 原生直连，产物经 `fromBrep` 收养（替代 l3-bridge adoptEntity）。
 */

import type { Shape } from '../mesh/types'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import { getBrepApi } from '../brep/handle-bridge'
import { brepOf, fromBrep } from '../shape'
import { solidToShape } from '../brep/brep-ops'
import { getOcctKernel } from '../occt-kernel/occtKernel'
import type { BrepHandle } from '../brep/engine/types'

/**
 * 加厚：把面（或壳）沿法向偏置成等厚实体。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name thicken
 * @note 平台 op：仅 occt 引擎（BRepOffset）。输入为面/壳 Shape（如 cad.profile 产物）；
 *       正厚度沿法向、负厚度反向。非 occt 引擎执行前报错；brep_mock 不拦截。
 * @returns Shape 加厚后的实体。
 * @param input - 面/壳几何（cad.profile 产物等）。type:Shape required:true
 * @param thickness - 厚度（mm，≠0；正沿法向，负反向）。type:number required:true
 * @example
 * const face = cad.profile({ contours: [{ segments: [
 *   { kind: 'line', x1: -10, y1: -10, x2: 10, y2: -10 },
 *   { kind: 'line', x1: 10, y1: -10, x2: 10, y2: 10 },
 *   { kind: 'line', x1: 10, y1: 10, x2: -10, y2: 10 },
 *   { kind: 'line', x1: -10, y1: 10, x2: -10, y2: -10 },
 * ] }] })
 * const solid = await cad.thicken(face, 2)
 */
export const thicken = defineOp({
  name: 'thicken',
  brep(input: Shape, thickness: number) {
    if (!input) throw new Error('E_THICKEN_NO_SHAPE: thicken requires a face/shell shape')
    if (typeof thickness !== 'number' || !Number.isFinite(thickness) || thickness === 0) {
      throw new Error('E_THICKEN_BAD_THICKNESS: thicken.thickness must be a non-zero number')
    }
    const kernel = getBrepApi()
    const handle = brepOf(input) as BrepHandle | undefined
    if (!handle) throw new Error('[thicken] input is not BREP')
    const h = getOcctKernel().thicken(handle as never, thickness, 1e-6) as unknown as BrepHandle
    return fromBrep(solidToShape(kernel, h), { solid: h }) as Shape
  },
  engines: ['occt'],
  naming: { kind: 'unmodeled', reason: 'thickened-body face vocabulary not defined' } as Provenance,
})
