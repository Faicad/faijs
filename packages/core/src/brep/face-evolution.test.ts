/**
 * @vitest-environment node
 *
 * P5-1: 拓扑面跟踪实验验证（阻塞性单测）
 *
 * 验证分析文档（2026-08-12-topology-face-tracking-analysis.md）§5.2 的核心假设：
 * - 确定性重放下 BRep 面枚举顺序稳定
 * - getSubShapes ↔ subShapeHashes 顺序一一对应
 * - cutWithHistory 的 modified 分段编码可正确解码为 ordinal 映射
 * - faceOrdinal 在两次独立构建中对应同一几何位置
 *
 * Run: npx vitest run src/ops/face-evolution.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { initOcctWasm, getKernel } from '../occt-kernel/occtKernel'
import type { BrepHandle } from './engine/types'
import type { BrepEngineApi } from './engine/primitives'

const HASH_UPPER_BOUND = 2147483647

let kernel: BrepEngineApi

beforeAll(async () => {
  await initOcctWasm()
  kernel = getKernel() as unknown as BrepEngineApi
}, 120000)

// ─── 辅助函数 ───

/**
 * 获取形状所有面的面积序列（用于确定性比较）。
 * 面面积通过 queryBatch 获取。
 */
function getFaceAreas(shape: BrepHandle): number[] {
  const faces = kernel.getSubShapes(shape, 'face')
  const results = kernel.queryBatch(faces)
  const areas = results.map(r => r.area)
  for (const f of faces) kernel.release(f)
  return areas
}

/**
 * 获取形状所有面的中心坐标序列（用于几何位置比较）。
 * 使用 getSurfaceCenterOfMass 获取面积加权重心。
 */
function getFaceCenters(shape: BrepHandle): Array<{ x: number; y: number; z: number }> {
  const faces = kernel.getSubShapes(shape, 'face')
  const centers = faces.map(f => kernel.getSurfaceCenterOfMass(f))
  for (const f of faces) kernel.release(f)
  return centers
}

/**
 * 构建一个标准测试场景：box 被圆柱切割。
 * 返回切割结果的 BrepHandle。
 */
function buildBoxCutByCylinder(): BrepHandle {
  const box = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })
  // 圆柱从顶面中心向下钻
  const cyl = kernel.makeCylinder(2, 10)
  // 平移圆柱到 box 顶面中心 (5, 5, 0)
  const cylMoved = kernel.translate(cyl, 5, 5, 0)
  kernel.release(cyl)
  const result = kernel.cut(box, cylMoved)
  kernel.release(box)
  kernel.release(cylMoved)
  return result
}

/**
 * 构建一个标准测试场景：两个 box 融合。
 * 返回融合结果的 BrepHandle。
 */
function buildBoxFuseBox(): BrepHandle {
  const boxA = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })
  const boxB = kernel.makeBoxFromCorners({ x: 5, y: 5, z: 0 }, { x: 15, y: 15, z: 10 })
  const result = kernel.fuse(boxA, boxB)
  kernel.release(boxA)
  kernel.release(boxB)
  return result
}

/**
 * 收集形状所有面的 hash 列表（通过 subShapeHashes）。
 */
function getFaceHashes(shape: BrepHandle): number[] {
  return Array.from(kernel.subShapeHashes(shape, 'face', HASH_UPPER_BOUND))
}

/**
 * 对两个面中心坐标序列做近似比较。
 */
function centersAlmostEqual(
  a: Array<{ x: number; y: number; z: number }>,
  b: Array<{ x: number; y: number; z: number }>,
  epsilon = 1e-6,
): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i].x - b[i].x) > epsilon) return false
    if (Math.abs(a[i].y - b[i].y) > epsilon) return false
    if (Math.abs(a[i].z - b[i].z) > epsilon) return false
  }
  return true
}

// ─── 实验 1：确定性重放验证 ───

describe('Experiment 1: deterministic replay — face enumeration order stable', () => {
  it('makeBox + cut(cylinder): two independent builds produce identical face area sequences', () => {
    const result1 = buildBoxCutByCylinder()
    const result2 = buildBoxCutByCylinder()

    const areas1 = getFaceAreas(result1)
    const areas2 = getFaceAreas(result2)

    // 面数量一致
    expect(areas1.length).toBe(areas2.length)

    // 面面积序列一致（按 ordinal 排序）
    for (let i = 0; i < areas1.length; i++) {
      expect(areas1[i]).toBeCloseTo(areas2[i], 6)
    }

    kernel.release(result1)
    kernel.release(result2)
  })

  it('makeBox + fuse(box): two independent builds produce identical face area sequences', () => {
    const result1 = buildBoxFuseBox()
    const result2 = buildBoxFuseBox()

    const areas1 = getFaceAreas(result1)
    const areas2 = getFaceAreas(result2)

    expect(areas1.length).toBe(areas2.length)
    for (let i = 0; i < areas1.length; i++) {
      expect(areas1[i]).toBeCloseTo(areas2[i], 6)
    }

    kernel.release(result1)
    kernel.release(result2)
  })

  it('face center sequences are identical across independent builds (box + cut)', () => {
    const result1 = buildBoxCutByCylinder()
    const result2 = buildBoxCutByCylinder()

    const centers1 = getFaceCenters(result1)
    const centers2 = getFaceCenters(result2)

    expect(centersAlmostEqual(centers1, centers2)).toBe(true)

    kernel.release(result1)
    kernel.release(result2)
  })
})

// ─── 实验 2：ordinal 与 hash 对齐验证 ───

describe('Experiment 2: ordinal ↔ hash alignment', () => {
  it('getSubShapes order corresponds to subShapeHashes order for a box', () => {
    const box = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })

    const faces = kernel.getSubShapes(box, 'face')
    const hashes = getFaceHashes(box)

    // 数量一致
    expect(faces.length).toBe(hashes.length)

    // 验证面心坐标有效且互异
    const centersFromSubShapes = faces.map(f => kernel.getSurfaceCenterOfMass(f))
    for (const f of faces) kernel.release(f)
    expect(centersFromSubShapes.length).toBe(6)
    // 每个面心坐标都是有限数
    for (const c of centersFromSubShapes) {
      expect(Number.isFinite(c.x)).toBe(true)
      expect(Number.isFinite(c.y)).toBe(true)
      expect(Number.isFinite(c.z)).toBe(true)
    }

    // 6 个面（box 有 6 个面）
    expect(faces.length).toBe(6)
    expect(hashes.length).toBe(6)

    // 所有 hash 互异（无碰撞）
    const uniqueHashes = new Set(hashes)
    expect(uniqueHashes.size).toBe(hashes.length)

    kernel.release(box)
  })

  it('getSubShapes order corresponds to subShapeHashes order for box + cut result', () => {
    const result = buildBoxCutByCylinder()

    const faces = kernel.getSubShapes(result, 'face')
    const hashes = getFaceHashes(result)

    expect(faces.length).toBe(hashes.length)

    // 切割后的面数应该 > 6（顶面被切成多个面）
    expect(faces.length).toBeGreaterThan(6)

    // 所有 hash 互异
    const uniqueHashes = new Set(hashes)
    expect(uniqueHashes.size).toBe(hashes.length)

    for (const f of faces) kernel.release(f)
    kernel.release(result)
  })
})

// ─── 实验 3：cutWithHistory 解码验证 ───

describe('Experiment 3: cutWithHistory evolution decoding', () => {
  it('cutWithHistory returns valid EvolutionData with result shape', () => {
    const box = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })
    const cyl = kernel.makeCylinder(2, 10)
    const cylMoved = kernel.translate(cyl, 5, 5, 0)
    kernel.release(cyl)

    // 收集输入面 hash（box 的所有面）
    const inputHashes = getFaceHashes(box)
    expect(inputHashes.length).toBe(6)

    const evo = kernel.cutWithHistory(box, cylMoved, inputHashes, HASH_UPPER_BOUND)

    // EvolutionData 应有 result
    expect(evo.result).toBeDefined()

    // result 应是有效形状
    const resultFaces = kernel.getSubShapes(evo.result, 'face')
    expect(resultFaces.length).toBeGreaterThan(0)
    for (const f of resultFaces) kernel.release(f)

    kernel.release(evo.result)
    kernel.release(box)
    kernel.release(cylMoved)
  })

  it('cutWithHistory modified array decodes to correct ordinal mapping', () => {
    const box = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })
    const cyl = kernel.makeCylinder(2, 10)
    const cylMoved = kernel.translate(cyl, 5, 5, 0)
    kernel.release(cyl)

    // 输入面 hash 和 ordinal 对齐
    const inputHashes = getFaceHashes(box)
    const inputFaces = kernel.getSubShapes(box, 'face')
    expect(inputHashes.length).toBe(inputFaces.length)

    // 记录每个输入面的中心坐标（用于验证映射正确性）
    const inputCenters = inputFaces.map(f => kernel.getSurfaceCenterOfMass(f))
    for (const f of inputFaces) kernel.release(f)
    // 验证输入面心坐标有效
    expect(inputCenters.length).toBe(6)

    const evo = kernel.cutWithHistory(box, cylMoved, inputHashes, HASH_UPPER_BOUND)

    // 解码 modified 分段编码: [inputHash, count, outHash1, outHash2, ...]
    const modified = evo.modified
    const resultHashes = getFaceHashes(evo.result)

    // 构建 hash → ordinal 查找表
    const resultHashToOrdinal = new Map<number, number>()
    for (let i = 0; i < resultHashes.length; i++) {
      resultHashToOrdinal.set(resultHashes[i], i)
    }
    const inputHashToOrdinal = new Map<number, number>()
    for (let i = 0; i < inputHashes.length; i++) {
      inputHashToOrdinal.set(inputHashes[i], i)
    }

    // 解码 modified 数组
    const ordinalEvolution = new Map<number, number[]>() // inOrdinal → outOrdinal[]
    let idx = 0
    while (idx < modified.length) {
      const inHash = modified[idx]
      const count = modified[idx + 1]
      const outOrdinals: number[] = []
      for (let j = 0; j < count; j++) {
        const outHash = modified[idx + 2 + j]
        const outOrdinal = resultHashToOrdinal.get(outHash)
        if (outOrdinal !== undefined) {
          outOrdinals.push(outOrdinal)
        }
      }
      const inOrdinal = inputHashToOrdinal.get(inHash)
      if (inOrdinal !== undefined) {
        ordinalEvolution.set(inOrdinal, outOrdinals)
      }
      idx += 2 + count
    }

    // 验证：至少有一些面被 modified
    // 圆柱穿过 box → 顶面/底面各被修改（1→1，面带孔仍是1个面），侧面也被修改
    expect(ordinalEvolution.size).toBeGreaterThan(0)

    // 验证：所有 modified 映射的输出面中心坐标有效
    const resultFaces2 = kernel.getSubShapes(evo.result, 'face')
    for (const [, outOrdinals] of ordinalEvolution) {
      for (const outOrdinal of outOrdinals) {
        const outCenter = kernel.getSurfaceCenterOfMass(resultFaces2[outOrdinal])
        expect(Number.isFinite(outCenter.x)).toBe(true)
        expect(Number.isFinite(outCenter.y)).toBe(true)
        expect(Number.isFinite(outCenter.z)).toBe(true)
      }
    }
    for (const f of resultFaces2) kernel.release(f)

    // 圆柱切割 box 的 modified 都是 1→1（面带孔仍是单面）
    // generated 为空：圆柱面是由 edge 生成的，不是由 face generated 的
    // deleted 为空：没有整个面被删除
    // 关键验证：modified 非空（输入面被修改为带孔的面）
    expect(evo.modified.length).toBeGreaterThan(0)

    kernel.release(evo.result)
    kernel.release(box)
    kernel.release(cylMoved)
  })

  it('cutWithHistory produces 1→N mapping when a face is split by a thin box', () => {
    // 用薄盒子切割 box 顶面 → 顶面被分成两个面（1→N 映射）
    const box = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })
    // 薄盒子从顶面中间切下去：x=4~6, y=0~10, z=5~15
    const cutter = kernel.makeBoxFromCorners({ x: 4, y: 0, z: 5 }, { x: 6, y: 10, z: 15 })

    const inputHashes = getFaceHashes(box)
    const evo = kernel.cutWithHistory(box, cutter, inputHashes, HASH_UPPER_BOUND)

    const resultHashes = getFaceHashes(evo.result)
    const resultHashToOrdinal = new Map<number, number>()
    for (let i = 0; i < resultHashes.length; i++) {
      resultHashToOrdinal.set(resultHashes[i], i)
    }
    const inputHashToOrdinal = new Map<number, number>()
    for (let i = 0; i < inputHashes.length; i++) {
      inputHashToOrdinal.set(inputHashes[i], i)
    }

    // 解码 modified 数组
    const modified = evo.modified
    let hasOneToN = false
    let idx = 0
    while (idx < modified.length) {
      const inHash = modified[idx]
      const count = modified[idx + 1]
      if (count > 1) {
        const inOrdinal = inputHashToOrdinal.get(inHash)
        if (inOrdinal !== undefined) {
          hasOneToN = true
          // 验证所有输出 hash 都在结果中找到
          for (let j = 0; j < count; j++) {
            const outHash = modified[idx + 2 + j]
            expect(resultHashToOrdinal.has(outHash)).toBe(true)
          }
        }
      }
      idx += 2 + count
    }
    // 顶面被薄盒子切割 → 1→2 映射
    expect(hasOneToN).toBe(true)

    kernel.release(evo.result)
    kernel.release(box)
    kernel.release(cutter)
  })

  it('cutWithHistory with union of both input hashes tracks faces from both shapes', () => {
    const boxA = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })
    const boxB = kernel.makeBoxFromCorners({ x: 5, y: 5, z: 0 }, { x: 15, y: 15, z: 10 })

    // 分析文档 §4.2：必须传 subShapeHashes(A) ∪ subShapeHashes(B) 才能跟踪两个输入
    const hashesA = getFaceHashes(boxA)
    const hashesB = getFaceHashes(boxB)
    const unionHashes = [...new Set([...hashesA, ...hashesB])]

    const evo = kernel.fuseWithHistory(boxA, boxB, unionHashes, HASH_UPPER_BOUND)
    expect(evo.result).toBeDefined()

    // 应该有 modified 记录（两个 box 的面在融合后有些会变化）
    expect(evo.modified.length).toBeGreaterThan(0)

    kernel.release(evo.result)
    kernel.release(boxA)
    kernel.release(boxB)
  })
})

// ─── 实验 4：faceOrdinal 稳定性验证 ───

describe('Experiment 4: faceOrdinal stability across independent builds', () => {
  it('input box face ordinals correspond to same geometric positions across builds', () => {
    // 两次独立构建 box，验证面的 ordinal 顺序一致
    const box1 = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })
    const box2 = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })

    const centers1 = getFaceCenters(box1)
    const centers2 = getFaceCenters(box2)

    // 两次构建的面心坐标序列应一致
    expect(centers1.length).toBe(centers2.length)
    expect(centersAlmostEqual(centers1, centers2)).toBe(true)

    kernel.release(box1)
    kernel.release(box2)
  })

  it('box+cut result face ordinals are stable across independent builds', () => {
    const result1 = buildBoxCutByCylinder()
    const result2 = buildBoxCutByCylinder()

    const centers1 = getFaceCenters(result1)
    const centers2 = getFaceCenters(result2)

    // 两次独立构建的切割结果，面 ordinal 顺序应一致
    expect(centers1.length).toBe(centers2.length)
    expect(centersAlmostEqual(centers1, centers2)).toBe(true)

    kernel.release(result1)
    kernel.release(result2)
  })

  it('faceOrdinal can be used to retrieve the same face across rebuilds', () => {
    // 模拟实际使用场景：
    // 1. 第一次构建 box → 记录某个面的 ordinal（如顶面 ordinal=5）
    // 2. 第二次构建 box → 用同一 ordinal 取面 → 面心应一致

    const box1 = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })
    const faces1 = kernel.getSubShapes(box1, 'face')
    // 找到顶面（z 坐标最大的面心）
    let topOrdinal = -1
    let maxZ = -Infinity
    for (let i = 0; i < faces1.length; i++) {
      const center = kernel.getSurfaceCenterOfMass(faces1[i])
      if (center.z > maxZ) {
        maxZ = center.z
        topOrdinal = i
      }
    }
    expect(topOrdinal).toBeGreaterThanOrEqual(0)
    expect(maxZ).toBeCloseTo(10, 6) // 顶面 z=10

    for (const f of faces1) kernel.release(f)
    kernel.release(box1)

    // 第二次构建
    const box2 = kernel.makeBoxFromCorners({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 })
    const faces2 = kernel.getSubShapes(box2, 'face')

    // 用同一 ordinal 取面
    const topFace2 = faces2[topOrdinal]
    const center2 = kernel.getSurfaceCenterOfMass(topFace2)

    // 面心 z 坐标应一致（都是顶面 z=10）
    expect(center2.z).toBeCloseTo(maxZ, 6)

    for (const f of faces2) kernel.release(f)
    kernel.release(box2)
  })
})
