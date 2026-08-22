/**
 * @vitest-environment node
 *
 * STEP 装配导出端到端测试 — Bug 1 & Bug 2 复现
 *
 * 场景：创建圆柱体 + 方块，用 applyTransformBrep 变换方块（模拟装配），
 * 导出 STEP，再导入 STEP 验证：
 * - Bug 1: 变换后的 solid 位置是否正确（不是默认位置）
 * - Bug 2: 两个 part 是否保持独立（不合并为一个），颜色是否保留
 *
 * Run: npx vitest run src/brep/export/step-assembly-export.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { initOcctWasm, getKernel, disposeOcctWasm, importAssemblyFromStep, releaseAssemblyTree } from '../../occt-kernel/occtKernel'
import type { AssemblyPartNode } from '../../occt-kernel/occtKernel'
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import { exportStepFromSolids } from './step'
import { applyTransformBrep } from '../brep-ops'
import { getSolidBoundingBox } from '../brep-utils'

let kernel: OcctKernel

beforeAll(async () => {
  await initOcctWasm()
  kernel = getKernel()
}, 120000)

afterAll(() => {
  disposeOcctWasm()
})

// ── helpers ──

function collectLeaves(nodes: AssemblyPartNode[]): { name: string; color: [number, number, number] | null; shapeHandle?: ShapeHandle }[] {
  const out: { name: string; color: [number, number, number] | null; shapeHandle?: ShapeHandle }[] = []
  for (const node of nodes) {
    if (node.isAssembly) {
      out.push(...collectLeaves(node.children))
    } else {
      out.push({ name: node.name, color: node.color, shapeHandle: node.shapeHandle })
    }
  }
  return out
}

function bboxCenter(bbox: { min: number[]; max: number[] }): [number, number, number] {
  return [
    (bbox.min[0] + bbox.max[0]) / 2,
    (bbox.min[1] + bbox.max[1]) / 2,
    (bbox.min[2] + bbox.max[2]) / 2,
  ]
}

// ── tests ──

describe('STEP assembly export: position and multi-part preservation', () => {
  it('Bug 1: transformed solid exports at assembled position (not default)', async () => {
    // 1. 创建圆柱体（半径 10，高 20，中心在原点）
    const cylinder = kernel.makeCylinder(10, 20, { x: 0, y: 0, z: -10 })
    // 2. 创建方块（大小 20，中心在 [10, 0, 0]）
    const boxOriginal = kernel.makeBoxFromCorners(
      { x: 0, y: -10, z: -10 },
      { x: 20, y: 10, z: 10 },
    )

    // 3. 获取原始方块的 bbox（变换前）
    const bboxBefore = getSolidBoundingBox(kernel, boxOriginal)
    const centerBefore = bboxCenter(bboxBefore)
    // centerBefore should be [10, 0, 0]

    // 4. 模拟装配变换：把方块从 [10,0,0] 移动到 [0,0,20]
    //    使用 identity rotation + translation [−10, 0, 20]
    const quaternion: [number, number, number, number] = [0, 0, 0, 1] // identity rotation
    const pivot: [number, number, number] = [0, 0, 0]
    const translation: [number, number, number] = [-10, 0, 20]
    const boxTransformed = applyTransformBrep(kernel, boxOriginal, quaternion, pivot, translation)

    // 5. 验证变换后的 bbox
    const bboxAfter = getSolidBoundingBox(kernel, boxTransformed)
    const centerAfter = bboxCenter(bboxAfter)
    // centerAfter should be [0, 0, 20]

    // 6. 导出 STEP（使用变换后的 solid）
    const buffer = exportStepFromSolids(kernel, [
      { solid: cylinder, name: 'part0_v0', color: [0.2, 0.8, 0.2] },
      { solid: boxTransformed, name: 'part1_v0', color: [0.8, 0.2, 0.2] },
    ])

    // 释放导出测试中创建的句柄
    kernel.release(cylinder)
    kernel.release(boxOriginal)
    kernel.release(boxTransformed)

    // 7. 导入 STEP，验证位置
    const nodes = await importAssemblyFromStep(buffer)
    try {
      const leaves = collectLeaves(nodes)
      // Bug 2: 应该有两个独立的 part
      expect(leaves.length).toBe(2)

      const partNames = leaves.map(l => l.name).sort()
      expect(partNames).toEqual(['part0_v0', 'part1_v0'])

      // Bug 1: 验证变换后的 part1_v0 位置不是 [10, 0, 0]
      const part1Leaf = leaves.find(l => l.name === 'part1_v0')
      expect(part1Leaf).toBeDefined()
      expect(part1Leaf!.shapeHandle).toBeDefined()

      if (part1Leaf!.shapeHandle) {
        const importedBbox = getSolidBoundingBox(kernel, part1Leaf!.shapeHandle)
        const importedCenter = bboxCenter(importedBbox)
        // The box should NOT be at [10, 0, 0] (default position)
        // It should be at approximately [0, 0, 20] (assembled position)
        expect(Math.abs(importedCenter[0] - 10)).toBeGreaterThan(1)
        expect(Math.abs(importedCenter[2] - 0)).toBeGreaterThan(1)
      }
    } finally {
      releaseAssemblyTree(kernel, nodes)
    }
  })

  it('Bug 2: two parts remain independent with colors preserved', async () => {
    // 创建两个不同颜色的 solid
    const cylinder = kernel.makeCylinder(10, 20, { x: 0, y: 0, z: -10 })
    const box = kernel.makeBoxFromCorners(
      { x: 0, y: -10, z: -10 },
      { x: 20, y: 10, z: 10 },
    )

    const colorCylinder: [number, number, number] = [0.2, 0.8, 0.2] // green
    const colorBox: [number, number, number] = [0.8, 0.2, 0.2] // red

    const buffer = exportStepFromSolids(kernel, [
      { solid: cylinder, name: 'cylinder_part', color: colorCylinder },
      { solid: box, name: 'box_part', color: colorBox },
    ])

    kernel.release(cylinder)
    kernel.release(box)

    const nodes = await importAssemblyFromStep(buffer)
    try {
      const leaves = collectLeaves(nodes)

      // Bug 2: 必须是两个独立 part
      expect(leaves.length).toBe(2)

      // 颜色保留
      const cyl = leaves.find(l => l.name === 'cylinder_part')
      const bx = leaves.find(l => l.name === 'box_part')
      expect(cyl).toBeDefined()
      expect(bx).toBeDefined()

      expect(cyl!.color).not.toBeNull()
      expect(cyl!.color![0]).toBeCloseTo(colorCylinder[0], 1)
      expect(cyl!.color![1]).toBeCloseTo(colorCylinder[1], 1)
      expect(cyl!.color![2]).toBeCloseTo(colorCylinder[2], 1)

      expect(bx!.color).not.toBeNull()
      expect(bx!.color![0]).toBeCloseTo(colorBox[0], 1)
      expect(bx!.color![1]).toBeCloseTo(colorBox[1], 1)
      expect(bx!.color![2]).toBeCloseTo(colorBox[2], 1)
    } finally {
      releaseAssemblyTree(kernel, nodes)
    }
  })

  it('Bug 1 full flow: large translation is preserved through export/import', async () => {
    // Test with a very large, clear translation to make any position bug obvious
    const cylinder = kernel.makeCylinder(10, 20, { x: 0, y: 0, z: -10 })
    const box = kernel.makeBoxFromCorners(
      { x: 0, y: -10, z: -10 },
      { x: 20, y: 10, z: 10 },
    )

    // Apply a clear translation
    const boxTransformed = applyTransformBrep(
      kernel, box,
      [0, 0, 0, 1], // identity quaternion
      [0, 0, 0], // no pivot
      [100, 50, 30], // move to [100, 50, 30]
    )

    // Verify the transformed solid's bbox center
    const bboxTrans = getSolidBoundingBox(kernel, boxTransformed)
    const centerTrans = bboxCenter(bboxTrans)
    expect(centerTrans[0]).toBeCloseTo(110, 0) // 10 + 100 = 110
    expect(centerTrans[1]).toBeCloseTo(50, 0)
    expect(centerTrans[2]).toBeCloseTo(30, 0)

    // Export with the transformed solid (using same kernel)
    const buffer = exportStepFromSolids(kernel, [
      { solid: cylinder, name: 'cyl', color: [0.2, 0.8, 0.2] },
      { solid: boxTransformed, name: 'box_moved', color: [0.8, 0.2, 0.2] },
    ])

    kernel.release(cylinder)
    kernel.release(box)
    kernel.release(boxTransformed)

    // Import and verify
    const nodes = await importAssemblyFromStep(buffer)
    try {
      const leaves = collectLeaves(nodes)
      expect(leaves.length).toBe(2)

      const movedLeaf = leaves.find(l => l.name === 'box_moved')
      expect(movedLeaf).toBeDefined()
      expect(movedLeaf!.shapeHandle).toBeDefined()

      if (movedLeaf!.shapeHandle) {
        const importedBbox = getSolidBoundingBox(kernel, movedLeaf!.shapeHandle)
        const importedCenter = bboxCenter(importedBbox)
        // The box should be at [110, 50, 30], not at [10, 0, 0]
        expect(importedCenter[0]).toBeCloseTo(110, 0)
        expect(importedCenter[1]).toBeCloseTo(50, 0)
        expect(importedCenter[2]).toBeCloseTo(30, 0)
      }
    } finally {
      releaseAssemblyTree(kernel, nodes)
    }
  })
})
