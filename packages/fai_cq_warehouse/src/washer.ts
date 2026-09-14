/**
 * washer.ts — 垫圈三类移植（上游 `cq_warehouse/fastener.py:2133-2369`，方案 §8 W4）。
 *
 * 类映射（方案 §4.2）：`Washer` 基类 → {@link buildWasher}；具体类 →
 * `plainWasher()` / `chamferedWasher()` / `cheeseHeadWasher()`；轮廓 →
 * `washerProfilePoints()`（纯几何，不建 kernel 对象，便于单测）。
 *
 * ## 几何路线
 *
 * 上游：`washer_profile()`（XZ 平面闭合轮廓）→ `.toPending().revolve()`（绕 Z 轴 360°）。
 * 本包：轮廓点列（`{r, z}`）→ {@link primitives.polygonWire} 转世界坐标
 * （`{x:r, y:0, z}`）→ {@link primitives.revolveProfile}。
 *
 * probe 实测（`scripts/kernel-nut-probe.ts` 段 3）：本内核 `revolve(闭合 wire, +Z, 2π)`
 * 对 XZ 轮廓**精确**——实心矩形 r=3/h=5 → 141.371669（=π·9·5）；管 2→4/h=5 →
 * 188.495559（=π·12·5）。故 washer 走直通路径，无退化。
 *
 * ⚠️ 两条 probe 实测约束（见 `docs/analysis/2026-09-14-cq-warehouse-nut-washer-probe.md`）：
 *  1. **轮廓点序决定朝向**：反序 → `getVolume` 为负（probe 段 3f 实测 −141.371669）。
 *     本文件统一按上游逆时针序（`x` 由内向外、`z` 由下向上）给出，保证正体积。
 *  2. **内核静默接受未闭合 wire**（probe 段 3h：`makeWire` 与 `revolve` 都不抛错）
 *     —— 闭合由 {@link primitives.polygonWire} 承担，勿绕过它直接喂边。
 *
 * ## A 侧基准的已知偏差（`volume` 字段对 washer 不可用）
 *
 * 上游 `Solid.Volume()`（OCP `BRepGProp`）对**revolve 原生生成的内孔管**给出
 * **恰好 2×** 解析值的错值（实测 PlainWasher M6 iso7089：解析 145.669368 /
 * `Volume()` 291.338736 / 三角化 145.609004），nut 侧不受影响。occt-wasm 的
 * `getVolume` 对同一几何**精确**（probe 段 3b），故 STEP 比对不受影响；
 * 但读 A 侧真值必须用 manifest 的 `volume_mesh`，**不要**用 `volume`。
 */

import type { BrepHandle, BrepVec3 } from '@faicad/faijs-core'
import {
  clearanceHoleData,
  isolateFastenerType,
  typesOf,
  WASHER_TABLES,
  type ParamRow,
  type WasherClassName,
} from './params'
import { imperialStrToFloat } from './measure'
import { polygonWire, revolveProfile } from './primitives'

/** 垫圈轮廓顶点（XZ 平面极坐标形态：`r` = 到旋转轴距离，`z` = 轴向高度）。 */
export interface WasherProfilePoint {
  r: number
  z: number
}

/** `Washer.__init__`（fastener.py:2235）的入参——参数名逐字沿用上游 snake_case。 */
export interface WasherParams {
  size: string
  fastener_type: string
}

/** `buildWasher` 的结果：几何句柄 + 上游同名派生量。 */
export interface WasherResult {
  handle: BrepHandle
  /** 上游 `washer_class`（`type(self).__name__`）。 */
  washerClass: WasherClassName
  /** 上游 `self.size`（**不** strip，见 fastener.py:2240）。 */
  size: string
  /** 上游 `self.thread_size`（垫圈不拆 `-`，等于 `size`）。 */
  threadSize: string
  /** 上游 `self.thread_diameter`（公制取 `size[1:]` 浮点，英制走 `imperial_str_to_float`）。 */
  threadDiameter: number
  isMetric: boolean
  fastenerType: string
  /** `isolate_fastener_type` 后的该规格行（d1/d2/h）。 */
  washerData: ParamRow
  /** 上游 `washer_thickness`（最高顶点 z）。 */
  thickness: number
  /** 上游 `washer_diameter`（2 × 最大水平半径）。 */
  diameter: number
  /** 上游 `info`。 */
  info: string
}

/** 每个垫圈类的轮廓点（按上游 `washer_profile()` 逐点转写）。 */
export type WasherProfileFn = (data: ParamRow) => WasherProfilePoint[]

function num(row: ParamRow, key: string, where: string): number {
  const v = row[key]
  if (typeof v !== 'number')
    throw new Error(`${where}: washer_data["${key}"] is not numeric (got ${JSON.stringify(v)})`)
  return v
}

function requireD1D2H(data: ParamRow, where: string): { d1: number; d2: number; h: number } {
  return {
    d1: num(data, 'd1', where),
    d2: num(data, 'd2', where),
    h: num(data, 'h', where),
  }
}

/**
 * `Washer.default_washer_profile`（fastener.py:2274）——矩形截面。
 *
 * 上游：`moveTo(d1/2, 0).hLineTo(d2/2).vLineTo(h).hLineTo(d1/2).close()`
 * @param data - 该规格的参数行（含 d1/d2/h）。
 * @returns 逆时针点列（4 点；`close` 的收尾边由 polygonWire 补）。
 */
export function plainWasherProfile(data: ParamRow): WasherProfilePoint[] {
  const { d1, d2, h } = requireD1D2H(data, 'PlainWasher')
  return [
    { r: d1 / 2, z: 0 },
    { r: d2 / 2, z: 0 },
    { r: d2 / 2, z: h },
    { r: d1 / 2, z: h },
  ]
}

/**
 * `ChamferedWasher.washer_profile`（fastener.py:2326）——顶面为 0.25h 斜面。
 * @param data - 该规格的参数行（含 d1/d2/h）。
 * @returns 逆时针点列（5 点）。
 */
export function chamferedWasherProfile(data: ParamRow): WasherProfilePoint[] {
  const { d1, d2, h } = requireD1D2H(data, 'ChamferedWasher')
  return [
    { r: d1 / 2, z: 0 },
    { r: d2 / 2, z: 0 },
    { r: d2 / 2, z: 0.75 * h },
    { r: d2 / 2 - h * 0.25, z: h },
    { r: d1 / 2, z: h },
  ]
}

/**
 * `CheeseHeadWasher.washer_profile`（fastener.py:2354）——内孔带沉窝。
 * @param data - 该规格的参数行（含 d1/d2/h）。
 * @returns 逆时针点列（6 点）。
 */
export function cheeseHeadWasherProfile(data: ParamRow): WasherProfilePoint[] {
  const { d1, d2, h } = requireD1D2H(data, 'CheeseHeadWasher')
  return [
    { r: d1 / 2 + h / 4, z: 0 },
    { r: d2 / 2, z: 0 },
    { r: d2 / 2, z: h },
    { r: d1 / 2 + h / 4, z: h },
    { r: d1 / 2, z: 0.75 * h },
    { r: d1 / 2, z: h / 4 },
  ]
}

/**
 * `Washer.default_countersink_profile`（fastener.py:2287）——沉孔切割器轮廓。
 *
 * 上游用 `clearance_hole_diameters[fit]`，缺该规格时抛 `ValueError`（逐字复刻）。
 * @param size - 螺纹规格（如 `M6`），用于查 clearance 表。
 * @param threadDiameter - 螺纹公称直径（mm），用于算 gap。
 * @param data - 该规格的参数行（含 d2/h）。
 * @param fit - 配合等级（`Close` / `Normal` / `Loose`）。
 * @returns 沉孔切割器的矩形轮廓点列（2 点，宽度已含 gap）。
 */
export function washerCountersinkProfile(
  size: string,
  threadDiameter: number,
  data: ParamRow,
  fit: 'Close' | 'Normal' | 'Loose',
): WasherProfilePoint[] {
  const row = clearanceHoleData[size]
  if (!row)
    throw new Error(`Washer: no clearance hole data for size ${size}`)
  const clearance = row[fit]
  if (clearance === undefined)
    throw new Error(
      `Washer: ${fit} invalid, must be one of ${Object.keys(row).join(', ')}`,
    )
  const { d2, h } = { d2: num(data, 'd2', 'Washer'), h: num(data, 'h', 'Washer') }
  const gap = clearance - threadDiameter
  return [
    { r: 0, z: 0 },
    { r: d2 / 2 + gap, z: 0 },
    { r: d2 / 2 + gap, z: h },
    { r: 0, z: h },
  ]
}

function pointsToWire(points: WasherProfilePoint[]): BrepHandle {
  const world: BrepVec3[] = points.map((p) => ({ x: p.r, y: 0, z: p.z }))
  return polygonWire(world)
}

/**
 * `Washer.__init__` + `make_washer`（fastener.py:2235 / :2267）。
 *
 * @param className - 垫圈类名（决定参数表）。
 * @param profileOf - 该类的轮廓函数（上游 `washer_profile`）。
 * @param p - 入参（`size` / `fastener_type`）。
 * @returns 垫圈实体与上游派生量。
 */
export function buildWasher(
  className: WasherClassName,
  profileOf: WasherProfileFn,
  p: WasherParams,
): WasherResult {
  const table = WASHER_TABLES[className]
  const types = typesOf(table)
  const size = p.size
  const threadSize = size
  const isMetric = threadSize.startsWith('M')
  let threadDiameter: number
  if (isMetric) {
    const v = Number(size.slice(1))
    if (!Number.isFinite(v))
      throw new Error(`Washer: size ${JSON.stringify(size)} is not a metric measure`)
    threadDiameter = v
  } else {
    const v = imperialStrToFloat(size)
    if (typeof v !== 'number')
      throw new Error(`Washer: size ${JSON.stringify(size)} is not an imperial measure`)
    threadDiameter = v
  }

  if (!types.includes(p.fastener_type))
    throw new Error(
      `${p.fastener_type} invalid, must be one of ${types.join(', ')}`,
    )

  const isolated = isolateFastenerType(p.fastener_type, table)
  const data = isolated[threadSize]
  if (!data)
    throw new Error(
      `${size} invalid, must be one of ${Object.keys(isolated).join(', ')}`,
    )

  const points = profileOf(data)
  const handle = revolveProfile(pointsToWire(points), {
    point: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 0, z: 1 },
  }, 2 * Math.PI)

  // 派生量取自轮廓（revolve 保半径，与上游读实体 vertex 等价；见文件头 §A 侧基准偏差）
  const thickness = Math.max(...points.map((q) => q.z))
  const diameter = 2 * Math.max(...points.map((q) => q.r))

  return {
    handle,
    washerClass: className,
    size,
    threadSize,
    threadDiameter,
    isMetric,
    fastenerType: p.fastener_type,
    washerData: data,
    thickness,
    diameter,
    info: `${className}(${p.fastener_type}): ${threadSize}`,
  }
}

/**
 * `PlainWasher`（fastener.py:2302）——iso7089 / iso7091 / iso7093 / iso7094。
 * @param p - 入参（`size` 如 `M6`；`fastener_type` 如 `iso7089`）。
 * @returns 垫圈实体与派生量。
 */
export function plainWasher(p: WasherParams): WasherResult {
  return buildWasher('PlainWasher', plainWasherProfile, p)
}

/**
 * `ChamferedWasher`（fastener.py:2317）——iso7090。
 * @param p - 入参（`size` 如 `M6`；`fastener_type` 固定 `iso7090`）。
 * @returns 垫圈实体与派生量。
 */
export function chamferedWasher(p: WasherParams): WasherResult {
  return buildWasher('ChamferedWasher', chamferedWasherProfile, p)
}

/**
 * `CheeseHeadWasher`（fastener.py:2343）——iso7092。
 * @param p - 入参（`size` 如 `M6`；`fastener_type` 固定 `iso7092`）。
 * @returns 垫圈实体与派生量。
 */
export function cheeseHeadWasher(p: WasherParams): WasherResult {
  return buildWasher('CheeseHeadWasher', cheeseHeadWasherProfile, p)
}
