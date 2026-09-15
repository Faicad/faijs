/**
 * holes — P1-b 孔系列（`extensions.py:865–1363` 的函数式移植）
 *
 * 上游以 Workplane monkey-patch 提供 `clearanceHole` / `tapHole` / `threadedHole` /
 * `insertHole` / `pressFitHole` / `fastenerHole` / `pushFastenerLocations`；
 * 本包按方案红线**不做 monkey-patch**，以函数式 API 提供（目标件显式入参）。
 *
 * 语义对齐（`_fastenerHole` 核心，extensions.py:865–1009）：
 *  - 孔切割器 = 沉头（轮廓 revolve，下移 head_offset）∪ 杆部圆柱（轴向 −Z）∪ 钻尖圆锥
 *    （cskAngle=82°）；
 *  - `depth=None` → 贯穿（`bboxDiagonal(part)` ≈ `Workplane.largestDimension()`）；
 *  - 螺纹孔（`threadedHole`）= 间隙孔 + 内螺纹 IsoThread(external=False) 并集；
 *  - 逐孔位 `cut`（上游 `cutEach`）。
 *
 * ⚠️ W4 的 `recess.ts` Temp* 临时实现在本文件落地后由 `src/nut.ts` 的 BradTeeNut
 * 改调本文件（`fastenerHole` 路径），Temp 节随替换删除（方案 §8-W4 去重表）。
 */

import type { BrepHandle } from '@faicad/faijs-core'
import { requireKernel } from './kernel'
import {
  cone,
  cylinder,
  fuse,
  revolveProfile,
  polygonWire,
  translate,
  bboxDiagonal,
} from './primitives'
import { isoThread, type Hand } from './thread'
import { clearanceHoleDiameters, tapHoleDiameters } from './params'

/** 钻尖角（度）—— 上游 `cskAngle = 82`（extensions.py:975）。 */
export const DRILL_TIP_ANGLE = 82

/** 沉头轮廓点列（r-z 半剖面，z 轴为旋转轴）。 */
export interface ProfilePoint {
  r: number
  z: number
}

/** 孔位（世界坐标，孔口所在点）。 */
export interface HoleLocation {
  x: number
  y: number
  z: number
}

/** 旋转轴（+Z）。 */
const AXIS_Z = { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }

/**
 * 孔切割器（局部坐标：孔口在 z=0，孔轴向 −Z）—— `_fastenerHole` 的几何核心。
 *
 * @param p.countersinkProfile 沉头轮廓（`null` = 无沉头，如 SetScrew）
 * @param p.holeRadius 孔半径
 * @param p.depth 孔深
 * @param p.threaded 内螺纹：提供则并集一个内螺纹 IsoThread（`threadedHole` 用）
 * @param p.hand 螺纹旋向（threaded 时必填语义上由调用方保证）
 * @param p.simple true → 跳过内螺纹（上游 `simple=True` 只打直孔）
 */
export interface FastenerHoleCutterParams {
  countersinkProfile: ProfilePoint[] | null
  holeRadius: number
  depth: number
  threadDiameter?: number
  threadPitch?: number
  hand?: Hand
  simple?: boolean
}

/**
 * 组装孔切割器实体（沉头 ∪ 杆部 ∪ 钻尖）。
 * @param p - 切割器参数（countersinkProfile 沉头轮廓、holeRadius 孔径、depth 深、可选 threadDiameter/threadPitch/hand/simple）。
 * @returns 切割器句柄，调用方平移到孔位后自行 cut。
 */
export function fastenerHoleCutter(p: FastenerHoleCutterParams): BrepHandle {
  const { countersinkProfile, holeRadius, depth } = p
  const headOffset =
    countersinkProfile !== null ? Math.max(...countersinkProfile.map((q) => q.z)) : 0

  let cutter: BrepHandle
  if (countersinkProfile !== null) {
    // ① 沉头：轮廓绕 +Z 旋转，下移 head_offset → z ∈ [−headOffset, 0]
    const csk = translate(
      revolveProfile(polygonWire(countersinkProfile.map((q) => ({ x: q.r, y: 0, z: q.z }))), AXIS_Z, 2 * Math.PI),
      0, 0, -headOffset,
    )
    // ② 杆部：自 z=0 向 −Z 长 depth
    const shank = translate(cylinder(holeRadius, depth), 0, 0, -depth)
    cutter = fuse(csk, shank)
  } else {
    cutter = translate(cylinder(holeRadius, depth), 0, 0, -depth)
  }

  // ③ 钻尖：底半径 holeRadius 于 z=−depth，尖顶向下
  const h = holeRadius / Math.tan(((DRILL_TIP_ANGLE / 2) * Math.PI) / 180)
  const tip = translate(cone(0, holeRadius, h), 0, 0, -depth - h)
  return fuse(cutter, tip)
}

/**
 * 内螺纹体（threadedHole 用）—— 上游 `_fastenerHole` 里它是**切割后 union 回
 * 零件**的（extensions.py:998–1005），**不是**切割器的一部分；置于孔底
 * `bore_direction * depth`，长 `depth − head_offset`。
 * @param p - 螺纹参数：threadDiameter 公称径、threadPitch 螺距、length 长、可选 hand 旋向。
 * @returns 内螺纹实体句柄（BrepHandle）。
 */
export function internalThreadSolid(p: {
  threadDiameter: number
  threadPitch: number
  length: number
  hand?: Hand
}): BrepHandle {
  const thread = isoThread({
    major_diameter: p.threadDiameter,
    pitch: p.threadPitch,
    length: p.length,
    external: false,
    hand: p.hand ?? 'right',
  })
  if (thread.handle === null) {
    throw new Error('internalThreadSolid: IsoThread returned no solid')
  }
  return thread.handle
}

/** 逐孔位切割公共实现：对 part 在每个 location 上 cut 同一切割器。 */
function cutAtLocations(part: BrepHandle, cutter: BrepHandle, locations: HoleLocation[]): BrepHandle {
  const k = requireKernel()
  let out = part
  for (const loc of locations) {
    const moved = translate(cutter, loc.x, loc.y, loc.z)
    out = k.cut(out, moved)
  }
  return out
}

/** 解析孔径：fit（间隙）或 material（攻丝），缺失即抛错（对齐上游 ValueError）。 */
function resolveDiameter(
  table: Record<string, number>, key: string | undefined, what: string,
): number {
  const k = key ?? 'Normal'
  const v = table[k]
  if (typeof v !== 'number') {
    throw new Error(`${what}: ${k} invalid, must be one of ${Object.keys(table).join(', ')}`)
  }
  return v
}

/** clearanceHole 参数（语义对齐 `extensions._clearanceHole`）。 */
export interface ClearanceHoleParams {
  /** 目标件（上游为 Workplane 栈上的实体）。 */
  part: BrepHandle
  /** 螺纹公称直径（如 'M6'）——查 `clearance_hole_sizes`。 */
  size: string
  /** 孔位列表（世界坐标）。 */
  locations: HoleLocation[]
  fit?: 'Close' | 'Normal' | 'Loose'
  /** 孔深；缺省贯穿（bboxDiagonal）。 */
  depth?: number
  /** 沉头轮廓；`null` = 无沉头。 */
  countersinkProfile?: ProfilePoint[] | null
  counterSunk?: boolean
  /** 螺纹直径（用于 largestDimension 对齐时的最小深度参考；B 侧直接用贯穿）。 */
  threadDiameter?: number
}

/**
 * clearanceHole —— 间隙孔（`extensions.py:1080` 起的 `_clearanceHole`）。
 * HeatSetNut 不可用（上游同样拒绝，提示改用 insertHole）。
 * @param p - 间隙孔参数（part 目标件、size 螺纹规格、locations 孔位、可选 fit/depth/countersinkProfile/counterSunk/threadDiameter）。
 * @returns 打孔后的零件实体。
 */
export function clearanceHole(p: ClearanceHoleParams): BrepHandle {
  const fit = p.fit ?? 'Normal'
  const diameters = clearanceHoleDiameters(p.size)
  const holeRadius = resolveDiameter(diameters, fit, 'clearanceHole') / 2
  const depth = p.depth ?? bboxDiagonal(p.part)
  const csk = p.counterSunk === false ? null : (p.countersinkProfile ?? null)
  const cutter = fastenerHoleCutter({ countersinkProfile: csk, holeRadius, depth })
  return cutAtLocations(p.part, cutter, p.locations)
}

/** tapHole 参数（语义对齐 `_tapHole`：material 定孔径）。 */
export interface TapHoleParams {
  part: BrepHandle
  size: string
  locations: HoleLocation[]
  material?: 'Soft' | 'Hard'
  fit?: 'Close' | 'Normal' | 'Loose'
  depth?: number
  countersinkProfile?: ProfilePoint[] | null
  counterSunk?: boolean
}

/**
 * tapHole —— 攻丝底孔（直孔，无螺纹；上游 `_tapHole` → `_fastenerHole(hand=None)`）。
 * @param p - 攻丝孔参数（part、size、locations、可选 material/fit/depth/countersinkProfile/counterSunk）。
 * @returns 打孔后的零件实体。
 */
export function tapHole(p: TapHoleParams): BrepHandle {
  const material = p.material ?? 'Soft'
  const diameters = tapHoleDiameters(p.size)
  const holeRadius = resolveDiameter(diameters, material, 'tapHole') / 2
  const depth = p.depth ?? bboxDiagonal(p.part)
  const csk = p.counterSunk === false ? null : (p.countersinkProfile ?? null)
  const cutter = fastenerHoleCutter({ countersinkProfile: csk, holeRadius, depth })
  return cutAtLocations(p.part, cutter, p.locations)
}

/** threadedHole 参数（语义对齐 `_threadedHole`：间隙孔 + 内螺纹）。 */
export interface ThreadedHoleParams {
  part: BrepHandle
  size: string
  locations: HoleLocation[]
  /** 螺距（来自紧固件参数行 `pitch`）。 */
  pitch: number
  hand?: Hand
  simple?: boolean
  fit?: 'Close' | 'Normal' | 'Loose'
  depth?: number
  countersinkProfile?: ProfilePoint[] | null
  counterSunk?: boolean
}

/**
 * threadedHole —— 螺纹孔：间隙孔切割后再与内螺纹 IsoThread 求并（上游
 * `_threadedHole` → `_fastenerHole(hand≠None)`，`simple=False` 才有螺纹体）。
 * @param p - 螺纹孔参数（part、size、locations、pitch、可选 hand/simple/fit/depth/countersinkProfile/counterSunk）。
 * @returns 打孔并含内螺纹的零件实体。
 */
export function threadedHole(p: ThreadedHoleParams): BrepHandle {
  const fit = p.fit ?? 'Normal'
  const diameters = clearanceHoleDiameters(p.size)
  const holeRadius = resolveDiameter(diameters, fit, 'threadedHole') / 2
  const depth = p.depth ?? bboxDiagonal(p.part)
  const csk = p.counterSunk === false ? null : (p.countersinkProfile ?? null)
  const headOffset = csk !== null ? Math.max(...csk.map((q) => q.z)) : 0
  const cutter = fastenerHoleCutter({ countersinkProfile: csk, holeRadius, depth })
  let out = cutAtLocations(p.part, cutter, p.locations)
  // 上游：threaded 且非 simple 时，把内螺纹 union 回零件（extensions.py:998–1005）
  if (p.simple !== true) {
    const thread = internalThreadSolid({
      threadDiameter: Number(p.size.replace(/[^0-9.]/g, '')),
      threadPitch: p.pitch,
      length: depth - headOffset,
      hand: p.hand,
    })
    const k = requireKernel()
    for (const loc of p.locations) {
      const moved = translate(thread, loc.x, loc.y, loc.z - depth)
      out = k.fuse(out, moved)
    }
  }
  return out
}

/** insertHole 参数（语义对齐 `_insertHole`：仅 HeatSetNut，间隙孔径）。 */
export interface InsertHoleParams {
  part: BrepHandle
  size: string
  locations: HoleLocation[]
  fit?: 'Close' | 'Normal' | 'Loose'
  depth?: number
}

/**
 * insertHole —— HeatSetNut 专用直孔（上游拒绝其它紧固件类型）。
 * 注：W4 起 `HeatSetNut` 本体因内核缺 `makeNSidedSurface` 显式抛错；本函数
 * 只依赖间隙孔径表，可用。
 * @param p - 直孔参数（part、size、locations、可选 fit/depth）。
 * @returns 打孔后的零件实体。
 */
export function insertHole(p: InsertHoleParams): BrepHandle {
  const fit = p.fit ?? 'Normal'
  const diameters = clearanceHoleDiameters(p.size)
  const holeRadius = resolveDiameter(diameters, fit, 'insertHole') / 2
  const depth = p.depth ?? bboxDiagonal(p.part)
  const cutter = fastenerHoleCutter({ countersinkProfile: null, holeRadius, depth })
  return cutAtLocations(p.part, cutter, p.locations)
}

/** pressFitHole 参数（语义对齐 `_pressFitHole`：仅 Bearing，间隙孔径）。 */
export interface PressFitHoleParams {
  part: BrepHandle
  size: string
  locations: HoleLocation[]
  fit?: 'Close' | 'Normal' | 'Loose'
  depth?: number
}

/**
 * pressFitHole —— 轴承压入孔（上游拒绝非 Bearing；外圈间隙孔径表）。
 * Bearing 的孔径表在 bearing 参数行（`clearance_hole_diameters`），此处按 size 查。
 * @param p - 压入孔参数（part、size、locations、可选 fit/depth）。
 * @returns 打孔后的零件实体。
 */
export function pressFitHole(p: PressFitHoleParams): BrepHandle {
  const fit = p.fit ?? 'Normal'
  const diameters = clearanceHoleDiameters(p.size)
  const holeRadius = resolveDiameter(diameters, fit, 'pressFitHole') / 2
  const depth = p.depth ?? bboxDiagonal(p.part)
  const cutter = fastenerHoleCutter({ countersinkProfile: null, holeRadius, depth })
  return cutAtLocations(p.part, cutter, p.locations)
}

/**
 * fastenerHole —— 通用入口（语义对齐 `_fastenerHole` 本体）：调用方直接给
 * 孔径/沉头/螺纹参数，不必经过各具名封装。
 */
export interface FastenerHoleParams extends FastenerHoleCutterParams {
  part: BrepHandle
  locations: HoleLocation[]
}

/**
 * fastenerHole —— 通用入口（语义对齐 `_fastenerHole` 本体）：调用方直接给
 * 孔径/沉头/螺纹参数，不必经过各具名封装；逐孔位切割。
 * @param p - 通用孔参数（FastenerHoleCutterParams + part + locations）。
 * @returns 打孔后的零件实体。
 */
export function fastenerHole(p: FastenerHoleParams): BrepHandle {
  const { part, locations, ...cutter } = p
  return cutAtLocations(part, fastenerHoleCutter(cutter), locations)
}

/**
 * pushFastenerLocations —— 记录孔位（上游为 Assembly 收集紧固件用；
 * 函数式形态下直接返回入参孔位副本，供调用方装配用）。
 * @param locations - 孔位列表。
 * @returns 孔位副本（HoleLocation[]）。
 */
export function pushFastenerLocations(locations: HoleLocation[]): HoleLocation[] {
  return locations.map((l) => ({ ...l }))
}
