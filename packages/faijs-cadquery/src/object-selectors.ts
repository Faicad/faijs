/**
 * Object selector classes — CadQuery `selectors.py` object-selector parity.
 *
 * This is the audit's "C 类 · 对象选择器类" silent gap
 * (`docs/plans/2026-10-02-cadquery-port-gap-audit.md` §3.3): the string
 * selector syntax was already covered, but the *object* selectors — the ones
 * upstream scripts pass to `.faces(...)`/`.edges(...)`/`.vertices(...)` as
 * instances — were entirely absent, and no STEP-geometry comparison can ever
 * see that (a selection is an in-process sub-shape reference, never an
 * exported solid).
 *
 * Every class here is verified against a ONE-SHOT CadQuery 2.8.0 reference
 * capture (`tests/ref-harness/object-selectors-probe.py`) whose numbers are
 * frozen into `src/object-selectors.test.ts` — audit §5.1: capture the truth
 * once, hard-code it, never run a per-test probe channel.
 *
 * Upstream Python composes selectors with the `&` / `+` / `-` / `-x`
 * operators; TypeScript has no operator overloading, so the binary classes are
 * constructed explicitly (`new AndSelector(a, b)`).
 */

import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import type { CqShape, Pt3, Selector } from './shape-class'
import { areaOf, boundingBoxOf, centerOf, lengthOf, radiusOf, shapeTypeOf, unwrapShape } from './shape-class'

function kernel(): OcctKernel {
  return getKernel() as unknown as OcctKernel
}

/** Deduplicate by wrapper identity, preserving first-appearance order. */
function dedupe(items: CqShape[]): CqShape[] {
  const seen = new Set<CqShape>()
  const out: CqShape[] = []
  for (const i of items) {
    if (!seen.has(i)) {
      seen.add(i)
      out.push(i)
    }
  }
  return out
}

/**
 * `_NthSelector` — the shared base of the "Nth by some key" selectors.
 *
 * Upstream semantics (probe-verified): sort the candidates by the key, CLUSTER
 * them (consecutive candidates within `tolerance` of the cluster's first key
 * share a cluster), then index into the cluster list. `directionMax = false`
 * reverses the cluster order first; a negative `n` counts from the end
 * (Python indexing).
 *
 * GOTCHA (probe-verified): an empty candidate list raises; a list where EVERY
 * candidate is dropped (its key is undefined — e.g. a straight edge asked for a
 * radius) ALSO raises, because upstream reads `key_and_obj[0][0]` after the
 * drop loop without checking. It never yields an empty selection.
 */
export abstract class NthSelector implements Selector {
  /**
   * @param n - cluster index; negative counts from the end.
   * @param directionMax - true ⇒ ascending by key (the largest is last).
   * @param tolerance - clustering width on the key.
   */
  constructor(
    private readonly n: number,
    private readonly directionMax = true,
    private readonly tolerance = 1e-4,
  ) {}

  /**
   * Select the Nth cluster of the candidate list.
   * @param items - candidate shapes.
   * @returns every member of the selected cluster.
   */
  filter(items: CqShape[]): CqShape[] {
    if (!items.length) throw new Error('Can not return the Nth element of an empty list')
    const clustered = this.cluster(items)
    if (!this.directionMax) clustered.reverse()
    const idx = this.n < 0 ? clustered.length + this.n : this.n
    if (idx < 0 || idx >= clustered.length) {
      throw new Error(`Attempted to access index ${this.n} of a list with length ${clustered.length}`)
    }
    return clustered[idx]
  }

  /**
   * Group the candidates into key-ordered clusters of near-equal key.
   * @param items - candidate shapes.
   * @returns clusters, ascending by key.
   */
  protected cluster(items: CqShape[]): CqShape[][] {
    const keyed: Array<{ key: number; item: CqShape }> = []
    for (const item of items) {
      const key = this.key(item)
      if (key === null) continue // upstream drops an element whose key() raises ValueError
      keyed.push({ key, item })
    }
    if (!keyed.length) throw new Error('Can not return the Nth element of an empty list')
    keyed.sort((a, b) => a.key - b.key)
    const clustered: CqShape[][] = [[]]
    let start = keyed[0].key
    for (const e of keyed) {
      // GOTCHA: the tolerance window is measured from the CLUSTER's first key,
      // not from the previous element — a chain of 1e-4 steps stays one cluster.
      if (Math.abs(e.key - start) <= this.tolerance) clustered[clustered.length - 1].push(e.item)
      else {
        clustered.push([e.item])
        start = e.key
      }
    }
    return clustered
  }

  /**
   * Ordering key of one candidate.
   * @param item - a candidate shape.
   * @returns the key, or null to drop the candidate.
   */
  protected abstract key(item: CqShape): number | null
}

/**
 * `CenterNthSelector(vector, n)` — the Nth object by its centre projected on
 * `vector` (upstream key: `obj.Center().dot(vector)`, NOT normalised).
 */
export class CenterNthSelector extends NthSelector {
  /**
   * @param vector - projection direction.
   * @param n - cluster index; negative counts from the end.
   * @param directionMax - true ⇒ ascending by projection.
   * @param tolerance - clustering width on the projection.
   */
  constructor(
    private readonly vector: Pt3,
    n: number,
    directionMax = true,
    tolerance = 1e-4,
  ) {
    super(n, directionMax, tolerance)
  }

  /**
   * Project the CadQuery-semantics centre onto the selector's direction.
   * @param item - a candidate shape.
   * @returns the projection.
   */
  protected key(item: CqShape): number | null {
    const c = centerOf(item)
    return c.x * this.vector.x + c.y * this.vector.y + c.z * this.vector.z
  }
}

/**
 * `LengthNthSelector(n)` — the Nth object by length. Applicable to edges and
 * wires only; every other shape type is DROPPED (upstream raises ValueError
 * from `key`, which the clustering loop swallows).
 */
export class LengthNthSelector extends NthSelector {
  /**
   * @param item - a candidate shape.
   * @returns its length, or null for anything that is not an edge/wire.
   */
  protected key(item: CqShape): number | null {
    const t = shapeTypeOf(item)
    return t === 'edge' || t === 'wire' ? lengthOf(item) : null
  }
}

/**
 * `AreaNthSelector(n)` — the Nth object by area: faces / shells / solids via
 * `Area()`, closed planar wires via a temporary face built from the wire
 * (upstream `Face.makeFromWires`); a wire that cannot be turned into a face
 * (open or non-planar) is DROPPED, as is every other shape type.
 */
export class AreaNthSelector extends NthSelector {
  /**
   * @param item - a candidate shape.
   * @returns its area, or null when the area is undefined for the shape.
   */
  protected key(item: CqShape): number | null {
    const t = shapeTypeOf(item)
    if (t === 'face' || t === 'shell' || t === 'solid') return areaOf(item)
    if (t !== 'wire') return null
    const k = kernel()
    const mark = k.checkpoint()
    try {
      const face = k.makeFace(unwrapShape(item))
      return Math.abs(areaOf(face))
    } catch {
      return null
    } finally {
      k.releaseSince(mark)
    }
  }
}

/**
 * `RadiusNthSelector(n)` — the Nth object by the radius of its circular
 * geometry. Applicable to edges and wires only; straight ones are DROPPED.
 */
export class RadiusNthSelector extends NthSelector {
  /**
   * @param item - a candidate shape.
   * @returns its radius, or null when it has no circle radius.
   */
  protected key(item: CqShape): number | null {
    const t = shapeTypeOf(item)
    if (t !== 'edge' && t !== 'wire') return null
    try {
      return radiusOf(item)
    } catch {
      return null // upstream: ValueError → dropped
    }
  }
}

/**
 * `BoxSelector(point0, point1, boundingbox)` — keep the objects inside the
 * 3D box spanned by two corners (order of the corners is irrelevant: the
 * test is an XOR on each axis).
 *
 * GOTCHA (probe-verified): the default mode tests the object's CENTRE, and
 * `boundingbox=True` requires BOTH bbox corners inside — so an exact-fit box
 * around a solid selects NOTHING (the bbox touches the faces, and the test is
 * strict `<` on both ends). Add a padding epsilon to select everything.
 */
export class BoxSelector implements Selector {
  /**
   * @param point0 - one corner of the box.
   * @param point1 - the opposite corner.
   * @param boundingbox - true ⇒ test both bbox corners; false ⇒ test the centre.
   */
  constructor(
    private readonly point0: Pt3,
    private readonly point1: Pt3,
    private readonly boundingbox = false,
  ) {}

  /**
   * Keep the objects inside the box.
   * @param items - candidate shapes.
   * @returns the objects inside the box, in input order.
   */
  filter(items: CqShape[]): CqShape[] {
    const inside = (p: Pt3): boolean =>
      p.x < this.point0.x !== p.x < this.point1.x &&
      p.y < this.point0.y !== p.y < this.point1.y &&
      p.z < this.point0.z !== p.z < this.point1.z
    return items.filter((item) => {
      if (!this.boundingbox) return inside(centerOf(item))
      const bb = boundingBoxOf(item)
      return (
        inside({ x: bb.xmin, y: bb.ymin, z: bb.zmin }) && inside({ x: bb.xmax, y: bb.ymax, z: bb.zmax })
      )
    })
  }
}

/**
 * `NearestToShapeSelector(shape)` — the single object closest to `shape`
 * (upstream `Shape.distance` = `BRepExtrema_DistShapeShape`, the true minimum
 * distance, not a centre-to-centre approximation).
 *
 * GOTCHA (probe-verified): ties are resolved by input order (upstream `min`
 * keeps the first minimum), and an empty candidate list raises.
 */
export class NearestToShapeSelector implements Selector {
  /**
   * @param shape - the reference shape (wrapper or handle).
   */
  constructor(private readonly shape: CqShape | ShapeHandle) {}

  /**
   * Keep the single nearest object.
   * @param items - candidate shapes.
   * @returns a one-element list holding the nearest object.
   */
  filter(items: CqShape[]): CqShape[] {
    if (!items.length) throw new Error('NearestToShapeSelector: can not select from an empty list')
    const k = kernel()
    const ref = unwrapShape(this.shape)
    let best = items[0]
    let bestD = Infinity
    for (const item of items) {
      const d = k.distanceBetween(ref, unwrapShape(item))
      if (d < bestD) {
        bestD = d
        best = item
      }
    }
    return [best]
  }
}

/**
 * `AndSelector(left, right)` — intersection: the objects both selectors pick.
 */
export class AndSelector implements Selector {
  /**
   * @param left - the left selector.
   * @param right - the right selector.
   */
  constructor(
    private readonly left: Selector,
    private readonly right: Selector,
  ) {}

  /**
   * Intersect the two selections.
   * @param items - candidate shapes.
   * @returns the objects selected by both sides, deduplicated.
   */
  filter(items: CqShape[]): CqShape[] {
    return this.filterResults(this.left.filter(items), this.right.filter(items))
  }

  /**
   * Combine the two already-computed selections.
   * @param rLeft - the left selection.
   * @param rRight - the right selection.
   * @returns the combined result.
   */
  protected filterResults(rLeft: CqShape[], rRight: CqShape[]): CqShape[] {
    const right = new Set<CqShape>(rRight)
    return dedupe(rLeft.filter((i) => right.has(i)))
  }
}

/**
 * `SumSelector(left, right)` — union: everything either selector picks.
 */
export class SumSelector implements Selector {
  /**
   * @param left - the left selector.
   * @param right - the right selector.
   */
  constructor(
    private readonly left: Selector,
    private readonly right: Selector,
  ) {}

  /**
   * Union the two selections.
   * @param items - candidate shapes.
   * @returns the objects selected by either side, deduplicated.
   */
  filter(items: CqShape[]): CqShape[] {
    return this.filterResults(this.left.filter(items), this.right.filter(items))
  }

  /**
   * Combine the two already-computed selections.
   * @param rLeft - the left selection.
   * @param rRight - the right selection.
   * @returns the combined result.
   */
  protected filterResults(rLeft: CqShape[], rRight: CqShape[]): CqShape[] {
    return dedupe([...rLeft, ...rRight])
  }
}

/**
 * `SubtractSelector(left, right)` — difference: what the left selector picks
 * minus what the right one picks.
 */
export class SubtractSelector implements Selector {
  /**
   * @param left - the left selector.
   * @param right - the right selector.
   */
  constructor(
    private readonly left: Selector,
    private readonly right: Selector,
  ) {}

  /**
   * Subtract the right selection from the left one.
   * @param items - candidate shapes.
   * @returns the remaining objects, deduplicated.
   */
  filter(items: CqShape[]): CqShape[] {
    return this.filterResults(this.left.filter(items), this.right.filter(items))
  }

  /**
   * Combine the two already-computed selections.
   * @param rLeft - the left selection.
   * @param rRight - the right selection.
   * @returns the combined result.
   */
  protected filterResults(rLeft: CqShape[], rRight: CqShape[]): CqShape[] {
    const right = new Set<CqShape>(rRight)
    return dedupe(rLeft.filter((i) => !right.has(i)))
  }
}

/**
 * `InverseSelector(selector)` — everything the wrapped selector does NOT pick
 * (upstream: `SubtractSelector(Selector(), selector)`); the result is
 * deduplicated, as upstream's set difference implies.
 */
export class InverseSelector implements Selector {
  /**
   * @param selector - the selector to invert.
   */
  constructor(private readonly selector: Selector) {}

  /**
   * Invert a selection over the candidate list.
   * @param items - candidate shapes.
   * @returns the objects the wrapped selector did not pick.
   */
  filter(items: CqShape[]): CqShape[] {
    const selected = new Set<CqShape>(this.selector.filter(items))
    return dedupe(items.filter((i) => !selected.has(i)))
  }
}
