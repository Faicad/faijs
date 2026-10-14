/**
 * gears — raw-handle primitives for the cq_gears port (E1–E6 companion layer).
 *
 * cq_gears' tooth faces are B-spline patches built from (u,v) point grids and
 * assembled by sewing — these need raw kernel construction primitives that no
 * Workplane op exposes (bsplineSurface / approximatePoints / interpolatePoints,
 * tolerant edge chaining, sew+makeSolid). The faijs-gears v1 port probed them
 * in its own `kernel.ts` / `geom-build.ts` / `spline-face.ts`; per the port
 * plan (§4) the implementations must live INSIDE cq-compat — this file is that
 * landing spot. faijs-gears only imports from here; it must not touch
 * occt-wasm directly.
 *
 * Everything here is a verbatim port of the proven v1 implementations (same
 * kernel call sequence → bit-identical geometry).
 *
 * ## 内核取用（内核取用面收敛 2026-10-14 §3.1 / §3.5）
 *
 * 本包是**平台库**（`package.json`：`faijs.lib = { role:'library', conformsTo:'cadquery',
 * platform:['occt'] }`），故按 §3.1 三分表的「平台库」行取内核，得到**双句柄**
 * `GearKernel = { l1, occt }`：
 *
 * | 面 | 出口 | 装什么 |
 * |---|---|---|
 * | `l1` | `getBrepApi()` | L1 中立面 `BrepEngineApi`——本包用到 37 个方法 |
 * | `occt` | `getOcctKernel()` | L1 **无法表达**的四件事（见 `GearOcct`） |
 *
 * 本包不再读裸槽位（`getBackends().kernel.brep`）、不再自装配内核（`initOcctWasm`），
 * 也不再返回「L1 + 平台扩展」的合并句柄——那种句柄缺的方法只在构建深处以
 * `kernel.X is not a function` 爆出（§2.2 的标本）。用错面现在是**编译期**错误：
 * `k.l1.split` 与 `k.occt.makeFace` 都不存在。
 *
 * 口径差异（L1 同名但语义不符，故走平台面）只有一处：`loft`——见
 * {@link GearOcct.loft}。这不是「平台库就可以随便用平台方法」，而是 L1 契约
 * 对该能力另有所指（L1 `loft` 恒产实体），本包要的是壳/单张面。
 */

import { getBrepApi, getConfiguredBrepEngineId } from '@faicad/faijs/sdk'
import { getOcctKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import type { BrepEngineApi, BrepHandle, BrepVec3 } from '@faicad/faijs'
import type { Vec3 } from '../math'

/** Rotation/mirror axis (L1 `rotate` 的轴形态). */
export interface GearAxis {
  point: BrepVec3
  direction: BrepVec3
}

/**
 * occt 平台面：L1（`BrepEngineApi`）**无法表达**的四件事。
 *
 * 四件全部落在**构建主路径**上——封盖（`healWire`）、切齿/越界修剪（`split`）、
 * 齿面蒙皮（`loft` 的壳形态）、齿面偏差量测（`projectPointOnFace`）。因此齿轮库
 * 整体是 occt-only，而不是个别函数的例外（§3.5 第 2 项）。
 */
export interface GearOcct {
  /**
   * `BRepOffsetAPI_ThruSections`：wires → **壳**（`isSolid=false`）。
   *
   * ⚠️ 不能换 L1 `loft`：L1 的 `loft(sections, ruled, endPoint?)` 在 occt 适配器里
   * 写死 `isSolid=true`（`packages/core/src/occt-kernel/occt-primitives.ts:172`），
   * **恒产实体**。本包两处要的是两个截面之间的**单张面**——`ring_gear.ts` 的外圈
   * 圆柱面、本文件 `buildGearRowLoft` 的齿面蒙皮——拿实体会在下游 `soleGearFace`
   * 处因面数不为 1 而失败。同款口径分歧见 faijs-fasteners `primitives.ruledFace`。
   */
  loft(wires: BrepHandle[], isSolid: boolean, ruled: boolean): BrepHandle
  /** 线修复（端盖组线成 wire 之后、`makeFace` 之前）。L1 无此能力。 */
  healWire(wire: BrepHandle, tolerance?: number): BrepHandle
  /**
   * 工具实体分割（cq `Face.split(plane)`，`BRepAlgoAPI_Splitter`）。
   * L1 只有 `splitByPlane`（无限平面二分），工具实体语义不同——切齿与越界修剪都用它。
   */
  split(shape: BrepHandle, tools: BrepHandle[]): BrepHandle
  /** 点到面的投影（齿面偏差量测）。L1 无此能力。 */
  projectPointOnFace(face: BrepHandle, point: BrepVec3): BrepVec3
}

/** 真实 occt 平台面的类型（库不得 `import type ... from 'occt-wasm'`，故经出口推导）。 */
type RawOcctFace = ReturnType<typeof getOcctKernel>

/**
 * `GearOcct` 的成员名清单。
 *
 * 两处自证都用它：
 *  - **编译期**：`satisfies` 保证四个名字在真实 occt 平台上存在——内核升级改名即 `tsc` 红；
 *  - **运行期**：{@link gearKernel} 逐个 `typeof === 'function'` 探活，报出缺哪一个。
 */
const GEAR_OCCT_NAMES = [
  'loft',
  'healWire',
  'split',
  'projectPointOnFace',
] as const satisfies readonly (keyof RawOcctFace)[]

/** 齿轮构建用的**双句柄**：中立面 + 平台面。 */
export interface GearKernel {
  /** L1 中立面（`BrepEngineApi`）。 */
  l1: BrepEngineApi
  /** occt 平台面（{@link GearOcct}）。 */
  occt: GearOcct
}

/**
 * 取齿轮构建用的双句柄。
 *
 * 每次调用**重新取**（不缓存）——引擎在会话中途可切，缓存会让句柄跨引擎串味。
 * 两个出口都在未就绪时显式抛错，不返回半成品：`getBrepApi()` 抛
 * 「BREP engine API not available」，`getOcctKernel()` 抛「occt-wasm kernel not
 * initialized」。
 *
 * **平台库门禁（方案 §3.5 第 5 项 / §2.2 标本）**：faijs-gears 全库 occt-only——构建
 * 主路径上的四件能力 L1 无法表达（`GearOcct`：封盖 `healWire`、切齿/越界修剪
 * `split`、齿面蒙皮 `loft(壳)`、齿面偏差 `projectPointOnFace`），约束因此是**库级**
 * 的（`package.json` 的 `faijs.lib.platform`）而非函数级。故取句柄前先校验当前活动
 * 引擎 id（`config.brepEngineId`）：非 `occt` 即**执行前**抛 `E_BREP_UNSUPPORTED`——
 * 文案与 core `api/internal/l3-bridge` 的 `assertEngineFor` 同构，含引擎名，可定位，
 * 不补桩、不静默降级。brepkit 等其它引擎下构建必然失败，落在这道门禁而不是构建深处
 * 的随机失败点。
 *
 * `occt` 的那一次断言只吸收**句柄品牌**：`BrepHandle` 与 occt 的 `ShapeHandle`
 * 都是 `number & { readonly [brand]: never }`（`brep/engine/types.ts:34` /
 * occt-wasm `types.d.ts:6`），运行期同一批数字，差别只在编译期品牌；成员名由
 * {@link GEAR_OCCT_NAMES} 的 `satisfies` 静态钉住、并在下面逐个探活。
 *
 * @returns `{ l1, occt }` 双句柄
 * @throws 当前引擎不是 `occt` 时抛 `E_BREP_UNSUPPORTED`；内核未就绪时原样上抛出口自己的错误
 */
export function gearKernel(): GearKernel {
  // 平台库门禁：当前活动引擎必须 ∈ 库级声明 `platform`（['occt']）。读配置的活动引擎
  // （而非注册表默认），与宿主 `configureBackends({ config: { brepEngineId } })` 的意图一致。
  const activeId = getConfiguredBrepEngineId()
  if (activeId !== 'occt') {
    const e = new Error(
      `E_BREP_UNSUPPORTED: lib 'faijs-gears' requires engine occt (current=${activeId ?? '<none>'})`,
    )
    e.name = 'BrepUnsupportedError'
    throw e
  }
  const raw = getOcctKernel() as unknown as Record<string, unknown>
  for (const name of GEAR_OCCT_NAMES) {
    if (typeof raw[name] !== 'function') {
      throw new Error(
        `[faijs-gears] occt platform face changed: '${name}' is not a function on the kernel ` +
          `(GearOcct needs ${GEAR_OCCT_NAMES.join(' / ')})`,
      )
    }
  }
  return { l1: getBrepApi(), occt: getOcctKernel() as unknown as GearOcct }
}

// ── L1 派生判定（§3.5 第 2 项：L1 无 isFace / isShell，按 `shapeType` 派生）─────
//
// `shapeType` 在 occt 适配器里是原生 `getShapeType` 直通，取值小写
// （occt-wasm `SHAPE_TYPES`: 'compound' | 'solid' | 'shell' | 'face' | …）。

/**
 * 形状是不是一个面（L1 `shapeType` 派生）。
 *
 * @param kernel 双句柄
 * @param shape 待判形状
 * @returns 当且仅当类型名为 `'face'`
 */
export function gearIsFace(kernel: GearKernel, shape: BrepHandle): boolean {
  return kernel.l1.shapeType(shape) === 'face'
}

/**
 * 形状是不是一个壳（L1 `shapeType` 派生）。
 *
 * @param kernel 双句柄
 * @param shape 待判形状
 * @returns 当且仅当类型名为 `'shell'`
 */
export function gearIsShell(kernel: GearKernel, shape: BrepHandle): boolean {
  return kernel.l1.shapeType(shape) === 'shell'
}

// ── tolerant edge chaining (port of faijs-gears v1 geom-build.ts) ─────────

/** The two endpoints of an edge (order = the edge's parameter direction). */
export interface GearEdgeEnds {
  edge: BrepHandle
  a: Vec3
  b: Vec3
}

function gearDist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

/**
 * Endpoints of an edge, via the curve parameter domain.
 *
 * ⚠️ Endpoint red line (probed 2026-09-11): `getSubShapes(edge, 'vertex')`
 * returns fewer than 2 vertices for **B-spline curve edges** (OCCT stores no
 * explicit vertices on them), which used to make edge chaining treat every
 * edge as its own wire. The correct path is `curveParameters(edge)` →
 * `curvePointAtParam(edge, param)` — valid for ALL edge kinds (line / arc /
 * B-spline); the vertex fallback only covers degenerate edges without an
 * underlying curve.
 *
 * @param kernel 双句柄
 * @param edge edge handle
 * @returns both endpoints (closed edges: first == last)
 */
export function gearEdgeEnds(kernel: GearKernel, edge: BrepHandle): GearEdgeEnds {
  try {
    const { first, last } = kernel.l1.curveParameters(edge)
    return {
      edge,
      a: kernel.l1.curvePointAtParam(edge, first),
      b: kernel.l1.curvePointAtParam(edge, last),
    }
  } catch {
    // Fallback: rare degenerate edges without an underlying curve.
    const vs = kernel.l1.getSubShapes(edge, 'vertex')
    if (vs.length < 2) {
      const p = kernel.l1.vertexPosition(vs[0])
      return { edge, a: p, b: p }
    }
    return {
      edge,
      a: kernel.l1.vertexPosition(vs[0]),
      b: kernel.l1.vertexPosition(vs[1]),
    }
  }
}

/**
 * TS port of OCCT `ShapeAnalysis_FreeBounds::ConnectEdgesToWires` — chain
 * unordered edges into wires by endpoint proximity within `tol`.
 *
 * faijs/occt-wasm has no such binding and `makeWire(edges)` is
 * `BRepBuilderAPI_MakeWire` — measured (2026-09-08) to silently drop edges on
 * unordered input (68 edges → 9-edge broken wire). Endpoint pairing is O(n²)
 * (n = 4·z teeth, at most a few hundred — fine).
 *
 * Gaps above OCCT precision (~1e-7) get a bridging line segment, matching
 * upstream ConnectEdgesToWires behaviour.
 *
 * @param kernel 双句柄
 * @param edges unordered edge set
 * @param tol endpoint pairing tolerance (mm); cq uses `wire_comb_tol = 1e-2`
 * @returns one or more wires, each with its edges chained head-to-tail
 */
export function connectEdgesToWires(
  kernel: GearKernel,
  edges: BrepHandle[],
  tol: number,
): BrepHandle[] {
  if (!Number.isFinite(tol) || tol <= 0) {
    throw new Error(`connectEdgesToWires: tol must be a positive finite number, got ${String(tol)}`)
  }
  const pool: GearEdgeEnds[] = edges.map((e) => gearEdgeEnds(kernel, e))
  const used = new Array<boolean>(pool.length).fill(false)
  const wires: BrepHandle[] = []

  for (let start = 0; start < pool.length; start++) {
    if (used[start]) continue
    used[start] = true

    const chain: BrepHandle[] = [pool[start].edge]
    let tail = pool[start].b
    const head = pool[start].a

    // Chain forward: find an unused edge whose endpoint touches `tail` within tol.
    for (;;) {
      let found = -1
      let best = Infinity
      for (let j = 0; j < pool.length; j++) {
        if (used[j]) continue
        const dA = gearDist(pool[j].a, tail)
        const dB = gearDist(pool[j].b, tail)
        const d = Math.min(dA, dB)
        if (d <= tol && d < best) {
          best = d
          found = j
        }
      }
      if (found < 0) break
      used[found] = true
      const e = pool[found]
      const flip = gearDist(e.a, tail) <= gearDist(e.b, tail)
      if (best > 1e-7) {
        chain.push(kernel.l1.makeLineEdge(tail, flip ? e.a : e.b))
      }
      // Edge points the wrong way: reverseShape makes a reversed copy.
      chain.push(flip ? e.edge : kernel.l1.reverseShape(e.edge))
      tail = flip ? e.b : e.a
      // Back at the start ⇒ closed loop, stop.
      if (gearDist(tail, head) <= tol) break
    }

    // Close the loop: bridge the tail-to-head gap too.
    const endGap = gearDist(tail, head)
    if (chain.length > 1 && endGap > 1e-7 && endGap <= tol) {
      chain.push(kernel.l1.makeLineEdge(tail, head))
    }

    wires.push(kernel.l1.makeWire(chain))
  }
  return wires
}

/**
 * cq `Face.makeFromWires(outer, holes)` analogue.
 *
 * @param kernel 双句柄
 * @param outer outer wire
 * @param holes inner hole wires (may be empty)
 * @returns face handle
 */
export function gearFaceFromWires(
  kernel: GearKernel,
  outer: BrepHandle,
  holes: BrepHandle[] = [],
): BrepHandle {
  const f = kernel.l1.makeFace(outer)
  return holes.length > 0 ? kernel.l1.addHolesInFace(f, holes) : f
}

/**
 * cq `make_shell(faces, tol)` + `Solid.makeSolid(shell)` analogue.
 *
 * A non-shell sew result is NOT silently swallowed — that is a construction
 * failure signal.
 *
 * @param kernel 双句柄
 * @param faces faces to sew
 * @param sewingTol sewing tolerance (mm, cq `shell_sewing_tol`)
 * @returns solid built from the sewn shell
 */
export function gearShellToSolid(
  kernel: GearKernel,
  faces: BrepHandle[],
  sewingTol: number,
): BrepHandle {
  const shell = kernel.l1.sew(faces, sewingTol)
  if (!gearIsShell(kernel, shell) && !kernel.l1.isSolid(shell)) {
    throw new Error(
      `gearShellToSolid: sew did not produce a shell (got ${String(kernel.l1.shapeType(shell))})`,
    )
  }
  return kernel.l1.makeSolid(shell)
}

// ── spline tooth faces (port of faijs-gears v1 spline-face.ts) ────────────

/**
 * Tooth-face B-spline face strategies (mirrors cq `Face.makeSplineApprox`).
 *
 * | strategy | how | semantic delta vs cq |
 * |---|---|---|
 * | `grid-approx` | `l1.bsplineSurface(flat, rows, cols)` (also `GeomAPI_PointsToBSplineSurface`) | OCCT default DegMin/DegMax/Tol3D; cq passes 3/8/1e-2 explicitly |
 * | `row-approx-loft` | per-row `l1.approximatePoints(row, tol)` → platform `loft` | curve-level tol same name/meaning; surface is skinned, not fitted at once |
 * | `row-interp-loft` | per-row `l1.interpolatePoints(row, 3)` → platform `loft` | passes through every sample point (interpolation) |
 */
export type GearSplineFaceStrategy = 'grid-approx' | 'row-approx-loft' | 'row-interp-loft'

/** All selectable strategies (tests iterate in this order for the deviation table). */
export const GEAR_SPLINE_FACE_STRATEGIES: readonly GearSplineFaceStrategy[] = [
  'grid-approx',
  'row-approx-loft',
  'row-interp-loft',
]

/**
 * Default strategy chosen by P0 measurement (2026-09-08).
 *
 * Per the measured table in the faijs-gears spike: S2's area relative
 * deviation is 5.6e-7 / max sample-point distance 2.6e-6 mm — about three
 * orders of magnitude better than S1/S3. See
 * `docs/analysis/2026-09-08-fai-cq-gears-spike.md`.
 */
export const DEFAULT_GEAR_SPLINE_FACE_STRATEGY: GearSplineFaceStrategy = 'row-approx-loft'

/** Face building options (tolerance + degrees, aligned with cq `makeSplineApprox`). */
export interface GearSplineFaceOptions {
  /** Approximation tolerance (mm). cq's `spline_approx_tol`, default 1e-2. */
  tolerance?: number
  /** Surface minimum degree (cq: 3) — only meaningful for grid-approx/row-approx-loft. */
  minDeg?: number
  /** Surface maximum degree (cq: 8). */
  maxDeg?: number
}

/** A row×col point grid with its dimensions (structural — no gear types here). */
export interface GearSplineGrid {
  /** `rows` point rows of `cols` points each. */
  points: Vec3[][]
  rows: number
  cols: number
}

/**
 * Build a face from a row×col point grid with the given strategy.
 *
 * @throws kernel errors propagate verbatim (never swallowed — red line)
 *
 * @param kernel 双句柄
 * @param grid row×col point grid
 * @param strategy face building strategy
 * @param options tolerance/degree options
 * @returns single face handle (Face)
 */
export function buildGearSplineFace(
  kernel: GearKernel,
  grid: GearSplineGrid,
  strategy: GearSplineFaceStrategy,
  options: GearSplineFaceOptions = {},
): BrepHandle {
  const tol = options.tolerance ?? 1e-2
  switch (strategy) {
    case 'grid-approx':
      return buildGearGridApprox(kernel, grid)
    case 'row-approx-loft':
      return buildGearRowLoft(kernel, grid, (row) => kernel.l1.approximatePoints(row, tol))
    case 'row-interp-loft':
      // L1 `interpolatePoints(points, degree)` 与 occt 原生 `interpolatePoints(points, periodic?)`
      // 的第二参**同位置不同义**：L1 是次数，原生是周期性。occt 适配器只认 degree=3
      // （其余显式抛错），而 3 正是原生缺省的三次有理/非周期插值——故 degree=3 与
      // 旧口径 `interpolatePoints(row, false)` 等价（§3.5 第 2 项的那个调用点）。
      return buildGearRowLoft(kernel, grid, (row) => kernel.l1.interpolatePoints(row, 3))
  }
}

/** S1: fit the whole grid to one B-spline surface at once. */
function buildGearGridApprox(kernel: GearKernel, grid: GearSplineGrid): BrepHandle {
  const flat: Vec3[] = []
  for (const row of grid.points) for (const p of row) flat.push(p)
  return kernel.l1.bsplineSurface(flat, grid.rows, grid.cols)
}

/** S2/S3: per-row curve → platform `loft` skinning. */
function buildGearRowLoft(
  kernel: GearKernel,
  grid: GearSplineGrid,
  makeCurve: (row: Vec3[]) => BrepHandle,
): BrepHandle {
  const wires = grid.points.map((row) => kernel.l1.makeWire([makeCurve(row)]))
  // `occt.loft(wires, isSolid=false, ruled=false)` returns a **shell** (measured
  // 2026-09-08), while cq's tooth face is a TopoDS_Face; downstream sew /
  // projectPointOnFace require a Face, so extract the sole face.
  // 走平台面而不是 L1 `loft`：L1 恒产实体（见 `GearOcct.loft`），实体的面数不为 1，
  // `soleGearFace` 会直接抛错。
  return soleGearFace(kernel, kernel.occt.loft(wires, false, false))
}

/**
 * Reduce a "single-face shell" to a Face; a Face passes through unchanged.
 *
 * @throws when the face count is not 1 (silently taking the first would mask problems)
 *
 * @param kernel 双句柄
 * @param shape any shape (Face / single-face shell / …)
 * @returns the sole Face
 */
export function soleGearFace(kernel: GearKernel, shape: BrepHandle): BrepHandle {
  if (gearIsFace(kernel, shape)) return shape
  const faces = kernel.l1.getSubShapes(shape, 'face')
  if (faces.length !== 1) {
    throw new Error(
      `soleGearFace: expected a single face, got ${faces.length} (shapeType=${String(kernel.l1.shapeType(shape))})`,
    )
  }
  return faces[0]!
}

/** Distance from a point to a face (platform `projectPointOnFace`).
 *
 * @param kernel 双句柄
 * @param face target face
 * @param p query point
 * @returns euclidean distance (mm)
 */
export function gearDistanceToFace(kernel: GearKernel, face: BrepHandle, p: Vec3): number {
  const q = kernel.occt.projectPointOnFace(face, p)
  return Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z)
}

/** Distance statistics (max / RMS / sample count). */
export interface GearDeviationStats {
  max: number
  rms: number
  n: number
}

/**
 * Distance statistics of reference sample points against a face.
 *
 * Parameterization-independent: samples come from the cq side's (u,v) grid, so
 * the two surfaces may have different parameterizations.
 *
 * @param kernel 双句柄
 * @param face face under test
 * @param samplePoints reference sample points (3D)
 * @returns max distance / RMS / sample count
 */
export function gearFaceDeviation(
  kernel: GearKernel,
  face: BrepHandle,
  samplePoints: Vec3[],
): GearDeviationStats {
  let max = 0
  let sumSq = 0
  for (const p of samplePoints) {
    const d = gearDistanceToFace(kernel, face, p)
    if (d > max) max = d
    sumSq += d * d
  }
  return { max, rms: Math.sqrt(sumSq / samplePoints.length), n: samplePoints.length }
}
