/**
 * P3-2 · kind-selector multi-object stack push — CadQuery 2.8.0
 * `Workplane.solids()/wires()/shells()/compounds()` now push EVERY sub-shape of
 * every stack object as its own stack entry (fast / slow path), instead of
 * keeping only the first and releasing the rest.
 *
 * Authority: `tests/ref-harness/kind-selectors-probe.py` (`cube.*().size()`,
 * `two.*().size()`, the `.objects` `kinds()` rows) and `object-stack-probe.py`
 * (G3: `two.solids().size()` = 2 vs `findSolid` = 1 compound). Neither probe is
 * wired into CI (audit §5.1). If an assertion looks wrong, re-run the probe
 * rather than adjusting the expectation.
 *
 * Why a dedicated Workplane-level file: the existing `kind-selectors.test.ts`
 * only exercises the `Shape`-level helpers (`wiresOf`/`solids`/`...` from
 * `shape-class`). The Workplane-level `wires()/solids()/...` are the ones that
 * changed in P3-2 (they now build a multi-object STACK), and a stack never
 * reaches an export — so this behaviour is invisible to the parity harness and
 * must be frozen here.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import { fromHandle, brepOf } from '@faicad/faijs/sdk'
import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import { setupNativeKernel } from './gear-test-harness'
import { shapeTypeOf } from './shape-class'
import type { Shape } from '@faicad/faijs/mesh/types'
import {
  Workplane,
  box,
  add,
  size,
  solids,
  wires,
  shells,
  compounds,
  findSolid,
  dispose,
} from './workplane'

beforeAll(async () => {
  await setupNativeKernel()
})

function k(): OcctKernel {
  return getKernel() as unknown as OcctKernel
}

/** Volume of one stack object. */
function vol(s: Shape): number {
  return k().getVolume(brepOf(s) as never)
}

/** ShapeType string of one stack object. */
function typeOf(s: Shape): string {
  return shapeTypeOf(brepOf(s) as never)
}

/** A unit cube carried on a fresh workplane. */
async function cubeWp(): Promise<{ wp: ReturnType<typeof Workplane>; cube: Shape }> {
  const wp = await box(Workplane('XY'), 1, 1, 1)
  return { wp, cube: wp.objects[0]! }
}

/** A compound of two unit cubes as ONE faijs Shape (mirrors the probe's `two`). */
function twoCubeCompound(): Shape {
  const kk = k()
  const a = kk.makeBox(1, 1, 1)
  const b = kk.translate(kk.makeBox(1, 1, 1), 5, 0, 0)
  return fromHandle(kk.makeCompound([a, b])) as Shape
}

/** A workplane carrying the two-cube compound as its single stack object. */
function twoCubeWp(): ReturnType<typeof Workplane> {
  return add(Workplane('XY'), twoCubeCompound())
}

// ===========================================================================
// Single-object FAST PATH — must be byte-identical to the pre-P3-2 behaviour
// (plan §3.5: zero behaviour / zero leak change on the common path).
// ===========================================================================
describe('fast path: a single solid stays a single-object stack', () => {
  it('cube.solids() → 1 object (probe: cube.solids().size() = 1)', async () => {
    const { wp } = await cubeWp()
    const s = solids(wp)
    expect(size(s)).toBe(1)
    expect(typeOf(s.objects[0]!)).toBe('solid')
    expect(vol(s.objects[0]!)).toBeCloseTo(1, 6)
  })

  it('cube.wires() → 6 wires, each a wire (probe: cube.wires().size() = 6)', async () => {
    const { wp } = await cubeWp()
    const w = wires(wp)
    expect(size(w)).toBe(6)
    expect(w.objects.every((o) => typeOf(o) === 'wire')).toBe(true)
  })

  it('cube.shells() → 1 shell (probe: cube.shells().size() = 1)', async () => {
    const { wp } = await cubeWp()
    const sh = shells(wp)
    expect(size(sh)).toBe(1)
    expect(typeOf(sh.objects[0]!)).toBe('shell')
  })

  it('cube.compounds() → 0 (probe: cube.compounds().size() = 0)', async () => {
    const { wp } = await cubeWp()
    expect(size(compounds(wp))).toBe(0)
  })

  it('GOTCHA: downstream cq.val() is undisturbed — fast path adopts the one sub-shape', async () => {
    // The pre-P3-2 code adopted `fromHandle(sub[0])`; the fast path does exactly
    // the same. So a box fed through `.solids()` still yields the same volume as
    // the bare box — the mirror parity gate (cq.val() geometry) cannot drift.
    const { wp, cube } = await cubeWp()
    expect(vol(solids(wp).objects[0]!)).toBeCloseTo(vol(cube), 9)
  })
})

// ===========================================================================
// SLOW PATH — multiple hits are ALL pushed (P3-2 core change).
// ===========================================================================
describe('slow path: a compound of two cubes pushes every sub-shape', () => {
  it('two.solids() → 2 separate solids (probe: two.solids().size() = 2)', () => {
    const two = twoCubeWp()
    const s = solids(two)
    expect(size(s)).toBe(2)
    expect(s.objects.every((o) => typeOf(o) === 'solid')).toBe(true)
    expect(vol(s.objects[0]!)).toBeCloseTo(1, 6)
    expect(vol(s.objects[1]!)).toBeCloseTo(1, 6)
  })

  it('two.compounds() → 1 (the whole compound, per upstream TopExp walk)', () => {
    // probe: two.compounds().size() = 1 — `compounds()` on a compound INCLUDES
    // the compound itself (see kind-selectors.test.ts GOTCHA).
    const two = twoCubeWp()
    const c = compounds(two)
    expect(size(c)).toBe(1)
    expect(typeOf(c.objects[0]!)).toBe('compound')
  })

  it('GOTCHA: solids() keeps them SEPARATE, findSolid() aggregates to ONE compound (G3)', () => {
    // probe `object-stack-probe.py`: two.solids().size() = 2 and
    // two.solids().val().ShapeType() = "Solid", while findSolid() returns a
    // "Compound". The two queries are strictly different.
    const two = twoCubeWp()
    expect(size(solids(two))).toBe(2)
    const found = findSolid(two)
    expect(typeOf(found)).toBe('compound')
    expect(vol(found)).toBeCloseTo(2, 6)
  })

  it('a 2-object stack is pooled: solids() returns 2, compounds() returns 0', async () => {
    // Upstream `_collectProperty` pools across the whole stack, not just the
    // first object — so a stack holding two separate cubes yields 2 solids and
    // 0 compounds (each cube has no nested compound).
    const { cube } = await cubeWp()
    const stack = add(Workplane('XY'), cube)
    const grown = add(stack, (await cubeWp()).cube)
    expect(size(solids(grown))).toBe(2)
    expect(size(compounds(grown))).toBe(0)
  })
})

// ===========================================================================
// Leak control — the slow path adopts every sub-shape (no release), so the
// stack objects own their handles. `dispose()` frees only `ownedHandles`,
// leaving the `objects` handles to their own Shape disposal (no double-free).
// ===========================================================================
describe('dispose — frees ownedHandles without touching stack-object handles', () => {
  it('a raw handle stashed in ownedHandles is released by dispose()', () => {
    const kk = k()
    const h = kk.makeBox(1, 1, 1) as ShapeHandle
    // hand-built carrier (plain object — clone is internal); only ownedHandles
    // is set, objects stay empty.
    const wp = Workplane('XY') as unknown as { ownedHandles?: number[] }
    wp.ownedHandles = [h as unknown as number]
    expect(() => kk.getBoundingBox(h)).not.toThrow()
    dispose(wp as never)
    // after dispose the raw handle is gone
    expect(() => kk.getBoundingBox(h)).toThrow()
  })

  it('dispose() does NOT release the stack objects (their handles are fromHandle-owned)', async () => {
    const { wp, cube } = await cubeWp()
    // attach a throwaway raw handle distinct from the cube's handle
    const kk = k()
    const spare = kk.makeBox(1, 1, 1) as ShapeHandle
    const carrier = wp as unknown as { ownedHandles?: number[] }
    carrier.ownedHandles = [spare as unknown as number]
    dispose(wp)
    // the cube on the stack is still alive (its handle is owned by the Shape,
    // not by ownedHandles)
    expect(() => vol(cube)).not.toThrow()
    expect(vol(cube)).toBeCloseTo(1, 6)
  })
})
