/**
 * three-parity — math3d 与 three r162 的逐位一致性测试（本重构的生命线）。
 *
 * 对每个移植类/方法：固定种子的随机输入 + 边界输入 → three-162 与 math3d 各跑
 * 一遍 → **断言输出逐位相等**（Object.is，不做 epsilon）。随机输入走固定种子
 * PRNG（mulberry32），不使用 Math.random —— 测试必须可复现。
 *
 * 测试与被测源码目录分离：本文件在 `packages/core/test/`，被测在 `src/math3d/`。
 */

import { describe, it, expect } from 'vitest'
import * as THREE from 'three-162'
import { Vec3, Vec2, Quat, Mat4, Euler, Plane, Box3 } from '../../src/math3d'

/** mulberry32 — 固定种子的确定性 PRNG（返回 [0, 1)）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 逐位比较两个数值数组（Object.is，含 -0/NaN 语义）。 */
function expectExact(actual: ArrayLike<number>, expected: ArrayLike<number>): void {
  expect(actual.length).toBe(expected.length)
  for (let i = 0; i < actual.length; i++) {
    if (!Object.is(actual[i], expected[i])) {
      throw new Error(`bit mismatch at [${i}]: ${actual[i]} !== ${expected[i]}`)
    }
  }
}

const r = mulberry32(20261011)
const num = (): number => (r() - 0.5) * 200
const small = (): number => (r() - 0.5) * 4
const unit = (): number => r() * 2 - 1

const ORDERS = ['XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY'] as const

describe('math3d ≡ three r162 (bit-for-bit)', () => {
  it('self-check: the reference is really r162', () => {
    expect(Number(THREE.REVISION)).toBe(162)
  })

  describe('Vec3', () => {
    it('arithmetic / normalize / cross / dot / distance', () => {
      for (let i = 0; i < 200; i++) {
        const ax = num(), ay = num(), az = num()
        const bx = num(), by = num(), bz = num()
        expectExact(new Vec3(ax, ay, az).addVectors(new Vec3(bx, by, bz), new Vec3(ax, ay, az)).toArray(),
          new THREE.Vector3(ax, ay, az).addVectors(new THREE.Vector3(bx, by, bz), new THREE.Vector3(ax, ay, az)).toArray())
        expectExact(new Vec3(ax, ay, az).subVectors(new Vec3(bx, by, bz), new Vec3(ax, ay, az)).toArray(),
          new THREE.Vector3(ax, ay, az).subVectors(new THREE.Vector3(bx, by, bz), new THREE.Vector3(ax, ay, az)).toArray())
        expectExact(new Vec3(ax, ay, az).crossVectors(new Vec3(bx, by, bz), new Vec3(ax, ay, az)).toArray(),
          new THREE.Vector3(ax, ay, az).crossVectors(new THREE.Vector3(bx, by, bz), new THREE.Vector3(ax, ay, az)).toArray())
        expect(new Vec3(ax, ay, az).dot(new Vec3(bx, by, bz))).toBe(new THREE.Vector3(ax, ay, az).dot(new THREE.Vector3(bx, by, bz)))
        expect(new Vec3(ax, ay, az).length()).toBe(new THREE.Vector3(ax, ay, az).length())
        expect(new Vec3(ax, ay, az).distanceToSquared(new Vec3(bx, by, bz))).toBe(new THREE.Vector3(ax, ay, az).distanceToSquared(new THREE.Vector3(bx, by, bz)))
        expectExact(new Vec3(ax, ay, az).normalize().toArray(), new THREE.Vector3(ax, ay, az).normalize().toArray())
        const s = small()
        expectExact(new Vec3(ax, ay, az).multiplyScalar(s).toArray(), new THREE.Vector3(ax, ay, az).multiplyScalar(s).toArray())
      }
    })

    it('boundary: zero vector normalize / cross with self', () => {
      expectExact(new Vec3(0, 0, 0).normalize().toArray(), new THREE.Vector3(0, 0, 0).normalize().toArray())
      const v = new Vec3(3, -4, 5)
      const t = new THREE.Vector3(3, -4, 5)
      expectExact(new Vec3().copy(v).cross(v).toArray(), new THREE.Vector3().copy(t).cross(t).toArray())
    })

    it('applyMatrix4 / applyQuaternion', () => {
      for (let i = 0; i < 100; i++) {
        const order = ORDERS[i % 6]
        const ex = small(), ey = small(), ez = small()
        const m = new Mat4().makeRotationFromEuler(new Euler(ex, ey, ez, order))
        const tm = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(ex, ey, ez, order))
        const x = num(), y = num(), z = num()
        expectExact(new Vec3(x, y, z).applyMatrix4(m).toArray(),
          new THREE.Vector3(x, y, z).applyMatrix4(tm).toArray())

        const ux = unit(), uy = unit(), uz = unit()
        const q = new Quat().setFromEuler(new Euler(ux, uy, uz, order))
        const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(ux, uy, uz, order))
        expectExact(new Vec3(x, y, z).applyQuaternion(q).toArray(),
          new THREE.Vector3(x, y, z).applyQuaternion(tq).toArray())
      }
    })
  })

  describe('Vec2', () => {
    it('arithmetic / cross / normalize / dot', () => {
      for (let i = 0; i < 100; i++) {
        const ax = num(), ay = num(), bx = num(), by = num()
        expect(new Vec2(ax, ay).dot(new Vec2(bx, by))).toBe(new THREE.Vector2(ax, ay).dot(new THREE.Vector2(bx, by)))
        expect(new Vec2(ax, ay).cross(new Vec2(bx, by))).toBe(new THREE.Vector2(ax, ay).cross(new THREE.Vector2(bx, by)))
        expect(new Vec2(ax, ay).length()).toBe(new THREE.Vector2(ax, ay).length())
        expectExact(new Vec2(ax, ay).normalize().toArray(), new THREE.Vector2(ax, ay).normalize().toArray())
        expectExact(new Vec2(ax, ay).addVectors(new Vec2(bx, by), new Vec2(ay, bx)).toArray(),
          new THREE.Vector2(ax, ay).addVectors(new THREE.Vector2(bx, by), new THREE.Vector2(ay, bx)).toArray())
      }
    })
  })

  describe('Quat', () => {
    it('setFromEuler for all six orders', () => {
      for (const order of ORDERS) {
        const e = new Euler(unit(), unit(), unit(), order)
        const te = new THREE.Euler(e.x, e.y, e.z, order)
        expectExact(new Quat().setFromEuler(e).toArray(), new THREE.Quaternion().setFromEuler(te).toArray())
      }
    })

    it('setFromAxisAngle / setFromUnitVectors / multiply / slerp', () => {
      for (let i = 0; i < 100; i++) {
        // 同一输入喂给两侧；不要预先归一化（否则二次 normalize 会引入 1 ULP 差异，
        // 那是测试构造差异而非实现差异）。
        const axis = new Vec3(unit(), unit(), unit())
        const tAxis = new THREE.Vector3(axis.x, axis.y, axis.z)
        const angle = small()
        expectExact(new Quat().setFromAxisAngle(axis, angle).toArray(),
          new THREE.Quaternion().setFromAxisAngle(tAxis, angle).toArray())

        const fromRaw = new Vec3(num(), num(), num())
        const toRaw = new Vec3(num(), num(), num())
        const from = new THREE.Vector3(fromRaw.x, fromRaw.y, fromRaw.z)
        const to = new THREE.Vector3(toRaw.x, toRaw.y, toRaw.z)
        expectExact(new Quat().setFromUnitVectors(fromRaw, toRaw).toArray(),
          new THREE.Quaternion().setFromUnitVectors(from, to).toArray())

        const ex = unit(), ey = unit(), ez = unit()
        const qa = new Quat().setFromEuler(new Euler(ex, ey, ez, 'XYZ'))
        const qb = new Quat().setFromEuler(new Euler(ez, ex, ey, 'ZYX'))
        const tqa = new THREE.Quaternion().setFromEuler(new THREE.Euler(ex, ey, ez, 'XYZ'))
        const tqb = new THREE.Quaternion().setFromEuler(new THREE.Euler(ez, ex, ey, 'ZYX'))
        expectExact(qa.clone().multiply(qb).toArray(), tqa.clone().multiply(tqb).toArray())
        expectExact(qa.clone().slerp(qb, 0.37).toArray(), tqa.clone().slerp(tqb, 0.37).toArray())
      }
    })

    it('boundary: 180° (opposite unit vectors) setFromUnitVectors', () => {
      expectExact(new Quat().setFromUnitVectors(new Vec3(0, 1, 0), new Vec3(0, -1, 0)).toArray(),
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0)).toArray())
    })
  })

  describe('Mat4', () => {
    it('makeRotationX/Y/Z / makeTranslation / makeScale / makeBasis', () => {
      for (let i = 0; i < 60; i++) {
        const t = small()
        expectExact(new Mat4().makeRotationX(t).elements, new THREE.Matrix4().makeRotationX(t).elements)
        expectExact(new Mat4().makeRotationY(t).elements, new THREE.Matrix4().makeRotationY(t).elements)
        expectExact(new Mat4().makeRotationZ(t).elements, new THREE.Matrix4().makeRotationZ(t).elements)
        const tx = num(), ty = num(), tz = num()
        expectExact(new Mat4().makeTranslation(tx, ty, tz).elements, new THREE.Matrix4().makeTranslation(tx, ty, tz).elements)
        expectExact(new Mat4().makeScale(tx, ty, tz).elements, new THREE.Matrix4().makeScale(tx, ty, tz).elements)
        const xa = new Vec3(num(), num(), num()), ya = new Vec3(num(), num(), num()), za = new Vec3(num(), num(), num())
        const txa = new THREE.Vector3(xa.x, xa.y, xa.z), tya = new THREE.Vector3(ya.x, ya.y, ya.z), tza = new THREE.Vector3(za.x, za.y, za.z)
        expectExact(new Mat4().makeBasis(xa, ya, za).elements, new THREE.Matrix4().makeBasis(txa, tya, tza).elements)
      }
    })

    it('makeRotationFromEuler all orders + makeRotationFromQuaternion + multiply/premultiply', () => {
      for (let i = 0; i < 120; i++) {
        const order = ORDERS[i % 6]
        const ex = small(), ey = small(), ez = small()
        const m = new Mat4().makeRotationFromEuler(new Euler(ex, ey, ez, order))
        const tm = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(ex, ey, ez, order))
        expectExact(m.elements, tm.elements)

        const q = new Quat().setFromEuler(new Euler(ex, ey, ez, order))
        const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(ex, ey, ez, order))
        expectExact(new Mat4().makeRotationFromQuaternion(q).elements,
          new THREE.Matrix4().makeRotationFromQuaternion(tq).elements)

        const ang = small()
        expectExact(m.clone().multiply(new Mat4().makeRotationX(ang)).elements,
          tm.clone().multiply(new THREE.Matrix4().makeRotationX(ang)).elements)
        expectExact(m.clone().premultiply(new Mat4().makeRotationX(ang)).elements,
          tm.clone().premultiply(new THREE.Matrix4().makeRotationX(ang)).elements)
      }
    })

    it('invert / setPosition / copy', () => {
      for (let i = 0; i < 60; i++) {
        const ex = small(), ey = small(), ez = small()
        const m = new Mat4().makeRotationFromEuler(new Euler(ex, ey, ez, 'XYZ'))
        m.setPosition(num(), num(), num())
        const tm = new THREE.Matrix4().fromArray(m.elements)
        expectExact(m.clone().invert().elements, tm.clone().invert().elements)
      }
    })
  })

  describe('Plane / Box3', () => {
    it('Plane setFromNormalAndCoplanarPoint / distanceToPoint', () => {
      for (let i = 0; i < 60; i++) {
        const n = new Vec3(unit(), unit(), unit()).normalize()
        const p = new Vec3(num(), num(), num())
        const q = new Vec3(num(), num(), num())
        const plane = new Plane().setFromNormalAndCoplanarPoint(n, p)
        const tPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
          new THREE.Vector3(n.x, n.y, n.z), new THREE.Vector3(p.x, p.y, p.z))
        expect(plane.constant).toBe(tPlane.constant)
        expectExact(plane.normal.toArray(), tPlane.normal.toArray())
        expect(plane.distanceToPoint(q)).toBe(tPlane.distanceToPoint(new THREE.Vector3(q.x, q.y, q.z)))
      }
    })

    it('Box3 expandByPoint / getCenter / getSize / setFromArray', () => {
      const b = new Box3()
      const tb = new THREE.Box3()
      const arr: number[] = []
      for (let i = 0; i < 90; i++) {
        const x = num(), y = num(), z = num()
        arr.push(x, y, z)
        b.expandByPoint(new Vec3(x, y, z))
        tb.expandByPoint(new THREE.Vector3(x, y, z))
      }
      expectExact(b.min.toArray(), tb.min.toArray())
      expectExact(b.max.toArray(), tb.max.toArray())
      expectExact(b.getCenter(new Vec3()).toArray(), tb.getCenter(new THREE.Vector3()).toArray())
      expectExact(b.getSize(new Vec3()).toArray(), tb.getSize(new THREE.Vector3()).toArray())
      const b2 = new Box3().setFromArray(arr)
      const tb2 = new THREE.Box3().setFromArray(arr)
      expectExact(b2.min.toArray(), tb2.min.toArray())
      expectExact(b2.max.toArray(), tb2.max.toArray())
    })
  })
})