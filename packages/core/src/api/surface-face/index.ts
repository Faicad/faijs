/**
 * api surface-face — 曲面与面构造族（S4，平台 op engines:['occt']）
 *
 * @platform occt — 本目录 import occt-kernel：各 op 直调 occt 原生面/曲面构造与查询
 * 方法（`makeFaceOnSurface` / `makeNonPlanarFace` / `makeSolid` / `reverseSurfaceU` /
 * `outerWire`，occt-wasm 原生有）。这些原生方法**不在** L1 契约 `BrepEngineApi` 里
 * （L1 只有 `makeFace`（仅平面）与 `getSubShapes` 等子集，见 brep/engine/primitives.ts）
 * ⇒ 全族平台 op：defineOp 声明 `engines: ['occt']`（D11）。
 *
 * 方案落点：docs/plans/2026-10-07-occt-wasm-op-enablement-plan.md §3.4.2。
 * 与既有 op 的边界（§4.5 去重表）：
 * - `makeSolid` vs `sewAndSolidify` / `compound`：前者输入是**已闭合的壳**，直接升为
 *   实体；后两者分别走「面 → 缝合 → 固化」链 / 聚合；
 * - `nonPlanarFace` vs L1 `makeFace`：后者只处理平面 wire，前者接受非平面 wire；
 * - `outerWire`（取面外环）vs `offset2d`（偏置）：纯查询 vs 几何构造。
 *
 * 产物形态：面/实体经 `fromBrep` 收养；wire（outerWire 产物）经 `fromBrepCurve`
 * 登记为 `kind:'curve'`（同 offset2d 口径）。
 */

import type { Shape } from '../../mesh/types'
import type { BrepHandle } from '../../brep/engine/types'
import { solidToShape } from '../../brep/brep-ops'
import { getBrepApi } from '../../brep/handle-bridge'
import { brepOf, fromBrep, fromBrepCurve } from '../../shape'
import { defineOp } from '../../sdk'
import type { Provenance } from '../../topology/naming/lineage'
import { getOcctKernel } from '../../occt-kernel/occtKernel'

/** 输入 Shape → 内核句柄（无 BREP 槁报错）。 */
function handleOf(shape: Shape, op: string, which: string): BrepHandle {
  const h = brepOf(shape) as BrepHandle | undefined
  if (!h) {
    throw new Error(`E_${op.toUpperCase()}_NO_BREP: ${op} requires a BREP handle for ${which} (mesh-only shape has none)`)
  }
  return h
}

// ─────────────────────────────────────────────────────────────────────────────
// faceOnSurface — 在已有面上建面（宿主面 + 曲面上的闭合 wire）
// ─────────────────────────────────────────────────────────────────────────────

/** BREP 路径：occt 原生 makeFaceOnSurface。 */
function faceOnSurfaceBrep(hostFace: Shape, wire: Shape): Shape {
  if (!hostFace || !wire) {
    throw new Error('E_FACEONSURFACE_MISSING_ARG: faceOnSurface requires a host face and a boundary wire')
  }
  const fh = handleOf(hostFace, 'faceOnSurface', 'host face')
  const wh = handleOf(wire, 'faceOnSurface', 'boundary wire')
  const handle = getOcctKernel().makeFaceOnSurface(fh as never, wh as never) as unknown as BrepHandle
  return fromBrep(solidToShape(getBrepApi(), handle), { solid: handle })
}

/**
 * 在已有曲面上建面：以宿主面（承载曲面）为底，用曲面上的闭合 wire 圈出新面。
 * @group 创建
 * @inputs 2
 * @async false
 * @qual ok
 * @name faceOnSurface
 * @note 平台 op：仅 occt 引擎（原生 makeFaceOnSurface，L1 契约无对应成员）。
 *       非 occt 引擎执行前报错；brep_mock 不拦截。
 * @returns Shape 新建的面。
 * @param hostFace - 宿主面（承载曲面）。type:Shape required:true
 * @param wire - 曲面上的闭合边界 wire。type:Shape required:true
 * @example
 * const f = cad.faceOnSurface(cylFace, boundaryWire)
 */
export const faceOnSurface = defineOp({
  name: 'faceOnSurface',
  brep(hostFace: Shape, wire: Shape) {
    return faceOnSurfaceBrep(hostFace, wire)
  },
  engines: ['occt'],
  naming: {
    kind: 'unmodeled',
    reason: 'face built on a host surface has no source-derived face role vocabulary',
  } as Provenance,
})

// ─────────────────────────────────────────────────────────────────────────────
// nonPlanarFace — 非平面 wire → 面（L1 makeFace 只处理平面）
// ─────────────────────────────────────────────────────────────────────────────

/** BREP 路径：occt 原生 makeNonPlanarFace。 */
function nonPlanarFaceBrep(wire: Shape): Shape {
  if (!wire) {
    throw new Error('E_NONPLANARFACE_NO_WIRE: nonPlanarFace requires a boundary wire')
  }
  const wh = handleOf(wire, 'nonPlanarFace', 'boundary wire')
  const handle = getOcctKernel().makeNonPlanarFace(wh as never) as unknown as BrepHandle
  return fromBrep(solidToShape(getBrepApi(), handle), { solid: handle })
}

/**
 * 由非平面闭合 wire 构造面（L1 `makeFace` 只处理平面 wire；本 op 补非平面缺口）。
 * @group 创建
 * @inputs 1
 * @async false
 * @qual ok
 * @name nonPlanarFace
 * @note 平台 op：仅 occt 引擎（原生 makeNonPlanarFace）。wire 须闭合。
 * @returns Shape 构造出的面。
 * @param wire - 闭合边界 wire（可非平面）。type:Shape required:true
 * @example
 * const f = cad.nonPlanarFace(curvedBoundaryWire)
 */
export const nonPlanarFace = defineOp({
  name: 'nonPlanarFace',
  brep(wire: Shape) {
    return nonPlanarFaceBrep(wire)
  },
  engines: ['occt'],
  naming: {
    kind: 'unmodeled',
    reason: 'face from arbitrary non-planar wire has no face role vocabulary',
  } as Provenance,
})

// ─────────────────────────────────────────────────────────────────────────────
// makeSolid — 闭合壳 → 实体（方案 §4.2 表列 unmodeled 例）
// ─────────────────────────────────────────────────────────────────────────────

/** BREP 路径：occt 原生 makeSolid。 */
function makeSolidBrep(shell: Shape): Shape {
  if (!shell) {
    throw new Error('E_MAKESOLID_NO_SHELL: makeSolid requires a closed shell')
  }
  const sh = handleOf(shell, 'makeSolid', 'closed shell')
  const handle = getOcctKernel().makeSolid(sh as never) as unknown as BrepHandle
  return fromBrep(solidToShape(getBrepApi(), handle), { solid: handle })
}

/**
 * 把已闭合的壳升为实体（输入是壳，不做缝合——缝合链见 `sewAndSolidify`）。
 * @group 创建
 * @inputs 1
 * @async false
 * @qual ok
 * @name makeSolid
 * @note 平台 op：仅 occt 引擎（原生 makeSolid）。输入须为闭合 shell。
 * @returns Shape 实体。
 * @param shell - 已闭合的壳。type:Shape required:true
 * @example
 * const s = cad.makeSolid(closedShell)
 */
export const makeSolid = defineOp({
  name: 'makeSolid',
  brep(shell: Shape) {
    return makeSolidBrep(shell)
  },
  engines: ['occt'],
  naming: {
    kind: 'unmodeled',
    reason: 'solid promoted from an arbitrary shell has no face role vocabulary',
  } as Provenance,
})

// ─────────────────────────────────────────────────────────────────────────────
// reverseSurfaceU — 反转面的 U 参数方向
// ─────────────────────────────────────────────────────────────────────────────

/** BREP 路径：occt 原生 reverseSurfaceU。 */
function reverseSurfaceUBrep(face: Shape): Shape {
  if (!face) {
    throw new Error('E_REVERSESURFACEU_NO_FACE: reverseSurfaceU requires a face')
  }
  const fh = handleOf(face, 'reverseSurfaceU', 'face')
  const handle = getOcctKernel().reverseSurfaceU(fh as never) as unknown as BrepHandle
  return fromBrep(solidToShape(getBrepApi(), handle), { solid: handle })
}

/**
 * 反转面的 U 参数方向（occt `Geom_Surface::UReverse` 语义）：返回新面代理，
 * 其曲面是原曲面的 U 反转版（拓扑不变，UV 求值随之镜像）。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name reverseSurfaceU
 * @note 平台 op：仅 occt 引擎（原生 reverseSurfaceU）。输入面。
 * @returns Shape U 反转后的面。
 * @param face - 输入面。type:Shape required:true
 * @example
 * const flipped = cad.reverseSurfaceU(f)
 */
export const reverseSurfaceU = defineOp({
  name: 'reverseSurfaceU',
  brep(face: Shape) {
    return reverseSurfaceUBrep(face)
  },
  engines: ['occt'],
  naming: {
    kind: 'unmodeled',
    reason: 'U-reversed face proxy keeps input topology; no new face role vocabulary',
  } as Provenance,
})

// ─────────────────────────────────────────────────────────────────────────────
// outerWire — 取面外环（查询；产物 1D wire）
// ─────────────────────────────────────────────────────────────────────────────

/** BREP 路径：occt 原生 outerWire → 1D wire 经 fromBrepCurve 登记。 */
function outerWireBrep(face: Shape): Shape {
  if (!face) {
    throw new Error('E_OUTERWIRE_NO_FACE: outerWire requires a face')
  }
  const fh = handleOf(face, 'outerWire', 'face')
  const handle = getOcctKernel().outerWire(fh as never) as unknown as BrepHandle
  return fromBrepCurve(solidToShape(getBrepApi(), handle), { solid: handle })
}

/**
 * 取面的外环（outer wire）：面上边界中最大的闭合 wire，1D 产物。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name outerWire
 * @note 平台 op：仅 occt 引擎（原生 outerWire）。产物 kind='curve'（1D wire）。
 * @returns Shape 面的外环（kind:'curve'）。
 * @param face - 输入面。type:Shape required:true
 * @example
 * const ow = cad.outerWire(face0)
 */
export const outerWire = defineOp({
  name: 'outerWire',
  brep(face: Shape) {
    return outerWireBrep(face)
  },
  engines: ['occt'],
  naming: {
    kind: 'unmodeled',
    reason: 'extracted sub-wire has no face role vocabulary',
  } as Provenance,
})
