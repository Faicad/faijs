/**
 * CompoundBlueprint — 2D profile with holes (pure-data port of brepjs, Apache-2.0).
 * `blueprints[0]` is the outer boundary; subsequent entries are holes.
 * @module
 */
import { Blueprint, type Point2 } from './blueprint'
import { centerOf, createBBox2d, mergeBBox, type BBox2d } from './bbox2d'

/**
 * CompoundBlueprint — 2D profile with holes.
 * `blueprints[0]` is the outer boundary; subsequent entries are holes.
 */
export class CompoundBlueprint {
  /** `blueprints[0]` = outer boundary; the rest are holes. */
  readonly blueprints: Blueprint[]

  private _bbox: BBox2d | null = null

  constructor(blueprints: Blueprint[]) {
    if (blueprints.length === 0) throw new Error('CompoundBlueprint requires at least the outer boundary')
    this.blueprints = blueprints
  }

  /**
   * Return a copy of this profile.
   * @returns a new CompoundBlueprint whose boundaries are clones of the originals.
   */
  clone(): CompoundBlueprint {
    return new CompoundBlueprint(this.blueprints.map((b) => b.clone()))
  }

  /**
   * Bounding box (cached). The box spanning the outer boundary and all holes.
   * @returns a BBox2d enclosing every boundary in this profile.
   */
  get boundingBox(): BBox2d {
    if (!this._bbox) {
      const bb = createBBox2d()
      for (const b of this.blueprints) mergeBBox(bb, b.boundingBox)
      this._bbox = bb
    }
    return this._bbox
  }

  /**
   * Scale this profile about a center point.
   * @param factor - the scale factor to apply.
   * @param center - the scaling center `[x, y]` (defaults to the bounding-box center).
   * @returns a new CompoundBlueprint with every boundary scaled.
   */
  scale(factor: number, center?: Point2): CompoundBlueprint {
    const ctr = center ?? centerOf(this.boundingBox)
    return new CompoundBlueprint(this.blueprints.map((b) => b.scale(factor, ctr)))
  }

  /**
   * Translate this profile by a delta.
   * @param dxOrPoint - the x delta, or a full `[dx, dy]` offset point.
   * @param dy - the y delta (default 0, ignored when `dxOrPoint` is a point).
   * @returns a new CompoundBlueprint with every boundary translated.
   */
  translate(dxOrPoint: number | Point2, dy?: number): CompoundBlueprint {
    return new CompoundBlueprint(this.blueprints.map((b) => b.translate(dxOrPoint, dy ?? 0)))
  }

  /**
   * Rotate this profile about a center point.
   * @param angleDeg - the rotation angle in degrees.
   * @param center - the rotation center `[x, y]` (defaults to the origin).
   * @returns a new CompoundBlueprint with every boundary rotated.
   */
  rotate(angleDeg: number, center?: Point2): CompoundBlueprint {
    return new CompoundBlueprint(this.blueprints.map((b) => b.rotate(angleDeg, center)))
  }

  /**
   * Mirror this profile.
   * @param centerOrDirection - the mirror center (mode `center`) or the mirror axis direction.
   * @param origin - the axis origin `[x, y]` when mirroring across a plane (defaults to the origin).
   * @param mode - `center` mirrors about a point; `plane` mirrors across an axis.
   * @returns a new CompoundBlueprint with every boundary mirrored.
   */
  mirror(centerOrDirection: Point2, origin?: Point2, mode: 'center' | 'plane' = 'center'): CompoundBlueprint {
    return new CompoundBlueprint(this.blueprints.map((b) => b.mirror(centerOrDirection, origin, mode)))
  }

  /**
   * The starting point of the outer boundary's first curve.
   * @returns the 2D point where this profile begins.
   */
  get firstPoint(): Point2 {
    return this.blueprints[0]!.firstPoint
  }

  /**
   * The ending point of the outer boundary's last curve.
   * @returns the 2D point where this profile ends.
   */
  get lastPoint(): Point2 {
    return this.blueprints[0]!.lastPoint
  }

  /**
   * True when the outer boundary closes back on itself.
   * @returns true when the outer boundary's first and last points coincide.
   */
  isClosed(): boolean {
    return this.blueprints[0]!.isClosed()
  }
}