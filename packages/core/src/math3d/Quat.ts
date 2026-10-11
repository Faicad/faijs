/**
   * math3d/Quat — three.js r162 `Quaternion` 的算法子集移植。
 *
   * Ported from three.js r162 `src/math/Quaternion.js` (MIT License, © 2010-2024
   * three.js authors). 公式与运算顺序逐行照抄以保证逐位一致；`_onChange`
   * 回调机制（three 的渲染用）未移植——本类只做数学。
 */

import type { Vec3 } from './Vec3'

/** Quaternion (x, y, z, w), three.js `Quaternion` subset. */
export class Quat {
  /** X component. */
  x: number
  /** Y component. */
  y: number
  /** Z component. */
  z: number
  /** W (scalar) component. */
  w: number

  /**
   * @param x - X component.
   * @param y - Y component.
   * @param z - Z component.
   * @param w - W (scalar) component.
   */
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x
    this.y = y
    this.z = z
    this.w = w
  }

  /**
   * Set the component values.
   * @param x - X component.
   * @param y - Y component.
   * @param z - Z component.
   * @param w - W (scalar) component.
   * @returns this
   */
  set(x: number, y: number, z: number, w: number): this {
    this.x = x
    this.y = y
    this.z = z
    this.w = w
    return this
  }

  /**
   * Copy the components from another quaternion.
   * @param q - source quaternion.
   * @returns this
   */
  copy(q: Quat): this {
    this.x = q.x
    this.y = q.y
    this.z = q.z
    this.w = q.w
    return this
  }

  /**
   * Return a new quaternion with the same components.
   * @returns a new quaternion with the same components.
   */
  clone(): Quat {
    return new Quat(this.x, this.y, this.z, this.w)
  }

  /**
   * Set to the identity quaternion.
   * @returns this (identity quaternion)
   */
  identity(): this {
    return this.set(0, 0, 0, 1)
  }

  /**
   * Set from Euler angles (radians) with an order tag.
   * @param euler - Euler angles (radians) with an order tag.
   * @returns this
   */
  setFromEuler(euler: { x: number; y: number; z: number; order: string }): this {
    const x = euler.x
    const y = euler.y
    const z = euler.z
    const order = euler.order
    const cos = Math.cos
    const sin = Math.sin
    const c1 = cos(x / 2)
    const c2 = cos(y / 2)
    const c3 = cos(z / 2)
    const s1 = sin(x / 2)
    const s2 = sin(y / 2)
    const s3 = sin(z / 2)

    switch (order) {
      case 'XYZ':
        this.x = s1 * c2 * c3 + c1 * s2 * s3
        this.y = c1 * s2 * c3 - s1 * c2 * s3
        this.z = c1 * c2 * s3 + s1 * s2 * c3
        this.w = c1 * c2 * c3 - s1 * s2 * s3
        break
      case 'YXZ':
        this.x = s1 * c2 * c3 + c1 * s2 * s3
        this.y = c1 * s2 * c3 - s1 * c2 * s3
        this.z = c1 * c2 * s3 - s1 * s2 * c3
        this.w = c1 * c2 * c3 + s1 * s2 * s3
        break
      case 'ZXY':
        this.x = s1 * c2 * c3 - c1 * s2 * s3
        this.y = c1 * s2 * c3 + s1 * c2 * s3
        this.z = c1 * c2 * s3 + s1 * s2 * c3
        this.w = c1 * c2 * c3 - s1 * s2 * s3
        break
      case 'ZYX':
        this.x = s1 * c2 * c3 - c1 * s2 * s3
        this.y = c1 * s2 * c3 + s1 * c2 * s3
        this.z = c1 * c2 * s3 - s1 * s2 * c3
        this.w = c1 * c2 * c3 + s1 * s2 * s3
        break
      case 'YZX':
        this.x = s1 * c2 * c3 + c1 * s2 * s3
        this.y = c1 * s2 * c3 + s1 * c2 * s3
        this.z = c1 * c2 * s3 - s1 * s2 * c3
        this.w = c1 * c2 * c3 - s1 * s2 * s3
        break
      case 'XZY':
        this.x = s1 * c2 * c3 - c1 * s2 * s3
        this.y = c1 * s2 * c3 - s1 * c2 * s3
        this.z = c1 * c2 * s3 + s1 * s2 * c3
        this.w = c1 * c2 * c3 + s1 * s2 * s3
        break
    }
    return this
  }

  /**
   * Set from an axis and an angle (radians).
   * @param axis - rotation axis (unit length assumed).
   * @param angle - rotation angle in radians.
   * @returns this
   */
  setFromAxisAngle(axis: Vec3, angle: number): this {
    const halfAngle = angle / 2
    const s = Math.sin(halfAngle)
    this.x = axis.x * s
    this.y = axis.y * s
    this.z = axis.z * s
    this.w = Math.cos(halfAngle)
    return this
  }

  /**
   * Set from a rotation matrix.
   * @param m - matrix whose upper 3x3 is a pure rotation (column-major elements).
   * @returns this
   */
  setFromRotationMatrix(m: { elements: number[] }): this {
    const te = m.elements
    const m11 = te[0]
    const m12 = te[4]
    const m13 = te[8]
    const m21 = te[1]
    const m22 = te[5]
    const m23 = te[9]
    const m31 = te[2]
    const m32 = te[6]
    const m33 = te[10]
    const trace = m11 + m22 + m33

    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1.0)
      this.w = 0.25 / s
      this.x = (m32 - m23) * s
      this.y = (m13 - m31) * s
      this.z = (m21 - m12) * s
    } else if (m11 > m22 && m11 > m33) {
      const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33)
      this.w = (m32 - m23) / s
      this.x = 0.25 * s
      this.y = (m12 + m21) / s
      this.z = (m13 + m31) / s
    } else if (m22 > m33) {
      const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33)
      this.w = (m13 - m31) / s
      this.x = (m12 + m21) / s
      this.y = 0.25 * s
      this.z = (m23 + m32) / s
    } else {
      const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22)
      this.w = (m21 - m12) / s
      this.x = (m13 + m31) / s
      this.y = (m23 + m32) / s
      this.z = 0.25 * s
    }
    return this
  }

  /**
   * Set to the rotation from unit vector v1 to v2.
   * @param vFrom - source direction (unit length assumed).
   * @param vTo - target direction (unit length assumed).
   * @returns this
   */
  setFromUnitVectors(vFrom: Vec3, vTo: Vec3): this {
    let r = vFrom.dot(vTo) + 1
    if (r < Number.EPSILON) {
      r = 0
      if (Math.abs(vFrom.x) > Math.abs(vFrom.z)) {
        this.x = -vFrom.y
        this.y = vFrom.x
        this.z = 0
        this.w = r
      } else {
        this.x = 0
        this.y = -vFrom.z
        this.z = vFrom.y
        this.w = r
      }
    } else {
      this.x = vFrom.y * vTo.z - vFrom.z * vTo.y
      this.y = vFrom.z * vTo.x - vFrom.x * vTo.z
      this.z = vFrom.x * vTo.y - vFrom.y * vTo.x
      this.w = r
    }
    return this.normalize()
  }

  /**
   * Multiply by another quaternion (this = this * q).
   * @param q - right operand.
   * @returns this
   */
  multiply(q: Quat): this {
    return this.multiplyQuaternions(this, q)
  }

  /**
   * Pre-multiply by another quaternion (this = q * this).
   * @param q - left operand.
   * @returns this
   */
  premultiply(q: Quat): this {
    return this.multiplyQuaternions(q, this)
  }

  /**
   * Set this to a * b.
   * @param a - left operand.
   * @param b - right operand.
   * @returns this
   */
  multiplyQuaternions(a: Quat, b: Quat): this {
    const qax = a.x
    const qay = a.y
    const qaz = a.z
    const qaw = a.w
    const qbx = b.x
    const qby = b.y
    const qbz = b.z
    const qbw = b.w
    this.x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby
    this.y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz
    this.z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx
    this.w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz
    return this
  }

  /**
   * Spherical-interpolate towards qb by t.
   * @param qb - target quaternion.
   * @param t - interpolation factor.
   * @returns this
   */
  slerp(qb: Quat, t: number): this {
    if (t === 0) return this
    if (t === 1) return this.copy(qb)
    const x = this.x
    const y = this.y
    const z = this.z
    const w = this.w
    let cosHalfTheta = w * qb.w + x * qb.x + y * qb.y + z * qb.z
    if (cosHalfTheta < 0) {
      this.w = -qb.w
      this.x = -qb.x
      this.y = -qb.y
      this.z = -qb.z
      cosHalfTheta = -cosHalfTheta
    } else {
      this.copy(qb)
    }
    if (cosHalfTheta >= 1.0) {
      this.w = w
      this.x = x
      this.y = y
      this.z = z
      return this
    }
    const sqrSinHalfTheta = 1.0 - cosHalfTheta * cosHalfTheta
    if (sqrSinHalfTheta <= Number.EPSILON) {
      const s = 1 - t
      this.w = s * w + t * this.w
      this.x = s * x + t * this.x
      this.y = s * y + t * this.y
      this.z = s * z + t * this.z
      this.normalize()
      return this
    }
    const sinHalfTheta = Math.sqrt(sqrSinHalfTheta)
    const halfTheta = Math.atan2(sinHalfTheta, cosHalfTheta)
    const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta
    const ratioB = Math.sin(t * halfTheta) / sinHalfTheta
    this.w = w * ratioA + this.w * ratioB
    this.x = x * ratioA + this.x * ratioB
    this.y = y * ratioA + this.y * ratioB
    this.z = z * ratioA + this.z * ratioB
    return this
  }

  /**
   * Return the dot product with another quaternion.
   * @param q - quaternion to compare with.
   * @returns the dot product.
   */
  dot(q: Quat): number {
    return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w
  }

  /**
   * Return the 4D length.
   * @returns the quaternion length.
   */
  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w)
  }

  /**
   * Scale to unit length (zero-length stays zero).
   * @returns this
   */
  normalize(): this {
    let l = this.length()
    if (l === 0) {
      this.x = 0
      this.y = 0
      this.z = 0
      this.w = 1
    } else {
      l = 1 / l
      this.x = this.x * l
      this.y = this.y * l
      this.z = this.z * l
      this.w = this.w * l
    }
    return this
  }

  /**
   * Invert in place (conjugate for unit quaternions).
   * @returns this (assumes unit length)
   */
  invert(): this {
    return this.conjugate()
  }

  /**
   * Conjugate in place (negate x, y, z).
   * @returns this
   */
  conjugate(): this {
    this.x *= -1
    this.y *= -1
    this.z *= -1
    return this
  }

  /**
   * Return the angle (radians) to another quaternion.
   * @param q - quaternion to compare with.
   * @returns the angle in radians.
   */
  angleTo(q: Quat): number {
    return 2 * Math.acos(Math.abs(Math.max(-1, Math.min(1, this.dot(q)))))
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
    array[offset + 3] = this.w
    return array
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
    this.w = array[offset + 3]
    return this
  }

  /**
   * Return true when all components are exactly equal.
   * @param q - quaternion to compare with.
   * @returns true when all components are strictly equal.
   */
  equals(q: Quat): boolean {
    return q.x === this.x && q.y === this.y && q.z === this.z && q.w === this.w
  }
}