/**
 * @vitest-environment node
 *
 * BREP 榫卯操作单元测试
 *
 * 测试：buildWedgeSolid, buildDowelSolid, buildTenonSolid,
 * detectCrossSectionComponents, dovetailBooleanSplitBrep,
 * dowelOrTenonBooleanSplitBrep。
 *
 * Run: npx vitest run src/brep/operations/joinery-brep.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { initOcctWasm, getKernel } from '../../occt/occtKernel'
import type { OcctKernel } from 'occt-wasm'
import {
  buildWedgeSolid,
  buildDowelSolid,
  buildTenonSolid,
  detectCrossSectionComponents,
  dovetailBooleanSplitBrep,
  dowelOrTenonBooleanSplitBrep,
  type JoineryBasis,
} from './joinery-brep'
import { getSolidBoundingBox } from '../brep-utils'
import { splitBrep } from '../brep-ops'

let kernel: OcctKernel

beforeAll(async () => {
  await initOcctWasm()
  kernel = getKernel()
}, 120000)

// 标准测试坐标框架：Z-up 切割平面在 Z=0
const defaultBasis: JoineryBasis = {
  normal: [0, 0, 1],
  widthDir: [1, 0, 0],
  depthDir: [0, 1, 0],
  planeCenter: [0, 0, 0],
  originOffset: 0,
}

// ─── buildWedgeSolid ───

describe('buildWedgeSolid', () => {
  it('should produce a valid solid with correct bounding box', () => {
    const wedge = buildWedgeSolid(
      kernel, defaultBasis,
      5,   // depth
      10,  // width
      60,  // angleDeg
      20,  // extrudeLength
    )
    expect(wedge).toBeDefined()

    const solids = kernel.getSubShapes(wedge, 'solid')
    expect(solids.length).toBeGreaterThanOrEqual(1)
    for (const s of solids) kernel.release(s)

    const bb = getSolidBoundingBox(kernel, wedge)
    // 楔沿 widthDir (X) 拉伸 20mm，居中于 planeCenter → X ∈ [-10, 10]
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(20, 0)
    // 楔沿 normal (Z) 从 0 到 -depth → Z ∈ [-5, 0]
    expect(bb.max[2]).toBeCloseTo(0, 0)
    expect(bb.min[2]).toBeCloseTo(-5, 0)

    kernel.release(wedge)
  })

  it('should produce ADVANCED_FACE in STEP export (not polygonal)', () => {
    const wedge = buildWedgeSolid(kernel, defaultBasis, 5, 10, 60, 20)
    const step = kernel.exportStep(wedge)
    expect(step).toContain('ADVANCED_FACE')
    kernel.release(wedge)
  })
})

// ─── buildDowelSolid ───

describe('buildDowelSolid', () => {
  it('should produce a cylinder with correct dimensions', () => {
    const centroid: [number, number, number] = [0, 0, 0]
    const dowel = buildDowelSolid(kernel, centroid, defaultBasis, 6, 10)
    expect(dowel).toBeDefined()

    const bb = getSolidBoundingBox(kernel, dowel)
    // 直径 6 → X/Y 跨度约 6
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(6, 1)
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(6, 1)
    // 高度 10，从 centroid 向下延伸 → Z ∈ [-10, 0]
    expect(bb.max[2]).toBeCloseTo(0, 1)
    expect(bb.min[2]).toBeCloseTo(-10, 1)

    kernel.release(dowel)
  })

  it('should produce ADVANCED_FACE in STEP export', () => {
    const dowel = buildDowelSolid(kernel, [0, 0, 0], defaultBasis, 6, 10)
    const step = kernel.exportStep(dowel)
    expect(step).toContain('ADVANCED_FACE')
    kernel.release(dowel)
  })
})

// ─── buildTenonSolid ───

describe('buildTenonSolid', () => {
  it('should produce a box with correct dimensions', () => {
    const centroid: [number, number, number] = [0, 0, 0]
    const tenon = buildTenonSolid(kernel, centroid, defaultBasis, 8, 10)
    expect(tenon).toBeDefined()

    const bb = getSolidBoundingBox(kernel, tenon)
    // 边长 8 → X/Y 跨度 = 8
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(8, 0)
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(8, 0)
    // 高度 10，从 centroid 向下延伸 → Z ∈ [-10, 0]
    expect(bb.max[2]).toBeCloseTo(0, 0)
    expect(bb.min[2]).toBeCloseTo(-10, 0)

    kernel.release(tenon)
  })

  it('should produce ADVANCED_FACE in STEP export', () => {
    const tenon = buildTenonSolid(kernel, [0, 0, 0], defaultBasis, 8, 10)
    const step = kernel.exportStep(tenon)
    expect(step).toContain('ADVANCED_FACE')
    kernel.release(tenon)
  })
})

// ─── detectCrossSectionComponents ───

describe('detectCrossSectionComponents', () => {
  it('should detect single component for a box split at Z=0', () => {
    // 创建一个 -10..10 的盒子，用 splitBrep 分割
    const box = kernel.makeBoxFromCorners({ x: -10, y: -10, z: -10 }, { x: 10, y: 10, z: 10 })
    // upper = Z > 0 的部分
    const split = splitBrep(kernel, box, {
      normal: [0, 0, 1],
      originOffset: 0,
      planeCenter: [0, 0, 0],
    })

    const components = detectCrossSectionComponents(kernel, split.front, defaultBasis)
    expect(components.length).toBe(1)
    // 质心应在 (0, 0, 0) 附近
    expect(components[0].centroid[0]).toBeCloseTo(0, 0)
    expect(components[0].centroid[1]).toBeCloseTo(0, 0)

    kernel.release(box)
    kernel.release(split.front)
    kernel.release(split.back)
  })
})

// ─── dovetailBooleanSplitBrep ───

describe('dovetailBooleanSplitBrep', () => {
  it('should split a box into upper (with wedge) and lower (with groove)', () => {
    const box = kernel.makeBoxFromCorners({ x: -10, y: -10, z: -10 }, { x: 10, y: 10, z: 10 })

    const result = dovetailBooleanSplitBrep(kernel, box, defaultBasis, {
      depth: 5,
      depthTolerance: 0.2,
      width: 8,
      widthTolerance: 0.2,
      flapsAngle: 60,
    })

    expect(result.front).toBeDefined()
    expect(result.back).toBeDefined()

    // STEP 导出应含 ADVANCED_FACE
    const stepFront = kernel.exportStep(result.front)
    expect(stepFront).toContain('ADVANCED_FACE')
    const stepBack = kernel.exportStep(result.back)
    expect(stepBack).toContain('ADVANCED_FACE')

    // upper' 应在切割面上方有凸楔（体积 > 原上半部分）
    // lower' 应有凹腔（体积 < 原下半部分）
    const frontVol = kernel.getVolume(result.front)
    const backVol = kernel.getVolume(result.back)
    expect(frontVol).toBeGreaterThan(0)
    expect(backVol).toBeGreaterThan(0)

    kernel.release(box)
    kernel.release(result.front)
    kernel.release(result.back)
  })
})

// ─── dowelOrTenonBooleanSplitBrep ───

describe('dowelOrTenonBooleanSplitBrep', () => {
  it('should split a box with dowel (cylinder) joinery', () => {
    const box = kernel.makeBoxFromCorners({ x: -10, y: -10, z: -10 }, { x: 10, y: 10, z: 10 })

    const result = dowelOrTenonBooleanSplitBrep(
      kernel, box, defaultBasis, 'dowel',
      { size: 6, sizeTolerance: 0.2, height: 8, heightTolerance: 0.2 },
      null,
    )

    expect(result.front).toBeDefined()
    expect(result.back).toBeDefined()

    const stepFront = kernel.exportStep(result.front)
    expect(stepFront).toContain('ADVANCED_FACE')
    const stepBack = kernel.exportStep(result.back)
    expect(stepBack).toContain('ADVANCED_FACE')

    const frontVol = kernel.getVolume(result.front)
    const backVol = kernel.getVolume(result.back)
    expect(frontVol).toBeGreaterThan(0)
    expect(backVol).toBeGreaterThan(0)

    kernel.release(box)
    kernel.release(result.front)
    kernel.release(result.back)
  })

  it('should split a box with tenon (box) joinery', () => {
    const box = kernel.makeBoxFromCorners({ x: -10, y: -10, z: -10 }, { x: 10, y: 10, z: 10 })

    const result = dowelOrTenonBooleanSplitBrep(
      kernel, box, defaultBasis, 'tenon',
      { size: 8, sizeTolerance: 0.2, height: 8, heightTolerance: 0.2 },
      null,
    )

    expect(result.front).toBeDefined()
    expect(result.back).toBeDefined()

    const stepFront = kernel.exportStep(result.front)
    expect(stepFront).toContain('ADVANCED_FACE')
    const stepBack = kernel.exportStep(result.back)
    expect(stepBack).toContain('ADVANCED_FACE')

    const frontVol = kernel.getVolume(result.front)
    const backVol = kernel.getVolume(result.back)
    expect(frontVol).toBeGreaterThan(0)
    expect(backVol).toBeGreaterThan(0)

    kernel.release(box)
    kernel.release(result.front)
    kernel.release(result.back)
  })

  it('upper should have larger volume than plain split (dowel added)', () => {
    const box = kernel.makeBoxFromCorners({ x: -10, y: -10, z: -10 }, { x: 10, y: 10, z: 10 })

    // 平面分割的 upper 体积
    const plainSplit = splitBrep(kernel, box, {
      normal: [0, 0, 1],
      originOffset: 0,
      planeCenter: [0, 0, 0],
    })
    const plainUpperVol = kernel.getVolume(plainSplit.front)
    kernel.release(plainSplit.front)
    kernel.release(plainSplit.back)

    // dowel 分割的 upper 体积（应 > 平面分割，因为加了圆柱）
    const result = dowelOrTenonBooleanSplitBrep(
      kernel, box, defaultBasis, 'dowel',
      { size: 6, sizeTolerance: 0.2, height: 8, heightTolerance: 0.2 },
      null,
    )
    const dowelUpperVol = kernel.getVolume(result.front)
    expect(dowelUpperVol).toBeGreaterThan(plainUpperVol)

    kernel.release(box)
    kernel.release(result.front)
    kernel.release(result.back)
  })
})
