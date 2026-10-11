/**
   * math3d/Box3 — three.js r162 `Box3` 的算法子集移植。
 *
   * Ported from three.js r162 `src/math/Box3.js` (MIT License, © 2010-2024
   * three.js authors). 公式与运算顺序逐行照抄以保证逐位一致。
 */

import { Vec3 } from './Vec3'

/** Axis-aligned bounding box, three.js `Box3` subset. */
export class Box3 {
  /** three 内部标记。 */
  readonly isBox3 = true

  /** Minimum corner. */
  min: Vec3
  /** Maximum corner. */
  max: Vec3

  /**
   * @param min - minimum corner (defaults to +Infinity).
   * @param max - maximum corner (defaults to -Infinity).
   */
  constructor(
    min: Vec3 = new Vec3(+Infinity, +Infinity, +Infinity),
    max: Vec3 = new Vec3(-Infinity, -Infinity, -Infinity),
  ) {
    this.min = min
    this.max = max
  }

  /**
   * Set the min/max corners.
   * @param min - minimum corner.
   * @param max - maximum corner.
   * @returns this
   */
  set(min: Vec3, max: Vec3): this {
    this.min.copy(min)
    this.max.copy(max)
    return this
  }

  /**
   * Copy min/max from another box.
   * @param box - source box.
   * @returns this
   */
  copy(box: Box3): this {
    this.min.copy(box.min)
    this.max.copy(box.max)
    return this
  }

  /**
   * Return a new box with the same corners.
   * @returns a new box with the same corners.
   */
  clone(): Box3 {
    return new Box3().copy(this)
  }

  /**
   * Make the box empty (min +Inf, max -Inf).
   * @returns this (empty box)
   */
  makeEmpty(): this {
    this.min.x = this.min.y = this.min.z = +Infinity
    this.max.x = this.max.y = this.max.z = -Infinity
    return this
  }

  /**
   * Return true when the box is empty.
   * @returns true when the box is empty.
   */
  isEmpty(): boolean {
    return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z
  }

  /**
   * Return the center point.
   * @param target - the output vector.
   * @returns the box center (stored in target).
   */
  getCenter(target: Vec3): Vec3 {
    return this.isEmpty() ? target.set(0, 0, 0) : target.addVectors(this.min, this.max).multiplyScalar(0.5)
  }

  /**
   * Return the size vector (zero for an empty box).
   * @param target - the output vector.
   * @returns the box size (stored in target).
   */
  getSize(target: Vec3): Vec3 {
    return this.isEmpty() ? target.set(0, 0, 0) : target.subVectors(this.max, this.min)
  }

  /**
   * Expand the box to include a point.
   * @param point - the point to include.
   * @returns this
   */
  expandByPoint(point: Vec3): this {
    this.min.min(point)
    this.max.max(point)
    return this
  }

  /**
   * Expand to the union with another box.
   * @param box - the box to union with.
   * @returns this
   */
  union(box: Box3): this {
    this.min.min(box.min)
    this.max.max(box.max)
    return this
  }

  /**
   * Set from an array of points.
   * @param points - the points to enclose.
   * @returns this
   */
  setFromPoints(points: Vec3[]): this {
    this.makeEmpty()
    for (let i = 0; i < points.length; i++) this.expandByPoint(points[i])
    return this
  }

  /**
   * Set from a flat array of coordinates.
   * @param array - flat position array (x, y, z, ...).
   * @returns this
   */
  setFromArray(array: ArrayLike<number>): this {
    let minX = +Infinity
    let minY = +Infinity
    let minZ = +Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxZ = -Infinity
    for (let i = 0; i < array.length; i += 3) {
      const x = array[i]
      const y = array[i + 1]
      const z = array[i + 2]
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (z < minZ) minZ = z
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      if (z > maxZ) maxZ = z
    }
    this.min.set(minX, minY, minZ)
    this.max.set(maxX, maxY, maxZ)
    return this
  }
}