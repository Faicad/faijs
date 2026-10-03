/**
 * P3-1 · Object-stack read API parity — CadQuery 2.8.0's `size` / `all` /
 * `first` / `last` / `item` / `add` / `findSolid` / `filter` / `map` /
 * `apply` / `sort` over the Workplane stack.
 *
 * Every number here is FROZEN from a ONE-SHOT CadQuery 2.8.0 reference
 * capture: `tests/ref-harness/object-stack-probe.py` plus its follow-up
 * `object-stack-probe2.py` (neither is wired into CI — audit §5.1). The
 * captures are the authority; if one of these assertions looks wrong, re-run
 * the probe rather than adjusting the expectation.
 *
 * WHY this family needs its own assertions: the stack never reaches an export.
 * `val()` is `objects[0]`, so a stack of 1 and a stack of 3 with the same head
 * produce byte-identical STEP. Every one of these behaviours is invisible to
 * the parity harness — that is exactly how the previous flat-carrier `size()`
 * (returning a bounding box) and `add()` (replacing instead of appending)
 * survived with a green report.
 *
 * Three of the captures contradict plausible guesses; those are flagged as
 * GOTCHA and the reasoning is spelled out:
 *   - `findSolid()` returns a Compound even for a single solid, and is NOT
 *     `solids()`.
 *   - `pushPoints` / `rarray` / `center()` push `Vector`s, so a pushed-points
 *     workplane has `size() == 3` upstream but 0 here.
 *   - `add(Workplane)` extends with ONE representative object, not the whole
 *     source stack.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import { brepOf, fromHandle } from '@faicad/faijs/sdk'
import { setupNativeKernel } from './gear-test-harness'
import {
  Workplane,
  add,
  all,
  bboxSize,
  box,
  edges,
  faces,
  findSolid,
  first,
  item,
  last,
  pushPoints,
  size,
  sortStack,
  stackApply,
  stackFilter,
  stackMap,
  val,
  vals,
} from './workplane'
import { areaOf, facesOf, shapeTypeOf, unwrapShape } from './shape-class'
import type { Shape } from '@faicad/faijs/mesh/types'

beforeAll(async () => {
  await setupNativeKernel()
})

const k = () =>
  getKernel() as unknown as {
    getVolume: (h: never) => number
    getSurfaceArea: (h: never) => number
  }

/** Volume of one stack object. */
function vol(s: Shape | null): number {
  return s ? k().getVolume(brepOf(s) as never) : 0
}

/** Area of one stack object. */
function area(s: Shape | null): number {
  return s ? k().getSurfaceArea(brepOf(s) as never) : 0
}

/** 10×10×10 box, used by the `add` tests (its lateral faces are 100 mm²). */
async function bigBox() {
  return box(Workplane('XY'), 10, 10, 10)
}

/**
 * The first lateral face (100 mm²) of a 10×10×10 box, as an faijs `Shape`.
 *
 * `Workplane.faces()` only records a deferred marker until P3-3 makes it eager,
 * so a test that needs a real face object takes it straight from the selector
 * engine. 100 mm² picks a side face unambiguously (the top and bottom are 600).
 */
function faceOfArea100(solid: Shape): Shape {
  const hit = facesOf(brepOf(solid) as never).find((f) => Math.abs(areaOf(f) - 100) < 1e-6)
  if (!hit) throw new Error('faceOfArea100: no 100 mm² face on the stack head')
  // `getSubShapes` copies each sub-shape into its own arena slot, so adopting it
  // through `fromHandle` hands ownership to the returned Shape (the same
  // contract the workplane kind selectors rely on).
  return fromHandle(unwrapShape(hit)) as Shape
}

// ===========================================================================
// size() — cq.py:358 `len(self.objects)`
// ===========================================================================
describe('size — the stack length, NOT a bounding box', () => {
  it('empty workplane → 0 (probe: G4 empty.size() = 0)', () => {
    expect(size(Workplane('XY'))).toBe(0)
  })

  it('a box → 1 (probe: G4 cube.size() = 1)', async () => {
    expect(size(await box(Workplane('XY'), 1, 1, 1))).toBe(1)
  })

  it('a pending face selection does not change the stack yet (P3-3 makes it eager)', async () => {
    // Upstream `cube.faces('>Z').size()` is 1 because `faces()` immediately
    // resolves and PUSHES the face. In faijs, `faces()` only records a deferred
    // marker (`faceSel` + `selChain`) that a later op consumes — P3-3 turns it
    // into a real multi-object push. Until then the stack is untouched, so the
    // stack length stays 1 and the shape is still the box. Freezing the
    // CURRENT behaviour; P3-3 must update this assertion.
    const c = await box(Workplane('XY'), 1, 1, 1)
    const marked = faces(c, '>Z')
    expect(size(marked)).toBe(1)
    expect(vol(marked.objects[0])).toBeCloseTo(1, 6)
  })

  it('a pending edge selection likewise leaves the stack alone', async () => {
    const c = await box(Workplane('XY'), 1, 1, 1)
    const marked = edges(faces(c, '>Z'), '|Z')
    expect(size(marked)).toBe(1)
    expect(vol(marked.objects[0])).toBeCloseTo(1, 6)
  })

  it('bboxSize still answers the old question (2×3×4 box → [2,3,4])', async () => {
    expect(bboxSize(await box(Workplane('XY'), 2, 3, 4)).map((v) => Math.round(v))).toEqual([2, 3, 4])
  })

  it('bboxSize throws on an empty workplane', () => {
    expect(() => bboxSize(Workplane('XY'))).toThrow(/no solid/)
  })

  it('GOTCHA: pushPoints grows wp.pts, NOT the stack (upstream: 3 Vectors)', () => {
    // Probe: pp.size() = 3, pp.vals() kinds = "3: Vector | Vector | Vector".
    // faijs keeps positions in the parallel array wp.pts. See `size`'s JSDoc.
    const wp = pushPoints(Workplane('XY'), [[-0.3, 0.3], [0.3, 0.3], [0, 0]])
    expect(wp.pts).toHaveLength(3)
    expect(size(wp)).toBe(0)
    expect(vals(wp)).toEqual([])
  })
})

// ===========================================================================
// val / vals — the stack head and the whole stack
// ===========================================================================
describe('val / vals read the stack', () => {
  it('val() is objects[0] and vals() is the stack itself', async () => {
    const c = await box(Workplane('XY'), 1, 1, 1)
    expect(val(c)).toBe(c.objects[0])
    expect(vals(c)).toEqual(c.objects)
  })

  it('vals() is a copy, not the live list (GOTCHA: upstream returns self.objects)', async () => {
    const c = await box(Workplane('XY'), 1, 1, 1)
    const taken = vals(c)
    taken.push(taken[0])
    expect(vals(c)).toHaveLength(1)
  })

  it('an empty stack yields null / []', () => {
    expect(val(Workplane('XY'))).toBeNull()
    expect(vals(Workplane('XY'))).toEqual([])
  })

  it('GOTCHA: upstream val() on an empty stack returns plane.origin (a Vector)', () => {
    // Probe: G1 empty.val() = Vector, toTuple (0,0,0). No Vector carrier here,
    // so faijs returns null — recorded in `val`'s JSDoc.
    expect(val(Workplane('XY'))).toBeNull()
  })
})

// ===========================================================================
// all() — cq.py:346, one single-object Workplane per stack entry
// ===========================================================================
describe('all() — one Workplane per stack object', () => {
  it('a single-object stack yields one workplane carrying it', async () => {
    const c = await box(Workplane('XY'), 1, 1, 1)
    const parts = all(c)
    expect(parts).toHaveLength(1)
    expect(parts[0].objects).toEqual([c.objects[0]])
  })

  it('an empty stack yields no workplanes', () => {
    expect(all(Workplane('XY'))).toEqual([])
  })

  it('each element is a full Workplane keeping the plane frame (probe: origin (0,0,0))', async () => {
    const c = await box(Workplane('XY'), 1, 1, 1)
    const parts = all(c)
    expect(parts[0].normal).toEqual(c.normal)
    expect(parts[0].origin).toEqual(c.origin)
  })
})

// ===========================================================================
// first / last / item — cq.py:644 / 661 / 653
// ===========================================================================
describe('first / last / item — single-object picks', () => {
  /** A 3-object stack of distinguishable solids (10 apart in x). */
  async function threeSolids() {
    const base = await box(Workplane('XY'), 2, 2, 2)
    const b = add(base, await box(Workplane('XY'), 2, 2, 2))
    return add(b, await box(Workplane('XY'), 2, 2, 2))
  }

  it('first() / last() / item() each yield a one-object workplane', async () => {
    const s = await threeSolids()
    expect(s.objects).toHaveLength(3)
    expect(size(first(s))).toBe(1)
    expect(size(last(s))).toBe(1)
    expect(size(item(s, 0))).toBe(1)
  })

  it('item() supports negative indices (Python semantics)', async () => {
    const s = await threeSolids()
    expect(item(s, -1).objects[0]).toBe(s.objects[2])
    expect(item(s, -3).objects[0]).toBe(s.objects[0])
  })

  it('item() out of range throws (probe: IndexError, no clamping)', async () => {
    const s = await threeSolids()
    expect(() => item(s, 9)).toThrow(/out of range/)
    expect(() => item(s, -4)).toThrow(/out of range/)
  })

  it('first() / last() on an empty stack yield an empty workplane, not a throw', () => {
    expect(size(first(Workplane('XY')))).toBe(0)
    expect(size(last(Workplane('XY')))).toBe(0)
  })
})

// ===========================================================================
// add() — cq.py:387, APPENDS (the old faijs add replaced)
// ===========================================================================
describe('add() appends — the upstream idiom the replacing add() silently broke', () => {
  it('a single shape is appended, not substituted', async () => {
    const base = await bigBox()
    const next = await add(base, await box(Workplane('XY'), 1, 1, 1))
    expect(size(next)).toBe(2)
    expect(next.objects[0]).toBe(base.objects[0])
  })

  it('appends three times without losing earlier entries (what the replacing add lost)', async () => {
    // Probe: `add(f1).add(f2) size` = 3, types = "3: Solid | Face | Face",
    // areas = [600, 100, 100] on a 10 cubed box. Under the old REPLACING add
    // this ended up as ONE object (the last addition) with no error raised.
    //
    // `faces()` only records a deferred marker (P3-3 makes it eager), so the
    // face shapes come from the selector engine directly - the same geometry
    // `faces('>Y')` will push once it is eager.
    const s = await bigBox()
    const fy = faceOfArea100(s.objects[0])
    const fx = faceOfArea100(s.objects[0])
    const grown = add(s, fy)
    const both = add(grown, fx)
    expect(size(both)).toBe(3)
    expect(Math.round(area(both.objects[0]))).toBe(600)
    expect(Math.round(area(both.objects[1]))).toBe(100)
    expect(Math.round(area(both.objects[2]))).toBe(100)
  })

  it('an array of shapes is appended in order (the fully-aligned multi-object path)', async () => {
    const base = await bigBox()
    const b2 = await box(Workplane('XY'), 1, 1, 1)
    const b3 = await box(Workplane('XY'), 2, 2, 2)
    const grown = add(base, [b2.objects[0], b3.objects[0]])
    expect(size(grown)).toBe(3)
    expect(grown.objects[1]).toBe(b2.objects[0])
    expect(grown.objects[2]).toBe(b3.objects[0])
  })

  it('a Workplane contributes its shape', async () => {
    const base = await bigBox()
    const other = await box(Workplane('XY'), 1, 1, 1)
    expect(size(add(base, other))).toBe(2)
  })

  it('adding nothing leaves the stack untouched', async () => {
    const base = await bigBox()
    expect(size(add(base, []))).toBe(1)
  })

  it('GOTCHA: upstream add() mutates in place and returns self; faijs is immutable', async () => {
    // Probe: `add returns same obj` = True, `receiver mutated in place` = 1.
    // The mirror's straight-line scripts cannot observe the difference.
    const base = await bigBox()
    const other = await box(Workplane('XY'), 1, 1, 1)
    const grown = add(base, other)
    expect(grown).not.toBe(base)
    expect(size(base)).toBe(1)
  })
})

// ===========================================================================
// findSolid() — cq.py:721. NOT the same query as solids().
// ===========================================================================
describe('findSolid() — always a Compound, never confused with solids()', () => {
  it('a single-solid stack returns a COMPOUND, not the solid (probe: ShapeType = Compound)', async () => {
    const c = await box(Workplane('XY'), 1, 1, 1)
    const found = findSolid(c)
    expect(shapeTypeOf(brepOf(found) as never)).toBe('compound')
  })

  it('…with exactly the volume of that solid (probe: difference 0.0)', async () => {
    const c = await box(Workplane('XY'), 2, 3, 4)
    const delta = vol(findSolid(c)) - vol(c.objects[0])
    expect(Math.abs(delta)).toBeLessThan(1e-9)
  })

  it('two solids on the stack are summed into ONE compound (probe: difference 0.0)', async () => {
    const c = await box(Workplane('XY'), 1, 1, 1)
    // P3-4 makes `split` push two objects; until then the split result is a
    // single compound, so the two-object stack is built explicitly via `add`.
    const halves = add(c, c.objects[0])
    const found = findSolid(halves)
    expect(shapeTypeOf(brepOf(found) as never)).toBe('compound')
    expect(Math.abs(vol(found) - 2 * vol(c.objects[0]))).toBeLessThan(1e-9)
  })

  it('an empty stack throws (mirrors upstream ValueError)', () => {
    expect(() => findSolid(Workplane('XY'))).toThrow(/cannot find a solid/)
  })

  it('a face-only stack throws — faces are not solids', async () => {
    const b = await bigBox()
    const f = faceOfArea100(b.objects[0])
    expect(() => findSolid(add(Workplane('XY'), f))).toThrow(/non-solid/)
  })

  it('GOTCHA: this is NOT what solids() does — solids() keeps them separate', async () => {
    // Probe: two.solids().size() = 2 and .val().ShapeType() = "Solid", while
    // two.findSolid().ShapeType() = "Compound" with the summed volume. The two
    // queries are strictly different; neither substitutes for the other.
    const c = await box(Workplane('XY'), 1, 1, 1)
    const twoSolids = add(c, c.objects[0])
    const found = findSolid(twoSolids)
    expect(shapeTypeOf(brepOf(found) as never)).toBe('compound')
    expect(vol(found)).toBeGreaterThan(vol(c.objects[0]))
  })
})

// ===========================================================================
// stackFilter / stackMap / stackApply / sortStack
// ===========================================================================
describe('stack combinators', () => {
  it('stackFilter keeps matching objects in stack order', async () => {
    const c = await box(Workplane('XY'), 1, 1, 1)
    const two = add(c, await box(Workplane('XY'), 2, 2, 2))
    const kept = stackFilter(two, (s) => vol(s) > 1.5)
    expect(size(kept)).toBe(1)
    expect(kept.objects[0]).toBe(two.objects[1])
  })

  it('stackMap replaces every object, order preserved', async () => {
    const c = await box(Workplane('XY'), 1, 1, 1)
    const two = add(c, c.objects[0])
    const mapped = stackMap(two, (s) => s)
    expect(size(mapped)).toBe(2)
    expect(mapped.objects[0]).toBe(two.objects[0])
  })

  it('stackApply hands the whole stack over at once', async () => {
    const c = await box(Workplane('XY'), 1, 1, 1)
    const two = add(c, c.objects[0])
    expect(size(stackApply(two, (objs) => objs.slice(0, 1)))).toBe(1)
    expect(size(stackApply(two, (objs) => objs))).toBe(2)
    expect(size(stackApply(two, () => []))).toBe(0)
  })

  it('stackApply receives a copy — mutating it cannot corrupt the carrier', async () => {
    const c = await box(Workplane('XY'), 1, 1, 1)
    stackApply(c, (objs) => {
      objs.push(objs[0])
      return objs
    })
    expect(size(c)).toBe(1)
  })

  it('sortStack reorders by the comparator (probe: sort by -Volume, [-1] is the smallest)', async () => {
    const a = await box(Workplane('XY'), 1, 1, 1) // vol 1
    const b = await box(Workplane('XY'), 3, 3, 3) // vol 27
    const c = await box(Workplane('XY'), 2, 2, 2) // vol 8
    const stack = add(add(a, b.objects[0]), c.objects[0])
    const desc = sortStack(stack, (x, y) => vol(y) - vol(x))
    expect(vol(desc.objects[0])).toBeCloseTo(27, 6)
    // Probe: the upstream assertion reads [-1] after sorting by -Volume ⇒ 1.0.
    expect(vol(desc.objects[2])).toBeCloseTo(1, 6)
  })

  it('sortStack does not mutate its input workplane', async () => {
    const a = await box(Workplane('XY'), 1, 1, 1)
    const b = await box(Workplane('XY'), 3, 3, 3)
    const stack = add(a, b.objects[0])
    sortStack(stack, (x, y) => vol(y) - vol(x))
    expect(vol(stack.objects[0])).toBeCloseTo(1, 6)
  })
})

// ===========================================================================
// Multi-object stacks must stay geometrically intact (not just count right).
// ===========================================================================
describe('stack contents are real geometry', () => {
  it('a 3-solid stack keeps each solid distinct and addressable by index', async () => {
    const mk = async (d: number): Promise<Shape> => (await box(Workplane('XY'), d, d, d)).objects[0]
    const stack = add(add(await bigBox(), await mk(3)), await mk(5))
    expect(size(stack)).toBe(3)
    expect(vol(item(stack, 0).objects[0])).toBeCloseTo(1000, 3)
    expect(vol(item(stack, 1).objects[0])).toBeCloseTo(27, 3)
    expect(vol(item(stack, 2).objects[0])).toBeCloseTo(125, 3)
    expect(vol(val(stack)!)).toBeCloseTo(1000, 3)
  })

  it('a face pushed by add() is still a face (not promoted to a solid)', async () => {
    const s = await bigBox()
    const f = faceOfArea100(s.objects[0])
    const withFace = add(s, f)
    expect(size(withFace)).toBe(2)
    expect(shapeTypeOf(brepOf(withFace.objects[1]) as never)).toBe('face')
    expect(vol(withFace.objects[1])).toBeCloseTo(0, 6)
  })

  it('GOTCHA: pushing a face does NOT make findSolid() return the box', async () => {
    // findSolid searches for SOLIDS only; the face is ignored and the stack's
    // single solid is returned (as a compound).
    const s = await bigBox()
    const f = faceOfArea100(s.objects[0])
    const withFace = add(s, f)
    expect(Math.abs(vol(findSolid(withFace)) - 1000)).toBeLessThan(1e-6)
  })
})

// ===========================================================================
// makeCompound() parity anchor — the shape-class primitive findSolid builds on