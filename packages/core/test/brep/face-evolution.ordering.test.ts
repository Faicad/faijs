/**
 * 钉住 `identityHashEvolution` 依赖的**假设**（Phase 0.3）：
 * **OCCT 在变换 / 非等比缩放 / 深拷贝后保持面枚举序号。**
 *
 * ⚠️ 为什么必须有这个文件：
 * `identityHashEvolution`（`face-evolution.ts`）的做法是"两端 `subShapeHashes`
 * 按枚举序号逐位对齐，取 `min(长度)`"。这在 Phase 0.3 之前是**无验证的工程直觉**——
 * OCCT 从不承诺面序稳定。它的正确性直接决定 4 个 op 的身份映射对不对：
 *
 * | op | 内核路径 | 本文件对应用例 |
 * |---|---|---|
 * | `rotate_euler` | `kernel.transform(3x4 矩阵)` | `transform` 保持面序 |
 * | `place` | `kernel.transform(3x4 矩阵)` | 同上 |
 * | `scale3d`（非等比） | `kernel.generalTransform` | `generalTransform` 保持面序 |
 * | `copy` | `kernel.copy` | `copy` 保持面序 |
 *
 * 判据不是"面数相同"（太弱，对称体也能骗过），而是**逐面比对中心点**：
 * 输出第 i 面的中心必须 ≈ 输入第 i 面中心经同一矩阵变换后的位置。
 * box(10,20,30) 的 6 个面中心互不相同，面序一旦漂移必然被抓到。
 *
 * 若本文件变红 ⇒ `identityHashEvolution` 在这 4 个 op 上产出**错误的身份映射**，
 * 必须为它们找权威来源（而不是调松断言）。
 */
import * as THREE from 'three'
import { describe, it, expect, beforeAll } from 'vitest'
import { initOcctWasm, getKernel } from '../../src/occt-kernel/occtKernel'
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import { matrixToArray } from '../../src/brep/brep-ops'
import type { BrepHandle, BrepVec3 } from '../../src/brep/engine/types'

let kernel: OcctKernel

beforeAll(async () => {
  await initOcctWasm()
  kernel = getKernel()
}, 120000)

interface FaceSignature {
  centers: BrepVec3[]
  areas: number[]
}

/**
 * 按**枚举序号**取全部面的中心点与面积。
 * @param shape - the shape to probe.
 * @returns per-face centers and areas, in enum order.
 */
function faceSignature(shape: BrepHandle): FaceSignature {
  const faces = kernel.getSubShapes(shape as unknown as ShapeHandle, 'face')
  const centers = faces.map((f) => kernel.getSurfaceCenterOfMass(f))
  // queryBatch 已随 Phase 4 收窄移出 BrepEngineApi；面积改走 L1 测量面 getSurfaceArea。
  const areas = faces.map((f) => kernel.getSurfaceArea(f))
  for (const f of faces) kernel.release(f)
  return { centers, areas }
}

/**
 * 把 BREP 面中心点过一遍 THREE 矩阵。
 * @param m - the transform matrix.
 * @param v - the point.
 * @returns the transformed point.
 */
function applyMatrix(m: THREE.Matrix4, v: BrepVec3): BrepVec3 {
  const p = new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(m)
  return { x: p.x, y: p.y, z: p.z }
}

/** box(10,20,30)：6 个面中心互不相同，面序漂移必然可见。 */
function makeProbeBox(): BrepHandle {
  return kernel.makeBox(10, 20, 30) as unknown as BrepHandle
}

describe('Phase 0.3: identityHashEvolution 的面序假设（内核实测）', () => {
  it('kernel.transform（rotate_euler / place 的路径）保持面枚举序号', () => {
    const box = makeProbeBox()
    const before = faceSignature(box)

    const m = new THREE.Matrix4().makeRotationZ(Math.PI / 2)
    const out = kernel.transform(box as unknown as ShapeHandle, matrixToArray(m))
    const after = faceSignature(out as unknown as BrepHandle)

    expect(before.centers).toHaveLength(6)
    expect(after.centers).toHaveLength(before.centers.length)
    for (let i = 0; i < before.centers.length; i++) {
      const expected = applyMatrix(m, before.centers[i])
      expect(after.centers[i].x, `face #${i} center.x`).toBeCloseTo(expected.x, 6)
      expect(after.centers[i].y, `face #${i} center.y`).toBeCloseTo(expected.y, 6)
      expect(after.centers[i].z, `face #${i} center.z`).toBeCloseTo(expected.z, 6)
      // 旋转不改面积 ⇒ 第 i 面面积应逐位相等
      expect(after.areas[i], `face #${i} area`).toBeCloseTo(before.areas[i], 6)
    }
  })

  it('kernel.generalTransform（scale3d 非等比的路径）保持面枚举序号', () => {
    const box = makeProbeBox()
    const before = faceSignature(box)

    const m = new THREE.Matrix4().makeScale(2, 1, 3)
    const out = kernel.generalTransform(box as unknown as ShapeHandle, matrixToArray(m))
    const after = faceSignature(out as unknown as BrepHandle)

    expect(after.centers).toHaveLength(before.centers.length)
    // 非等比缩放改变面积（且各面倍率不同）⇒ 只比中心点
    for (let i = 0; i < before.centers.length; i++) {
      const expected = applyMatrix(m, before.centers[i])
      expect(after.centers[i].x, `face #${i} center.x`).toBeCloseTo(expected.x, 6)
      expect(after.centers[i].y, `face #${i} center.y`).toBeCloseTo(expected.y, 6)
      expect(after.centers[i].z, `face #${i} center.z`).toBeCloseTo(expected.z, 6)
    }
  })

  it('kernel.copy（copy 的路径）保持面枚举序号', () => {
    const box = makeProbeBox()
    const before = faceSignature(box)

    const out = kernel.copy(box as unknown as ShapeHandle)
    const after = faceSignature(out as unknown as BrepHandle)

    expect(after.centers).toHaveLength(before.centers.length)
    for (let i = 0; i < before.centers.length; i++) {
      // 深拷贝几何不变 ⇒ 中心点与面积逐位相同
      expect(after.centers[i].x, `face #${i} center.x`).toBeCloseTo(before.centers[i].x, 6)
      expect(after.centers[i].y, `face #${i} center.y`).toBeCloseTo(before.centers[i].y, 6)
      expect(after.centers[i].z, `face #${i} center.z`).toBeCloseTo(before.centers[i].z, 6)
      expect(after.areas[i], `face #${i} area`).toBeCloseTo(before.areas[i], 6)
    }
  })
})
