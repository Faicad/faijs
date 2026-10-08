/**
 * api align — 包围盒锚点对齐族（S4 剩余，平台 op engines:['occt']）
 *
 * @platform occt — 三个原生方法 `alignX` / `alignY` / `alignZ`（occt-wasm 5.6.0 有）
 * 直调 occt：**不在** L1 契约 `BrepEngineApi` 里（L1 只有 `translate` 这类按向量平移，
 * 没有「把包围盒某个锚点挪到目标坐标」的成员）⇒ 平台 op。
 *
 * 方案落点：docs/plans/2026-10-07-occt-wasm-op-enablement-plan.md §3.4.9。落地为一个
 * **脚本符号** `alignTo(shape, axis, options?)`：三轴的动作是同一能力的三参数形态，
 * 分成三个符号会平白制造三个名字（同一治理理由见 `liftCurve2d` 与 `view-export`）。
 *
 * 语义：按 `anchor`（min / center / max）取形状包围盒在该轴的极值，平移使该值落到
 * `target`。**输入形状不动**（原生返回新句柄）。
 *
 * GOTCHA（实测钉住，test/api/occt-s4-boolean-align.test.ts A4b）：`target` 与 `anchor`
 * 在 d.ts 里都写作可选，但原生的**默认值**是 `target = 0` 且 **`anchor = 'center'`**
 * （dist/index.js:549-553 的默认参数）——不是直觉上的 min。缺省调用
 * `alignTo(shape, 'z')` 会把包围盒的 **中点** 挪到 z=0，而不是把最低点抬到 z=0。
 * 本 op 不替上游编默认值（缺省一律透传 undefined 让原生默认生效），因此这条语义
 * 变化会直接透到脚本面。
 *
 * naming：本族是刚体平移 ⇒ `kernel` + `newFaces: { via: 'byAdjacency' }`，与
 * api/transform.ts 的 `translate` 同口径（刚体变换不改面集，演化由邻接关系推导）。
 *
 * §9.5 降级路径：一旦 L1 契约补上进 bezeichnet 的对齐成员且两侧适配器同时落地，删掉
 * `engines` 声明改走 getBrepApi()，三个原生方法即从 C2 转入 C1。
 */

import type { Shape } from '../../mesh/types'
import type { BrepHandle } from '../../brep/engine/types'
import { solidToShape } from '../../brep/brep-ops'
import { getBrepApi } from '../../brep/handle-bridge'
import { brepOf, fromBrep } from '../../shape'
import { defineOp } from '../../sdk'
import type { Provenance } from '../../topology/naming/lineage'
import { getOcctKernel } from '../../occt-kernel/occtKernel'

/** 对齐的目标轴。 */
export type AlignAxis = 'x' | 'y' | 'z'

/** 包围盒上被对齐的那个锚点（与 occt-wasm 的 `AlignAnchor` 字面量一致）。 */
export type AlignAnchor = 'min' | 'center' | 'max'

/** `alignTo` 的选项（两个字段都缺省时取原生默认：target 0 / anchor 'min'）。 */
export interface AlignOptions {
  /** 目标坐标；缺省交由原生默认（0）。type:number required:false */
  target?: number
  /** 包围盒锚点；缺省交由原生默认（min）。type:string required:false */
  anchor?: AlignAnchor
}

const AXES: readonly AlignAxis[] = ['x', 'y', 'z']
const ANCHORS: readonly AlignAnchor[] = ['min', 'center', 'max']

/** 输入 Shape → 内核句柄（无 BREP 槽报错）。 */
function handleOf(shape: Shape): BrepHandle {
  const h = brepOf(shape) as BrepHandle | undefined
  if (!h) {
    throw new Error('E_ALIGNTO_NO_BREP: alignTo requires a BREP handle (mesh-only shape has none)')
  }
  return h
}

/** BREP 路径：按轴分派到 occt 原生 alignX / alignY / alignZ。 */
function alignToBrep(shape: Shape, axis: AlignAxis, options?: AlignOptions): Shape {
  if (!shape) {
    throw new Error('E_ALIGNTO_NO_INPUT: alignTo requires an input shape')
  }
  if (!AXES.includes(axis)) {
    throw new Error(`E_ALIGNTO_BAD_AXIS: axis must be one of x/y/z (got ${String(axis)})`)
  }
  const opts = options ?? {}
  if (opts.target !== undefined && (typeof opts.target !== 'number' || !Number.isFinite(opts.target))) {
    throw new Error('E_ALIGNTO_BAD_TARGET: target must be a finite number')
  }
  if (opts.anchor !== undefined && !ANCHORS.includes(opts.anchor)) {
    throw new Error(`E_ALIGNTO_BAD_ANCHOR: anchor must be one of min/center/max (got ${String(opts.anchor)})`)
  }
  const h = handleOf(shape)
  const k = getOcctKernel()
  const { target, anchor } = opts
  // 三分支**显式直调**（不用 `const native = axis === 'x' ? k.alignX : …` 再
  // `.call()`）：动态取属性会让覆盖率扫描器（scan-occt-op-coverage.ts）看不见
  // alignX/alignY/alignZ，它们会掉回 C4 而被误判成「未接入」。
  const handle = (
    axis === 'x'
      ? k.alignX(h as never, target, anchor as never)
      : axis === 'y'
        ? k.alignY(h as never, target, anchor as never)
        : k.alignZ(h as never, target, anchor as never)
  ) as unknown as BrepHandle
  return fromBrep(solidToShape(getBrepApi(), handle), { solid: handle })
}

/**
 * 把形状沿某一轴平移，使其包围盒的指定锚点落到目标坐标。
 * @group 变换
 * @inputs 1
 * @async false
 * @qual ok
 * @name alignTo
 * @note 平台 op：仅 occt 引擎（原生 alignX/alignY/alignZ，L1 契约无对应成员）。
 *       非 occt 引擎执行前报错；brep_mock 不拦截。
 *       输入的原形状**不会被改动**——原生返回新句柄。
 * @returns Shape 对齐后的形状。
 * @param shape - 被对齐的形状。type:Shape required:true
 * @param axis - 对齐的目标轴（x/y/z）。type:string required:true
 * @param options.target - 目标坐标（缺省交由原生默认）。type:number required:false
 * @param options.anchor - 包围盒锚点 min|center|max（缺省交由原生默认）。type:string required:false
 * @example
 * // 把零件放到 XY 平面上（最低点抬到 z=0）
 * const flat = cad.alignTo(part0, 'z')
 * // 居中：把 x 方向的包围盒中点移到 0
 * const centered = cad.alignTo(part0, 'x', { target: 0, anchor: 'center' })
 */
export const alignTo = defineOp({
  name: 'alignTo',
  paramDims: { options: 'length' },
  brep(shape: Shape, axis: AlignAxis, options?: AlignOptions) {
    return alignToBrep(shape, axis, options)
  },
  engines: ['occt'],
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } } as Provenance,
})
