/**
 * meshdata-parametric — 参数化几何与 three r162 的逐位一致性测试。
 *
 * 面序契约（`faceRanges`）建立在顶点/索引生成顺序之上，因此这里必须逐位对照：
 * three 生成 normal/uv，但 position/index 必须与本模块完全一致。
 */

import { describe, it, expect } from 'vitest'
import * as THREE from 'three-162'
import { boxGeometry, cylinderGeometry, coneGeometry, sphereGeometry } from '../../src/mesh/meshdata'

function expectExact(actual: ArrayLike<number>, expected: ArrayLike<number>): void {
  expect(actual.length).toBe(expected.length)
  for (let i = 0; i < actual.length; i++) {
    if (!Object.is(actual[i], expected[i])) {
      throw new Error(`bit mismatch at [${i}]: ${actual[i]} !== ${expected[i]}`)
    }
  }
}

describe('meshdata parametric ≡ three r162 (bit-for-bit)', () => {
  it('boxGeometry (multi-segment)', () => {
    for (const [w, h, d, ws, hs, ds] of [
      [2, 3, 4, 1, 1, 1],
      [10, 20, 30, 2, 3, 4],
    ] as const) {
      const mine = boxGeometry(w, h, d, ws, hs, ds)
      const three = new THREE.BoxGeometry(w, h, d, ws, hs, ds)
      expectExact(mine.positions, three.attributes.position.array as Float32Array)
      expectExact(mine.indices, three.index!.array as Uint32Array)
    }
  })

  it('cylinderGeometry (torso + caps, frustum)', () => {
    for (const [rt, rb, h, seg] of [
      [1, 1, 3, 16],
      [2, 1, 5, 12],
    ] as const) {
      const mine = cylinderGeometry(rt, rb, h, seg)
      const three = new THREE.CylinderGeometry(rt, rb, h, seg)
      expectExact(mine.positions, three.attributes.position.array as Float32Array)
      expectExact(mine.indices, three.index!.array as Uint32Array)
    }
  })

  it('coneGeometry (apex) ≡ CylinderGeometry(0, r, ...)', () => {
    const mine = coneGeometry(3, 4, 12)
    const three = new THREE.ConeGeometry(3, 4, 12)
    expectExact(mine.positions, three.attributes.position.array as Float32Array)
    expectExact(mine.indices, three.index!.array as Uint32Array)
  })

  it('sphereGeometry', () => {
    for (const [r, ws, hs] of [
      [5, 12, 8],
      [2, 16, 10],
    ] as const) {
      const mine = sphereGeometry(r, ws, hs)
      const three = new THREE.SphereGeometry(r, ws, hs)
      expectExact(mine.positions, three.attributes.position.array as Float32Array)
      expectExact(mine.indices, three.index!.array as Uint32Array)
    }
  })
})