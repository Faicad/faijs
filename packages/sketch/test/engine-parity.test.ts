/**
 * engine-parity — which parts of the sketch/draw → face pipeline can run on each
 * BREP engine, measured rather than inferred.
 *
 * Written 2026-09-30 to answer the port plan's engine question; updated the same
 * day the brepkit arc defect was fixed. It also settles a contradiction in the
 * faijs tree: `api/feature-family.test.ts` carries a GOTCHA-2 note (added
 * 2026-09-24, commit 476a88c) claiming brepkit cannot build a sketch/profile
 * face — "invalid solid handle". `brep/engine/brepkit-non-solid-fix.test.ts`
 * (commit a317ea35, 2026-09-26) asserts `cad.profile` DOES work on brepkit. The
 * note predates the fix by two days and was never amended.
 *
 * ## What is actually true (measured, both engines)
 *
 * | pipeline part | occt | brepkit |
 * |---|---|---|
 * | lines only (rectangle, polygon, sampled curves) | ✅ | ✅ |
 * | `makeArcEdge` (quarter / half / cw spans) | ✅ | ✅ |
 * | `makeCircleEdge` full circle | ✅ | ✅ |
 * | bezier edges | ✅ | ✅ (NURBS-backed) |
 * | `makeWire` / `makeFace` / `addHolesInFace` / `makeCompound` | ✅ | ✅ |
 * | full-circle sketch → face → extrude | ✅ | ✅ |
 *
 * ## The arc defect and its fix
 *
 * `circumcircle()` (`brepkit-kernel/brepkitKernel.ts`) derived the centre from
 * `( |ac|²·(ab×n) + |ab|²·(n×ac) ) / 2|n|²` — the standard form with its two
 * coefficients swapped, i.e. negated. The centre landed on the far side of the
 * chord (measured `(20,0,0)` for the r=10 circle at the origin instead of
 * `(0,0,0)`), the three input points were not equidistant, and brepkit built the
 * 333° complementary arc (length 58.195 instead of πr/2 = 15.708). The fix is
 * the standard `( |ab|²·(ac×n) + |ac|²·(n×ab) ) / 2|n|²`; the invariant to pin
 * is `|center−a| = |center−b| = |center−c|`.
 *
 * A second, independent brepkit limitation surfaced after the fix: a closed wire
 * of EXACTLY two half-arcs makes `makeFaceFromWire` cover only 1/3 of the disc
 * (extrude volume 523.6 vs 1570.8), while 3- or 4-arc wires and a single closed
 * `makeCircleEdge` are exact. `liftCurve2dToPlane` therefore emits one
 * `makeCircleEdge` for a full circle instead of two arcs (GOTCHA recorded there).
 *
 * ## Measurement traps this file records
 *
 * - `getSurfaceArea` / `getVolume` map to solid-only brepkit functions; calling
 *   them on a face handle throws `invalid solid handle`. The valid area/volume
 *   signal is an *extruded solid*.
 * - `uvBounds` returns the sentinel `±1e6` for ANY planar face on brepkit —
 *   measured identical for the known-good `cad.profile` path and for
 *   `sketchFaces`. It is NOT a failure signal.
 * - `getLength` on a multi-edge wire was NOT the wire total (edge-length path
 *   won the dialect discrimination). Fixed by `1c06570` (2026-10-02): the L1
 *   `getLength` now sums the unique-edge arc lengths, so a 4-edge wire DOES
 *   report 140 — the pin below was updated to the fixed behaviour.
 *
 * Run: npx vitest run src/engine-parity.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { initOcctWasm } from '@faicad/faijs/occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '@faicad/faijs/brep/engine/adapters/occt'
import { registerBrepkitBrepEngine } from '@faicad/faijs/brep/engine/adapters/brepkit'
import { __resetEngineRegistriesForTests, getBrepEngine } from '@faicad/faijs/brep/engine/registry'
import { configureBackends, CONTRACT_VERSION } from '@faicad/faijs/runtime-state'
import { brepOf } from '@faicad/faijs/shape'
import type { Shape } from '@faicad/faijs/mesh/types'
import type { BrepEngineApi } from '@faicad/faijs/brep/engine/primitives'
import { extractContours } from '../src/contour.js'
import { toFreeCadGeoms } from '../src/project.js'
import { sketchFaces } from '../src/faces.js'
import { createNodePlanegcsSolver } from '../src/node.js'
import type { SketchSolver } from '../src/solver.js'
import type { SketchGeom } from '../src/canonical.js'

/** A 40×30 rectangle as four lines — the shape `faces-plane.test.ts` uses. */
const LINES: SketchGeom[] = [
  { tag: 'bottom', kind: 'line', x1: 0, y1: 0, x2: 40, y2: 0 },
  { tag: 'right', kind: 'line', x1: 40, y1: 0, x2: 40, y2: 30 },
  { tag: 'top', kind: 'line', x1: 40, y1: 30, x2: 0, y2: 30 },
  { tag: 'left', kind: 'line', x1: 0, y1: 30, x2: 0, y2: 0 },
]

/** A full circle (r=10) — exercises the `makeCircleEdge` half of the pipeline. */
const CIRCLE: SketchGeom[] = [{ tag: 'c', kind: 'circle', cx: 0, cy: 0, r: 10 }]

const R = 10
const at = (t: number) => ({ x: R * Math.cos(t), y: R * Math.sin(t), z: 0 })

let solver: SketchSolver
let api: BrepEngineApi

async function useEngine(register: () => Promise<void>): Promise<BrepEngineApi> {
  __resetEngineRegistriesForTests()
  await register()
  const engine = await getBrepEngine()
  api = engine.primitives
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'brep' },
    kernel: { brep: api, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: undefined,
    cad: undefined,
  } as never)
  return api
}

/** Extrude a sketch face into a solid and return its volume (the valid measure). */
async function extrudeVolume(face: Shape, length: number): Promise<number> {
  const solid = api.extrude(brepOf(face) as never, 0, 0, length)
  return api.getVolume(solid)
}

beforeAll(async () => {
  await initOcctWasm()
  solver = await createNodePlanegcsSolver()
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

// ─────────────────────────────────────────────────────────────────────────────
// OCCT — the declared engine, per the `engines: ['occt']` gate.
// ─────────────────────────────────────────────────────────────────────────────

describe('occt (declared engine): full pipeline works', () => {
  beforeAll(async () => {
    await useEngine(registerOcctBrepEngine)
  }, 120000)

  it('four-line sketch → one face, area 40×30', async () => {
    const shape = await sketchFaces(LINES, [], { solver })
    const faces = api.getSubShapes(brepOf(shape) as never, 'face' as never)
    expect(faces).toHaveLength(1)
    expect(api.getSurfaceArea(faces[0]!)).toBeCloseTo(40 * 30, 0)
  })

  it('circle sketch → one face, area πr²', async () => {
    const shape = await sketchFaces(CIRCLE, [], { solver })
    const faces = api.getSubShapes(brepOf(shape) as never, 'face' as never)
    expect(faces).toHaveLength(1)
    expect(api.getSurfaceArea(faces[0]!)).toBeCloseTo(Math.PI * 100, 0)
  })

  it('makeArcEdge honours a quadrant span: 0→π/2 is πr/2', () => {
    const e = api.makeArcEdge(at(0), at(Math.PI / 4), at(Math.PI / 2))
    expect(api.curveType(e)).toMatch(/circle/i)
    expect(api.curveLength(e)).toBeCloseTo((Math.PI / 2) * R, 1)
  })

  it("as:'wire' → closed outer wire of length 2(40+30)", async () => {
    const shape = await sketchFaces(LINES, [], { solver, as: 'wire' })
    expect((shape as { kind?: string }).kind).toBe('curve')
    expect(api.getLength(brepOf(shape) as never)).toBeCloseTo(2 * (40 + 30), 0)
  })

  it('circle face extrudes to a solid of volume πr²×5', async () => {
    const shape = await sketchFaces(CIRCLE, [], { solver })
    expect(await extrudeVolume(shape, 5)).toBeCloseTo(Math.PI * 100 * 5, 0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// brepkit — what works.
// ─────────────────────────────────────────────────────────────────────────────

describe('brepkit: lines, wires, faces and compound construction all WORK', () => {
  beforeAll(async () => {
    await useEngine(registerBrepkitBrepEngine)
  }, 120000)

  it('four-line sketch → face mesh has triangles', async () => {
    const shape = await sketchFaces(LINES, [], { solver })
    const mesh = api.meshShape(brepOf(shape) as never)
    expect(mesh.positions.length).toBeGreaterThan(0)
    expect(mesh.triangleCount).toBeGreaterThan(0)
  })

  it('rect face extrudes to a solid of volume 40×30×5', async () => {
    const shape = await sketchFaces(LINES, [], { solver })
    expect(await extrudeVolume(shape, 5)).toBeCloseTo(40 * 30 * 5, 0)
  })

  it("as:'wire' → builds; wireframe reports the 4 edges", async () => {
    const shape = await sketchFaces(LINES, [], { solver, as: 'wire' })
    const wf = api.wireframe(brepOf(shape) as never)
    expect(wf.edgeCount).toBe(4)
  })

  it('makeCircleEdge full circle is exact (2πr) and meshes as a face', () => {
    const e = api.makeCircleEdge({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, R)
    expect(api.curveLength(e)).toBeCloseTo(2 * Math.PI * R, 1)
    const mesh = api.meshShape(api.makeFace(api.makeWire([e])))
    expect(mesh.triangleCount).toBeGreaterThan(0)
  })

  it('a 32-gon approximation of the circle meshes fine (control)', () => {
    const edges = []
    for (let i = 0; i < 32; i++) {
      edges.push(api.makeLineEdge(at((i / 32) * 2 * Math.PI), at(((i + 1) / 32) * 2 * Math.PI)))
    }
    expect(api.meshShape(api.makeFace(api.makeWire(edges))).triangleCount).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// brepkit — arcs: the FIXED behaviour, pinned (2026-09-30).
// ─────────────────────────────────────────────────────────────────────────────

describe('brepkit arcs: fixed — spans and full-circle faces are exact', () => {
  beforeAll(async () => {
    await useEngine(registerBrepkitBrepEngine)
  }, 120000)

  it('makeArcEdge quarter span 0→π/2 is πr/2 (was 58.195)', async () => {
    const brepkit = await useEngine(registerBrepkitBrepEngine)
    const e = brepkit.makeArcEdge(at(0), at(Math.PI / 4), at(Math.PI / 2))
    expect(brepkit.curveType(e)).toMatch(/circle/i)
    expect(brepkit.curveLength(e)).toBeCloseTo((Math.PI / 2) * R, 6)
  })

  it('makeArcEdge half span 0→π is πr (was 2πr)', async () => {
    const brepkit = await useEngine(registerBrepkitBrepEngine)
    const e = brepkit.makeArcEdge(at(0), at(Math.PI / 2), at(Math.PI))
    expect(brepkit.curveLength(e)).toBeCloseTo(Math.PI * R, 6)
  })

  it('makeArcEdge cw span π/2→0 is also πr/2 (the axis follows the sweep)', async () => {
    const brepkit = await useEngine(registerBrepkitBrepEngine)
    const e = brepkit.makeArcEdge(at(Math.PI / 2), at(Math.PI / 4), at(0))
    expect(brepkit.curveLength(e)).toBeCloseTo((Math.PI / 2) * R, 6)
  })

  it('CONSEQUENCE (fixed): a full-circle sketch meshes and extrudes to πr²·5', async () => {
    const brepkit = await useEngine(registerBrepkitBrepEngine)
    const shape = await sketchFaces(CIRCLE, [], { solver })
    const mesh = brepkit.meshShape(brepOf(shape) as never)
    expect(mesh.triangleCount).toBeGreaterThan(0)
    expect(mesh.positions.length).toBeGreaterThan(0)
    expect(brepkit.getVolume(brepkit.extrude(brepOf(shape) as never, 0, 0, 5)))
      .toBeCloseTo(Math.PI * R * R * 5, 0)
  })

  it('CONSEQUENCE (fixed): a half-disc face (arc + chord) meshes with triangles', async () => {
    const brepkit = await useEngine(registerBrepkitBrepEngine)
    const w = brepkit.makeWire([
      brepkit.makeArcEdge(at(0), at(Math.PI / 2), at(Math.PI)),
      brepkit.makeLineEdge(at(Math.PI), at(0)),
    ])
    const face = brepkit.makeFace(w)
    expect(brepkit.meshShape(face).triangleCount).toBeGreaterThan(0)
    expect(brepkit.getVolume(brepkit.extrude(face, 0, 0, 5)))
      .toBeCloseTo((Math.PI * R * R / 2) * 5, 0)
  })

  it('GOTCHA: a closed wire of exactly TWO half-arcs is NOT used — the circle path uses makeCircleEdge', async () => {
    // Rules out a future "fix" that goes back to two `makeArcEdge` halves: that
    // construction makes brepkit's makeFaceFromWire cover only ~1/3 of the disc
    // (or degenerate to 0 when the shared endpoint is not bit-identical). Three
    // and four arc halves are exact — so it is a special case of the two-arc
    // wire, not "arcs don't work". `liftCurve2dToPlane`'s circle branch emits one
    // closed `makeCircleEdge` for this reason.
    const brepkit = await useEngine(registerBrepkitBrepEngine)
    const twoArc = brepkit.makeFace(brepkit.makeWire([
      brepkit.makeArcEdge(at(0), at(Math.PI / 2), at(Math.PI)),
      brepkit.makeArcEdge(at(Math.PI), at((3 * Math.PI) / 2), at(2 * Math.PI)),
    ]))
    expect(brepkit.getVolume(brepkit.extrude(twoArc, 0, 0, 5)))
      .not.toBeCloseTo(Math.PI * R * R * 5, 0)
    const fourArc = brepkit.makeFace(brepkit.makeWire([
      brepkit.makeArcEdge(at(0), at(Math.PI / 4), at(Math.PI / 2)),
      brepkit.makeArcEdge(at(Math.PI / 2), at((3 * Math.PI) / 4), at(Math.PI)),
      brepkit.makeArcEdge(at(Math.PI), at((5 * Math.PI) / 4), at((3 * Math.PI) / 2)),
      brepkit.makeArcEdge(at((3 * Math.PI) / 2), at((7 * Math.PI) / 4), at(2 * Math.PI)),
    ]))
    expect(brepkit.getVolume(brepkit.extrude(fourArc, 0, 0, 5)))
      .toBeCloseTo(Math.PI * R * R * 5, 0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// brepkit — measurement traps that make a naive test mislead.
// ─────────────────────────────────────────────────────────────────────────────

describe('brepkit measurement traps', () => {
  beforeAll(async () => {
    await useEngine(registerBrepkitBrepEngine)
  }, 120000)

  it('getSurfaceArea on a face throws "invalid solid handle" (solid-only API)', async () => {
    const shape = await sketchFaces(LINES, [], { solver })
    expect(() => api.getSurfaceArea(brepOf(shape) as never)).toThrow(/invalid solid handle/)
  })

  it("getSubShapes(face, 'face') returns [face]; 'solid' returns []", async () => {
    const shape = await sketchFaces(LINES, [], { solver })
    const h = brepOf(shape) as never
    expect(api.getSubShapes(h, 'face' as never)).toHaveLength(1)
    expect(api.getSubShapes(h, 'solid' as never)).toEqual([])
  })

  it('uvBounds is ±1e6 on ANY planar face — a sentinel, not a failure signal', () => {
    const face = api.makeFace(api.makeWire([
      api.makeLineEdge({ x: 0, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }),
      api.makeLineEdge({ x: 40, y: 0, z: 0 }, { x: 40, y: 30, z: 0 }),
      api.makeLineEdge({ x: 40, y: 30, z: 0 }, { x: 0, y: 30, z: 0 }),
      api.makeLineEdge({ x: 0, y: 30, z: 0 }, { x: 0, y: 0, z: 0 }),
    ]))
    const b = api.uvBounds(face)
    expect(Math.abs(b.uMin)).toBe(1_000_000)
    // …yet this face is genuinely good:
    expect(api.meshShape(face).triangleCount).toBe(2)
  })

  it('getLength on a 4-edge wire is the wire total (fixed 2026-10-02, 1c06570)', () => {
    const e1 = api.makeLineEdge({ x: 0, y: 0, z: 0 }, { x: 40, y: 0, z: 0 })
    const e2 = api.makeLineEdge({ x: 40, y: 0, z: 0 }, { x: 40, y: 30, z: 0 })
    const e3 = api.makeLineEdge({ x: 40, y: 30, z: 0 }, { x: 0, y: 30, z: 0 })
    const e4 = api.makeLineEdge({ x: 0, y: 30, z: 0 }, { x: 0, y: 0, z: 0 })
    const w = api.makeWire([e1, e2, e3, e4])
    expect(api.getLength(e1)).toBeCloseTo(40, 1)
    // Was a pinned defect ("edge length path wins for a wire handle, so the wire
    // total is something else"). `1c06570` normalised L1 getLength to
    // Σ unique-edge arc length, so the wire now reports its real perimeter —
    // same dialect as occt. Re-pinned on the fixed behaviour (2026-10-03).
    expect(api.getLength(w)).toBeCloseTo(140, 1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Which pipeline methods an engine really provides — measured, not declared.
// ─────────────────────────────────────────────────────────────────────────────

describe('pipeline kernel methods: occt vs brepkit', () => {
  /** Kernel methods the sketch/face pipeline actually calls. */
  const REQUIRED = [
    'makeLineEdge',
    'makeArcEdge',
    'makeCircleEdge',
    'makeBezierEdge',
    'makeWire',
    'makeFace',
    'addHolesInFace',
    'makeCompound',
  ] as const

  /**
   * 2026-10-08：`BrepEngine.capabilities`（`methods` / `evolution` 逐名声明）随
   * `capabilities` 声明轴整体删除。同一事实的来源改为**实现本身**——适配器对未实现的
   * 成员摆桩，桩一调用就抛 `unsupported` / `not implemented`。所以这里把管线需要的核
   * 方法逐个真跑一遍：「名单里有名字」换成「真的能用」。这比旧断言更强：名字只证明
   * 存在，证明不了名字背后的几何正确（见本文件顶部 circumcircle 缺陷记录）。
   *
   * @param register - engine adapter registration to exercise.
   * @returns `failures`（方法名 + 错误消息；空 = 全部可用）与 `covered`（实际跑过的方法名）。
   */
  async function unavailableMethods(
    register: () => Promise<void>,
  ): Promise<{ failures: string[]; covered: string[] }> {
    const k = await useEngine(register)
    const failures: string[] = []
    const probe = (name: string, run: () => unknown): void => {
      try {
        run()
      } catch (e) {
        failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    const square = (): ReturnType<BrepEngineApi['makeWire']> => k.makeWire([
      k.makeLineEdge({ x: 0, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }),
      k.makeLineEdge({ x: 40, y: 0, z: 0 }, { x: 40, y: 30, z: 0 }),
      k.makeLineEdge({ x: 40, y: 30, z: 0 }, { x: 0, y: 30, z: 0 }),
      k.makeLineEdge({ x: 0, y: 30, z: 0 }, { x: 0, y: 0, z: 0 }),
    ])
    const cases: readonly (readonly [string, () => unknown])[] = [
      ['makeLineEdge', () => k.makeLineEdge(at(0), at(Math.PI / 2))],
      ['makeArcEdge', () => k.makeArcEdge(at(0), at(Math.PI / 4), at(Math.PI / 2))],
      ['makeCircleEdge', () => k.makeCircleEdge({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, R)],
      ['makeBezierEdge', () => k.makeBezierEdge([at(0), at(Math.PI / 4), at(Math.PI / 2)])],
      ['makeWire', square],
      ['makeFace', () => k.makeFace(square())],
      ['addHolesInFace', () => {
        const hole = k.makeWire([
          k.makeLineEdge({ x: 5, y: 5, z: 0 }, { x: 10, y: 5, z: 0 }),
          k.makeLineEdge({ x: 10, y: 5, z: 0 }, { x: 10, y: 10, z: 0 }),
          k.makeLineEdge({ x: 10, y: 10, z: 0 }, { x: 5, y: 10, z: 0 }),
          k.makeLineEdge({ x: 5, y: 10, z: 0 }, { x: 5, y: 5, z: 0 }),
        ])
        return k.addHolesInFace(k.makeFace(square()), [hole])
      }],
      ['makeCompound', () => k.makeCompound([k.makeLineEdge(at(0), at(Math.PI / 2))])],
    ]
    for (const [name, run] of cases) probe(name, run)
    return { failures, covered: cases.map(([name]) => name) }
  }

  it('occt: every kernel method the pipeline needs really runs (no stub)', async () => {
    const { failures, covered } = await unavailableMethods(registerOcctBrepEngine)
    expect([...covered].sort()).toEqual([...REQUIRED].sort())
    expect(failures).toEqual([])
  }, 120000)

  it('brepkit: every kernel method the pipeline needs really runs (no stub)', async () => {
    const { failures, covered } = await unavailableMethods(registerBrepkitBrepEngine)
    expect([...covered].sort()).toEqual([...REQUIRED].sort())
    expect(failures).toEqual([])
  }, 120000)

  it('the arc is geometrically correct — "it runs" says nothing about WHERE the centre is', async () => {
    // The engines:['occt'] gate that used to protect cad.sketch was removed only
    // because the implementation behind the name was proven correct. A
    // presence-only probe (declared name, or a call that merely returns) would
    // pass while the centre was wrong, so this test pins the geometry itself.
    const brepkit = await useEngine(registerBrepkitBrepEngine)

    expect(brepkit.curveLength(brepkit.makeArcEdge(at(0), at(Math.PI / 4), at(Math.PI / 2))))
      .toBeCloseTo((Math.PI / 2) * R, 6)
  }, 120000)
})

// ─────────────────────────────────────────────────────────────────────────────
// Contour output shape — why the arc path matters at all.
// ─────────────────────────────────────────────────────────────────────────────

describe('contour output shape', () => {
  it('a circle geom yields one closed contour whose single segment is an arc', () => {
    const contours = extractContours(toFreeCadGeoms(CIRCLE))
    expect(contours).toHaveLength(1)
    expect(contours[0]!.closed).toBe(true)
    expect(contours[0]!.segments).toHaveLength(1)
    expect(contours[0]!.segments[0]!.kind).toBe('arc')
  })

  it('a four-line rectangle yields one closed contour of four line segments', () => {
    const contours = extractContours(toFreeCadGeoms(LINES))
    expect(contours).toHaveLength(1)
    expect(contours[0]!.segments).toHaveLength(4)
    expect(contours[0]!.segments.every((s) => s.kind === 'line')).toBe(true)
  })
})
