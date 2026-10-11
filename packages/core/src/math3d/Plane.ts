/**
   * math3d/Plane — three.js r162 `Plane` 的算法子集移植。
 *
   * Ported from three.js r162 `src/math/Plane.js` (MIT License, © 2010-2024
   * three.js authors). 平面方程 `normal · p + constant = 0` 与 three 一致。
   * 未移植 `intersectLine` / `intersectsBox`（core 不用；需要时再补，别顺手加）。
 */

import { Vec3 } from './Vec3'

/** Plane (normal, constant), three.js `Plane` subset. */
export class Plane {
  /** three 内部标记。 */
  readonly isPlane = true

  /** Unit normal of the plane. */
  normal: Vec3
  /** Signed distance from the origin along the normal. */
  constant: number

  /**
   * @param normal - unit normal.
   * @param constant - plane constant (normal · p + constant = 0).
   */
  constructor(normal: Vec3 = new Vec3(1, 0, 0), constant = 0) {
    this.normal = normal
    this.constant = constant
  }

  /**
   * Set the normal and constant.
   * @param normal - unit normal.
   * @param constant - plane constant.
   * @returns this
   */
  set(normal: Vec3, constant: number): this {
    this.normal.copy(normal)
    this.constant = constant
    return this
  }

  /**
   * Set from a normal and a point on the plane.
   * @param normal - unit normal.
   * @param point - a point on the plane.
   * @returns this
   */
  setFromNormalAndCoplanarPoint(normal: Vec3, point: Vec3): this {
    this.normal.copy(normal)
    this.constant = -point.dot(this.normal)
    return this
  }

  /**
   * Copy from another plane.
   * @param plane - source plane.
   * @returns this
   */
  copy(plane: Plane): this {
    this.normal.copy(plane.normal)
    this.constant = plane.constant
    return this
  }

  /**
   * Return a new plane with the same values.
   * @returns a new plane with the same normal and constant.
   */
  clone(): Plane {
    return new Plane().copy(this)
  }

  /**
   * Return the signed distance to a point.
   * @param point - the point to measure.
   * @returns the signed distance from the plane.
   */
  distanceToPoint(point: Vec3): number {
    return this.normal.dot(point) + this.constant
  }

  /**
   * Project a point onto the plane.
   * @param point - the point to project.
   * @param target - the output vector.
   * @returns the projected point (stored in target).
   */
  projectPoint(point: Vec3, target: Vec3): Vec3 {
    return target.copy(point).addScaledVector(this.normal, -this.distanceToPoint(point))
  }

  /**
   * Return a point on the plane.
   * @param target - the output vector.
   * @returns an arbitrary point on the plane (stored in target).
   */
  coplanarPoint(target: Vec3): Vec3 {
    return target.copy(this.normal).multiplyScalar(-this.constant)
  }
}