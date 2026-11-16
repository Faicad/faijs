/**
 * sweep-guard — 扫掠/旋转产物的数值对账（post-condition，不修几何）
 *
 * ## 为什么需要
 *
 * 实测（`packages/core/test/probe-case8-pipe-gap.ts`）证明：折线脊柱不会报错，只会
 * **静默少给体积**，且少的量是固定解析系数——
 *
 * | 脊柱 | 实际/解析 |
 * |---|---|
 * | 真弧 R10 / R36.35 | < 0.01% |
 * | 折线弧 16 段 / 40 段（圆截面、环形截面） | 0.63662 = 2/π |
 * | 两段 90° 折线 | 0.5 |
 *
 * 0.01% 到 36% 之间没有任何样本，所以 5% 是安全分界：正常件不会被误判，
 * 丢实体的扫掠一定会被拦。
 *
 * ## 恒等式
 *
 *   期望体积 = 截面积 × 脊柱长度        （等截面、无缩放律）
 *
 * 只在恒等式成立时判：截面必须闭合且平面（`makeFace` 能造出面）、期望值 > 0、
 * 无缩放律（`law ≠ none`）。任一不满足 → 跳过，不猜。
 *
 * ## 与 rotate 的关系
 *
 * 旋转的判据不同（体积/厚度是否为 0），见 `assertNotZeroThickness`。两者共用
 * 同一套失败哲学：**几何自洽不等于结果正确**，能在出口用算术判出来的，就不要
 * 留给调用方去发现。
 */

import type { BrepHandle } from '../../brep/engine/types'
import type { BrepEngineApi } from '../../brep/engine/primitives'
import { OpError } from './result-unwrap'

/** 默认体积对账容差：5%。依据见文件头实测表。 */
export const DEFAULT_SWEEP_VOLUME_TOLERANCE = 0.05

let sweepVolumeTolerance = DEFAULT_SWEEP_VOLUME_TOLERANCE

/** 读取当前容差。
 * @returns Current relative volume tolerance.
 */
export function getSweepVolumeTolerance(): number {
  return sweepVolumeTolerance
}

/**
 * 调整体积对账容差。
 *
 * 只在确有"有意粗扫"证据时使用（如多段真弧拟合）；折线脊柱不会因为放宽阈值变对。
 * @param value - 相对容差，(0, 1) 之间。
 */
export function setSweepVolumeTolerance(value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new Error(`E_SWEEP_TOL_INVALID: tolerance must be in (0,1), got ${String(value)}`)
  }
  sweepVolumeTolerance = value
}

/** 面截面的面积（带孔面取净面积——与 `pipe` 的"截面原样透传"一致）。
 * @param api - BREP engine API used for surface-area queries.
 * @param face - Face handle to measure.
 * @returns Net area of the face, or undefined when measurement fails.
 */
export function areaOfProfileFace(api: BrepEngineApi, face: BrepHandle): number | undefined {
  try {
    const area = api.getSurfaceArea(face)
    return Number.isFinite(area) && area > 0 ? area : undefined
  } catch {
    return undefined
  }
}

/**
 * wire 是否闭合。
 *
 * 为什么必须自己判、不能靠 `makeFace`：OCCT 的 `BRepBuilderAPI_MakeFace` 对**开口**
 * wire 会**隐式补线闭合**（实测：3 点开口折线造出面积 16 的面），于是"面积 × 长度"
 * 这条恒等式会拿一个用户没指定的截面去对账，误报 83%（`sweep-loft.test.ts` 的
 * 开口截面用例就是这么被打中的）。
 *
 * 判据（拓扑计数）：闭合环的边数 == 顶点数；开口折线是 边数 + 1。无法判定（如
 * 顶点表异常的曲线 wire）时返回 `false` —— 宁可少查，不可误判。
 */
function wireIsClosed(api: BrepEngineApi, wire: BrepHandle): boolean {
  try {
    const edges = api.getSubShapes(wire, 'edge')
    const verts = api.getSubShapes(wire, 'vertex')
    const ne = edges.length
    const nv = verts.length
    for (const h of edges) {
      try { api.release(h) } catch { /* 已释放 */ }
    }
    for (const h of verts) {
      try { api.release(h) } catch { /* 已释放 */ }
    }
    return ne > 0 && nv === ne
  } catch {
    return false
  }
}

/**
 * wire 截面的面积：造一个临时面再量。
 *
 * 造面失败（非平面）或 wire 不闭合 ⇒ 返回 `undefined`，调用方据此跳过对账——
 * 开放截面扫出的是曲面片，体积语义本就不适用。
 * @param api - BREP engine API used to build the temp face and measure it.
 * @param wire - Closed wire handle to measure.
 * @returns Area of the wire's face, or undefined when a face cannot be built.
 */
export function areaOfProfileWire(api: BrepEngineApi, wire: BrepHandle): number | undefined {
  if (!wireIsClosed(api, wire)) return undefined
  let face: BrepHandle | undefined
  try {
    face = api.makeFace(wire)
    const area = api.getSurfaceArea(face)
    return Number.isFinite(area) && area > 0 ? area : undefined
  } catch {
    return undefined
  } finally {
    if (face !== undefined) {
      try { api.release(face) } catch { /* 已释放 */ }
    }
  }
}

/** 脊柱的边数——只用于错误信息（"16 edges" 比"某处"更能指向根因）。 */
function spineEdgeCount(api: BrepEngineApi, spine: BrepHandle): number {
  try {
    const edges = api.getSubShapes(spine, 'edge')
    const n = edges.length
    for (const e of edges) {
      try { api.release(e) } catch { /* 已释放 */ }
    }
    return n
  } catch {
    return 0
  }
}

/**
 * 本次调用实际使用的容差：局部参数优先，缺省回落到进程级全局值。
 *
 * 只接受 `(0, 1)`，与 `setSweepVolumeTolerance` 同一契约——放宽是**知情放行**，
 * 不是「关掉守卫」；把几何改对才是修法。
 * @param local - 调用方显式传入的容差（可选）。
 * @returns Effective relative tolerance.
 */
function resolveTolerance(local: number | undefined): number {
  if (local === undefined) return sweepVolumeTolerance
  if (!Number.isFinite(local) || local <= 0 || local >= 1) {
    throw new Error(`E_SWEEP_TOL_INVALID: tolerance must be in (0,1), got ${String(local)}`)
  }
  return local
}

/**
 * 扫掠体积对账。
 *
 * @param api - 引擎面。
 * @param op - op 名（错误码前缀与消息用）。
 * @param profileArea - 已算好的截面积；`undefined` ⇒ 跳过（开放/非平面/面积非正）。
 * @param spine - 脊柱 wire（量长度、数边数）。
 * @param result - 扫掠产物（量体积）。
 * @param volumeTolerance - 本次调用的相对容差 `(0,1)`；缺省用进程级全局值（5%）。
 * @throws OpError `E_SWEEP_VOLUME_MISMATCH` 当相对偏差超过容差。
 */
export function assertSweptVolumeMatches(
  api: BrepEngineApi,
  op: string,
  profileArea: number | undefined,
  spine: BrepHandle,
  result: BrepHandle,
  volumeTolerance?: number,
): void {
  if (profileArea === undefined) return
  const tolerance = resolveTolerance(volumeTolerance)
  let spineLength: number
  let actual: number
  try {
    spineLength = api.getLength(spine)
    actual = api.getVolume(result)
  } catch {
    return
  }
  const expected = profileArea * spineLength
  if (!Number.isFinite(expected) || expected <= 0) return
  if (!Number.isFinite(actual)) return

  const rel = Math.abs(actual - expected) / expected
  if (rel <= tolerance) return

  const edges = spineEdgeCount(api, spine)
  const pct = (rel * 100).toFixed(1)
  throw new OpError(
    op,
    'E_SWEEP_VOLUME_MISMATCH',
    `[api/${op}] swept volume does not match section area × spine length: ` +
      `expected ${expected.toFixed(2)} (= ${profileArea.toFixed(2)} × ${spineLength.toFixed(3)}), ` +
      `actual ${actual.toFixed(2)} (${pct}% off, tolerance ${(tolerance * 100).toFixed(0)}%). ` +
      `spine has ${edges} edge(s) — a polyline spine loses solid volume at every corner ` +
      `(measured: 2/π for a densely sampled arc, 1/2 for a single 90° bend). ` +
      `Use a single straight segment, or a single true arc. ` +
      `A true-arc spine is written as cad.wireFromEdges([cad.circleArc(...)]) — ` +
      `circleArc yields one edge, and wireFromEdges accepts a single edge (widened 2026-11-14). ` +
      `If a coarse sweep is genuinely intended, pass opts.volumeTolerance (per call) or use ` +
      `setSweepVolumeTolerance() (process-wide). Raising it does NOT fix the geometry.`,
  )
}

/**
 * 旋转产物的零厚度判定。
 *
 * `revolve` 对**截面平面不含旋转轴**的轮廓扫出的是二维区域：`getVolume` 为 0，
 * `shapeType` 仍报 `'solid'`（实测，见 probe §P3），所以只能用体积/厚度判，
 * 不能用类型判。
 *
 * @param api - 引擎面。
 * @param op - op 名。
 * @param result - 旋转产物。
 * @throws OpError `E_REVOLVE_ZERO_THICKNESS` 当体积为 0 或包围盒某向为 0。
 */
export function assertNotZeroThickness(api: BrepEngineApi, op: string, result: BrepHandle): void {
  let volume: number
  let box: { xmin: number; xmax: number; ymin: number; ymax: number; zmin: number; zmax: number }
  try {
    volume = api.getVolume(result)
    box = api.getBoundingBox(result) as unknown as typeof box
  } catch {
    return
  }
  const sizes = [box.xmax - box.xmin, box.ymax - box.ymin, box.zmax - box.zmin]
  const flat = sizes.some((s) => !Number.isFinite(s) || Math.abs(s) <= 1e-9)
  if (Number.isFinite(volume) && volume > 1e-9 && !flat) return

  throw new OpError(
    op,
    'E_REVOLVE_ZERO_THICKNESS',
    `[api/${op}] revolve produced a zero-thickness result (volume=${volume}, bbox size=[${sizes
      .map((s) => s.toFixed(3))
      .join(', ')}]). ` +
      `The section plane does not contain the rotation axis: when the axis is perpendicular to ` +
      `the section plane, the section merely spins inside its own plane and never sweeps a volume. ` +
      `Put the section on a plane that CONTAINS the axis ` +
      `(e.g. a profile in XZ revolved about Z works; a profile in XY revolved about Z does not). ` +
      `shapeType alone will not catch this — it still reports 'solid'.`,
  )
}
