/**
 * api solid-offset — 实体与偏置族（S4 剩余：draftPrism / pipe，平台 op engines:['occt']）
 *
 * @platform occt — 本目录 import occt-kernel：`draftPrism`（拔模棱柱）与 `pipe`
 * （沿脊柱的管）直调 occt 原生（occt-wasm 原生有）。这两个原生方法**不在** L1 契约
 * `BrepEngineApi` 里（L1 只有 `offset` / `sweepPipeShell` 等，见
 * brep/engine/primitives.ts）⇒ 平台 op：defineOp 声明 `engines: ['occt']`（D11）。
 *
 * 方案落点：docs/plans/2026-10-07-occt-wasm-op-enablement-plan.md §3.4.4
 * （该族 5 项中 `offsetWire2d` / `buildSolidFromFaces` / `halfSpace` 已由 S3 落地）。
 * 与既有 op 的边界（§4.5 去重表）：
 * - `pipe` vs `sweep`：pipe = `BRepOffsetAPI_MakePipe`（沿脊柱的管，单截面裸管线）；
 *   sweep = `sweepPipeShell` / `simplePipe`（截面扫掠，带 Frenet/平滑选项）；
 * - `draftPrism` vs `extrude`：前者带拔模角（上下截面渐变），后者平行拔出；
 * - `draftPrism` vs `draft`：draft 对已有实体面加拔模斜度；draftPrism 是拔模挤出。
 *
 * 角度约定（实测钉住，见 test/api/occt-s4-solid-offset.test.ts）：occt 原生
 * `draftPrism` 的形参名即 `angleDeg`（**度**，facade 内部自行换算弧度）——脚本面
 * 直传度，不做二次换算。
 */

import type { Shape } from '../../mesh/types'
import type { BrepHandle } from '../../brep/engine/types'
import { solidToShape } from '../../brep/brep-ops'
import { getBrepApi } from '../../brep/handle-bridge'
import { brepOf, fromBrep } from '../../shape'
import { defineOp } from '../../sdk'
import type { Provenance } from '../../topology/naming/lineage'
import { getOcctKernel } from '../../occt-kernel/occtKernel'

type Vec3 = [number, number, number]

/** 输入 Shape → 内核句柄（无 BREP 槁报错）。 */
function handleOf(shape: Shape, op: string, which: string): BrepHandle {
  const h = brepOf(shape) as BrepHandle | undefined
  if (!h) {
    throw new Error(`E_${op.toUpperCase()}_NO_BREP: ${op} requires a BREP handle for ${which} (mesh-only shape has none)`)
  }
  return h
}

// ─────────────────────────────────────────────────────────────────────────────
// draftPrism — 拔模棱柱（带角度挤出）
// ─────────────────────────────────────────────────────────────────────────────

/** BREP 路径：occt 原生 draftPrism（angleDeg 度，原生内部换算弧度）。 */
function draftPrismBrep(base: Shape, direction: Vec3, angleDeg: number): Shape {
  if (!base) {
    throw new Error('E_DRAFTPRISM_NO_BASE: draftPrism requires a planar base (face or wire)')
  }
  if (
    !Array.isArray(direction) ||
    direction.length !== 3 ||
    direction.some((n) => typeof n !== 'number' || !Number.isFinite(n)) ||
    (direction[0] === 0 && direction[1] === 0 && direction[2] === 0)
  ) {
    throw new Error('E_DRAFTPRISM_BAD_DIRECTION: direction must be a non-zero [dx,dy,dz]')
  }
  if (typeof angleDeg !== 'number' || !Number.isFinite(angleDeg)) {
    throw new Error('E_DRAFTPRISM_BAD_ANGLE: angleDeg must be a finite number (degrees)')
  }
  const bh = handleOf(base, 'draftPrism', 'base shape')
  const handle = getOcctKernel().draftPrism(
    bh as never, direction[0], direction[1], direction[2], angleDeg,
  ) as unknown as BrepHandle
  return fromBrep(solidToShape(getBrepApi(), handle), { solid: handle })
}

/**
 * 拔模棱柱：把平面基底（face 或 wire）沿方向挤出，并施加拔模角（上下截面渐变）。
 * @group 创建
 * @inputs 0
 * @async false
 * @qual ok
 * @name draftPrism
 * @note 平台 op：仅 occt 引擎（原生 draftPrism，形参即 angleDeg——角度单位是**度**，
 *       原生内部换算）。角度为 0 时等价普通挤出。
 * @returns Shape 拔模挤出体。
 * @param base - 平面基底（face 或闭合 wire）。type:Shape required:true
 * @param direction - 挤出方向 [dx,dy,dz]（非零；长度即挤出距离）。type:Vec3 required:true
 * @param angleDeg - 拔模角（度）。type:number required:true
 * @example
 * const s = cad.draftPrism(squareFace, [0, 0, 10], 5)
 */
export const draftPrism = defineOp({
  name: 'draftPrism',
  paramDims: { direction: 'length', angleDeg: 'angle' },
  brep(base: Shape, direction: Vec3, angleDeg: number) {
    return draftPrismBrep(base, direction, angleDeg)
  },
  engines: ['occt'],
  naming: {
    kind: 'unmodeled',
    reason: 'tapered prism face vocabulary not defined',
  } as Provenance,
})

// ─────────────────────────────────────────────────────────────────────────────
// pipe — 沿脊柱的管（BRepOffsetAPI_MakePipe）
// ─────────────────────────────────────────────────────────────────────────────

/** BREP 路径：occt 原生 pipe。脊柱须 wire（原生 TopoDS::Wire 转换）；截面原样透传
 *  ——**face 截面产实体，wire/edge 截面产壳**（BRepOffsetAPI_MakePipe 语义，
 *  实测钉在 test/api/occt-s4-solid-offset.test.ts A3/A4），故不做面→外环适配
 *  （那会把实体口径降级成壳）。 */
function pipeBrep(profile: Shape, spine: Shape): Shape {
  if (!profile || !spine) {
    throw new Error('E_PIPE_MISSING_ARG: pipe requires a profile and a spine (wire)')
  }
  const profileHandle = handleOf(profile, 'pipe', 'profile')
  const spineHandle = handleOf(spine, 'pipe', 'spine wire')
  const kernel = getBrepApi()
  const handle = getOcctKernel().pipe(
    profileHandle as never, spineHandle as never,
  ) as unknown as BrepHandle
  return fromBrep(solidToShape(kernel, handle), { solid: handle })
}

/**
 * 沿脊柱扫出管：把截面沿脊柱 wire 扫掠（`BRepOffsetAPI_MakePipe` 裸管线；
 * 带过渡/方向控制的扫掠见 `sweep`）。
 *
 * 产物类型随截面类型（实测钉住，test/api/occt-s4-solid-offset.test.ts A3/A4）：
 * **截面 face → 实体；截面 wire/edge → 壳（管面，体积无意义）**。要实体管，
 * 喂面截面（如 `cad.profile` 的圆盘轮廓）。
 * @group 创建
 * @inputs 2
 * @async false
 * @qual ok
 * @name pipe
 * @note 平台 op：仅 occt 引擎（原生 pipe，L1 契约无对应成员）。脊柱须为 wire。
 *       非 occt 引擎执行前报错；brep_mock 不拦截。
 * @returns Shape 扫出的管（截面 face → 实体；wire/edge → 壳）。
 * @param profile - 截面（face → 实体；wire/edge → 壳）。
 *                  type:Shape required:true
 * @param spine - 脊柱 wire。type:Shape required:true
 * @example
 * const tube = cad.pipe(diskFace, spineWire)
 */
export const pipe = defineOp({
  name: 'pipe',
  brep(profile: Shape, spine: Shape) {
    return pipeBrep(profile, spine)
  },
  engines: ['occt'],
  naming: {
    kind: 'unmodeled',
    reason: 'pipe face vocabulary not defined',
  } as Provenance,
})
