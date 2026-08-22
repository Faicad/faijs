/**
 * @vitest-environment node
 *
 * solveFaceMate 单元测试 — 装配约束求解器的数学正确性
 *
 * 验证不变量（所有用例必须满足）：
 * 1. 变换后 movingFace.center == fixedFace.center（面中心重合）
 * 2. 变换后 movingFace.normal == -fixedFace.normal（法线反向平行，面贴合）
 *
 * 这些是装配的几何定义。如果不变量不成立，装配就是错的。
 *
 * Run: npx vitest run src/ops/assemble-solve.test.ts
 */

import { describe, it, expect } from 'vitest'
import { solveFaceMate, applyTransform } from './assemble'
import type { Shape } from './types'

// ── 向量工具 ──

function vec3Sub(a: number[], b: number[]): number[] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function vec3Len(v: number[]): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
}

function vec3Normalize(v: number[]): number[] {
  const len = vec3Len(v)
  if (len < 1e-12) return [0, 0, 0]
  return [v[0] / len, v[1] / len, v[2] / len]
}

function vec3Dist(a: number[], b: number[]): number {
  return vec3Len(vec3Sub(a, b))
}

function vec3Dot(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

// ── 核心：验证 solveFaceMate 的变换结果 ──

/**
 * 给定 fixedFace 和 movingFace 的 center/normal，
 * 用 solveFaceMate 计算变换，然后验证：
 * 1. 变换后的 movingCenter == fixedCenter
 * 2. 变换后的 movingNormal == -fixedNormal
 */
function verifyFaceMate(
  fixedCenter: [number, number, number],
  fixedNormal: [number, number, number],
  movingCenter: [number, number, number],
  movingNormal: [number, number, number],
) {
  const { quaternion, pivot, translation, rotationMatrix } = solveFaceMate(
    fixedCenter, fixedNormal, movingCenter, movingNormal,
  )

  // 1. 变换后的 movingCenter 应该等于 fixedCenter
  //    p' = R * (movingCenter - pivot) + pivot + translation
  //    pivot == movingCenter, 所以 R * 0 + movingCenter + (fixedCenter - movingCenter) = fixedCenter
  const d = vec3Sub(movingCenter, pivot)
  const rd: number[] = [
    rotationMatrix[0] * d[0] + rotationMatrix[1] * d[1] + rotationMatrix[2] * d[2],
    rotationMatrix[3] * d[0] + rotationMatrix[4] * d[1] + rotationMatrix[5] * d[2],
    rotationMatrix[6] * d[0] + rotationMatrix[7] * d[1] + rotationMatrix[8] * d[2],
  ]
  const transformedCenter: number[] = [
    rd[0] + pivot[0] + translation[0],
    rd[1] + pivot[1] + translation[1],
    rd[2] + pivot[2] + translation[2],
  ]
  const centerDist = vec3Dist(transformedCenter, fixedCenter)

  // 2. 变换后的 movingNormal 应该等于 -fixedNormal
  //    n' = R * movingNormal
  const n2 = vec3Normalize(movingNormal)
  const n1 = vec3Normalize(fixedNormal)
  const transformedNormal: number[] = [
    rotationMatrix[0] * n2[0] + rotationMatrix[1] * n2[1] + rotationMatrix[2] * n2[2],
    rotationMatrix[3] * n2[0] + rotationMatrix[4] * n2[1] + rotationMatrix[5] * n2[2],
    rotationMatrix[6] * n2[0] + rotationMatrix[7] * n2[1] + rotationMatrix[8] * n2[2],
  ]
  const targetNormal = [-n1[0], -n1[1], -n1[2]]
  const normalDist = vec3Dist(transformedNormal, targetNormal)

  // 3. 也用 applyTransform 对一个虚拟 mesh 验证（mesh 路径）
  //    创建一个只有一个顶点（movingCenter）的虚拟 shape
  const fakeShape: Shape = {
    positions: new Float32Array(movingCenter),
    indices: new Uint32Array([0]),
  }
  const transformedShape = applyTransform(fakeShape, quaternion, pivot, translation, rotationMatrix)
  const meshCenter: number[] = [
    transformedShape.positions[0],
    transformedShape.positions[1],
    transformedShape.positions[2],
  ]
  const meshCenterDist = vec3Dist(meshCenter, fixedCenter)

  return { centerDist, normalDist, meshCenterDist, transformedCenter, transformedNormal, targetNormal }
}

// ── 测试用例 ──

describe('solveFaceMate: face coincidence invariants', () => {
  it('case 1: two top faces (same normal +Z), centers offset in XY', () => {
    // fixed: top face of a box at origin, center [0,0,10], normal [0,0,1]
    // moving: top face of another box, center [50,30,10], normal [0,0,1]
    const result = verifyFaceMate(
      [0, 0, 10], [0, 0, 1],
      [50, 30, 10], [0, 0, 1],
    )
    expect(result.centerDist).toBeLessThan(1e-6)
    expect(result.normalDist).toBeLessThan(1e-6)
    expect(result.meshCenterDist).toBeLessThan(1e-6)
  })

  it('case 2: fixed top face (+Z), moving bottom face (-Z)', () => {
    // This is the natural assembly case: two faces already pointing at each other
    // fixed: center [0,0,10], normal [0,0,1] (top face pointing up)
    // moving: center [50,30,5], normal [0,0,-1] (bottom face pointing down)
    const result = verifyFaceMate(
      [0, 0, 10], [0, 0, 1],
      [50, 30, 5], [0, 0, -1],
    )
    expect(result.centerDist).toBeLessThan(1e-6)
    expect(result.normalDist).toBeLessThan(1e-6)
    expect(result.meshCenterDist).toBeLessThan(1e-6)
  })

  it('case 3: faces with different normals (not axis-aligned)', () => {
    // fixed: center [10,20,30], normal [1,1,1]/sqrt(3)
    // moving: center [100,200,300], normal [1,0,0]
    const result = verifyFaceMate(
      [10, 20, 30], [1, 1, 1],
      [100, 200, 300], [1, 0, 0],
    )
    expect(result.centerDist).toBeLessThan(1e-6)
    expect(result.normalDist).toBeLessThan(1e-6)
    expect(result.meshCenterDist).toBeLessThan(1e-6)
  })

  it('case 4: moving face already in place (center == fixed center, normal == -fixed normal)', () => {
    // Already assembled — transform should be identity
    const result = verifyFaceMate(
      [5, 10, 15], [0, 0, 1],
      [5, 10, 15], [0, 0, -1],
    )
    expect(result.centerDist).toBeLessThan(1e-6)
    expect(result.normalDist).toBeLessThan(1e-6)
    expect(result.meshCenterDist).toBeLessThan(1e-6)
  })

  it('case 5: moving face same as fixed face (same center, same normal — degenerate)', () => {
    // Same face — needs 180° rotation
    const result = verifyFaceMate(
      [5, 10, 15], [0, 1, 0],
      [5, 10, 15], [0, 1, 0],
    )
    expect(result.centerDist).toBeLessThan(1e-6)
    expect(result.normalDist).toBeLessThan(1e-6)
    expect(result.meshCenterDist).toBeLessThan(1e-6)
  })

  it('case 6: large offset (1000mm in all axes)', () => {
    const result = verifyFaceMate(
      [0, 0, 0], [0, 0, 1],
      [1000, 2000, 3000], [0, 0, 1],
    )
    expect(result.centerDist).toBeLessThan(1e-6)
    expect(result.normalDist).toBeLessThan(1e-6)
    expect(result.meshCenterDist).toBeLessThan(1e-6)
  })

  it('case 7: normals with arbitrary directions', () => {
    const result = verifyFaceMate(
      [100, 50, 25], [0.3, -0.8, 0.5],
      [-200, 300, -100], [-0.6, 0.2, 0.7],
    )
    expect(result.centerDist).toBeLessThan(1e-6)
    expect(result.normalDist).toBeLessThan(1e-6)
    expect(result.meshCenterDist).toBeLessThan(1e-6)
  })

  it('case 8: face normals already anti-parallel but centers far apart', () => {
    // fixed normal +Z, moving normal -Z, centers 500mm apart
    const result = verifyFaceMate(
      [0, 0, 100], [0, 0, 1],
      [500, 0, -400], [0, 0, -1],
    )
    expect(result.centerDist).toBeLessThan(1e-6)
    expect(result.normalDist).toBeLessThan(1e-6)
    expect(result.meshCenterDist).toBeLessThan(1e-6)
  })
})
