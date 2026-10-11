/**
   * math3d/Vec3 — three.js r162 `Vector3` 的算法子集移植（可变类，与 three 逐位一致）。
 *
   * Ported from three.js r162 `src/math/Vector3.js` (MIT License, © 2010-2024
   * three.js authors). 仅保留 core/extra 实际使用的方法；公式与运算顺序逐行照抄，
   * 以保证与 three 的浮点结果逐位一致（parity 测试钉死）。**不得**顺手改写公式。
 *
   * 与 `api/geom-types/vecOps.ts`（compat 面 tuple 纯函数）职责分离：本类是 core
   * 内部 three 替换用的可变向量类，不是公开 API 面的一部分。
 */

import { Quat } from './Quat'

/** 3D vector/point (mutable), three.js `Vector3` subset. */
export class Vec3 {
  /** three 内部标记，供 Matrix4.setPosition / makeTranslation 的向量参数判定。 */
  readonly isVector3 = true

  /** X component. */
  x: number
  /** Y component. */
  y: number
  /** Z component. */
  z: number

  /**
   * @param x - X component.
   * @param y - Y component.
   * @param z - Z component.
   */
  constructor(x = 0, y = 0, z = 0) {
    this.x = x
    this.y = y
    this.z = z
  }

  /**
   * Set the component values.
   * @param x - X component.
   * @param y - Y component.
   * @param z - Z component (kept when omitted, matching three's sprite.scale.set).
   * @returns this
   */
  set(x: number, y: number, z?: number): this {
    if (z === undefined) z = this.z
    this.x = x
    this.y = y
    this.z = z
    return this
  }

  /**
   * Set all components to the same scalar.
   * @param scalar - value for all components.
   * @returns this
   */
  setScalar(scalar: number): this {
    this.x = scalar
    this.y = scalar
    this.z = scalar
    return this
  }

  /**
   * Set the X component.
   * @param x - X component.
   * @returns this
   */
  setX(x: number): this {
    this.x = x
    return this
  }

  /**
   * Set the Y component.
   * @param y - Y component.
   * @returns this
   */
  setY(y: number): this {
    this.y = y
    return this
  }

  /**
   * Set the Z component.
   * @param z - Z component.
   * @returns this
   */
  setZ(z: number): this {
    this.z = z
    return this
  }

  /**
   * Return a new vector with the same components.
   * @returns a new vector with the same components.
   */
  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z)
  }

  /**
   * Copy the components from another vector.
   * @param v - source vector.
   * @returns this
   */
  copy(v: Vec3): this {
    this.x = v.x
    this.y = v.y
    this.z = v.z
    return this
  }

  /**
   * Add a vector component-wise.
   * @param v - right operand.
   * @returns this
   */
  add(v: Vec3): this {
    this.x += v.x
    this.y += v.y
    this.z += v.z
    return this
  }

  /**
   * Add a scalar to every component.
   * @param s - scalar.
   * @returns this
   */
  addScalar(s: number): this {
    this.x += s
    this.y += s
    this.z += s
    return this
  }

  /**
   * Set this to a + b, component-wise.
   * @param a - left operand.
   * @param b - right operand.
   * @returns this
   */
  addVectors(a: Vec3, b: Vec3): this {
    this.x = a.x + b.x
    this.y = a.y + b.y
    this.z = a.z + b.z
    return this
  }

  /**
   * Add v scaled by s, component-wise.
   * @param v - source vector.
   * @param s - scalar.
   * @returns this
   */
  addScaledVector(v: Vec3, s: number): this {
    this.x += v.x * s
    this.y += v.y * s
    this.z += v.z * s
    return this
  }

  /**
   * Subtract a vector component-wise.
   * @param v - right operand.
   * @returns this
   */
  sub(v: Vec3): this {
    this.x -= v.x
    this.y -= v.y
    this.z -= v.z
    return this
  }

  /**
   * Subtract a scalar from every component.
   * @param s - scalar.
   * @returns this
   */
  subScalar(s: number): this {
    this.x -= s
    this.y -= s
    this.z -= s
    return this
  }

  /**
   * Set this to a - b, component-wise.
   * @param a - left operand.
   * @param b - right operand.
   * @returns this
   */
  subVectors(a: Vec3, b: Vec3): this {
    this.x = a.x - b.x
    this.y = a.y - b.y
    this.z = a.z - b.z
    return this
  }

  /**
   * Multiply component-wise by a vector.
   * @param v - right operand.
   * @returns this
   */
  multiply(v: Vec3): this {
    this.x *= v.x
    this.y *= v.y
    this.z *= v.z
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
    this.z *= scalar
    return this
  }

  /**
   * Set this to a * b, component-wise.
   * @param a - left operand.
   * @param b - right operand.
   * @returns this
   */
  multiplyVectors(a: Vec3, b: Vec3): this {
    this.x = a.x * b.x
    this.y = a.y * b.y
    this.z = a.z * b.z
    return this
  }

  /**
   * Rotate the vector by Euler angles (radians).
   * @param euler - Euler angles (radians) with an order tag.
   * @returns this
   */
  applyEuler(euler: { x: number; y: number; z: number; order: string }): this {
    return this.applyQuaternion(new Quat().setFromEuler(euler))
  }

  /**
   * Rotate the vector around an axis by an angle (radians).
   * @param axis - rotation axis (unit length assumed).
   * @param angle - rotation angle in radians.
   * @returns this
   */
  applyAxisAngle(axis: Vec3, angle: number): this {
    return this.applyQuaternion(new Quat().setFromAxisAngle(axis, angle))
  }

  /**
   * Transform the vector by a 4x4 matrix (as a point).
   * @param m - affine 4x4 matrix (three column-major `elements` layout).
   * @returns this
   */
  applyMatrix4(m: { elements: number[] }): this {
    const x = this.x
    const y = this.y
    const z = this.z
    const e = m.elements
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15])
    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w
    return this
  }

  /**
   * Rotate the vector by a quaternion.
   * @param q - unit quaternion.
   * @returns this
   */
  applyQuaternion(q: { x: number; y: number; z: number; w: number }): this {
    const vx = this.x
    const vy = this.y
    const vz = this.z
    const qx = q.x
    const qy = q.y
    const qz = q.z
    const qw = q.w
    const tx = 2 * (qy * vz - qz * vy)
    const ty = 2 * (qz * vx - qx * vz)
    const tz = 2 * (qx * vy - qy * vx)
    this.x = vx + qw * tx + qy * tz - qz * ty
    this.y = vy + qw * ty + qz * tx - qx * tz
    this.z = vz + qw * tz + qx * ty - qy * tx
    return this
  }

  /**
   * Divide component-wise by a vector.
   * @param v - right operand.
   * @returns this
   */
  divide(v: Vec3): this {
    this.x /= v.x
    this.y /= v.y
    this.z /= v.z
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
    this.z = -this.z
    return this
  }

  /**
   * Return the dot product with another vector.
   * @param v - right operand.
   * @returns the dot product.
   */
  dot(v: Vec3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z
  }

  /**
   * Return the squared length.
   * @returns the squared length.
   */
  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z
  }

  /**
   * Return the Euclidean length.
   * @returns the Euclidean length.
   */
  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z)
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
   * Interpolate towards v by t in [0, 1].
   * @param v - target vector.
   * @param alpha - interpolation factor.
   * @returns this
   */
  lerp(v: Vec3, alpha: number): this {
    this.x += (v.x - this.x) * alpha
    this.y += (v.y - this.y) * alpha
    this.z += (v.z - this.z) * alpha
    return this
  }

  /**
   * Set this to the linear interpolation of a and b.
   * @param v1 - start vector.
   * @param v2 - end vector.
   * @param alpha - interpolation factor.
   * @returns this
   */
  lerpVectors(v1: Vec3, v2: Vec3, alpha: number): this {
    this.x = v1.x + (v2.x - v1.x) * alpha
    this.y = v1.y + (v2.y - v1.y) * alpha
    this.z = v1.z + (v2.z - v1.z) * alpha
    return this
  }

  /**
   * Set this to the cross product with v.
   * @param v - right operand.
   * @returns this
   */
  cross(v: Vec3): this {
    return this.crossVectors(this, v)
  }

  /**
   * Set this to the cross product of a and b.
   * @param a - left operand.
   * @param b - right operand.
   * @returns this
   */
  crossVectors(a: Vec3, b: Vec3): this {
    const ax = a.x
    const ay = a.y
    const az = a.z
    const bx = b.x
    const by = b.y
    const bz = b.z
    this.x = ay * bz - az * by
    this.y = az * bx - ax * bz
    this.z = ax * by - ay * bx
    return this
  }

  /**
   * Return the Euclidean distance to another vector.
   * @param v - target vector.
   * @returns the distance.
   */
  distanceTo(v: Vec3): number {
    return Math.sqrt(this.distanceToSquared(v))
  }

  /**
   * Return the squared distance to another vector.
   * @param v - target vector.
   * @returns the squared distance.
   */
  distanceToSquared(v: Vec3): number {
    const dx = this.x - v.x
    const dy = this.y - v.y
    const dz = this.z - v.z
    return dx * dx + dy * dy + dz * dz
  }

  /**
   * Return the angle (radians) to another vector.
   * @param v - target vector.
   * @returns the unsigned angle in radians.
   */
  angleTo(v: Vec3): number {
    const denominator = Math.sqrt(this.lengthSq() * v.lengthSq())
    if (denominator === 0) return Math.PI / 2
    const theta = this.dot(v) / denominator
    return Math.acos(Math.max(-1, Math.min(1, theta)))
  }

  /**
   * Clamp each component to the per-component minimum with v.
   * @param v - target vector (component-wise minimum).
   * @returns this
   */
  min(v: Vec3): this {
    this.x = Math.min(this.x, v.x)
    this.y = Math.min(this.y, v.y)
    this.z = Math.min(this.z, v.z)
    return this
  }

  /**
   * Clamp each component to the per-component maximum with v.
   * @param v - target vector (component-wise maximum).
   * @returns this
   */
  max(v: Vec3): this {
    this.x = Math.max(this.x, v.x)
    this.y = Math.max(this.y, v.y)
    this.z = Math.max(this.z, v.z)
    return this
  }

  /**
   * Clamp every component into [min, max].
   * @param minVal - lower clamp bound.
   * @param maxVal - upper clamp bound.
   * @returns this
   */
  clampScalar(minVal: number, maxVal: number): this {
    this.x = Math.max(minVal, Math.min(maxVal, this.x))
    this.y = Math.max(minVal, Math.min(maxVal, this.y))
    this.z = Math.max(minVal, Math.min(maxVal, this.z))
    return this
  }

  /**
   * Set the components from the translation part of a matrix.
   * @param m - matrix (column-major `elements`).
   * @returns this
   */
  setFromMatrixPosition(m: { elements: number[] }): this {
    const e = m.elements
    this.x = e[12]
    this.y = e[13]
    this.z = e[14]
    return this
  }

  /**
   * Set the components from a matrix column.
   * @param m - matrix (column-major `elements`).
   * @param index - column index.
   * @returns this
   */
  setFromMatrixColumn(m: { elements: number[] }, index: number): this {
    return this.fromArray(m.elements, index * 4)
  }

  /**
   * Set the components from the scale part of a matrix.
   * @param m - matrix (column-major `elements`).
   * @returns the column lengths as (x, y, z) scale factors.
   */
  setFromMatrixScale(m: { elements: number[] }): this {
    const sx = this.setFromMatrixColumn(m, 0).length()
    const sy = this.setFromMatrixColumn(m, 1).length()
    const sz = this.setFromMatrixColumn(m, 2).length()
    this.x = sx
    this.y = sy
    this.z = sz
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
    this.z = array[offset + 2]
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
    array[offset + 2] = this.z
    return array
  }

  /**
   * Return true when all components are exactly equal.
   * @param v - vector to compare with.
   * @returns true when all components are strictly equal.
   */
  equals(v: Vec3): boolean {
    return v.x === this.x && v.y === this.y && v.z === this.z
  }
}