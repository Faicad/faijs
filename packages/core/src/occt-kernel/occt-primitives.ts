/**
 * occt-kernel/occt-primitives — `createOcctPrimitives()`: the L1 contract
 * (`BrepEngineApi`) adapter over the raw occt-wasm `OcctKernel` singleton.
 *
 * Plan Phase 3.2 (docs/plans/2026-09-24-brep-engine-api-narrowing-native-access.md):
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
} from '../brep/engine/types'

const asHandle = (h: number | ShapeHandle): BrepHandle => h as BrepHandle
const asShape = (h: BrepHandle): ShapeHandle => h as unknown as ShapeHandle
const shapes = (hs: BrepHandle[]): ShapeHandle[] => hs.map(asShape)
const v3 = (v: Vec3): BrepVec3 => ({ x: v.x, y: v.y, z: v.z })
const rad = (deg: number): number => (deg * Math.PI) / 180

/** brepjs topology layer uses this upper bound for face hashes (HASH_CODE_MAX). */
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
  // （hullGeometry + hullOps，occt-wasm 原生直调），此处不再经 vendored
  // OcctWasmAdapter——core 自有引擎对 brepjs 适配器的最后一处依赖已拔除。

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
    revolveVec: (shape, center, direction, angleDeg) =>
      asHandle(k.revolve(asShape(shape), { point: center, direction }, rad(angleDeg))),
    sew: (list, tolerance) => asHandle(k.sew(shapes(list), tolerance)),
    sewAndSolidify: (faces, tolerance) => asHandle(k.sewAndSolidify(shapes(faces), tolerance)),
    shell: (solid, facesToRemove, thickness, tolerance) =>
      asHandle(k.shell(asShape(solid), shapes(facesToRemove), thickness, tolerance)),
    hullFromPoints: (points, tolerance) => hullFromPointsCore(k, points as never, tolerance),

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
    generalTransform: (shape, matrix) => asHandle(k.generalTransform(asShape(shape), matrix)),
    copy: (shape) => asHandle(k.copy(asShape(shape))),
    copyShape: (shape) => asHandle(k.copy(asShape(shape))),
    composeTransform: (m1, m2) => k.composeTransform(m1, m2),
    mirror: (shape, point, normal) => asHandle(k.mirror(asShape(shape), point, normal)),

    // ── patterns ──
    // GOTCHA: occt-wasm native linearPattern/circularPattern return ONE compound
    // handle (their d.ts type lies). Split it into per-replica handles here.
    linearPattern: (shape, direction, spacing, count) => {
      const compound = nativeLinearPattern(asShape(shape), direction, spacing, count)
      return splitCompoundToArray(compound)
    },
    circularPattern: (shape, center, axis, angleStep, count) => {
      // Empirically validated (old adapter + engine-switch-p2 parity): the wasm
      // layer takes the angle in DEGREES here (unlike revolve's angleRad).
      const compound = (k as unknown as OcctPatternRaw).circularPattern.call(
        k, asShape(shape), center, axis, angleStep, count,
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
    makeCircleEdge: (center, normal, radius) =>
      asHandle(k.makeCircleEdge(center, normal, radius)),

    // ── topology construction ──
    makeWire: (edgesList) => asHandle(k.makeWire(shapes(edgesList))),
    makeFace: (wire) => asHandle(k.makeFace(asShape(wire))),
    makeCompound: (list) => asHandle(k.makeCompound(shapes(list))),
    addHolesInFace: (face, holeWires) =>
      asHandle(k.addHolesInFace(asShape(face), shapes(holeWires))),
    buildTriFace: (a, b, c) => asHandle(k.buildTriFace(a, b, c)),

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
    shapeType: (shape) => k.getShapeType(asShape(shape)),
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
    getFaceCylinderData: (face) => {
      const d = k.getFaceCylinderData(asShape(face))
      return d ? { radius: d.radius } : null
    },
    getNurbsCurveData: (edge) => {
      const d = k.getNurbsCurveData(asShape(edge))
      return d ? { degree: d.degree, periodic: d.periodic, rational: d.rational } : null
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
      k.getBoundingBox(asShape(shape), useTriangulation),
    getVolume: (shape) => k.getVolume(asShape(shape)),
    getCenterOfMass: (shape) => v3(k.getCenterOfMass(asShape(shape))),
    getSurfaceArea: (shape) => k.getSurfaceArea(asShape(shape)),
    getLength: (shape) => k.getLength(asShape(shape)),

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