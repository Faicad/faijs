/**
 * occt-kernel/occt-primitives — `createOcctPrimitives()`: the L1 contract
 * (`BrepEngineApi`) adapter over the raw occt-wasm `OcctKernel` singleton.
 *
 * Plan Phase 3.2:
 * explicit object literal, one method per L1 contract member — no monkey
 * patching, no cross-layer assertion lies, no unsupported() stubs. Every member
 * here is either a direct pass-through to the native kernel or an adapter-side
 * dialect digestion, both honestly implementing the contract.
 *
 * Occt-only capabilities (loft family, tool-entity section/split, *WithHistory
 * beyond the L1 trio, XCAF, SVG projection …) are deliberately NOT here —
 * platform code reaches them through the native face: `getOcctKernel()` (D3).
 */
import type {
  EdgeData,
  EvolutionData,
  Mesh,
  OcctKernel,
  ShapeHandle,
  Vec3,
} from 'occt-wasm'
import { initOcctWasm } from './occtKernel'
import { hullFromPoints as hullFromPointsCore } from './hullOps'
import { repairDegenerateRevolve } from './revolve-degenerate'
import type { AssertSatisfiesBrepEngineApi, BrepEngineApi } from '../brep/engine/primitives'
import type {
  BrepBoundingBox,
  BrepCurveParameters,
  BrepEdgeData,
  BrepEvolutionData,
  BrepHandle,
  BrepMeshResult,
  BrepUvBounds,
  BrepVec3,
  ShapeType,
} from '../brep/engine/types'

const asHandle = (h: number | ShapeHandle): BrepHandle => h as BrepHandle
const asShape = (h: BrepHandle): ShapeHandle => h as unknown as ShapeHandle
const shapes = (hs: BrepHandle[]): ShapeHandle[] => hs.map(asShape)
const v3 = (v: Vec3): BrepVec3 => ({ x: v.x, y: v.y, z: v.z })
const rad = (deg: number): number => (deg * Math.PI) / 180

// canonical 椭圆帧用到的向量小工具（BrepVec3 = {x,y,z} 对象，不是元组）。
const ellSub = (a: BrepVec3, b: BrepVec3): BrepVec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const ellScale = (a: BrepVec3, s: number): BrepVec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
const ellDot = (a: BrepVec3, b: BrepVec3): number => a.x * b.x + a.y * b.y + a.z * b.z
const ellCross = (a: BrepVec3, b: BrepVec3): BrepVec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
const ellUnit = (a: BrepVec3, what: string): BrepVec3 => {
  const len = Math.hypot(a.x, a.y, a.z)
  if (!(len > 1e-12)) throw new Error(`[occt] ${what} must be non-zero`)
  return { x: a.x / len, y: a.y / len, z: a.z / len }
}

/**
 * L1 向量形参的静态校验：`BrepVec3 = {x,y,z}` **对象**，不是元组、更不是布尔。
 *
 * 包侧旧口径（`loft(wires, isSolid?, ruled?)`）把布尔塞进 endPoint 位时，occt 会走
 * `loftWithVertices` 并 wasm 硬 abort（进程直接退出、JS 层捕不到）；brepkit 则抛
 * `cannot normalize zero vector`。两者都无指向——静态可判的约束必须在执行前拦下。
 */
const isBrepVec3 = (v: unknown): boolean => {
  if (typeof v !== 'object' || v === null) return false
  const o = v as { x?: unknown; y?: unknown; z?: unknown }
  return typeof o.x === 'number' && typeof o.y === 'number' && typeof o.z === 'number'
}

/** Topology layer uses this upper bound for face hashes (HASH_CODE_MAX). */
const HASH_UPPER_BOUND = 2 ** 24

/** occt-wasm native linearPattern/circularPattern return ONE compound handle
 * containing all replicas (the wasm d.ts type lies by claiming a plain handle).
 * The adapter captures the native methods, then splits the compound via
 * getSubShapes('solid') into the BrepHandle[] the L1 contract promises. */
type OcctPatternRaw = {
  linearPattern(shape: ShapeHandle, direction: Vec3, spacing: number, count: number): ShapeHandle
  circularPattern(shape: ShapeHandle, center: Vec3, axis: Vec3, angle: number, count: number): ShapeHandle
}

/**
 * Build a large planar face (boolean tool) through `point`, oriented by
 * `normal`. The face is constructed directly in the plane's own basis
 * (u ⊥ v ⊥ normal, through point) — no post-rotation needed, any normal
 * direction works (the Phase 1 probe only pinned +Z; this generalizes it).
 */
function makePlanarFaceTool(k: OcctKernel, point: BrepVec3, normal: BrepVec3): ShapeHandle {
  const size = 500 // large enough to fully cut any reasonable solid
  // Pick the axis component with the smallest magnitude to build a stable
  // perpendicular basis (avoids degeneracy when normal is axis-aligned).
  const ax = Math.abs(normal.x)
  const ay = Math.abs(normal.y)
  const az = Math.abs(normal.z)
  let u: BrepVec3
  if (ax <= ay && ax <= az) u = { x: 0, y: -normal.z, z: normal.y }
  else if (ay <= az) u = { x: -normal.z, y: 0, z: normal.x }
  else u = { x: normal.y, y: -normal.x, z: 0 }
  const ul = Math.hypot(u.x, u.y, u.z)
  u = { x: u.x / ul, y: u.y / ul, z: u.z / ul }
  const v: BrepVec3 = {
    x: normal.y * u.z - normal.z * u.y,
    y: normal.z * u.x - normal.x * u.z,
    z: normal.x * u.y - normal.y * u.x,
  }
  const corner = (a: number, b: number): Vec3 => ({
    x: point.x + (u.x * a + v.x * b) * size,
    y: point.y + (u.y * a + v.y * b) * size,
    z: point.z + (u.z * a + v.z * b) * size,
  })
  const e1 = k.makeLineEdge(corner(-1, -1), corner(1, -1))
  const e2 = k.makeLineEdge(corner(1, -1), corner(1, 1))
  const e3 = k.makeLineEdge(corner(1, 1), corner(-1, 1))
  const e4 = k.makeLineEdge(corner(-1, 1), corner(-1, -1))
  const wire = k.makeWire([e1, e2, e3, e4])
  const face = k.makeFace(wire)
  k.release(wire)
  return face
}

/**
 * Create the occt implementation of the L1 engine contract. Idempotent-friendly:
 * the wasm kernel is a process-level singleton (see initOcctWasm), each call
 * returns a fresh adapter object over the same kernel.
 *
 * @returns a BrepEngineApi implementation backed by the occt wasm kernel.
 */
export async function createOcctPrimitives(): Promise<BrepEngineApi> {
  const k = await initOcctWasm()
  const raw = k as unknown as OcctPatternRaw
  // Capture native pattern methods BEFORE any wiring so gridPattern composes
  // on true native semantics (old adapter GOTCHA: after overwriting, calling
  // the property again recurses into the wrapper).
  const nativeLinearPattern = raw.linearPattern.bind(k)
  // 2026-09-25 core-decouple Phase 2（§5.1）：hull 最小闭包已移植进 occt-kernel/
  // （hullGeometry + hullOps，occt-wasm 原生直调），此处不再经
  // OcctWasmAdapter——core 自有引擎对旧适配器的最后一处依赖已拔除。

  const splitCompoundToArray = (compound: ShapeHandle): BrepHandle[] => {
    const parts = k.getSubShapes(compound, 'solid').map(asHandle)
    k.release(compound)
    return parts
  }

  const toEvolution = (e: EvolutionData): BrepEvolutionData => ({
    // occt-wasm's EvolutionData already carries the segmented
    // [inHash, count, outHash…] encoding pinned by phase0-kernel-probes
    // (its own docs claim flat maps — docs are wrong, data is segmented).
    result: asHandle(e.result),
    modified: e.modified,
    generated: e.generated,
    deleted: e.deleted,
  })

  /**
   * canonical 椭圆帧（与 `cad.circleArc` / `neutralCircleArc` 同一规则）：
   * `u` = 世界 +X 在椭圆面上的投影（`|n̂.x| ≥ 0.999` 时退化取 +Y），`v = n̂ × u`。
   * 契约点 `E(θ) = c + a·cosθ·u + b·sinθ·v`。
   */
  const ellipseFrame = (center: BrepVec3, normal: BrepVec3, a: number, b: number) => {
    const n = ellUnit(normal, 'normal')
    const ref = Math.abs(n.x) < 0.999 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
    const u = ellUnit(ellSub(ref, ellScale(n, ellDot(ref, n))), 'normal')
    const v = ellCross(n, u)
    const point = (t: number): BrepVec3 => ({
      x: center.x + a * Math.cos(t) * u.x + b * Math.sin(t) * v.x,
      y: center.y + a * Math.cos(t) * u.y + b * Math.sin(t) * v.y,
      z: center.z + a * Math.cos(t) * u.z + b * Math.sin(t) * v.z,
    })
    /** 实测点 → 契约帧角度（atan2(b 分量, a 分量)）。 */
    const angleOf = (p: BrepVec3): number =>
      Math.atan2(ellDot(ellSub(p, center), v) / b, ellDot(ellSub(p, center), u) / a)
    return { n, u, v, point, angleOf }
  }

  /**
   * occt 侧椭圆弧的 canonical 对齐。
   *
   * `gp_Elips` 的轴是内核自选的：`gp_Ax2(center, normal)` 的 XDirection 定 a 的方向，且
   * `gp_Elips` 硬要求 `a >= b`（对调半径会直接 KERNEL_ERROR）。实测 `n̂ = +Z` 时 XDirection
   * 恰好是契约帧的 `u`，倾斜法向时**会整体旋转**（`n̂ = +X` / `+Y` 的 0° 点都落在 `+Z`，
   * 即 XDirection 落到 `±v` 上）。所以不能靠改角度、也不能靠对调半径，只能量出这个旋转再把它转回来：
   *
   * 1. 闭合椭圆探针（`makeEllipseEdge` 的参数 0 / 90° 两点）量出内核自己的 XDirection `kx`；
   * 2. `ρ` = `kx` 到契约帧 `u` 的有向角（绕 `n̂`）。内核椭圆 = 契约椭圆绕 `(center, n̂)` 转 `−ρ`，
   *    所以「先用契约角建弧、再转 `ρ`」即可把几何与参数一起对齐（运动是刚性的，`curveType`
   *    仍是解析 `ellipse`，不降级 —— 而且 `gp_Ax2` 恒右手，`ky = n̂ × kx` 会被转到 `v` 上，
   *    不需要镜像）；
   * 3. 验两端 **并且验参数中点**：跨度 135° 的 CW 弧与 225° 的 CCW 补弧两端点完全重合，
   *    只验两端会把长弧放过去；
   * 4. 方向相反时（CW，或内核轴基顺序相反）建反向弧再 `reverseShape`：该边是 REVERSED，
   *    按 `shapeOrientation` 解释走向时起点仍是 `startAngle` 一侧。
   *
   * 全部候选都不落点时显式抛错，绝不把内核方言漏给消费方。
   */
  const ellipseArcOcct = (
    center: BrepVec3,
    normal: BrepVec3,
    a: number,
    b: number,
    startAngle: number,
    endAngle: number,
  ): BrepHandle => {
    const span = endAngle - startAngle
    if (!(Math.abs(span) > 1e-12)) throw new Error('[occt] makeEllipseArc: zero span')
    if (Math.abs(span) > 2 * Math.PI + 1e-9) throw new Error('[occt] makeEllipseArc: span exceeds 360°')
    const fr = ellipseFrame(center, normal, a, b)
    const n = fr.n
    const want = [fr.point(startAngle), fr.point(endAngle)] as const
    const wantMid = fr.point((startAngle + endAngle) / 2)
    const tol = 1e-7 * Math.max(a, b, 1)

    // 探针：内核自己的 XDirection（闭合椭圆恒可建，参数 0 点就在 XDirection 上）。
    const probe = asHandle(k.makeEllipseEdge(center as never, normal as never, a, b))
    const probeShape = asShape(probe)
    const pr = k.curveParameters(probeShape)
    const q0 = v3(k.curvePointAtParam(probeShape, pr.first))
    k.release(probeShape)
    const kx = ellUnit(ellSub(q0, center), 'kernel x-axis')
    const rho = Math.atan2(ellDot(n, ellCross(kx, fr.u)), ellDot(kx, fr.u))

    const build = (p0: number, p1: number): ShapeHandle =>
      k.makeEllipseArc(center as never, normal as never, a, b, p0, p1)
    const emit = (h: ShapeHandle): ShapeHandle =>
      Math.abs(rho) < 1e-12
        ? h
        : k.rotate(h, { point: center, direction: n } as never, rho)
    const endsOf = (h: ShapeHandle): [BrepVec3, BrepVec3] => {
      const p = k.curveParameters(h)
      return [v3(k.curvePointAtParam(h, p.first)), v3(k.curvePointAtParam(h, p.last))]
    }
    const midOf = (h: ShapeHandle): BrepVec3 => {
      const p = k.curveParameters(h)
      return v3(k.curvePointAtParam(h, (p.first + p.last) / 2))
    }
    const near = (p: BrepVec3, q: BrepVec3): boolean =>
      Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) <= tol

    // 候选 1：契约角直传 + 旋转对齐（CCW 时一步到位）。
    const h1 = emit(build(startAngle, endAngle))
    const e1 = endsOf(h1)
    if (near(e1[0], want[0]) && near(e1[1], want[1]) && near(midOf(h1), wantMid)) return asHandle(h1)
    // 候选 2：反向建（CW 或内核参数方向相反）+ 旋转对齐 + 翻转向。
    const h2 = emit(build(endAngle, startAngle))
    const e2 = endsOf(h2)
    if (near(e2[0], want[1]) && near(e2[1], want[0]) && near(midOf(h2), wantMid)) {
      return asHandle(k.reverseShape(h2 as never))
    }
    throw new Error(
      `[occt] makeEllipseArc: canonical datum unresolved ` +
        `(rho=${rho.toFixed(6)}, span=${(span * 180 / Math.PI).toFixed(3)}°, a=${a}, b=${b})`,
    )
  }

  const primitives: BrepEngineApi = {
    // ── lifecycle ──
    release: (shape) => k.release(asShape(shape)),
    dispose: (shape) => {
      if (shape !== undefined) k.release(asShape(shape))
    },

    // ── solids ──
    makeBox: (dx, dy, dz) => asHandle(k.makeBox(dx, dy, dz)),
    makeBoxFromCorners: (c1, c2) => asHandle(k.makeBoxFromCorners(c1, c2)),
    makeCylinder: (radius, height) => asHandle(k.makeCylinder(radius, height)),
    makeSphere: (radius) => asHandle(k.makeSphere(radius)),
    makeCone: (r1, r2, height) => asHandle(k.makeCone(r1, r2, height)),
    makeRectangle: (w, h) => asHandle(k.makeRectangle(w, h)),
    makeEllipsoid: (rx, ry, rz) => asHandle(k.makeEllipsoid(rx, ry, rz)),
    makeTorus: (major, minor) => asHandle(k.makeTorus(major, minor)),
    makeVertex: (x, y, z) => asHandle(k.makeVertex(x, y, z)),

    // ── shaping ──
    extrude: (shape, dx, dy, dz) => asHandle(k.extrude(asShape(shape), dx, dy, dz)),
    revolveVec: (shape, center, direction, angleDeg) => {
      // Near-degenerate cone preservation: modern OCCT's revolve sweep
      // canonicalizes slant profile lines with tiny slope (e.g. the Fasteners
      // 0.001 sliver) into lossy/inconsistent cylinders; the exact frustum
      // repair keeps corpus-truth-exact cones. Gates inside; non-degenerate
      // profiles take the plain sweep unchanged.
      const repaired = repairDegenerateRevolve(k, asShape(shape), center, direction, angleDeg)
      if (repaired !== undefined) return asHandle(repaired)
      return asHandle(k.revolve(asShape(shape), { point: center, direction }, rad(angleDeg)))
    },
    // L1 中立 sweep：occt 侧 native sweepPipeShell 的 (profile, spine) 与 L1 同形，
    // 只补齐两个默认开关（freenet=false / smooth=false，与旧 sweepFns 的默认路径
    // 逐字节一致）；brepkit 侧的 face/NURBS 适配在 brepkitKernel 内。
    // ⚠️ 不用 native `simplePipe`：实测它对本用例的 8×8 方截面沿 +Z 扫 50 产出
    // 体积 2133.33，而 sweepPipeShell 产出解析值 3200（`test/api/sweep-loft.test.ts`
    // 的「两个 2D 面截面」用例即为该真值）——基础 sweep 必须与既有行为一致。
    sweep: (profile, spine) => asHandle(k.sweepPipeShell(asShape(profile), asShape(spine), false, false)),
    // L1 中立 loft：occt 原生 loft 吃 wire，只作 endPoint → loftWithVertices 的退化解。
    loft: (sections, ruled, endPoint) => {
      const wires = shapes(sections)
      if (endPoint === undefined) return asHandle(k.loft(wires, true, ruled))
      // 契约守卫：第三参是 `endPoint: BrepVec3`，不是布尔/标量。包侧旧口径
      // `loft(wires, isSolid?, ruled?)`（faijs-gears `loft(wires, false, false)`）会把
      // 布尔塞进这个位置 → occt 走 loftWithVertices 而 wasm 硬 abort（进程直接退出、
      // JS 层捕不到）。静态可判的输入约束必须在执行前显式失败。
      if (!isBrepVec3(endPoint)) {
        throw new Error(
          `E_LOFT_BAD_ENDPOINT: loft endPoint must be a BrepVec3 ({x,y,z}), got ${JSON.stringify(endPoint)}`,
        )
      }
      const end = k.makeVertex(endPoint.x, endPoint.y, endPoint.z)
      try {
        return asHandle(k.loftWithVertices(wires, true, ruled, undefined as never, end))
      } finally {
        k.release(end)
      }
    },
    sew: (list, tolerance) => asHandle(k.sew(shapes(list), tolerance)),
    sewAndSolidify: (faces, tolerance) => asHandle(k.sewAndSolidify(shapes(faces), tolerance)),
    shell: (solid, facesToRemove, thickness, tolerance) =>
      asHandle(k.shell(asShape(solid), shapes(facesToRemove), thickness, tolerance)),
    hullFromPoints: (points, tolerance) => hullFromPointsCore(k, points as never, tolerance),
    // 样条面 / 体构造补缺（2026-10-13 进 L1）：occt 侧全部直连原生，签名同形。
    bsplineSurface: (points, rows, cols) =>
      asHandle(k.bsplineSurface(points as never, rows, cols)),
    makeSolid: (shell) => asHandle(k.makeSolid(asShape(shell))),
    // tolerance 在 occt 是必填（OCCT 偏移重建精度）；L1 让它可选，缺省取 brepjs
    // 默认 1e-6（occt-wasm index.d.ts 注释：`1e-3` 是更粗的历史值）——不静默取 0。
    thicken: (shape, thickness, tolerance) =>
      asHandle(k.thicken(asShape(shape), thickness, tolerance ?? 1e-6)),

    // ── booleans & splitting ──
    fuse: (a, b) => asHandle(k.fuse(asShape(a), asShape(b))),
    cut: (a, b) => asHandle(k.cut(asShape(a), asShape(b))),
    common: (a, b) => asHandle(k.common(asShape(a), asShape(b))),
    intersect: (a, b) => asHandle(k.intersect(asShape(a), asShape(b))),
    fuseAll: (list) => asHandle(k.fuseAll(shapes(list))),
    sectionByPlane: (shape, point, normal) => {
      // Phase 1 probe A (phase1-semantic-probes.test.ts): a planar face used as
      // the section tool yields the plane-section geometry. Downcast the result
      // compound into edge/wire handles; a non-compound result passes through.
      const tool = makePlanarFaceTool(k, point, normal)
      try {
        const result = k.section(asShape(shape), tool)
        if (k.isNull(result)) return []
        const out: BrepHandle[] = []
        for (const t of ['edge', 'wire'] as const) {
          for (const part of k.getSubShapes(result, t)) out.push(asHandle(k.downcast(part, t)))
        }
        if (out.length === 0) {
          // No intersection: native section still yields an (empty) compound —
          // release it and return an empty list so callers can detect the miss
          // instead of adopting an empty compound as a "curve".
          k.release(result)
          return []
        }
        k.release(result)
        return out
      } finally {
        k.release(tool)
      }
    },
    splitByPlane: (shape, point, normal) => {
      // Phase 1 probe A: splitter with a planar face tool yields exactly 2 solids.
      const tool = makePlanarFaceTool(k, point, normal)
      try {
        const result = k.split(asShape(shape), [tool])
        if (k.isNull(result)) throw new Error('splitByPlane: splitter produced no result')
        const solids = k.getSubShapes(result, 'solid').map(asHandle)
        k.release(result)
        if (solids.length !== 2) {
          throw new Error(`splitByPlane: expected 2 solids, got ${solids.length}`)
        }
        // Classify sides by centroid projection onto the plane normal.
        const originDot = point.x * normal.x + point.y * normal.y + point.z * normal.z
        const side = (h: BrepHandle): number => {
          const c = k.getCenterOfMass(asShape(h))
          return c.x * normal.x + c.y * normal.y + c.z * normal.z - originDot
        }
        const [a, b] = solids
        return side(a) >= side(b)
          ? { positive: a, negative: b }
          : { positive: b, negative: a }
      } finally {
        k.release(tool)
      }
    },

    // ── chamfer & fillet ──
    chamfer: (solid, edgesList, distance) =>
      asHandle(k.chamfer(asShape(solid), shapes(edgesList), distance)),
    chamferDistAngle: (solid, edgesList, distance, angleDeg) =>
      asHandle(k.chamferDistAngle(asShape(solid), shapes(edgesList), distance, angleDeg)),
    fillet: (solid, edgesList, radius) =>
      asHandle(k.fillet(asShape(solid), shapes(edgesList), radius)),
    filletVariable: (solid, edge, startRadius, endRadius) =>
      asHandle(k.filletVariable(asShape(solid), asShape(edge), startRadius, endRadius)),
    filletWithHistory: (solid, edgesList, radius, inputFaceHashes, hashUpperBound) =>
      toEvolution(k.filletWithHistory(asShape(solid), shapes(edgesList), radius, inputFaceHashes, hashUpperBound)),

    // ── transforms (matrix convention: 3×4 row-major, 12 doubles) ──
    translate: (shape, dx, dy, dz) => asHandle(k.translate(asShape(shape), dx, dy, dz)),
    scale: (shape, center, factor) => asHandle(k.scale(asShape(shape), center, factor)),
    transform: (shape, matrix) => asHandle(k.transform(asShape(shape), matrix)),
    located: (shape, matrix) => asHandle(k.located(asShape(shape), matrix)),
    locate: (shape, matrix) => asHandle(k.located(asShape(shape), matrix)),
    generalTransform: (shape, matrix) => {
      // GOTCHA (2026-10-07, openscad example023 parity): the native `gp_GTrsf`
      // path returns a handle whose *stored triangulation* double-applies the
      // translated face's TopLoc. The exact geometry is right; only the
      // tessellation is wrong, so the defect only shows on an **already meshed**
      // shape — and every `cad.extrude`/boolean result is meshed for display
      // (`brep-ops.ts#solidToShape`). Measured on an extruded face-with-hole
      // prism: exact top cap 5.0, tessellated top cap 10.0 (non-uniform z×2.5:
      // 12.5 vs 17.5). `BRepBuilderAPI_Copy` yields a shape without the stale
      // triangulation, so the result re-tessellates correctly.
      //
      // Deliberately adapter-local, not in the engine-neutral dispatcher
      // (`brep/brep-ops.ts#applyAffineBrep`): the defect is **occt-only** —
      // brepkit's GTrsf path is clean (pinned by
      // test/brep/applymatrix-similarity-routing.test.ts). Making every engine
      // pay an extra handle allocation for an occt quirk also perturbed
      // brepkit's `cut` bbox in test/brep/engine/multi-engine-op-parity.test.ts.
      //
      // Safety: the copy is adapter-owned and released here; the returned handle
      // is independent of it (the native op does not consume its input).
      const copy = k.copy(asShape(shape))
      try {
        return asHandle(k.generalTransform(copy, matrix))
      } finally {
        k.release(copy)
      }
    },
    copy: (shape) => asHandle(k.copy(asShape(shape))),
    copyShape: (shape) => asHandle(k.copy(asShape(shape))),
    composeTransform: (m1, m2) => k.composeTransform(m1, m2),
    mirror: (shape, point, normal) => asHandle(k.mirror(asShape(shape), point, normal)),
    rotate: (shape, axis, angleRad) => asHandle(k.rotate(asShape(shape), axis, angleRad)),

    // ── patterns ──
    // GOTCHA: occt-wasm native linearPattern/circularPattern return ONE compound
    // handle (their d.ts type lies). Split it into per-replica handles here.
    linearPattern: (shape, direction, spacing, count) => {
      const compound = nativeLinearPattern(asShape(shape), direction, spacing, count)
      return splitCompoundToArray(compound)
    },
    circularPattern: (shape, center, axis, angleStep, count) => {
      // GOTCHA: occt-wasm 的原语口径是「总角度（弧度）+ 份数」——它内部按
      // `totalAngle / count` 逐份旋转，**不是**每份步距；faijs 契约是「每份步距（度）」。
      // 实测 anchor：直接传 (angleStep=30, count=4) 会得到每份 30/4 = 7.5 rad ≈ 429.7°
      // → 归一 69.7°，四处孔位全错。故此处换算 totalAngleRad = count · angleStep · π/180
      // （整圆 count 份即 2π，与 occt / smlib 的整圆语义一致）。
      const totalAngleRad = (count * angleStep * Math.PI) / 180
      const compound = (k as unknown as OcctPatternRaw).circularPattern.call(
        k, asShape(shape), center, axis, totalAngleRad, count,
      )
      return splitCompoundToArray(compound)
    },
    gridPattern: (shape, directionX, directionY, spacingX, spacingY, countX, countY) => {
      // Composed: native linearPattern along X per column, then along Y per row,
      // fuse all replicas. Must use the CAPTURED native linearPattern (returns
      // compound) — the adapter property above now returns arrays.
      const colCompound = nativeLinearPattern(asShape(shape), directionX, spacingX, countX)
      const cols = k.getSubShapes(colCompound, 'solid')
      k.release(colCompound)
      const all: ShapeHandle[] = []
      try {
        for (const c of cols) {
          const rowCompound = nativeLinearPattern(c, directionY, spacingY, countY)
          try {
            all.push(...k.getSubShapes(rowCompound, 'solid'))
          } finally {
            k.release(rowCompound)
          }
        }
      } finally {
        for (const c of cols) k.release(c)
      }
      return asHandle(k.fuseAll(all))
    },

    // ── curve construction ──
    makeLineEdge: (start, end) => asHandle(k.makeLineEdge(start, end)),
    makeArcEdge: (start, mid, end) => asHandle(k.makeArcEdge(start, mid, end)),
    makeBezierEdge: (controlPoints) => asHandle(k.makeBezierEdge(controlPoints)),
    makeBSplineEdge: (poles, weights, knots, multiplicities, degree, periodic) =>
      asHandle(k.makeBSplineEdge(poles, weights, knots, multiplicities, degree, periodic ?? false)),
    makeCircleEdge: (center, normal, radius) =>
      asHandle(k.makeCircleEdge(center, normal, radius)),
    makeCircleArc: (center, normal, radius, startAngle, endAngle) =>
      asHandle(k.makeCircleArc(center, normal, radius, startAngle, endAngle)),
    // 椭圆族：occt 原生解析椭圆直连（curveType = 'ellipse'、解析面）。弧的零点/轴向由
    // 内核自选，适配器在这里把 canonical 帧反解对齐（见 ellipseArcOcct 的 rationale）。
    makeEllipseEdge: (center, normal, majorRadius, minorRadius) =>
      asHandle(k.makeEllipseEdge(center, normal, majorRadius, minorRadius)),
    makeEllipseArc: (center, normal, majorRadius, minorRadius, startAngle, endAngle) =>
      ellipseArcOcct(center, normal, majorRadius, minorRadius, startAngle, endAngle),
    // 螺旋线：右手走原生 makeHelixWire（保持既有几何路径不变）；左手走带手性入口
    // makeHelixWireHanded(..., true) —— occt-wasm d.ts 明示后者才是 "Prefer this for
    // new code" 的入口。两侧都在本契约实现层直调，故 cad.helix 无需 import 平台模块、
    // 也不必声明 engines:['occt']（右手在 brepkit 上同样可用）。
    makeHelixWire: (origin, axis, pitch, height, radius, leftHanded) =>
      leftHanded
        ? asHandle(k.makeHelixWireHanded(origin, axis, pitch, height, radius, true))
        : asHandle(k.makeHelixWire(origin, axis, pitch, height, radius)),
    // 逼近容差：occt 原生 tolerance 可选，缺省由内核定；这里显式给 1e-2
    // （与 faijs-fasteners / cq 的 spline_approx_tol 同口径），不依赖内核默认。
    approximatePoints: (points, tolerance) =>
      asHandle(k.approximatePoints(points as never, tolerance ?? 1e-2)),
    interpolatePointsWithTangents: (points, startTangent, endTangent) =>
      asHandle(k.interpolatePointsWithTangents(points as never, startTangent, endTangent)),

    // ── topology construction ──
    makeWire: (edgesList) => asHandle(k.makeWire(shapes(edgesList))),
    makeFace: (wire) => asHandle(k.makeFace(asShape(wire))),
    makeCompound: (list) => asHandle(k.makeCompound(shapes(list))),
    addHolesInFace: (face, holeWires) =>
      asHandle(k.addHolesInFace(asShape(face), shapes(holeWires))),
    buildTriFace: (a, b, c) => asHandle(k.buildTriFace(a, b, c)),
    makeNonPlanarFace: (wire) => asHandle(k.makeNonPlanarFace(asShape(wire))),

    // ── tessellation (the only BREP→mesh exit) ──
    meshShape: (shape, options): BrepMeshResult => {
      const m: Mesh = k.meshShape(asShape(shape), options)
      return {
        positions: m.positions,
        normals: m.normals,
        indices: m.indices,
        vertexCount: m.vertexCount,
        triangleCount: m.triangleCount,
        faceGroups: m.faceGroups,
        faceCount: m.faceCount,
      }
    },
    wireframe: (shape, deflection): BrepEdgeData => {
      const e: EdgeData = k.wireframe(asShape(shape), deflection)
      return {
        points: e.points,
        edgeGroups: e.edgeGroups,
        pointCount: e.pointCount,
        edgeCount: e.edgeCount,
      }
    },

    // ── topology queries ──
    getSubShapes: (shape, type) => k.getSubShapes(asShape(shape), type).map(asHandle),
    subShapeHashes: (shape, type, hashUpperBound) =>
      k.subShapeHashes(asShape(shape), type, hashUpperBound),
    hashCode: (shape, upperBound) => k.hashCode(asShape(shape), upperBound),
    isSame: (a, b) => k.isSame(asShape(a), asShape(b)),
    isSolid: (shape) => k.isSolid(asShape(shape)),
    subShapeCount: (shape, type) => k.subShapeCount(asShape(shape), type),
    shapeType: (shape) => k.getShapeType(asShape(shape)).toLowerCase() as ShapeType,
    shapeOrientation: (shape) => String(k.shapeOrientation(asShape(shape))),
    edgeToFaceMap: (shape) => k.edgeToFaceMap(asShape(shape), HASH_UPPER_BOUND),
    adjacentFaces: (shape, face) =>
      k.adjacentFaces(asShape(shape), asShape(face)).map(asHandle),
    sharedEdges: (a, b) => k.sharedEdges(asShape(a), asShape(b)).map(asHandle),

    // ── geometry evaluation ──
    curveType: (edge) => String(k.curveType(asShape(edge))),
    curvePointAtParam: (edge, param) => v3(k.curvePointAtParam(asShape(edge), param)),
    curveTangent: (edge, param) => v3(k.curveTangent(asShape(edge), param)),
    curveParameters: (edge): BrepCurveParameters => k.curveParameters(asShape(edge)),
    curveIsClosed: (edge) => k.curveIsClosed(asShape(edge)),
    curveLength: (edge) => k.curveLength(asShape(edge)),
    surfaceType: (face) => String(k.surfaceType(asShape(face))),
    surfaceNormal: (face, u, vv) => v3(k.surfaceNormal(asShape(face), u, vv)),
    pointOnSurface: (face, u, vv) => v3(k.pointOnSurface(asShape(face), u, vv)),
    uvBounds: (face): BrepUvBounds => k.uvBounds(asShape(face)),
    surfaceCenterOfMass: (face) => v3(k.getSurfaceCenterOfMass(asShape(face))),
    vertexPosition: (vertex) => v3(k.vertexPosition(asShape(vertex))),
    containsPoint: (shape, point, tolerance) =>
      k.containsPoint(asShape(shape), { x: point.x, y: point.y, z: point.z }, tolerance),
    getFaceCylinderData: (face) => {
      const d = k.getFaceCylinderData(asShape(face))
      return d ? { radius: d.radius } : null
    },
    getNurbsCurveData: (edge) => {
      const d = k.getNurbsCurveData(asShape(edge))
      return d
        ? {
            degree: d.degree,
            rational: d.rational,
            periodic: d.periodic,
            knots: Array.from(d.knots),
            multiplicities: Array.from(d.multiplicities),
            poles: Array.from(d.poles),
            weights: Array.from(d.weights),
          }
        : null
    },
    curveSplit: (edge, param) => {
      const parts = k.curveSplit(asShape(edge), param)
      return [asHandle(parts[0]), asHandle(parts[1])]
    },
    interpolatePoints: (points, degree) => {
      // L1 contract takes an explicit degree; occt-wasm interpolates a cubic
      // (or periodic) spline and ignores degree — honor only degree 3 and
      // reject others loudly rather than silently producing wrong geometry.
      if (degree !== 3) {
        throw new Error(`occt interpolatePoints: only degree 3 supported, got ${degree}`)
      }
      return asHandle(k.interpolatePoints(points))
    },

    defeature: (shape, facesList) => asHandle(k.defeature(asShape(shape), shapes(facesList), 0)),
    draft: (shape, facesList, pull, neutral, angleDeg) => {
      // Native draft is single-face + radians, and has NO neutral-plane argument
      // (occt-wasm index.d.ts:156 `draft(shape, face, angleRad, direction)`).
      // Silently dropping a caller-supplied neutral plane would draft against the
      // wrong plane, so reject loudly (same rule as `interpolatePoints` below).
      // brepkit's L1 draft does consume the neutral point (brepkitKernel.ts:669).
      if (neutral && (neutral.x !== 0 || neutral.y !== 0 || neutral.z !== 0)) {
        throw new Error(
          'occt draft: neutral plane is not supported by the native kernel ' +
            `(got neutral=(${neutral.x},${neutral.y},${neutral.z})); only the origin neutral is representable`,
        )
      }
      // Native draft is single-face; fold N faces sequentially.
      let current = asShape(shape)
      for (const f of facesList) {
        current = k.draft(current, asShape(f), rad(angleDeg), pull)
      }
      return asHandle(current)
    },
    removeHolesFromFace: (face) => {
      // Native takes hole indices; removing ALL holes = all wires except outer.
      const wires = k.getSubShapes(asShape(face), 'wire')
      const indices = wires.map((_, i) => i).filter((i) => i > 0)
      return asHandle(k.removeHolesFromFace(asShape(face), indices))
    },
    reverseShape: (shape) => asHandle(k.reverseShape(asShape(shape))),
    projectEdges: (shape, origin, direction, xAxis, _hiddenLines, _deflection) =>
      // Native projection has no hiddenLines/deflection flags in its signature —
      // pass through the projection result; callers treat it as opaque (unknown).
      k.projectEdges(asShape(shape), origin, direction, xAxis),

    // ── measurement ──
    getBoundingBox: (shape, useTriangulation): BrepBoundingBox =>
      k.getBoundingBox(asShape(shape), useTriangulation ?? false),
    getVolume: (shape) => k.getVolume(asShape(shape)),
    getCenterOfMass: (shape) => v3(k.getCenterOfMass(asShape(shape))),
    getSurfaceArea: (shape) => k.getSurfaceArea(asShape(shape)),
    // getLength：唯一 edge 弧长之和（与 brepkit 适配器同口径，D5）。
    // OCC 原生 LinearProperties 默认 SkipShared=false，按**面**遍历、把每条共享边按
    // 相邻面各计一次 ⇒ 实体得到的是「Σ 面周长」而非弧长（20×10×5 盒 → 280 = 2×140）。
    // 归一化为 TopExp 去重后的边逐条求和。checkpoint/releaseSince 是 occt-wasm 为
    // 「枚举子形状句柄后批量回收」提供的 arena 机制（index.d.ts:274-279, 498-511）；
    // h 在 checkpoint 之前产生，不会被回收。
    getLength: (shape) => {
      const h = asShape(shape)
      const mark = k.checkpoint()
      try {
        let total = 0
        for (const e of k.getSubShapes(h, 'edge')) total += k.getLength(e)
        return total
      } finally {
        k.releaseSince(mark)
      }
    },

    // ── validation & repair ──
    isValid: (shape) => k.isValid(asShape(shape)),
    unifySameDomain: (shape) => asHandle(k.unifySameDomain(asShape(shape))),
    healSolid: (shape, tolerance) => asHandle(k.healSolid(asShape(shape), tolerance)),
    fixShape: (shape) => asHandle(k.fixShape(asShape(shape))),
    fixFaceOrientations: (shape) => asHandle(k.fixFaceOrientations(asShape(shape))),
    removeDegenerateEdges: (shape, _tolerance) =>
      // Native takes no tolerance parameter (kernel-fixed tolerance).
      asHandle(k.removeDegenerateEdges(asShape(shape))),

    // ── IO ──
    importStep: (data) => asHandle(k.importStep(data)),
    exportStep: (shape) => k.exportStep(asShape(shape)),
    importStl: (data) => asHandle(k.importStl(data)),
    fromBREP: (data) => asHandle(k.fromBREP(data)),

    // ── face evolution (L1 trio only) ──
    cutWithHistory: (a, b, inputFaceHashes, hashUpperBound) =>
      toEvolution(k.cutWithHistory(asShape(a), asShape(b), inputFaceHashes, hashUpperBound)),
    fuseWithHistory: (a, b, inputFaceHashes, hashUpperBound) =>
      toEvolution(k.fuseWithHistory(asShape(a), asShape(b), inputFaceHashes, hashUpperBound)),
    intersectWithHistory: (a, b, inputFaceHashes, hashUpperBound) =>
      toEvolution(k.intersectWithHistory(asShape(a), asShape(b), inputFaceHashes, hashUpperBound)),
  }

  return primitives
}

/** The occt primitives type (BrepEngineApi implementation). */
export type OcctPrimitives = Awaited<ReturnType<typeof createOcctPrimitives>>

// §7.8 compile-time guard: the explicit literal must satisfy the L1 contract
// member-by-member (this now has real verification power — no `as` escape).
/** Compile-time assertion that OcctPrimitives satisfies BrepEngineApi. */
export type _AssertOcctApi = AssertSatisfiesBrepEngineApi<OcctPrimitives>