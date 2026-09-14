/**
 * thread.ts — 螺纹五类移植（上游 `cq_warehouse/thread.py` 1003 行，方案 §8 W3）。
 *
 * 类映射（方案 §4.2）：`Thread` 基类 → `buildThread()`；具体类 → `isoThread()` /
 * `acmeThread()` / `metricTrapezoidalThread()` / `plasticBottleThread()`（纯函数），
 * 派生量 → `isoThreadDimensions()` / `acmeThreadSizes()` / `…`。
 * 抽象基类 `TrapezoidalThread` 不单独导出（TS 用共享的 parse/轮廓数学承接）。
 *
 * ## 几何路线（W2/W3 probe 实测裁决）
 *
 * 上游三步：`Wire.makeHelix` / `parametricCurve` 造 4 条曲线 → `Face.makeRuledSurface`
 * 造 4 条带 + 2 端帽 → `Shell.makeShell` + `Solid.makeSolid`。本包对应：
 *
 * | 上游 | 本包 | 依据 |
 * |---|---|---|
 * | `Wire.makeHelix` / `parametricCurve` | 解析采样点列（helix / fade 公式直写） | 内核 `makeHelixWire` 无 lefthand 参数；解析式可控且免内核往返 |
 * | `Face.makeRuledSurface(a, b)` | `primitives.ruledFace(a, b)` = `bsplineSurface([...a,...b], 2, N)` | probe：rows=2 ⇒ 该方向次数退化为 1 ⇒ 直纹且精确过两曲线 |
 * | `Shell.makeShell` + `Solid.makeSolid` | `primitives.solidFromFaces(faces, 1e-3)` | probe：**容差必须 ≥1e-3**（1e-6 下完全不缝合）；实体朝向不可靠 → 自动翻正 |
 *
 * ## 与上游一致的三处「怪癖」（照抄，不修）
 *
 * 1. `root_radius` 的 fudge `±0.001`，且 `tooth_height` 用 **fudge 后**的值
 *    （`thread.py:98,105`）。
 * 2. `square_off_ends` 对两端都是 `square` 时只生效**后一次**切割（每次以传入的
 *    `cq_object` 为基而非累积的 `squared`，`thread.py:216-231`）——上游 bug，
 *    为 STEP 等价必须复刻。
 * 3. fade 的根曲线 z 位移是 `t` 相关的复合式（`thread.py:292-310`），不是常偏移。
 *
 * ## 未实现（W3 已知缺口）
 *
 * `end_finishes` 含 `"chamfer"` 时**显式抛错**：上游用 `BRepFilletAPI_MakeChamfer`
 * 的**非对称** `chamfer(0.5·tooth_height, 0.75·tooth_height)` + `RadiusNthSelector`
 * 选边，本内核只提供单距离 `chamfer` / `chamferDistAngle`；未取得 A 侧等价证据前
 * 不做启发式实现（方案 §5.4 红线）。
 */

import type { BrepHandle, BrepVec3 } from '@faicad/faijs-core'
import {
  orientOutward,
  quadFace,
  ruledFace,
  solidFromFaces,
  translate as translateShape,
  makeBoxOrigin,
  cut,
} from './primitives'
import { imperialStrToFloat } from './measure'

/** 螺纹两端的收尾方式（thread.py:20 `end_finishes` 的取值域）。 */
export type EndFinish = 'raw' | 'square' | 'fade' | 'chamfer'
/** 旋向：右旋或左旋。 */
export type Hand = 'right' | 'left'

const END_FINISHES: EndFinish[] = ['raw', 'square', 'fade', 'chamfer']
const DEG = Math.PI / 180

function assertFinish(f: EndFinish, where: string): void {
  if (!END_FINISHES.includes(f))
    throw new Error(`${where}: end_finishes invalid, must be one of ${END_FINISHES.join(', ')}`)
}

function assertHand(hand: Hand, where: string): void {
  if (hand !== 'right' && hand !== 'left')
    throw new Error(`${where}: hand must be one of "right" or "left" not ${hand}`)
}

// ── Thread 基类 ────────────────────────────────────────────────────────────

/** `Thread.__init__` 的入参（thread.py:68）——参数名逐字沿用上游 snake_case。 */
export interface ThreadSpec {
  apex_radius: number
  apex_width: number
  root_radius: number
  root_width: number
  pitch: number
  length: number
  apex_offset?: number
  hand?: Hand
  end_finishes?: [EndFinish, EndFinish]
  /** 上游语义：True = 只算参数、不建几何（`wrapped` 置空）。 */
  simple?: boolean
}

/** `buildThread` 的结果：几何句柄（simple=true 时为 null）+ 派生量。 */
export interface ThreadResult {
  handle: BrepHandle | null
  external: boolean
  toothHeight: number
  /** fudge 之后的根半径（上游 `self.root_radius`）。 */
  rootRadius: number
  apexRadius: number
  pitch: number
  length: number
  apexOffset: number
  apexWidth: number
  rootWidth: number
  hand: Hand
  endFinishes: [EndFinish, EndFinish]
  simple: boolean
}

// ── 曲线点采样 ─────────────────────────────────────────────────────────────

/** 圆柱螺旋线的每圈采样点数（`n = max(96, turns·48)`）。
 *  上游用精确 `Wire.makeHelix`；本包解析采样，48 点/圈的插值偏差
 *  ≈ (2π/48)⁴/384·r（r=3 时约 2e-6 mm，远小于 1e-3 线性门禁）。 */
const HELIX_POINTS_PER_TURN = 48
/** 上游 `Workplane.parametricCurve` 的默认 N（cq.py:1942）。 */
const PARAMETRIC_N = 400

/** 圆柱螺旋线：`Wire.makeHelix(pitch, height, radius, angle=360, lefthand)` 的解析采样。
 *  起点 (radius, 0, zOffset)，θ = 2π·z/pitch（右手为正）。 */
function helixPoints(
  radius: number,
  pitch: number,
  length: number,
  rightHand: boolean,
  zOffset: number,
): BrepVec3[] {
  const turns = Math.abs(length / pitch)
  const n = Math.max(96, Math.ceil(turns * HELIX_POINTS_PER_TURN))
  const pts: BrepVec3[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const z = t * length
    const th = ((2 * Math.PI * z) / pitch) * (rightHand ? 1 : -1)
    pts.push({ x: radius * Math.cos(th), y: radius * Math.sin(th), z: z + zOffset })
  }
  return pts
}

/** `Thread.fade_helix`（thread.py:39）：t∈[0,1] 内牙高收敛到 0，跨 pitch/4。 */
function fadePoints(opts: {
  apex: boolean
  verticalDisplacement: number
  apexRadius: number
  rootRadius: number
  toothHeight: number
  external: boolean
  pitch: number
  zOffset: number
}): BrepVec3[] {
  const { apex, verticalDisplacement, apexRadius, rootRadius, toothHeight, external, pitch, zOffset } = opts
  const pts: BrepVec3[] = []
  for (let i = 0; i <= PARAMETRIC_N; i++) {
    const t = i / PARAMETRIC_N
    const s = Math.sin((t * Math.PI) / 2)
    const radius = apex
      ? external
        ? apexRadius - s * toothHeight
        : apexRadius + s * toothHeight
      : rootRadius
    const z = (t * pitch) / 4 + t * verticalDisplacement + zOffset
    const th = (t * Math.PI) / 2
    pts.push({ x: radius * Math.cos(th), y: radius * Math.sin(th), z })
  }
  return pts
}

// ── 点列/带的变换（几何全在点层完成，可控且免内核往返）─────────────────────

function shiftP(p: BrepVec3, dz: number): BrepVec3 {
  return { x: p.x, y: p.y, z: p.z + dz }
}

function translatePts(pts: BrepVec3[], dz: number): BrepVec3[] {
  return pts.map((p) => shiftP(p, dz))
}

function translateQuad(
  q: [BrepVec3, BrepVec3, BrepVec3, BrepVec3],
  dz: number,
): [BrepVec3, BrepVec3, BrepVec3, BrepVec3] {
  return [shiftP(q[0], dz), shiftP(q[1], dz), shiftP(q[2], dz), shiftP(q[3], dz)]
}

/** 上游 `f.mirror("XZ")`：y → -y。 */
function mirrorXZ(pts: BrepVec3[]): BrepVec3[] {
  return pts.map((p) => ({ x: p.x, y: -p.y, z: p.z }))
}

/** 上游 `f.mirror("XY")`：z → -z。 */
function mirrorXY(pts: BrepVec3[]): BrepVec3[] {
  return pts.map((p) => ({ x: p.x, y: p.y, z: -p.z }))
}

/** 绕 Z 轴旋转（上游 `f.rotate((0,0,0),(0,0,1),angleDeg)`）。 */
function rotateZ(pts: BrepVec3[], angleRad: number): BrepVec3[] {
  const c = Math.cos(angleRad)
  const s = Math.sin(angleRad)
  return pts.map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z }))
}

/** 直纹带 = 两条同参数曲线（行优先两行）。 */
type Band = [BrepVec3[], BrepVec3[]]

function bandFace(band: Band): BrepHandle {
  return ruledFace(band[0], band[1])
}

// ── Thread.make_thread_faces（thread.py:256）───────────────────────────────

type Quad = [BrepVec3, BrepVec3, BrepVec3, BrepVec3]

interface ThreadFaces {
  /** 4 条带：[apexLo→apexHi, apexHi→rootHi, rootHi→rootLo, rootLo→apexLo] */
  bands: Band[]
  /** 端帽多边形：[apex0, apex1, root1, root0]；非 fade 时两端各一。 */
  caps: Quad[]
}

function makeThreadFaces(
  p: ThreadResult,
  length: number,
  fadeHelix: boolean,
  asymmetricFlip: boolean,
): ThreadFaces {
  const localApexOffset = asymmetricFlip ? -p.apexOffset : p.apexOffset
  const idx = [-0.5, 0.5]

  // apex 曲线：fade 走 fade_helix(apex=True, vd=0)，否则圆柱螺旋线
  const apex = idx.map((i) =>
    fadeHelix
      ? fadePoints({
          apex: true, verticalDisplacement: 0, apexRadius: p.apexRadius, rootRadius: p.rootRadius,
          toothHeight: p.toothHeight, external: p.external, pitch: p.pitch,
          zOffset: i * p.apexWidth + localApexOffset,
        })
      : helixPoints(p.apexRadius, p.pitch, length, p.hand === 'right', i * p.apexWidth + localApexOffset),
  ) as Band

  // root 曲线：fade 的 z 位移是 t 相关复合式（thread.py:295-302, 360-368）
  const root = idx.map((i) =>
    fadeHelix
      ? fadePoints({
          apex: false, verticalDisplacement: -i * (p.rootWidth - p.apexWidth),
          apexRadius: p.apexRadius, rootRadius: p.rootRadius, toothHeight: p.toothHeight,
          external: p.external, pitch: p.pitch, zOffset: i * p.rootWidth,
        })
      : helixPoints(p.rootRadius, p.pitch, length, p.hand === 'right', i * p.rootWidth),
  ) as Band

  const bands: Band[] = [
    [apex[0], apex[1]],
    [apex[1], root[1]],
    [root[1], root[0]],
    [root[0], apex[0]],
  ]
  // fade 分支只需一个端帽（`end_caps = [0] if fade_helix else [0, 1]`）
  const last = apex[0].length - 1
  const capAt = (k: number): Quad => [apex[0][k]!, apex[1][k]!, root[1][k]!, root[0][k]!]
  const caps = fadeHelix ? [capAt(0)] : [capAt(0), capAt(last)]
  return { bands, caps }
}

// ── buildThread（thread.py:109-144）────────────────────────────────────────

/**
 * Helical thread（`Thread` 基类）。`simple=true` 时只算参数、返回 `handle: null`
 * （对齐上游把 `wrapped` 置空的语义）。
 * @param spec - `Thread.__init__` 的入参（snake_case，逐字沿用上游）。
 * @returns 派生尺寸 + 实体句柄（`simple=true` 时 `handle` 为 null）。
 */
export function buildThread(spec: ThreadSpec): ThreadResult {
  const hand: Hand = spec.hand ?? 'right'
  const endFinishes: [EndFinish, EndFinish] = spec.end_finishes ?? ['raw', 'raw']
  const apexOffset = spec.apex_offset ?? 0
  const simple = spec.simple ?? false
  assertHand(hand, 'Thread')
  for (const f of endFinishes) assertFinish(f, 'Thread')
  const numeric = [
    ['apex_radius', spec.apex_radius], ['apex_width', spec.apex_width],
    ['root_radius', spec.root_radius], ['root_width', spec.root_width],
    ['pitch', spec.pitch], ['length', spec.length], ['apex_offset', apexOffset],
  ] as const
  for (const [name, v] of numeric)
    if (!Number.isFinite(v)) throw new Error(`Thread: ${name} must be a finite number`)

  const external = spec.apex_radius > spec.root_radius
  // 上游 fudge（thread.py:98）：保证 fade 端的参数曲线面能相交
  const rootRadius = spec.root_radius - (external ? 0.001 : -0.001)
  const toothHeight = Math.abs(spec.apex_radius - rootRadius)

  const result: ThreadResult = {
    handle: null, external, toothHeight, rootRadius,
    apexRadius: spec.apex_radius, pitch: spec.pitch, length: spec.length,
    apexOffset, apexWidth: spec.apex_width, rootWidth: spec.root_width,
    hand, endFinishes, simple,
  }
  if (simple) return result

  if (endFinishes.includes('chamfer'))
    throw new Error(
      'Thread: end_finishes "chamfer" is not implemented yet (W3 known gap — upstream uses an ' +
        'asymmetric chamfer(0.5·tooth_height, 0.75·tooth_height) with a RadiusNthSelector edge ' +
        'pick; this kernel only exposes single-distance chamfer). Refusing to guess — see ' +
        'docs/analysis/2026-09-14-cq-warehouse-thread-probe.md',
    )

  const nFaded = endFinishes.filter((f) => f === 'fade').length
  const cylLength = spec.length + spec.pitch * (1 - nFaded)
  const disp = endFinishes[0] === 'fade' ? spec.pitch / 2 : -spec.pitch / 2

  let solid: BrepHandle
  if (nFaded === 0) {
    const tf = makeThreadFaces(result, cylLength, false, false)
    solid = solidFromFaces([...tf.bands.map(bandFace), ...tf.caps.map(quadFace)])
    solid = translateShape(solid, 0, 0, disp)
  } else {
    const tf = makeThreadFaces(result, cylLength, false, false)
    const faces: BrepHandle[] = tf.bands.map((b) =>
      bandFace([translatePts(b[0], disp), translatePts(b[1], disp)]),
    )

    // fade 带（恒右手方向），左手螺纹整体镜像 XZ（thread.py:169-170）
    const buildFadeBands = (asymmetric: boolean): Band[] => {
      const ff = makeThreadFaces(result, spec.pitch / 4, true, asymmetric).bands
      return result.hand === 'right' ? ff : ff.map((b): Band => [mirrorXZ(b[0]), mirrorXZ(b[1])])
    }
    const fadeBands = buildFadeBands(false)

    if (endFinishes[0] === 'fade') {
      // 非对称螺纹的底端 fade 必须重建（翻转/旋转都得不到，thread.py:172-186）
      const bottom = apexOffset !== 0 ? buildFadeBands(true) : fadeBands
      for (const b of bottom)
        faces.push(bandFace([
          translatePts(mirrorXY(mirrorXZ(b[0])), spec.pitch / 2),
          translatePts(mirrorXY(mirrorXZ(b[1])), spec.pitch / 2),
        ]))
    }
    if (endFinishes[1] === 'fade') {
      // 顶端 fade 按圆柱段末端螺旋相位旋转（thread.py:187-197）
      const cylAngle = (((result.hand === 'right' ? 360 : -360) * cylLength) / spec.pitch) * DEG
      const z = cylLength + disp
      for (const b of fadeBands)
        faces.push(bandFace([
          rotateZ(translatePts(b[0], z), cylAngle),
          rotateZ(translatePts(b[1], z), cylAngle),
        ]))
    }
    // 端帽：两端都 fade 时无帽；否则补非 fade 端（thread.py:198-209）
    if (nFaded !== 2) {
      const cap = endFinishes[0] === 'fade' ? tf.caps[1]! : tf.caps[0]!
      faces.push(quadFace(translateQuad(cap, disp)))
    }
    solid = solidFromFaces(faces)
  }

  solid = squareOffEnds(solid, spec, endFinishes)
  return { ...result, handle: orientOutward(solid) }
}

/** `Thread.square_off_ends`（thread.py:212）——立方体裁掉 z<0 / z>length 的两端。
 *
 *  ⚠️ 复刻上游 bug：两端都是 "square" 时结果取**后一次**切割（每次以传入的
 *  `cq_object` 为基而非累积的 `squared`）→ 只有 z>length 那侧被切。
 *  A 侧用例 `iso-m6x1-square-square` 就是这么生成的，必须一致。 */
function squareOffEnds(
  shape: BrepHandle,
  spec: ThreadSpec,
  endFinishes: [EndFinish, EndFinish],
): BrepHandle {
  if (!endFinishes.includes('square')) return shape
  const half = 2 * Math.max(spec.apex_radius, spec.root_radius)
  const box = makeBoxOrigin(2 * half, 2 * half, spec.length)
  let out = shape
  for (let i = 0; i < 2; i++) {
    if (endFinishes[i] !== 'square') continue
    out = cut(shape, translateShape(box, -half, -half, -spec.length + 2 * i * spec.length))
  }
  return out
}

// ── IsoThread（thread.py:471）──────────────────────────────────────────────

/** `IsoThread.__init__` 的入参（thread.py:471）——参数名逐字沿用上游 snake_case。 */
export interface IsoThreadParams {
  major_diameter: number
  pitch: number
  length: number
  external?: boolean
  hand?: Hand
  end_finishes?: [EndFinish, EndFinish]
  simple?: boolean
}

/**
 * `IsoThread` 的派生尺寸（对应上游 `thread_angle` / `h_parameter` / `min_radius`）。
 * @param p - 大径 / 螺距 / 内外螺纹三要素。
 * @returns 锥角、h 参数、最小半径，以及内外螺纹各自的口顶/齿根半径与宽度。
 */
export function isoThreadDimensions(
  p: Pick<IsoThreadParams, 'major_diameter' | 'pitch' | 'external'>,
): {
  threadAngle: number
  hParameter: number
  minRadius: number
  apexRadius: number
  apexWidth: number
  rootRadius: number
  rootWidth: number
} {
  const external = p.external ?? true
  const threadAngle = 60
  const hParameter = p.pitch / 2 / Math.tan((threadAngle / 2) * DEG)
  const minRadius = (p.major_diameter - 2 * (5 / 8) * hParameter) / 2
  return {
    threadAngle,
    hParameter,
    minRadius,
    apexRadius: external ? p.major_diameter / 2 : minRadius,
    apexWidth: external ? p.pitch / 8 : p.pitch / 4,
    rootRadius: external ? minRadius : p.major_diameter / 2,
    rootWidth: external ? (3 * p.pitch) / 4 : (7 * p.pitch) / 8,
  }
}

/**
 * ISO 60° 螺纹（`IsoThread`）。默认 `end_finishes=("fade","square")`。
 * @param p - 入参（同 {@link IsoThreadParams}）。
 * @returns 螺纹实体与派生尺寸。
 */
export function isoThread(p: IsoThreadParams): ThreadResult {
  const hand: Hand = p.hand ?? 'right'
  assertHand(hand, 'IsoThread')
  const d = isoThreadDimensions(p)
  return buildThread({
    apex_radius: d.apexRadius, apex_width: d.apexWidth,
    root_radius: d.rootRadius, root_width: d.rootWidth,
    pitch: p.pitch, length: p.length, hand,
    end_finishes: p.end_finishes ?? ['fade', 'square'],
    simple: p.simple,
  })
}

// ── TrapezoidalThread 基类 + AcmeThread / MetricTrapezoidalThread ──────────

/** `TrapezoidalThread.__init__`（thread.py:583）的共享轮廓数学。
 *  该基类在上游**没有** `simple` 参数（梯形螺纹恒建几何）。 */
export interface TrapezoidalParams {
  size: string
  length: number
  external?: boolean
  hand?: Hand
  end_finishes?: [EndFinish, EndFinish]
}

function buildTrapezoidal(
  where: string,
  p: TrapezoidalParams,
  threadAngle: number,
  diameter: number,
  pitch: number,
): ThreadResult {
  const external = p.external ?? true
  const hand: Hand = p.hand ?? 'right'
  assertHand(hand, where)
  const shoulderWidth = (pitch / 2) * Math.tan((threadAngle / 2) * DEG)
  const apexWidth = pitch / 2 - shoulderWidth
  const rootWidth = pitch / 2 + shoulderWidth
  return buildThread({
    apex_radius: external ? diameter / 2 : diameter / 2 - pitch / 2,
    apex_width: apexWidth,
    root_radius: external ? diameter / 2 - pitch / 2 : diameter / 2,
    root_width: rootWidth,
    pitch, length: p.length, hand,
    end_finishes: p.end_finishes ?? ['fade', 'fade'],
  })
}

/** `AcmeThread.acme_pitch`（thread.py:672）——英寸规格 → 螺距（mm）。 */
export const ACME_PITCH: Readonly<Record<string, number>> = {
  '1/4': (1 / 16) * 25.4,
  '5/16': (1 / 14) * 25.4,
  '3/8': (1 / 12) * 25.4,
  '1/2': (1 / 10) * 25.4,
  '5/8': (1 / 8) * 25.4,
  '3/4': (1 / 6) * 25.4,
  '7/8': (1 / 6) * 25.4,
  '1': (1 / 5) * 25.4,
  '1 1/4': (1 / 5) * 25.4,
  '1 1/2': (1 / 4) * 25.4,
  '1 3/4': (1 / 4) * 25.4,
  '2': (1 / 4) * 25.4,
  '2 1/2': (1 / 3) * 25.4,
  '3': (1 / 2) * 25.4,
}

/**
 * `AcmeThread.sizes()`（thread.py:691）。
 * @returns 全部 ACME 英寸规格（`ACME_PITCH` 的键，按上游插入序）。
 */
export function acmeThreadSizes(): string[] {
  return Object.keys(ACME_PITCH)
}

/**
 * `AcmeThread.parse_size`（thread.py:696）→ (diameter mm, pitch mm)。
 * @param size - 英寸规格字符串，如 `"1/2"`、`"1 1/4"`。
 * @returns `[直径 mm, 螺距 mm]`。
 */
export function acmeThreadParseSize(size: string): [number, number] {
  if (!(size in ACME_PITCH))
    throw new Error(`AcmeThread: size invalid, must be one of ${acmeThreadSizes().join(', ')}`)
  const diameter = imperialStrToFloat(size)
  if (typeof diameter !== 'number')
    throw new Error(`AcmeThread: size ${JSON.stringify(size)} is not an imperial measure`)
  return [diameter, ACME_PITCH[size]!]
}

/**
 * ACME 29° 梯形螺纹（`AcmeThread`）。默认 `end_finishes=("fade","fade")`。
 * @param p - 入参（同 {@link TrapezoidalParams}）。
 * @returns 螺纹实体与派生尺寸。
 */
export function acmeThread(p: TrapezoidalParams): ThreadResult {
  const [diameter, pitch] = acmeThreadParseSize(p.size)
  return buildTrapezoidal('AcmeThread', p, 29.0, diameter, pitch)
}

/** `MetricTrapezoidalThread.standard_sizes`（thread.py:746）——ISO 2904 公制规格表。 */
export const METRIC_TRAPEZOIDAL_SIZES: readonly string[] = [
  '8x1.5', '9x1.5', '9x2', '10x1.5', '10x2', '11x2', '11x3', '12x2', '12x3', '14x2',
  '14x3', '16x2', '16x3', '16x4', '18x2', '18x3', '18x4', '20x2', '20x3', '20x4',
  '22x3', '22x5', '22x8', '24x3', '24x5', '24x8', '26x3', '26x5', '26x8', '28x3',
  '28x5', '28x8', '30x3', '30x6', '30x10', '32x3', '32x6', '32x10', '34x3', '34x6',
  '34x10', '36x3', '36x6', '36x10', '38x3', '38x7', '38x10', '40x3', '40x7', '40x10',
  '42x3', '42x7', '42x10', '44x3', '44x7', '44x12', '46x3', '46x8', '46x12', '48x3',
  '48x8', '48x12', '50x3', '50x8', '50x12', '52x3', '52x8', '52x12', '55x3', '55x9',
  '55x14', '60x3', '60x9', '60x14', '65x4', '65x10', '65x16', '70x4', '70x10', '70x16',
  '75x4', '75x10', '75x16', '80x4', '80x10', '80x16', '85x4', '85x12', '85x18', '90x4',
  '90x12', '90x18', '95x4', '95x12', '95x18', '100x4', '100x12', '100x20', '105x4',
  '105x12', '105x20', '110x4', '110x12', '110x20', '115x6', '115x12', '115x14',
  '115x22', '120x6', '120x12', '120x14', '120x22', '125x6', '125x12', '125x14',
  '125x22', '130x6', '130x12', '130x14', '130x22', '135x6', '135x12', '135x14',
  '135x24', '140x6', '140x12', '140x14', '140x24', '145x6', '145x12', '145x14',
  '145x24', '150x6', '150x12', '150x16', '150x24', '155x6', '155x12', '155x16',
  '155x24', '160x6', '160x12', '160x16', '160x28', '165x6', '165x12', '165x16',
  '165x28', '170x6', '170x12', '170x16', '170x28', '175x8', '175x12', '175x16',
  '175x28', '180x8', '180x12', '180x18', '180x28', '185x8', '185x12', '185x18',
  '185x24', '185x32', '190x8', '190x12', '190x18', '190x24', '190x32', '195x8',
  '195x12', '195x18', '195x24', '195x32', '200x8', '200x12', '200x18', '200x24',
  '200x32', '205x4', '210x4', '210x8', '210x12', '210x20', '210x24', '210x36', '215x4',
  '220x4', '220x8', '220x12', '220x20', '220x24', '220x36', '230x4', '230x8', '230x12',
  '230x20', '230x24', '230x36', '235x4', '240x4', '240x8', '240x12', '240x20',
  '240x22', '240x24', '240x36', '250x4', '250x12', '250x22', '250x24', '250x40',
  '260x4', '260x12', '260x20', '260x22', '260x24', '260x40', '270x12', '270x24',
  '270x40', '275x4', '280x4', '280x12', '280x24', '280x40', '290x4', '290x12',
  '290x24', '290x44', '295x4', '300x4', '300x12', '300x24', '300x44', '310x5', '315x5',
]

/**
 * `MetricTrapezoidalThread.sizes()`（thread.py:779）。
 * @returns ISO 2904 公制规格表的副本（调用方改动不影响内部表）。
 */
export function metricTrapezoidalThreadSizes(): string[] {
  return [...METRIC_TRAPEZOIDAL_SIZES]
}

/**
 * `MetricTrapezoidalThread.parse_size`（thread.py:784）→ (diameter mm, pitch mm)。
 * @param size - 公制规格字符串，形如 `"20x4"`。
 * @returns `[直径 mm, 螺距 mm]`。
 */
export function metricTrapezoidalThreadParseSize(size: string): [number, number] {
  if (!METRIC_TRAPEZOIDAL_SIZES.includes(size))
    throw new Error(
      `MetricTrapezoidalThread: size invalid, must be one of ${metricTrapezoidalThreadSizes().join(', ')}`,
    )
  const [d, p] = size.split('x')
  return [Number(d), Number(p)]
}

/**
 * ISO 2904 公制 30° 梯形螺纹（`MetricTrapezoidalThread`）。
 * @param p - 入参（同 {@link TrapezoidalParams}）。
 * @returns 螺纹实体与派生尺寸。
 */
export function metricTrapezoidalThread(p: TrapezoidalParams): ThreadResult {
  const [diameter, pitch] = metricTrapezoidalThreadParseSize(p.size)
  return buildTrapezoidal('MetricTrapezoidalThread', p, 30.0, diameter, pitch)
}

// ── PlasticBottleThread（thread.py:926）────────────────────────────────────

/** `{TPI: [root_width, thread_height]}`（thread.py:835）。 */
const L_STYLE_THREAD_DIMENSIONS: Readonly<Record<number, [number, number]>> = {
  4: [3.18, 1.57], 5: [3.05, 1.52], 6: [2.39, 1.19], 8: [2.13, 1.07], 12: [1.14, 0.76],
}
const M_STYLE_THREAD_DIMENSIONS: Readonly<Record<number, [number, number]>> = {
  4: [3.18, 1.57], 5: [3.05, 1.52], 6: [2.39, 1.19], 8: [2.13, 1.07], 12: [1.29, 0.76],
}
/** `thread_angles`（thread.py:850）。 */
const PBT_THREAD_ANGLES: Readonly<Record<string, [number, number]>> = {
  L100: [30, 30], M100: [10, 40], L103: [30, 30], M103: [10, 40],
  L110: [30, 30], M110: [10, 50], L200: [30, 30], M200: [10, 40],
  L400: [30, 30], M400: [10, 45], L410: [30, 30], M410: [10, 45],
  L415: [30, 30], M415: [10, 45], L425: [30, 30], M425: [10, 45],
  L444: [30, 30], M444: [10, 45],
}
/** `{finish: [min_turns, diameters]}`（thread.py:873）。
 *  ⚠️ `200: [1.5, [24.28]]` 的 `24.28` 是上游笔误（应为 `[24, 28]`），照抄以
 *  保持行为一致——结果：200 规格任何直径都判非法。 */
const PBT_FINISH_DATA: Readonly<Record<number, [number, number[]]>> = {
  100: [1.125, [22, 24, 28, 30, 33, 35, 38]],
  103: [1.125, [26]],
  110: [1.125, [28]],
  200: [1.5, [24.28]],
  400: [1.0, [18, 20, 22, 24, 28, 30, 33, 35, 38, 40, 43, 45, 48, 51, 53, 58, 60, 63, 66, 70, 75, 77, 83, 89, 100, 110, 120]],
  410: [1.5, [18, 20, 22, 24, 28]],
  415: [2.0, [13, 15, 18, 20, 22, 24, 28, 30, 33]],
  425: [2.0, [13, 15]],
  444: [1.125, [24, 28, 30, 33, 35, 38, 40, 43, 45, 48, 51, 53, 58, 60, 63, 66, 70, 75, 77, 83]],
}
/** `{thread_size: [max, min, TPI]}`（thread.py:887）。 */
const PBT_THREAD_DIMENSIONS: Readonly<Record<number, [number, number, number]>> = {
  13: [13.06, 12.75, 12], 15: [14.76, 14.45, 12], 18: [17.88, 17.47, 8],
  20: [19.89, 19.48, 8], 22: [21.89, 21.49, 8], 24: [23.88, 23.47, 8],
  26: [25.63, 25.12, 8], 28: [27.64, 27.13, 6], 30: [28.62, 28.12, 6],
  33: [32.13, 31.52, 6], 35: [34.64, 34.04, 6], 38: [37.49, 36.88, 6],
  40: [40.13, 39.37, 6], 43: [42.01, 41.25, 6], 45: [44.20, 43.43, 6],
  48: [47.50, 46.74, 6], 51: [49.99, 49.10, 6], 53: [52.50, 51.61, 6],
  58: [56.49, 55.60, 6], 60: [59.49, 58.60, 6], 63: [62.51, 61.62, 6],
  66: [65.51, 64.62, 6], 70: [69.49, 68.60, 6], 75: [73.99, 73.10, 6],
  77: [77.09, 76.20, 6], 83: [83.01, 82.12, 5], 89: [89.18, 88.29, 5],
  100: [100.0, 99.11, 5], 110: [110.01, 109.12, 5], 120: [119.99, 119.10, 5],
}

/** `PlasticBottleThread.__init__` 的入参（thread.py:926）。 */
export interface PlasticBottleThreadParams {
  size: string
  external?: boolean
  hand?: Hand
  /** 3D 打印过挤补偿：外部螺纹半径减、内部加（thread.py:813）。 */
  manufacturingCompensation?: number
}

/**
 * `PlasticBottleThread` 的派生尺寸（覆盖上游全部属性）。
 * @param p - 入参（规格串 + 内外螺纹 + 过挤补偿）。
 * @returns 上游实例的全部派生属性（半径 / 宽度 / 螺距 / 长度 / 两段牙侧角）。
 */
export function plasticBottleThreadDimensions(p: PlasticBottleThreadParams): {
  style: string
  diameter: number
  finish: number
  tpi: number
  apexRadius: number
  rootRadius: number
  apexWidth: number
  apexOffset: number
  pitch: number
  length: number
  threadAngles: [number, number]
  rootWidth: number
} {
  const external = p.external ?? true
  const hand: Hand = p.hand ?? 'right'
  assertHand(hand, 'PlasticBottleThread')
  const comp = p.manufacturingCompensation ?? 0
  const m = /^([LM])(\d+)SP(\d+)$/.exec(p.size)
  if (!m)
    throw new Error(
      'PlasticBottleThread: size invalid, must match [L|M][diameter(mm)]SP[100|103|110|200|400|410|415|425|444]',
    )
  const style = m[1]!
  const diameter = Number(m[2])
  const finish = Number(m[3])
  const finishData = PBT_FINISH_DATA[finish]
  if (!finishData)
    throw new Error(
      `PlasticBottleThread: finish (${finish}) invalid, must be one of ${Object.keys(PBT_FINISH_DATA).join(', ')}`,
    )
  if (!finishData[1].includes(diameter))
    throw new Error(
      `PlasticBottleThread: diameter (${diameter}) invalid, must be one of ${finishData[1].join(', ')}`,
    )
  const [diameterMax, diameterMin, tpi] = PBT_THREAD_DIMENSIONS[diameter]!
  const [rootWidth, threadHeight] =
    style === 'L' ? L_STYLE_THREAD_DIMENSIONS[tpi]! : M_STYLE_THREAD_DIMENSIONS[tpi]!
  const apexRadius = external ? diameterMin / 2 - comp : diameterMax / 2 - threadHeight + comp
  const rootRadius = external ? diameterMin / 2 - threadHeight - comp : diameterMax / 2 + comp
  const threadAngles = PBT_THREAD_ANGLES[style + String(finish)]!
  const shoulders = threadAngles.map((a) => threadHeight * Math.tan(a * DEG))
  const apexWidth = rootWidth - (shoulders[0]! + shoulders[1]!)
  let apexOffset = shoulders[0]! + apexWidth / 2 - rootWidth / 2
  if (!external) apexOffset = -apexOffset
  const pitch = 25.4 / tpi
  const length = (finishData[0] + 0.75) * pitch
  return {
    style, diameter, finish, tpi, apexRadius, rootRadius, apexWidth,
    apexOffset, pitch, length, threadAngles, rootWidth,
  }
}

/**
 * ASTM D2911 塑料瓶口螺纹（`PlasticBottleThread`），端部恒为 ("fade","fade")。
 * @param p - 入参（规格串 + 内外螺纹 + 过挤补偿）。
 * @returns 螺纹实体与派生尺寸。
 */
export function plasticBottleThread(p: PlasticBottleThreadParams): ThreadResult {
  const d = plasticBottleThreadDimensions(p)
  return buildThread({
    apex_radius: d.apexRadius, apex_width: d.apexWidth,
    root_radius: d.rootRadius, root_width: d.rootWidth,
    pitch: d.pitch, length: d.length, apex_offset: d.apexOffset,
    hand: p.hand ?? 'right', end_finishes: ['fade', 'fade'],
  })
}
