/**
 * stdlib sectionByPlane — 平面求交线：solid 与无限平面的精确截面（手写中立 op，Phase 6.2）
 *
 * 中立 op：L1 `sectionByPlane(shape, point, normal)` 两引擎同实现
 * （engine-method-map `dialect`；occt 适配器用大平面 face 作 tool 经原生 section，
 * brepkit 映射其平面求交）⇒ 走 `getBrepApi()`，不声明 engines。
 *
 * 产物形态（方案 §4 Phase 6.2）：1D compound——`CompoundShape{ children: CurveShape[] }`
 * （每条交线经 `fromBrepCurve` 登记 1D 句柄；空截面 ⇒ 空数组 children）。
 * 依赖 Phase 3 已落地的 `curve()` / `fromBrepCurve` 1D 形态。
 *
 * 仅 BREP 可用（同 shell/splitByPlane）：mesh 输入执行前报错（backend-dispatch 静态判定）。
 */

import type { Shape } from '../mesh/types'
import type { BrepHandle, BrepVec3 } from '../brep/engine/types'
import { solidToShape } from '../brep/brep-ops'
import { getBrepApi } from '../brep/handle-bridge'
import { brepOf, fromBrep, fromBrepCurve } from '../shape'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'

/** `cad.sectionByPlane` 参数。 */
export interface SectionByPlaneParams {
  /** 平面上一点 [x, y, z]。 */
  point: [number, number, number]
  /** 平面法向 [x, y, z]（不必单位化）。 */
  normal: [number, number, number]
}

/** 归一化 3D 点参数（[x,y,z] 数组 → BrepVec3）。 */
function toVec3(raw: unknown, what: string): BrepVec3 {
  if (!Array.isArray(raw) || raw.length < 3 || raw.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    throw new Error(`E_SECTION_BY_PLANE_BAD_${what.toUpperCase()}: ${what} must be [x, y, z] finite numbers`)
  }
  return { x: raw[0] as number, y: raw[1] as number, z: raw[2] as number }
}

/** BREP 路径：L1 sectionByPlane → 每条交线登记为 1D curve → compound 打包。 */
function sectionByPlaneBrep(input: Shape, params: SectionByPlaneParams): Shape {
  const p = params ?? ({} as SectionByPlaneParams)
  const point = toVec3(p.point, 'point')
  const normal = toVec3(p.normal, 'normal')
  const kernel = getBrepApi()
  const solid = brepOf(input) as BrepHandle | undefined
  if (!solid) throw new Error('E_SECTION_BY_PLANE_NO_BREP: sectionByPlane input is not BREP')
  const handles = kernel.sectionByPlane(solid, point, normal)
  // GOTCHA（occt 适配器透传语义，2026-09-24 实测）：occt 的 sectionByPlane 在
  // 提取不到 edge/wire 子形状时把整个 result compound 透传成单句柄
  // （occt-primitives.ts `if (out.length === 0) return [asHandle(result)]`）——
  // 空截面时那是一条空载荷的退化曲线。这里按「无 edge 且无 vertex」过滤掉
  // 退化句柄，保证空截面 ⇒ 空 compound（不伪造几何，方案原则 9）。
  const real = handles.filter((h) => {
    try {
      return (
        kernel.getSubShapes(h, 'edge').length > 0 ||
        kernel.getSubShapes(h, 'vertex').length > 0
      )
    } catch {
      return true // 子形状枚举失败时不误删真实几何
    }
  })
  if (real.length === 0) return fromBrepCurve({ positions: new Float32Array(0), indices: new Uint32Array(0) }, { solid: kernel.makeCompound([]) })
  // 产物：L1 makeCompound 持句柄打包（几何复合体，可继续变换/布尔），交线经
  // fromBrepCurve 各自登记 1D 句柄；顶层走 fromBrep 以 compound 句柄收养。
  for (const h of real) fromBrepCurve(solidToShape(kernel, h), { solid: h })
  const top = kernel.makeCompound(real)
  return fromBrep(solidToShape(kernel, top), { solid: top })
}

/**
 * 平面求交线：solid 与「过 point、法向 normal 的无限平面」的精确截面。
 * @group 切分
 * @inputs 1
 * @async true
 * @qual ok
 * @name sectionByPlane
 * @note 中立 op：L1 sectionByPlane 两引擎同实现。产物是 1D compound
 *       （children 为 curve 形态的交线，kind:'curve'，无三角载荷；显示经 wireframe）。
 *       空截面 ⇒ 空 compound。仅 BREP 可用。
 * @returns Shape 1D compound（交线组）。
 * @param input - 目标几何。type:Shape required:true
 * @param params.point - 平面上一点 [x,y,z]。type:Vec3 required:true
 * @param params.normal - 平面法向 [x,y,z]。type:Vec3 required:true
 * @example
 * const sec = await cad.sectionByPlane(part0, { point: [0,0,5], normal: [0,0,1] })
 */
export const sectionByPlane = defineOp({
  brep(input: Shape, params: SectionByPlaneParams) {
    return sectionByPlaneBrep(input, params)
  },
  naming: { kind: 'unmodeled', reason: '1D section curves carry no face roleTable' } as Provenance,
})
