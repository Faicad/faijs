/**
 * @vitest-environment node
 *
 * face-evolution 工具函数测试（faceOrdinal 拓扑引用）
 *
 * 测试内容：
 * - face-evolution 工具函数正确性（cutWithHistoryBrep / fuseWithHistoryBrep / getFaceHashes）
 *
 * 说明：resolveGeomRef 测试块已删除——GeomRef 类型在语言正常化中退役（退役为 CallRefIR，
 * faceOrdinal/anchor 成为普通实参），拓扑语义由 stdlib/geom.ts 的 geomQuery 承担。
 *
 * Run: npx vitest run src/brep/face-evolution-impl.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { initOcctWasm, getKernel } from '../occt-kernel/occtKernel'
import type { BrepEngineApi } from './engine/primitives'
import {
  cutWithHistoryBrep,
  fuseWithHistoryBrep,
  getFaceHashes,
  getUnionFaceHashes,
} from './face-evolution'

let kernel: BrepEngineApi

beforeAll(async () => {
  await initOcctWasm()
  kernel = getKernel() as unknown as BrepEngineApi
}, 120000)

// ─── face-evolution 工具函数测试 ───

describe('face-evolution utility functions', () => {
  it('getFaceHashes returns correct number of hashes', () => {
    const box = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })
    const hashes = getFaceHashes(kernel, box)
    expect(hashes.length).toBe(6) // box has 6 faces
    kernel.release(box)
  })

  it('getUnionFaceHashes returns union of both shapes hashes', () => {
    const boxA = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })
    const boxB = kernel.makeBoxFromCorners({ x: 5, y: 5, z: 0 }, { x: 15, y: 15, z: 10 })
    const union = getUnionFaceHashes(kernel, boxA, boxB)
    // 12 = 6 + 6（两个 box 的面 hash 互异）
    expect(union.length).toBe(12)
    kernel.release(boxA)
    kernel.release(boxB)
  })

  it('cutWithHistoryBrep returns result and faceEvolution', () => {
    const box = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })
    const cyl = kernel.makeCylinder(2, 10)
    const cylMoved = kernel.translate(cyl, 5, 5, 0)
    kernel.release(cyl)

    const { result, faceEvolution } = cutWithHistoryBrep(kernel, box, cylMoved)

    expect(result).toBeDefined()
    // faceEvolution 应有映射条目
    expect(faceEvolution.size).toBeGreaterThan(0)

    // 所有映射的 ordinal 应有效
    const resultFaces = kernel.getSubShapes(result, 'face')
    for (const [inOrdinal, outOrdinals] of faceEvolution) {
      expect(inOrdinal).toBeGreaterThanOrEqual(0)
      expect(inOrdinal).toBeLessThan(6) // box has 6 faces
      for (const outOrdinal of outOrdinals) {
        expect(outOrdinal).toBeGreaterThanOrEqual(0)
        expect(outOrdinal).toBeLessThan(resultFaces.length)
      }
    }
    for (const f of resultFaces) kernel.release(f)

    kernel.release(result)
    kernel.release(box)
    kernel.release(cylMoved)
  })

  it('fuseWithHistoryBrep returns result and faceEvolution', () => {
    const boxA = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })
    const boxB = kernel.makeBoxFromCorners({ x: 5, y: 5, z: 0 }, { x: 15, y: 15, z: 10 })

    const { result, faceEvolution } = fuseWithHistoryBrep(kernel, boxA, boxB)

    expect(result).toBeDefined()
    expect(faceEvolution.size).toBeGreaterThan(0)

    kernel.release(result)
    kernel.release(boxA)
    kernel.release(boxB)
  })
})
