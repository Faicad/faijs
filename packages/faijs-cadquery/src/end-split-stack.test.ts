/**
 * P3-4 · `end()` parent chain + `split()` multi-object push.
 *
 * Every number here is FROZEN from a ONE-SHOT CadQuery 2.8.0 reference capture
 * (`tests/ref-harness/p3-4-end-split-probe.py`, not wired into CI — audit
 * §5.1). The capture is the authority; if an assertion looks wrong, re-run the
 * probe rather than adjusting the expectation.
 *
 * Like the rest of this family, none of it reaches an export — `val()` is
 * `objects[0]`, so `end()`/`split()`-stack shape is invisible to the STEP
 * parity harness. That is exactly why it needs its own frozen assertions.
 *
 * GOTCHAs pinned here:
 *   - the parent chain is FULL-CHAIN (upstream `newObject` sets `ns.parent =
 *     self` on every op, `cq.py:1312`), not just on selection/plane switches —
 *     so `box(1,1,1).end()` already returns the empty root (test_cadquery.py:5005)
 *   - `split(keepTop=True, keepBottom=True)` pushes BOTH halves (`rv = [top,
 *     bottom]`, `cq.py:322`), so `.size() == 2` and `.shape` is only the first
 *     half — NOT the fused compound the old flat carrier produced
 *   - `partAt(i)` is now an alias of `item(i)` over that stack
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import { brepOf } from '@faicad/faijs/sdk'
import { setupNativeKernel } from './gear-test-harness'
import { Workplane, all, box, end, faces, item, partAt, size, solids, split } from './workplane'
import { shapeTypeOf } from './shape-class'
import type { Shape } from '@faicad/faijs/mesh/types'

beforeAll(async () => {
  await setupNativeKernel()
})

const k = () => getKernel() as unknown as { getVolume: (h: never) => number }
/** Volume of one stack object (0 for null/undefined). */
const vol = (s: Shape | null | undefined): number => (s ? k().getVolume(brepOf(s) as never) : 0)

// ── end() — parent chain (cq.py:669) ───────────────────────────────────────
describe('end() — parent chain', () => {
  it('box(1,1,1).end() walks back to the empty root (test_cadquery.py:5005)', async () => {
    const b = await box(Workplane(), 1, 1, 1)
    const back = end(b)
    expect(size(back)).toBe(0)
    expect(back.objects).toHaveLength(0)
    // the root is a real workplane, not a stub — a further end() has nothing to
    // climb to (upstream ValueError)
    expect(() => end(back)).toThrow(/no parents/)
  })

  it('box(1).box(2).end(2) → the empty root (test_cadquery.py:5006)', async () => {
    const b1 = await box(Workplane(), 1, 1, 1)
    const b2 = await box(b1, 2, 2, 1)
    // one link up = b1 (the first box workplane); two = the empty root
    expect(size(end(b2))).toBe(1)
    expect(size(end(b2, 2))).toBe(0)
  })

  it('faces(">Z").end() → the pre-selection box workplane', async () => {
    const c = await box(Workplane(), 1, 1, 1)
    const f = faces(c, '>Z')
    expect(size(f)).toBe(1) // the pushed face
    const back = end(f)
    expect(size(back)).toBe(1) // the box workplane
    expect(shapeTypeOf(brepOf(back.objects[0]) as never)).toBe('solid')
    expect(vol(back.objects[0])).toBeCloseTo(1, 6)
  })

  it('end(n) past the root throws (upstream ValueError)', async () => {
    const b = await box(Workplane(), 1, 1, 1)
    expect(() => end(b, 5)).toThrow(/no parents/)
  })
})

// ── split(keepTop, keepBottom) — multi-object push (cq.py:258) ──────────────
describe('split() — multi-object push', () => {
  it('both kept → 2 objects on the stack, each half vol 4 (probe split_size == 2)', async () => {
    const b = await box(Workplane(), 2, 2, 2)
    const sp = await split(b, [0, 0, 0], [0, 0, 1])
    expect(size(sp)).toBe(2)
    expect(size(solids(sp))).toBe(2)
    expect(vol(sp.objects[0])).toBeCloseTo(4, 6)
    expect(vol(sp.objects[1])).toBeCloseTo(4, 6)
  })

  it('all() yields one Workplane per half (probe split_all_len == 2)', async () => {
    const b = await box(Workplane(), 2, 2, 2)
    const sp = await split(b, [0, 0, 0], [0, 0, 1])
    const parts = all(sp)
    expect(parts).toHaveLength(2)
    expect(vol(parts[0].objects[0])).toBeCloseTo(4, 6)
    expect(vol(parts[1].objects[0])).toBeCloseTo(4, 6)
  })

  it('keepTop only → 1 object (probe split_keeptop_size == 1)', async () => {
    const b = await box(Workplane(), 2, 2, 2)
    const sp = await split(b, [0, 0, 0], [0, 0, 1], { keepTop: true, keepBottom: false })
    expect(size(sp)).toBe(1)
    expect(vol(sp.objects[0])).toBeCloseTo(4, 6)
  })

  it('partAt(i) is the item(i) shim over the halved stack', async () => {
    const b = await box(Workplane(), 2, 2, 2)
    const sp = await split(b, [0, 0, 0], [0, 0, 1])
    // same object, same geometry as item()
    expect(partAt(sp, 0).objects[0]).toBe(item(sp, 0).objects[0])
    expect(partAt(sp, 1).objects[0]).toBe(item(sp, 1).objects[0])
    // and it keeps item()'s range guard
    expect(() => partAt(sp, 5)).toThrow(/out of range/)
  })
})
