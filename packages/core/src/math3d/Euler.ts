/**
   * math3d/Euler — three.js r162 `Euler` 的算法子集移植。
 *
   * Ported from three.js r162 `src/math/Euler.js` (MIT License, © 2010-2024
   * three.js authors). 回调机制未移植；`order` 语义（'XYZ' 等六个序）与 three
   * 完全一致。
 */

/** Euler rotation order names supported by three. */
export type EulerOrder = 'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY'

/** Euler angles (radians) with a rotation order, three.js `Euler` subset. */
export class Euler {
  /** three 内部标记。 */
  readonly isEuler = true

  /** Default rotation order used when none is supplied. */
  static readonly DEFAULT_ORDER: EulerOrder = 'XYZ'

  /** X component. */
  x: number
  /** Y component. */
  y: number
  /** Z component. */
  z: number
  /** Rotation axis order, e.g. 'XYZ'. */
  order: EulerOrder

  /**
   * @param x - rotation about X in radians.
   * @param y - rotation about Y in radians.
   * @param z - rotation about Z in radians.
   * @param order - rotation order.
   */
  constructor(x = 0, y = 0, z = 0, order: EulerOrder = Euler.DEFAULT_ORDER) {
    this.x = x
    this.y = y
    this.z = z
    this.order = order
  }

  /**
   * Set the angles and order.
   * @param x - rotation about X in radians.
   * @param y - rotation about Y in radians.
   * @param z - rotation about Z in radians.
   * @param order - rotation order (kept when omitted).
   * @returns this
   */
  set(x: number, y: number, z: number, order: EulerOrder = this.order): this {
    this.x = x
    this.y = y
    this.z = z
    this.order = order
    return this
  }

  /**
   * Return a new Euler with the same values.
   * @returns a new euler with the same components.
   */
  clone(): Euler {
    return new Euler(this.x, this.y, this.z, this.order)
  }

  /**
   * Copy from another Euler.
   * @param euler - source euler.
   * @returns this
   */
  copy(euler: Euler): this {
    this.x = euler.x
    this.y = euler.y
    this.z = euler.z
    this.order = euler.order
    return this
  }

  /**
   * Load from an array-like [x, y, z, order?].
   * @param array - source array.
   * @returns this
   */
  fromArray(array: [number, number, number, EulerOrder?]): this {
    this.x = array[0]
    this.y = array[1]
    this.z = array[2]
    if (array[3] !== undefined) this.order = array[3]
    return this
  }

  /**
   * Write into an array [x, y, z, order?].
   * @param array - target array (created when omitted).
   * @returns the target array.
   */
  toArray(array: Array<number | EulerOrder> = []): Array<number | EulerOrder> {
    array[0] = this.x
    array[1] = this.y
    array[2] = this.z
    array[3] = this.order
    return array
  }
}