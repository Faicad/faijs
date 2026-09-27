/**
 * Blueprints — collection of disjoint 2D profiles (pure-data port of brepjs,
 * Apache-2.0). Typical result of boolean operations producing multiple regions.
 * @module
 */
import { Blueprint, type Point2 } from './blueprint'
import { CompoundBlueprint } from './compound-blueprint'
import { centerOf, createBBox2d, mergeBBox, type BBox2d } from './bbox2d'

/**
 * Blueprints — collection of disjoint 2D profiles.
 * Typical result of boolean operations producing multiple independent regions.
 */
export class Blueprints {
  /** The independent profiles in this collection. */
  readonly blueprints: Array<Blueprint | CompoundBlueprint>

  private _bbox: BBox2d | null = null

  constructor(blueprints: Array<Blueprint | CompoundBlueprint>) {
    this.blueprints = blueprints
  }

  /**
   * Return a copy of this collection.
   * @returns a new Blueprints whose profiles are clones of the originals.
   */
  clone(): Blueprints {
    return new Blueprints(this.blueprints.map((b) => b.clone()))
  }

  /**
   * Bounding box (cached). The box spanning all contained profiles.
   * @returns a BBox2d enclosing every profile in this collection.
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
   * Scale every profile about a center point.
   * @param factor - the scale factor to apply.
   * @param center - the scaling center `[x, y]` (defaults to the bounding-box center).
   * @returns a new Blueprints with every profile scaled.
   */
  scale(factor: number, center?: Point2): Blueprints {
    const ctr = center ?? centerOf(this.boundingBox)
    return new Blueprints(this.blueprints.map((b) => b.scale(factor, ctr)))
  }

  /**
   * Translate every profile by a delta.
   * @param dxOrPoint - the x delta, or a full `[dx, dy]` offset point.
   * @param dy - the y delta (default 0, ignored when `dxOrPoint` is a point).
   * @returns a new Blueprints with every profile translated.
   */
  translate(dxOrPoint: number | Point2, dy?: number): Blueprints {
    return new Blueprints(this.blueprints.map((b) => b.translate(dxOrPoint, dy ?? 0)))
  }

  /**
   * Rotate every profile about a center point.
   * @param angleDeg - the rotation angle in degrees.
   * @param center - the rotation center `[x, y]` (defaults to the origin).
   * @returns a new Blueprints with every profile rotated.
   */
  rotate(angleDeg: number, center?: Point2): Blueprints {
    return new Blueprints(this.blueprints.map((b) => b.rotate(angleDeg, center)))
  }

  /**
   * Mirror every profile.
   * @param centerOrDirection - the mirror center (mode `center`) or the mirror axis direction.
   * @param origin - the axis origin `[x, y]` when mirroring across a plane (defaults to the origin).
   * @param mode - `center` mirrors about a point; `plane` mirrors across an axis.
   * @returns a new Blueprints with every profile mirrored.
   */
  mirror(centerOrDirection: Point2, origin?: Point2, mode: 'center' | 'plane' = 'center'): Blueprints {
    return new Blueprints(this.blueprints.map((b) => b.mirror(centerOrDirection, origin, mode)))
  }
}