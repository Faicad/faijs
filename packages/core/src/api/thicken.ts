/**
 * stdlib thicken — 加厚：把面/壳偏置成实体（手写平台 op，Phase 5）
 *
 * @platform occt — 实现走 vendored `thicken`（`BRepOffset_MakeOffset` /
 * `thickenWithHistory`；brepkit 无对应 API，engine-method-map `occt-only`）⇒
 * 平台 op：defineOp 声明 `engines: ['occt']`（D11）。
 *
 * 输入口径（方案 §7 待裁决 2 → (b)）：薄壳化的起点是**面**——脚手架语言里最自然的
 * 面来源是 `cad.sketch(...)`（产出 face Shape）；faceRef 产物是纯数据 TopoRef（不是
 * Shape），不适用于「从无到有造体」的 thicken。入参收 Shape（face），内部借入喂
 * vendored thicken。
 */

import type { Shape } from '../mesh/types'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import { thicken as vendoredThicken } from '../vendored/brepjs/topology/modifierFns.js'
import { adoptEntity, borrowBrepjsShape, callBrepjs } from './internal/l3-bridge'
import { unwrapOrThrow } from './internal/compat-op'

/**
 * 加厚：把面（或壳）沿法向偏置成等厚实体。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name thicken
 * @note 平台 op：仅 occt 引擎（BRepOffset）。输入为面/壳 Shape（如 cad.sketch 产物）；
 *       正厚度沿法向、负厚度反向。非 occt 引擎执行前报错；brep_mock 不拦截。
 * @returns Shape 加厚后的实体。
 * @param input - 面/壳几何（cad.sketch 产物等）。type:Shape required:true
 * @param thickness - 厚度（mm，≠0；正沿法向，负反向）。type:number required:true
 * @example
 * const face = cad.sketch({ contours: [{ segments: [
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
    const view = borrowBrepjsShape(input)
    const r = callBrepjs(vendoredThicken, [view, thickness])
    return adoptEntity(unwrapOrThrow(r, 'thicken'), 'thicken') as Shape
  },
  engines: ['occt'],
  naming: { kind: 'unmodeled', reason: 'thickened-body face vocabulary not defined' } as Provenance,
})
