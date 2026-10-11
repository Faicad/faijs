/**
   * math3d/Vec2 — three.js r162 `Vector2` 的算法子集移植。
 *
   * Ported from three.js r162 `src/math/Vector2.js` (MIT License, © 2010-2024
   * three.js authors). 公式与运算顺序逐行照抄以保证逐位一致。
 */

/** 2D point/vector (mutable), three.js `Vector2` subset. */
export class Vec2 {
  /** three 内部标记（与 Vector2 一致）。 */
  readonly isVector2 = true

  /** X component. */
  x: number
  /** Y component. */
  y: number

  /**
   * @param x - X component.
   * @param y - Y component.
   */
  constructor(x = 0, y = 0) {
    this.x = x
    this.y = y
  }

  /**
   * Set the component values.
   * @param x - X component.
   * @param y - Y component.
   * @returns this
   */
  set(x: number, y: number): this {
    this.x = x
    this.y = y
    return this
  }

  /**
   * Copy the components from another vector.
   * @param v - source vector.
   * @returns this
   */
  copy(v: Vec2): this {
    this.x = v.x
    this.y = v.y
    return this
  }

  /**
   * Return a new vector with the same components.
   * @returns a new vector with the same components.
   */
  clone(): Vec2 {
    return new Vec2(this.x, this.y)
  }

  /**
   * Add a vector component-wise.
   * @param v - right operand.
   * @returns this
   */
  add(v: Vec2): this {
    this.x += v.x
    this.y += v.y
    return this
  }

  /**
   * Set this to a + b, component-wise.
   * @param a - left operand.
   * @param b - right operand.
   * @returns this
   */
  addVectors(a: Vec2, b: Vec2): this {
    this.x = a.x + b.x
    this.y = a.y + b.y
    return this
  }

  /**
   * Add v scaled by s, component-wise.
   * @param v - source vector.
   * @param s - scalar.
   * @returns this
   */
  addScaledVector(v: Vec2, s: number): this {
    this.x += v.x * s
    this.y += v.y * s
    return this
  }

  /**
   * Subtract a vector component-wise.
   * @param v - right operand.
   * @returns this
   */
  sub(v: Vec2): this {
    this.x -= v.x
    this.y -= v.y
    return this
  }

  /**
   * Set this to a - b, component-wise.
   * @param a - left operand.
   * @param b - right operand.
   * @returns this
   */
  subVectors(a: Vec2, b: Vec2): this {
    this.x = a.x - b.x
    this.y = a.y - b.y
    return this
  }

  /**
   * Multiply component-wise by a vector.
   * @param v - right operand.
   * @returns this
   */
  multiply(v: Vec2): this {
    this.x *= v.x
    this.y *= v.y
    return this
  }

  /**
   * Multiply every component by a scalar.
   * @param scalar - scalar factor.
   * @returns this
   */
  multiplyScalar(scalar: number): this {
    this.x *= scalar
    this.y *= scalar
    return this
  }

  /**
   * Divide component-wise by a vector.
   * @param v - right operand.
   * @returns this
   */
  divide(v: Vec2): this {
    this.x /= v.x
    this.y /= v.y
    return this
  }

  /**
   * Divide every component by a scalar.
   * @param scalar - scalar divisor.
   * @returns this
   */
  divideScalar(scalar: number): this {
    return this.multiplyScalar(1 / scalar)
  }

  /**
   * Negate every component.
   * @returns this
   */
  negate(): this {
    this.x = -this.x
    this.y = -this.y
    return this
  }

  /**
   * Return the dot product with another vector.
   * @param v - right operand.
   * @returns the dot product.
   */
  dot(v: Vec2): number {
    return this.x * v.x + this.y * v.y
  }

  /**
   * Return the 2D cross (z of a × b).
   * @param v - right operand.
   * @returns the 2D cross product (scalar).
   */
  cross(v: Vec2): number {
    return this.x * v.y - this.y * v.x
  }

  /**
   * Return the squared length.
   * @returns the squared length.
   */
  lengthSq(): number {
    return this.x * this.x + this.y * this.y
  }

  /**
   * Return the Euclidean length.
   * @returns the Euclidean length.
   */
  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y)
  }

  /**
   * Scale to unit length (zero-length stays zero).
   * @returns this
   */
  normalize(): this {
    return this.divideScalar(this.length() || 1)
  }

  /**
   * Scale to the given length.
   * @param length - target length.
   * @returns this
   */
  setLength(length: number): this {
    return this.normalize().multiplyScalar(length)
  }

  /**
   * Return the Euclidean distance to another vector.
   * @param v - target vector.
   * @returns the distance.
   */
  distanceTo(v: Vec2): number {
    return Math.sqrt(this.distanceToSquared(v))
  }

  /**
   * Return the squared distance to another vector.
   * @param v - target vector.
   * @returns the squared distance.
   */
  distanceToSquared(v: Vec2): number {
    const dx = this.x - v.x
    const dy = this.y - v.y
    return dx * dx + dy * dy
  }

  /**
   * Interpolate towards v by t in [0, 1].
   * @param v - target vector.
   * @param alpha - interpolation factor.
   * @returns this
   */
  lerp(v: Vec2, alpha: number): this {
    this.x += (v.x - this.x) * alpha
    this.y += (v.y - this.y) * alpha
    return this
  }

  /**
   * Clamp each component to the per-component minimum with v.
   * @param v - target vector (component-wise minimum).
   * @returns this
   */
  min(v: Vec2): this {
    this.x = Math.min(this.x, v.x)
    this.y = Math.min(this.y, v.y)
    return this
  }

  /**
   * Clamp each component to the per-component maximum with v.
   * @param v - target vector (component-wise maximum).
   * @returns this
   */
  max(v: Vec2): this {
    this.x = Math.max(this.x, v.x)
    this.y = Math.max(this.y, v.y)
    return this
  }

  /**
   * Load the components from an array-like.
   * @param array - source array.
   * @param offset - start offset.
   * @returns this
   */
  fromArray(array: ArrayLike<number>, offset = 0): this {
    this.x = array[offset]
    this.y = array[offset + 1]
    return this
  }

  /**
   * Write the components into an array.
   * @param array - target array (created when omitted).
   * @param offset - start offset.
   * @returns the target array.
   */
  toArray(array: number[] = [], offset = 0): number[] {
    array[offset] = this.x
    array[offset + 1] = this.y
    return array
  }

  /**
   * Return true when all components are exactly equal.
   * @param v - vector to compare with.
   * @returns true when all components are strictly equal.
   */
  equals(v: Vec2): boolean {
    return v.x === this.x && v.y === this.y
  }
}