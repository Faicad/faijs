/**
 * api helix — 螺旋线（1D 曲线，全平台中立 op）
 *
 * 2026-10-13：`makeHelixWire` 已进 L1 中立面（`BrepEngineApi`），本 op 由
 * 「occt 平台 op」升为**全平台中立 op** —— 不再声明 `engines: ['occt']`。
 *
 * 手性是 `makeHelixWire` 的**形参**（`leftHanded`），由引擎适配器消化，本文件只看 L1：
 * - 右手（默认 `'right'`）：两引擎都可建。brepkit 侧是采样拟合近似
 *   （无 1D 螺旋原语），偏差已钉 band。
 * - 左手（`handed: 'left'`）：occt 侧走原生带手性入口（`makeHelixWireHanded`）；
 *   brepkit 无带手性原语 → 适配器**显式失败**，不做镜像兜底
 *   （静默换算法比报错更危险）。故本文件不 import 平台模块、也不按 op 声明
 *   `engines: ['occt']`——那会把右手一并拒掉。
 * - 1D 产物：经 fromBrepCurve 登记，kind='curve'。
 */

import type { Shape } from '../mesh/types'
import { solidToShape } from '../brep/brep-ops'
import { getBrepApi } from '../brep/handle-bridge'
import { fromBrepCurve } from '../shape'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'

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
   * 经 L1 `makeHelixWire(..., leftHanded)` 送达引擎适配器：occt 两侧都原生支持；
   * brepkit 只有右手（左手显式失败，不镜像）。
   */
  handed?: HelixHanded
}

/** BREP 路径：经 L1 `makeHelixWire` 构造螺旋线（手性作为形参），登记 1D 句柄。 */
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
  // 手性是 L1 形参：occt 侧左右手都是原生路径；brepkit 侧右手采样拟合、左手由
  // 适配器显式拒绝（无镜像兜底）。本文件因此不需要任何平台 import。
  const handle = kernel.makeHelixWire(o, a, pitch, height, radius, handed === 'left')
  return fromBrepCurve(solidToShape(kernel, handle), { solid: handle })
}

/**
 * 构造螺旋线（1D 曲线）。
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name helix
 * @note 全平台中立 op：手性是 L1 `makeHelixWire` 的形参（`leftHanded`）——右手两引擎都可建（brepkit 侧为采样拟合近似）；左手仅 occt 原生支持，brepkit 适配器显式失败（不镜像兜底）。
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
  // name 必填：occt op 覆盖率扫描器的 op 全集只收
  // `export const X = defineOp({ name: '…' })`——缺 name 的 op 在报告里不可见。
  // （本 op 无平台直调：左手经 L1 形参送达，原生 makeHelixWireHanded 由契约实现层
  //   直调，见 occt-kernel/occt-primitives.ts。）
  name: 'helix',
  brep(opts: HelixOptions) {
    return helixBrep(opts)
  },
  naming: { kind: 'unmodeled', reason: 'construct vocabulary pending Phase 3' } as Provenance,

  paramDims: { radius: 'length', pitch: 'length', turns: 'plain' },
})
