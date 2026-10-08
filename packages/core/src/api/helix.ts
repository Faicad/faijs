/**
 * api helix — 螺旋线（1D 曲线，平台 op engines:['occt']）
 *
 * @platform occt — 本文件 import occt-kernel：螺旋线用 `makeHelixWire` 构造
 * （occt-wasm 原生有，L1 无）。守卫 ① 要求平台 import 自证身份；调用方 op 声明
 * `engines: ['occt']` 由守卫 ② 校验。
 *
 * 用途：G-D 门控层的 1D 造线能力（Phase 3）。下游 sweep / loft 等可用螺旋线作 spine。
 *
 * 设计：
 * - 平台 op：occt 原生 makeHelixWire（occt-wasm 有，L1 无）→ 声明 engines:['occt']（D11）。
 *   实现直连平台原生方法，能力由引擎身份本身界定（无第二个声明轴）。
 * - 1D 产物：经 fromBrepCurve 登记，kind='curve'。
 * - 非 occt 引擎（brepkit）→ 执行前 BrepUnsupportedError（D11-4）；brep_mock 受 D11-3
 *   豁免不拦截（且 getOcctKernel 为全局 occt 实例，brep_mock 下仍可真实出线）。
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
  const occt = getOcctKernel()
  const o = { x: origin[0], y: origin[1], z: origin[2] }
  const a = { x: axis[0], y: axis[1], z: axis[2] }
  // 右手默认沿用 makeHelixWire（保持两个原生入口都可达）；左手走带手性的显式入口。
  const handle = (
    handed === 'left'
      ? occt.makeHelixWireHanded(o, a, pitch, height, radius, true)
      : occt.makeHelixWire(o, a, pitch, height, radius)
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
 * @note 平台 op：仅 occt 引擎（原生 makeHelixWire / makeHelixWireHanded）。非 occt 引擎执行前报错；brep_mock 不拦截。
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
  engines: ['occt'],
  naming: { kind: 'unmodeled', reason: 'construct vocabulary pending Phase 3' } as Provenance,
})
