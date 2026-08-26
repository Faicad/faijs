/**
 * @vitest-environment node
 *
 * P5-2: GeomRef faceOrdinal 化测试
 *
 * 测试内容：
 * - GeomRef 类型携带 faceOrdinal
 * - resolveGeomRef 按 faceOrdinal 取面（BREP 路径）
 * - resolveGeomRef 降级到 anchor（无 BREP 时）
 * - codegen/parser faceOrdinal 文本往返保真
 * - face-evolution 工具函数正确性
 *
 * Run: npx vitest run src/ops/face-evolution-impl.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { initOcctWasm, getKernel } from '../occt-kernel/occtKernel'
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import { resolveGeomRef } from '../stdlib/internal/geom-ref'
import {
  cutWithHistoryBrep,
  fuseWithHistoryBrep,
  getFaceHashes,
  getUnionFaceHashes,
} from './face-evolution'
import type { GeomRef } from '../lang/types'
import type { Shape } from '../mesh/types'
import { asPartName } from '../identity'

let kernel: OcctKernel

beforeAll(async () => {
  await initOcctWasm()
  kernel = getKernel()
}, 120000)

// ─── 辅助函数 ───

/** 将 OCCT solid 三角化为 Shape（用于 resolveGeomRef 的 mesh 兜底路径） */
function solidToShape(solid: ShapeHandle): Shape {
  const mesh = kernel.meshShape(solid, {
    linearDeflection: 0.1,
    angularDeflection: (2 * Math.PI) / 32,
  })
  return {
    positions: new Float32Array(mesh.positions),
    indices: new Uint32Array(mesh.indices),
  }
}

// ─── resolveGeomRef faceOrdinal 测试 ───

describe('resolveGeomRef with faceOrdinal (BREP path)', () => {
  it('resolves faceCenter by faceOrdinal using BREP solid', () => {
    const box = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })
    const shape = solidToShape(box)

    // 获取面列表，找到顶面 ordinal
    const faces = kernel.getSubShapes(box, 'face')
    let topOrdinal = -1
    let maxZ = -Infinity
    for (let i = 0; i < faces.length; i++) {
      const center = kernel.getSurfaceCenterOfMass(faces[i])
      if (center.z > maxZ) {
        maxZ = center.z
        topOrdinal = i
      }
    }
    for (const f of faces) kernel.release(f)

    // 构建 GeomRef with faceOrdinal
    const ref: GeomRef = {
      $geom: {
        of: asPartName('test_box'),
        feature: 'faceCenter',
        faceOrdinal: topOrdinal,
        anchor: { point: [5, 5, 10], normal: [0, 0, 1] },
      },
    }

    // resolveGeomRef 应按 faceOrdinal 取面心
    const result = resolveGeomRef(
      ref,
      () => shape,
      () => box,
      kernel,
    )

    // 顶面中心应在 (5, 5, 10)
    expect(result[0]).toBeCloseTo(5, 4)
    expect(result[1]).toBeCloseTo(5, 4)
    expect(result[2]).toBeCloseTo(10, 4)

    kernel.release(box)
  })

  it('resolves faceNormal by faceOrdinal using BREP solid', () => {
    const box = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })
    const shape = solidToShape(box)

    // 找到顶面 ordinal
    const faces = kernel.getSubShapes(box, 'face')
    let topOrdinal = -1
    let maxZ = -Infinity
    for (let i = 0; i < faces.length; i++) {
      const center = kernel.getSurfaceCenterOfMass(faces[i])
      if (center.z > maxZ) {
        maxZ = center.z
        topOrdinal = i
      }
    }
    for (const f of faces) kernel.release(f)

    const ref: GeomRef = {
      $geom: {
        of: asPartName('test_box'),
        feature: 'faceNormal',
        faceOrdinal: topOrdinal,
        anchor: { point: [5, 5, 10], normal: [0, 0, 1] },
      },
    }

    const result = resolveGeomRef(
      ref,
      () => shape,
      () => box,
      kernel,
    )

    // 顶面法向应接近 [0, 0, 1] 或 [0, 0, -1]（取决于面朝向）
    expect(Math.abs(result[2])).toBeCloseTo(1, 4)

    kernel.release(box)
  })

  it('falls back to anchor when BREP solid is not available', () => {
    const box = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })
    const shape = solidToShape(box)

    const ref: GeomRef = {
      $geom: {
        of: asPartName('test_box'),
        feature: 'faceCenter',
        faceOrdinal: 0,
        anchor: { point: [5, 5, 10], normal: [0, 0, 1] },
      },
    }

    // 不传 getUpstreamSolid → 应回落到 anchor 路径
    const result = resolveGeomRef(ref, () => shape)

    // anchor 路径应该返回某个面心（不抛异常）
    expect(result).toBeDefined()
    expect(result.length).toBe(3)

    kernel.release(box)
  })

  it('falls back to anchor when faceOrdinal is out of bounds', () => {
    const box = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })
    const shape = solidToShape(box)

    const ref: GeomRef = {
      $geom: {
        of: asPartName('test_box'),
        feature: 'faceCenter',
        faceOrdinal: 999, // 越界
        anchor: { point: [5, 5, 10], normal: [0, 0, 1] },
      },
    }

    // ordinal 越界 → 应回落到 anchor 路径
    const result = resolveGeomRef(
      ref,
      () => shape,
      () => box,
      kernel,
    )

    expect(result).toBeDefined()
    expect(result.length).toBe(3)

    kernel.release(box)
  })

  it('works without faceOrdinal (backward compat: pure anchor)', () => {
    const box = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })
    const shape = solidToShape(box)

    const ref: GeomRef = {
      $geom: {
        of: asPartName('test_box'),
        feature: 'faceCenter',
        // 无 faceOrdinal — 纯 anchor 路径
        anchor: { point: [5, 5, 10], normal: [0, 0, 1] },
      },
    }

    const result = resolveGeomRef(
      ref,
      () => shape,
      () => box,
      kernel,
    )

    expect(result).toBeDefined()
    expect(result.length).toBe(3)

    kernel.release(box)
  })

  it('throws when faceCenter has no anchor and no faceOrdinal', () => {
    const box = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })
    const shape = solidToShape(box)

    const ref: GeomRef = {
      $geom: {
        of: asPartName('test_box'),
        feature: 'faceCenter',
        // 无 faceOrdinal, 无 anchor
      },
    }

    // 无 anchor 且无 faceOrdinal → 应 throw（不再降级到 bboxCenter）
    expect(() => resolveGeomRef(ref, () => shape)).toThrow(/requires anchor or faceOrdinal/)

    kernel.release(box)
  })

  it('throws when faceNormal has no anchor and no faceOrdinal', () => {
    const box = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })
    const shape = solidToShape(box)

    const ref: GeomRef = {
      $geom: {
        of: asPartName('test_box'),
        feature: 'faceNormal',
        // 无 faceOrdinal, 无 anchor
      },
    }

    expect(() => resolveGeomRef(ref, () => shape)).toThrow(/requires anchor or faceOrdinal/)

    kernel.release(box)
  })

  it('throws for unknown feature', () => {
    const box = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })
    const shape = solidToShape(box)

    const ref: GeomRef = {
      $geom: {
        of: asPartName('test_box'),
        feature: 'unknownFeature' as 'bboxCenter',
      },
    }

    expect(() => resolveGeomRef(ref, () => shape)).toThrow(/unknown feature/)

    kernel.release(box)
  })
})

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
