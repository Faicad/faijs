/**
 * @vitest-environment node
 *
 * face-evolution 工具函数测试（faceOrdinal 拓扑引用）
 *
 * 测试内容：
 * - face-evolution 工具函数正确性（cutWithHistoryBrep / fuseWithHistoryBrep / getFaceHashes）
 *
 * 说明：resolveGeomRef 测试块已删除——GeomRef 类型在语言正常化中退役（退役为 CallRefIR，
 * faceOrdinal/anchor 成为普通实参），拓扑语义由 api/geom.ts 的 geomQuery 承担。
 *
 * Run: npx vitest run src/brep/face-evolution-impl.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { initOcctWasm, getKernel } from '../occt-kernel/occtKernel'
import type { BrepEngineApi } from './engine/primitives'
import {
  booleanWithRoleTable,
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

  // G 组 (edgeRef-lineage corpus, 2026-10-03): fuse SEAM faces belong to
  // neither parent's lineage — they were left role-less, so a downstream
  // edgeRef at a fillet hit 'adjacent face ordinal N has no role lineage'
  // (Flapper LHS takepoint: midplane pad = union of two half-prisms, the
  // seam plane face had no role). booleanWithRoleTable now registers
  // uncovered result faces as seam faces under the boolean statement's
  // origin — real lineage (the face WAS born there), not a forged mapping.
  it('fuse seam faces get a seam role under the boolean statement origin (G组)', () => {
    const boxA = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })
    const boxB = kernel.makeBoxFromCorners({ x: 10, y: 0, z: 0 }, { x: 20, y: 10, z: 10 })
    const { result, roleTable } = booleanWithRoleTable(kernel, 'fuse', boxA, boxB, new Map(), new Map(), 's9')
    // every result face must now carry lineage (parent faces + seam faces)
    const covered = new Set<unknown>()
    for (const roles of roleTable.values()) {
      for (const hs of (roles as ReadonlyMap<string, readonly number[]>).values()) for (const h of hs) covered.add(h)
    }
    const faces = kernel.getSubShapes(result, 'face')
    const hashes = getFaceHashes(kernel, result)
    const uncovered = hashes.filter((h) => !covered.has(h))
    expect(uncovered).toEqual([])
    // and the seam origin exists when seam faces were produced
    const seamRoles = roleTable.get('s9') as ReadonlyMap<string, readonly number[]> | undefined
    const seamCount = seamRoles ? (seamRoles.get('seam')?.length ?? 0) : 0
    expect(covered.size + seamCount).toBeGreaterThan(0)
    for (const f of faces) kernel.release(f)
    kernel.release(result)
    kernel.release(boxA)
    kernel.release(boxB)
  })
})
