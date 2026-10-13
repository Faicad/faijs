/**
 * api helix — 螺旋线（1D 曲线，全平台中立 op）
 *
 * 2026-10-13：`makeHelixWire` 已进 L1 中立面（`BrepEngineApi`），本 op 由
 * 「occt 平台 op」升为**全平台中立 op** —— 不再声明 `engines: ['occt']`。
 *
 * - 右手（默认 `'right'`）：走 `getBrepApi().makeHelixWire`（L1）。
 *   brepkit 侧是采样拟合近似（无 1D 螺旋原语），偏差已钉 band。
 * - 左手（`handed: 'left'`）：仍是 **occt 平台路径**（`getOcctKernel().makeHelixWireHanded`）
 *   —— brepkit 无带手性的螺旋原语。非 occt 引擎下该分支由 `getOcctKernel()` 抛错，
 *   不做镜像兜底（静默换算法比报错更危险）。
 * - 1D 产物：经 fromBrepCurve 登记，kind='curve'。
 */

import type { Shape } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'
import { solidToShape } from '../brep/brep-ops'
import { getBrepApi } from '../brep/handle-bridge'
import { fromBrepCurve } from '../shape'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import { getOcctKernel } from '../occt-kernel/occtKernel'

/** 螺旋手性：`'right'`（右手，逆时针上旋）或 `'left'`（左手，顺时针上旋）。 */
export type HelixHanded = 'right' | 'left'

/** `cad.helix` 参数。 */
export interface HelixOptions {
  /** 螺旋半径（mm，>0）。 */
  radius: number
  /** 螺距（mm，每圈沿轴的推进量，≠0）。 */
  pitch: number
  /** 圈数（>0）。 */
  turns: number
  /** 螺旋轴方向（单位向量，默认 +Z）。 */
  axis?: [number, number, number]
  /** 起点（默认原点）。 */
  origin?: [number, number, number]
  /**
   * 手性（默认 `'right'`）。同 pitch/height/radius 下左右旋互为镜像。
   * `'right'` 走 `makeHelixWire`，`'left'` 走 `makeHelixWireHanded(..., true)`。
   */
  handed?: HelixHanded
}

/** BREP 路径：用 occt 原生 makeHelixWire / makeHelixWireHanded 构造螺旋线，登记 1D 句柄。 */
function helixBrep(opts: HelixOptions): Shape {
  const { radius, pitch, turns } = opts
  if (!(radius > 0)) throw new Error('E_HELIX_BAD_RADIUS: radius must be > 0')
  if (!(pitch !== 0)) throw new Error('E_HELIX_BAD_PITCH: pitch must be non-zero')
  if (!(turns > 0)) throw new Error('E_HELIX_BAD_TURNS: turns must be > 0')
  const handed = opts.handed ?? 'right'
  if (handed !== 'right' && handed !== 'left') {
    throw new Error(`E_HELIX_BAD_HANDED: handed must be 'right' or 'left' (got '${String(handed)}')`)
  }
  const axis = opts.axis ?? [0, 0, 1]
  const origin = opts.origin ?? [0, 0, 0]
  const height = pitch * turns
  const kernel = getBrepApi()
  const o = { x: origin[0], y: origin[1], z: origin[2] }
  const a = { x: axis[0], y: axis[1], z: axis[2] }
  // 右手（默认）= L1 中立名，两引擎都能建；左手仍是 occt 平台原语（无镜像兜底）。
  const handle = (
    handed === 'left'
      ? getOcctKernel().makeHelixWireHanded(o, a, pitch, height, radius, true)
      : kernel.makeHelixWire(o, a, pitch, height, radius)
  ) as unknown as BrepHandle
  return fromBrepCurve(solidToShape(kernel, handle), { solid: handle })
}

/**
 * 构造螺旋线（1D 曲线）。
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name helix
 * @note 全平台中立 op：右手走 L1 makeHelixWire（brepkit 侧为采样拟合近似）；左手 handed:'left' 仍仅 occt（平台原语 makeHelixWireHanded）。
 * @returns Shape 1D 螺旋线（kind:'curve'）。
 * @param options.radius - 螺旋半径（mm，>0）。type:number required:true
 * @param options.pitch - 螺距（mm，≠0）。type:number required:true
 * @param options.turns - 圈数（>0）。type:number required:true
 * @param options.axis - 螺旋轴方向（默认 +Z）。type:Vec3 required:false
 * @param options.origin - 起点（默认原点）。type:Vec3 required:false
 * @param options.handed - 手性：'right'（默认）或 'left'。type:HelixHanded required:false
 * @example
 * const h = cad.helix({ radius: 5, pitch: 2, turns: 3 })
 * const lh = cad.helix({ radius: 5, pitch: 2, turns: 3, handed: 'left' })
 */
export const helix = defineOp({
  // name 必填：① 引擎门文案携带 op 名（`op 'helix' requires engine occt`，见
  // test/api/sweep-loft.test.ts GOTCHA-3 对该形态的要求）；② occt op 覆盖率扫描器
  // 的 op 全集只收 `export const X = defineOp({ name: '…' })`——缺 name 的 op
  // 不可见，其直调的 occt 方法（makeHelixWireHanded）会被误判为「未接入」。
  name: 'helix',
  brep(opts: HelixOptions) {
    return helixBrep(opts)
  },
  naming: { kind: 'unmodeled', reason: 'construct vocabulary pending Phase 3' } as Provenance,

  paramDims: {},
})
