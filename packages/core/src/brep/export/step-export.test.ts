/**
 * @vitest-environment node
 *
 * exportStepFromSolids — 多实体 STEP 导出（零 fuse）单元测试。
 *
 * 验证：
 * - 多实体各自成为 STEP 中独立实体（MANIFOLD_SOLID_BREP ≥ 2），互不 fuse
 * - 导出 → importAssemblyFromStep 回读：part 数与名称一一对应（身份闭环）
 * - Compound 展平命名（`name [n]`）与导入侧拆分一致
 * - mesh 零件经 reconstructSolidFromMesh 重建后导出（ADVANCED_FACE）
 * - 颜色保留、空 entries 抛错、导出后原 solid 句柄仍有效
 *
 * Run: npx vitest run src/brep/export/step-export.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { initOcctWasm, getKernel, disposeOcctWasm } from '../../occt-kernel/occtKernel'
import { importAssemblyFromStep, releaseAssemblyTree } from '../../occt-kernel/occtKernel'
import type { AssemblyPartNode } from '../../occt-kernel/occtKernel'
import type { BrepHandle } from '../engine/types'
import type { BrepEngineApi } from '../engine/primitives'
import { exportStepFromSolids } from './step'

let kernel: BrepEngineApi

beforeAll(async () => {
  await initOcctWasm()
  kernel = getKernel() as unknown as BrepEngineApi
}, 120000)

afterAll(() => {
  disposeOcctWasm()
})

// ─── helpers ───

function makeBox(x: number, y: number, z: number, w = 10, h = 10, d = 10): BrepHandle {
  return kernel.makeBoxFromCorners(
    { x, y, z },
    { x: x + w, y: y + h, z: z + d },
  )
}

/** 收集装配树所有叶节点的 (name, color)。 */
function collectLeaves(nodes: AssemblyPartNode[]): { name: string; color: [number, number, number] | null }[] {
  const out: { name: string; color: [number, number, number] | null }[] = []
  for (const node of nodes) {
    if (node.isAssembly) {
      out.push(...collectLeaves(node.children))
    } else {
      out.push({ name: node.name, color: node.color })
    }
  }
  return out
}

/** 简易立方体三角网格（8 顶点 12 三角形，闭合流形）。 */
function unitCubeMesh(): { positions: Float32Array; indices: Uint32Array } {
  const v = [
    -5, -5, -5,   5, -5, -5,   5, 5, -5,  -5, 5, -5,
    -5, -5,  5,   5, -5,  5,   5, 5,  5,  -5, 5,  5,
  ]
  const f = [
    0, 2, 1,  0, 3, 2,
    4, 5, 6,  4, 6, 7,
    0, 1, 5,  0, 5, 4,
    2, 3, 7,  2, 7, 6,
    1, 2, 6,  1, 6, 5,
    3, 0, 4,  3, 4, 7,
  ]
  return {
    positions: new Float32Array(v),
    indices: new Uint32Array(f),
  }
}

function decodeStep(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(new Uint8Array(buffer))
}

// ─── tests ───

describe('exportStepFromSolids', () => {
  it('multi-solid export: independent entities, no fuse', async () => {
    const boxA = makeBox(0, 0, 0)
    const boxB = makeBox(20, 0, 0)
    try {
      const buffer = exportStepFromSolids(kernel, [
        { solid: boxA, name: 'part-a' },
        { solid: boxB, name: 'part-b' },
      ])
      const text = decodeStep(buffer)

      // 独立实体：≥2 个 MANIFOLD_SOLID_BREP（若 fuse 只会剩 1 个）
      const solidCount = (text.match(/MANIFOLD_SOLID_BREP/g) ?? []).length
      expect(solidCount).toBeGreaterThanOrEqual(2)

      // 精确几何（ADVANCED_FACE），非三角化（POLYGONAL_FACE）
      expect(text).toContain('ADVANCED_FACE')
      expect(text).not.toContain('POLYGONAL_FACE')

      // 回读：两个 part，名称保留（身份闭环）
      const nodes = await importAssemblyFromStep(buffer)
      try {
        const leaves = collectLeaves(nodes)
        const names = leaves.map(l => l.name).sort()
        expect(names).toEqual(['part-a', 'part-b'])
      } finally {
        releaseAssemblyTree(kernel, nodes)
      }
    } finally {
      kernel.release(boxA)
      kernel.release(boxB)
    }
  })

  it('single solid: one entity, round-trips to one part', async () => {
    const box = makeBox(0, 0, 0)
    try {
      const buffer = exportStepFromSolids(kernel, [{ solid: box, name: 'solo' }])
      const text = decodeStep(buffer)
      expect(text).toContain('ADVANCED_FACE')
      expect(text).not.toContain('POLYGONAL_FACE')

      const nodes = await importAssemblyFromStep(buffer)
      try {
        const leaves = collectLeaves(nodes)
        expect(leaves).toHaveLength(1)
        expect(leaves[0].name).toBe('solo')
      } finally {
        releaseAssemblyTree(kernel, nodes)
      }
    } finally {
      kernel.release(box)
    }
  })

  it('compound entry: flattened into separate parts named `name [n]`', async () => {
    const boxA = makeBox(0, 0, 0)
    const boxB = makeBox(20, 0, 0)
    const compound = kernel.makeCompound([boxA, boxB])
    try {
      const buffer = exportStepFromSolids(kernel, [{ solid: compound, name: 'assy' }])
      const text = decodeStep(buffer)
      const solidCount = (text.match(/MANIFOLD_SOLID_BREP/g) ?? []).length
      expect(solidCount).toBe(2)

      const nodes = await importAssemblyFromStep(buffer)
      try {
        const leaves = collectLeaves(nodes)
        const names = leaves.map(l => l.name).sort()
        // 与导入侧 walkLabel 拆分命名一致：`name [1]` / `name [2]`
        expect(names).toEqual(['assy [1]', 'assy [2]'])
      } finally {
        releaseAssemblyTree(kernel, nodes)
      }
    } finally {
      kernel.release(compound)
      kernel.release(boxA)
      kernel.release(boxB)
    }
  })

  it('mesh entry: reconstructed solid exported as ADVANCED_FACE', async () => {
    const buffer = exportStepFromSolids(kernel, [
      { mesh: unitCubeMesh(), name: 'faceted-part' },
    ])
    const text = decodeStep(buffer)
    expect(text).toContain('ADVANCED_FACE')

    const nodes = await importAssemblyFromStep(buffer)
    try {
      const leaves = collectLeaves(nodes)
      expect(leaves).toHaveLength(1)
      expect(leaves[0].name).toBe('faceted-part')
    } finally {
      releaseAssemblyTree(kernel, nodes)
    }
  })

  it('mixed solid + mesh entries: two independent entities, no string splicing', async () => {
    const box = makeBox(0, 0, 0)
    try {
      const buffer = exportStepFromSolids(kernel, [
        { solid: box, name: 'brep-part' },
        { mesh: unitCubeMesh(), name: 'mesh-part' },
      ])
      const text = decodeStep(buffer)

      const solidCount = (text.match(/MANIFOLD_SOLID_BREP/g) ?? []).length
      expect(solidCount).toBeGreaterThanOrEqual(2)
      // 单一合法 STEP 文件：仅一个 HEADER 段
      expect((text.match(/HEADER/g) ?? []).length).toBe(1)
      expect(text).not.toContain('POLYGONAL_FACE')

      const nodes = await importAssemblyFromStep(buffer)
      try {
        const names = collectLeaves(nodes).map(l => l.name).sort()
        expect(names).toEqual(['brep-part', 'mesh-part'])
      } finally {
        releaseAssemblyTree(kernel, nodes)
      }
    } finally {
      kernel.release(box)
    }
  })

  it('color is preserved on the exported label', async () => {
    const box = makeBox(0, 0, 0)
    try {
      const buffer = exportStepFromSolids(kernel, [
        { solid: box, name: 'colored', color: [0.8, 0.2, 0.1] },
      ])
      const nodes = await importAssemblyFromStep(buffer)
      try {
        const leaves = collectLeaves(nodes)
        expect(leaves).toHaveLength(1)
        const c = leaves[0].color
        expect(c).not.toBeNull()
        expect(c![0]).toBeCloseTo(0.8, 5)
        expect(c![1]).toBeCloseTo(0.2, 5)
        expect(c![2]).toBeCloseTo(0.1, 5)
      } finally {
        releaseAssemblyTree(kernel, nodes)
      }
    } finally {
      kernel.release(box)
    }
  })

  it('empty entries throws', () => {
    expect(() => exportStepFromSolids(kernel, [])).toThrow('No exportable geometry')
  })

  it('entry without solid or mesh throws', () => {
    const box = makeBox(0, 0, 0)
    try {
      expect(() => exportStepFromSolids(kernel, [{}])).toThrow(
        'StepExportEntry must provide either solid or mesh',
      )
    } finally {
      kernel.release(box)
    }
  })

  it('original solid handles remain usable after export (no premature release)', () => {
    const boxA = makeBox(0, 0, 0)
    const boxB = makeBox(20, 0, 0)
    try {
      exportStepFromSolids(kernel, [
        { solid: boxA, name: 'a' },
        { solid: boxB, name: 'b' },
      ])
      // 导出后原 solid 仍可继续使用（exportStep / 再导出都不抛错）
      const stepAgain = kernel.exportStep(boxA)
      expect(stepAgain).toContain('MANIFOLD_SOLID_BREP')
      exportStepFromSolids(kernel, [{ solid: boxB, name: 'b-again' }])
    } finally {
      kernel.release(boxA)
      kernel.release(boxB)
    }
  })
})