/**
 * @vitest-environment node
 *
 * solveFaceMate + applyTransformBrep 集成测试
 *
 * 使用用户提供的真实 faijs 文件数据：
 *   const part0_v0 = cad.cylinder({ radius:10, height:20, center:[0,0,0] })
 *   const part1_v0 = cad.box({ size:20, center:[10,0,0] })
 *   constraints: face_mate, fixedFace center=[-0.106133,0.04153,10] normal=[0,0,1]
 *                          movingFace center=[10,0,10] normal=[0,0,1]
 *
 * 验证不变量：
 * 1. 变换后 movingFace.center == fixedFace.center（面中心重合）
 * 2. 变换后 movingFace.normal == -fixedFace.normal（法线反向平行）
 * 3. 变换后 BREP solid 的 bbox 反映了面重合
 *
 * Run: npx vitest run src/ops/assemble-real-data.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { initOcctWasm, getKernel, disposeOcctWasm } from '../occt-kernel/occtKernel'
import type { OcctKernel } from 'occt-wasm'
import { solveFaceMate, applyTransform } from './assemble'
import { applyTransformBrep } from '../brep/brep-ops'
import { getSolidBoundingBox } from '../brep/brep-utils'

let kernel: OcctKernel

beforeAll(async () => {
  await initOcctWasm()
  kernel = getKernel()
}, 120000)

afterAll(() => {
  disposeOcctWasm()
})

// ── 向量工具 ──

function vec3Sub(a: number[], b: number[]): number[] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
function vec3Len(v: number[]): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
}
function vec3Dist(a: number[], b: number[]): number {
  return vec3Len(vec3Sub(a, b))
}
function vec3Normalize(v: number[]): number[] {
  const len = vec3Len(v)
  if (len < 1e-12) return [0, 0, 0]
  return [v[0] / len, v[1] / len, v[2] / len]
}

// ── 真实数据（来自用户的 faijs 文件 Cylinder (10).faijs） ──

const FIXED_CENTER: [number, number, number] = [-0.106133, 0.04153, 10]
const FIXED_NORMAL: [number, number, number] = [0, 0, 1]
const MOVING_CENTER: [number, number, number] = [10, 0, 10]
const MOVING_NORMAL: [number, number, number] = [0, 0, 1]

// ── 测试 ──

describe('solveFaceMate: real data from user faijs file', () => {
  it('invariant 1: transformed movingFace.center == fixedFace.center', () => {
    const { pivot, translation, rotationMatrix } = solveFaceMate(
      FIXED_CENTER, FIXED_NORMAL,
      MOVING_CENTER, MOVING_NORMAL,
    )

    // p' = R * (movingCenter - pivot) + pivot + translation
    // pivot == movingCenter, so R * 0 + movingCenter + (fixedCenter - movingCenter) = fixedCenter
    const d = vec3Sub(MOVING_CENTER, pivot)
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

    // 面中心必须重合
    expect(vec3Dist(transformedCenter, FIXED_CENTER)).toBeLessThan(1e-6)
  })

  it('invariant 2: transformed movingFace.normal == -fixedFace.normal', () => {
    const { rotationMatrix } = solveFaceMate(
      FIXED_CENTER, FIXED_NORMAL,
      MOVING_CENTER, MOVING_NORMAL,
    )

    // n' = R * movingNormal
    const n2 = vec3Normalize(MOVING_NORMAL)
    const transformedNormal: number[] = [
      rotationMatrix[0] * n2[0] + rotationMatrix[1] * n2[1] + rotationMatrix[2] * n2[2],
      rotationMatrix[3] * n2[0] + rotationMatrix[4] * n2[1] + rotationMatrix[5] * n2[2],
      rotationMatrix[6] * n2[0] + rotationMatrix[7] * n2[1] + rotationMatrix[8] * n2[2],
    ]
    const targetNormal = [-FIXED_NORMAL[0], -FIXED_NORMAL[1], -FIXED_NORMAL[2]]

    // 法线必须反向平行
    expect(vec3Dist(transformedNormal, targetNormal)).toBeLessThan(1e-6)
  })

  it('invariant: both center and normal hold simultaneously', () => {
    const { pivot, translation, rotationMatrix } = solveFaceMate(
      FIXED_CENTER, FIXED_NORMAL,
      MOVING_CENTER, MOVING_NORMAL,
    )

    // center
    const d = vec3Sub(MOVING_CENTER, pivot)
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

    // normal
    const n2 = vec3Normalize(MOVING_NORMAL)
    const transformedNormal: number[] = [
      rotationMatrix[0] * n2[0] + rotationMatrix[1] * n2[1] + rotationMatrix[2] * n2[2],
      rotationMatrix[3] * n2[0] + rotationMatrix[4] * n2[1] + rotationMatrix[5] * n2[2],
      rotationMatrix[6] * n2[0] + rotationMatrix[7] * n2[1] + rotationMatrix[8] * n2[2],
    ]
    const targetNormal = [-FIXED_NORMAL[0], -FIXED_NORMAL[1], -FIXED_NORMAL[2]]

    expect(vec3Dist(transformedCenter, FIXED_CENTER)).toBeLessThan(1e-6)
    expect(vec3Dist(transformedNormal, targetNormal)).toBeLessThan(1e-6)
  })
})

describe('solveFaceMate + applyTransformBrep: BREP solid with real data', () => {
  it('cylinder + box from faijs: box solid moves so face coincides', () => {
    // 1. 创建 cylinder: radius=10, height=20, center=[0,0,0]
    const cylinder = kernel.makeCylinder(10, 20)

    // 2. 创建 box: size=20, center=[10,0,0]
    //    box 角点: [10-10, 0-10, 0-10] = [0, -10, -10] 到 [10+10, 0+10, 0+10] = [20, 10, 10]
    const box = kernel.makeBoxFromCorners(
      { x: 0, y: -10, z: -10 },
      { x: 20, y: 10, z: 10 },
    )

    // 3. 使用真实约束数据
    const { quaternion, pivot, translation } = solveFaceMate(
      FIXED_CENTER, FIXED_NORMAL,
      MOVING_CENTER, MOVING_NORMAL,
    )

    // 4. 对 BREP solid 施加变换
    const boxTransformed = applyTransformBrep(kernel, box, quaternion, pivot, translation)

    // 5. 验证变换后 box 的 bbox
    const bboxBefore = getSolidBoundingBox(kernel, box)
    const bboxAfter = getSolidBoundingBox(kernel, boxTransformed)

    const centerBefore = [
      (bboxBefore.min[0] + bboxBefore.max[0]) / 2,
      (bboxBefore.min[1] + bboxBefore.max[1]) / 2,
      (bboxBefore.min[2] + bboxBefore.max[2]) / 2,
    ]
    const centerAfter = [
      (bboxAfter.min[0] + bboxAfter.max[0]) / 2,
      (bboxAfter.min[1] + bboxAfter.max[1]) / 2,
      (bboxAfter.min[2] + bboxAfter.max[2]) / 2,
    ]

    // 6. 验证面重合不变量
    //    变换前 box 中心 = [10, 0, 0]
    expect(centerBefore[0]).toBeCloseTo(10, 4)
    expect(centerBefore[1]).toBeCloseTo(0, 4)
    expect(centerBefore[2]).toBeCloseTo(0, 4)

    //    变换后 box 底面 z 应 = fixedFace z = 10
    //    由于两个法线都是 [0,0,1]（同向），需要 180° 翻转
    //    翻转后 box 的顶面变成底面
    //    box 原来顶面 z = 10，翻转后变成底面 z = 10（如果翻转中心在 z=10）
    //    但变换是绕 movingFace.center = [10,0,10] 旋转 180°
    //    旋转后 box 的顶面（原来 z=10）变为底面（z=10），底面（原来 z=-10）变为顶面（z=30）
    //    所以变换后 bbox.min.z 应该 ≈ 10（与 fixedFace z 一致）
    expect(bboxAfter.min[2]).toBeCloseTo(10, 1)

    //    box 中心 z 应 = 10 + 10 = 20（底面在 z=10，中心偏移 10）
    //    但旋转 180° 后，原来中心 [10,0,0] 绕 [10,0,10] 旋转 → [10,0,20]
    expect(centerAfter[0]).toBeCloseTo(-0.106133, 1) // x 跟随 fixedFace center x
    expect(centerAfter[2]).toBeCloseTo(20, 1) // z = 20

    kernel.release(cylinder)
    kernel.release(box)
    kernel.release(boxTransformed)
  })

  it('mesh path: applyTransform also produces face coincidence', () => {
    // 验证 mesh 路径的变换也满足不变量
    // 用一个虚拟 mesh（只有 movingCenter 一个顶点）
    const fakeShape = {
      positions: new Float32Array(MOVING_CENTER),
      indices: new Uint32Array([0]),
    }
    const { quaternion, pivot, translation, rotationMatrix } = solveFaceMate(
      FIXED_CENTER, FIXED_NORMAL,
      MOVING_CENTER, MOVING_NORMAL,
    )
    const transformed = applyTransform(fakeShape, quaternion, pivot, translation, rotationMatrix)
    const meshPoint: number[] = [
      transformed.positions[0],
      transformed.positions[1],
      transformed.positions[2],
    ]
    // mesh 顶点（原 movingCenter）变换后应该 = fixedCenter
    expect(vec3Dist(meshPoint, FIXED_CENTER)).toBeLessThan(1e-6)
  })
})
