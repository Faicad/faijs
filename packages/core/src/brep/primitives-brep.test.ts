/**
 * @vitest-environment node
 *
 * BREP 基本体 API 单元测试
 *
 * 测试内容：
 * 1. boxBrep/sphereBrep/cylinderBrep/coneBrep/wedgeBrep 返回有效 Shape
 * 2. Shape 的 positions/indices 非空、长度合理
 * 3. 包围盒尺寸与参数一致
 * 4. center 偏移正确
 * 5. Vec3 size（box）正确映射
 * 6. 与 mesh 路径（cad.box 等）的等价性对比（外形一致，三角数可不同）
 *
 * 运行：npx vitest run src/brep/primitives-brep.test.ts
 */

// ─── OCCT stdout 噪声过滤（与 src/primitives/brep-primitives 相关测试一致） ───
const occtOrigLog = console.log
console.log = (...args: unknown[]) => {
  const msg = args.map(String).join(' ')
  const isOcctNoise =
    msg.includes('Statistics on Transfer') ||
    msg.includes('Transfer Mode =') ||
    msg.includes('Transferring Shape') ||
    msg.includes('WorkSession') ||
    /^\*{4,}/.test(msg) ||
    msg.startsWith(' Step File Name')
  if (isOcctNoise || msg.trim() === '') return
  occtOrigLog(...args)
}

import { describe, it, expect, beforeAll } from 'vitest'
import { getKernel } from '../occt-kernel/occtKernel'
import { registerOcctBrepEngine } from './engine/adapters/occt'
import { cad } from '../mesh/index'
import type { Shape } from '../mesh/types'
import { primitiveToBrepSolid, brepSolidToStep } from '../primitives/brep-primitives'
import type { BrepEngineApi } from './engine/primitives'

let kernel: BrepEngineApi

beforeAll(async () => {
  await registerOcctBrepEngine()
  kernel = getKernel() as unknown as BrepEngineApi
}, 120000)

// ── 辅助函数 ──

function shapeVertexCount(s: Shape): number {
  return s.positions.length / 3
}

function shapeTriangleCount(s: Shape): number {
  return s.indices.length / 3
}

/** 从 Shape 计算包围盒 */
function shapeBoundingBox(s: Shape): { min: [number, number, number]; max: [number, number, number] } {
  let xmin = Infinity, ymin = Infinity, zmin = Infinity
  let xmax = -Infinity, ymax = -Infinity, zmax = -Infinity
  for (let i = 0; i < s.positions.length; i += 3) {
    const x = s.positions[i]
    const y = s.positions[i + 1]
    const z = s.positions[i + 2]
    if (x < xmin) xmin = x
    if (y < ymin) ymin = y
    if (z < zmin) zmin = z
    if (x > xmax) xmax = x
    if (y > ymax) ymax = y
    if (z > zmax) zmax = z
  }
  return { min: [xmin, ymin, zmin], max: [xmax, ymax, zmax] }
}

// ── 基本有效性测试 ──

describe('BREP primitives: basic validity', () => {
  it('boxBrep: returns valid Shape with positions and indices', async () => {
    const s = await cad.boxBrep({ width: 20, depth: 20, height: 20, centered: true })
    expect(s.positions).toBeInstanceOf(Float32Array)
    expect(s.indices).toBeInstanceOf(Uint32Array)
    expect(shapeVertexCount(s)).toBeGreaterThan(0)
    expect(shapeTriangleCount(s)).toBeGreaterThan(0)
  })

  it('sphereBrep: returns valid Shape', async () => {
    const s = await cad.sphereBrep({ radius: 10 })
    expect(shapeVertexCount(s)).toBeGreaterThan(0)
    expect(shapeTriangleCount(s)).toBeGreaterThan(0)
  })

  it('cylinderBrep: returns valid Shape', async () => {
    const s = await cad.cylinderBrep({ radius: 10, height: 20 })
    expect(shapeVertexCount(s)).toBeGreaterThan(0)
    expect(shapeTriangleCount(s)).toBeGreaterThan(0)
  })

  it('coneBrep: returns valid Shape', async () => {
    const s = await cad.coneBrep({ radiusBottom: 10, radiusTop: 0, height: 20 })
    expect(shapeVertexCount(s)).toBeGreaterThan(0)
    expect(shapeTriangleCount(s)).toBeGreaterThan(0)
  })

  it('wedgeBrep: returns valid Shape', async () => {
    const s = await cad.wedgeBrep({ width: 20, height: 10, angle: 60, length: 50 })
    expect(shapeVertexCount(s)).toBeGreaterThan(0)
    expect(shapeTriangleCount(s)).toBeGreaterThan(0)
  })
})

// ── 包围盒尺寸测试 ──

describe('BREP primitives: bounding box dimensions', () => {
  it('boxBrep: 20×20×20 cube', async () => {
    const s = await cad.boxBrep({ width: 20, depth: 20, height: 20, centered: true })
    const bb = shapeBoundingBox(s)
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(20, 1)
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(20, 1)
    expect(bb.max[2] - bb.min[2]).toBeCloseTo(20, 1)
  })

  it('boxBrep: Vec3 size [10, 20, 30]', async () => {
    const s = await cad.boxBrep({ width: 10, depth: 20, height: 30, centered: true })
    const bb = shapeBoundingBox(s)
    const dims = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]].sort((a, b) => a - b)
    expect(dims[0]).toBeCloseTo(10, 1)
    expect(dims[1]).toBeCloseTo(20, 1)
    expect(dims[2]).toBeCloseTo(30, 1)
  })

  it('sphereBrep: radius 10 → diameter 20', async () => {
    const s = await cad.sphereBrep({ radius: 10 })
    const bb = shapeBoundingBox(s)
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(20, 1)
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(20, 1)
    expect(bb.max[2] - bb.min[2]).toBeCloseTo(20, 1)
  })

  it('cylinderBrep: radius 10, height 20', async () => {
    const s = await cad.cylinderBrep({ radius: 10, height: 20 })
    const bb = shapeBoundingBox(s)
    // 圆柱沿 Z 轴，X/Y 直径 = 20，Z 高度 = 20
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(20, 1)
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(20, 1)
    expect(bb.max[2] - bb.min[2]).toBeCloseTo(20, 1)
  })

  it('cylinderBrep: radius 5, height 30 (non-cubic)', async () => {
    const s = await cad.cylinderBrep({ radius: 5, height: 30 })
    const bb = shapeBoundingBox(s)
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(10, 1) // diameter
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(10, 1) // diameter
    expect(bb.max[2] - bb.min[2]).toBeCloseTo(30, 1) // height
  })

  it('coneBrep: radiusBottom 10, radiusTop 0, height 20', async () => {
    const s = await cad.coneBrep({ radiusBottom: 10, radiusTop: 0, height: 20 })
    const bb = shapeBoundingBox(s)
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(20, 1) // base diameter
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(20, 1) // base diameter
    expect(bb.max[2] - bb.min[2]).toBeCloseTo(20, 1) // height
  })

  it('coneBrep: truncated cone (radiusBottom 10, radiusTop 5, height 15)', async () => {
    const s = await cad.coneBrep({ radiusBottom: 10, radiusTop: 5, height: 15 })
    const bb = shapeBoundingBox(s)
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(20, 1) // base diameter
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(20, 1)
    expect(bb.max[2] - bb.min[2]).toBeCloseTo(15, 1) // height
  })

  it('wedgeBrep: extrude length 50, width 20, height 10', async () => {
    const s = await cad.wedgeBrep({ width: 20, height: 10, angle: 60, length: 50 })
    const bb = shapeBoundingBox(s)
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(50, 0) // extrude length
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(20, 0) // width
    expect(bb.max[2] - bb.min[2]).toBeCloseTo(10, 0) // height
  })
})

// ── center 偏移测试 ──

describe('BREP primitives: center offset', () => {
  it('boxBrep: center [100, 0, 0] shifts bbox', async () => {
    const s = await cad.boxBrep({ width: 10, depth: 10, height: 10, centered: true, at: [100, 0, 0] })
    const bb = shapeBoundingBox(s)
    expect(bb.min[0]).toBeCloseTo(95, 1)
    expect(bb.max[0]).toBeCloseTo(105, 1)
  })

  it('sphereBrep: center [0, 50, 0] shifts bbox', async () => {
    const s = await cad.sphereBrep({ radius: 10, center: [0, 50, 0] })
    const bb = shapeBoundingBox(s)
    expect(bb.min[1]).toBeCloseTo(40, 1)
    expect(bb.max[1]).toBeCloseTo(60, 1)
  })

  it('cylinderBrep: at [0, 0, 100] centered shifts bbox', async () => {
    const s = await cad.cylinderBrep({ radius: 5, height: 10, centered: true, at: [0, 0, 100] })
    const bb = shapeBoundingBox(s)
    expect(bb.min[2]).toBeCloseTo(95, 1)
    expect(bb.max[2]).toBeCloseTo(105, 1)
  })
})

// ── 居中测试：所有基本体默认以原点为中心 ──

describe('BREP primitives: centered at origin by default', () => {
  it('boxBrep: centered at origin', async () => {
    const s = await cad.boxBrep({ width: 20, depth: 20, height: 20, centered: true })
    const bb = shapeBoundingBox(s)
    expect(bb.min[0]).toBeCloseTo(-10, 1)
    expect(bb.max[0]).toBeCloseTo(10, 1)
    expect(bb.min[2]).toBeCloseTo(-10, 1)
    expect(bb.max[2]).toBeCloseTo(10, 1)
  })

  it('cylinderBrep: centered at origin', async () => {
    const s = await cad.cylinderBrep({ radius: 10, height: 20, centered: true })
    const bb = shapeBoundingBox(s)
    expect(bb.min[2]).toBeCloseTo(-10, 1)
    expect(bb.max[2]).toBeCloseTo(10, 1)
  })

  it('coneBrep: centered at origin', async () => {
    const s = await cad.coneBrep({ radiusBottom: 10, radiusTop: 0, height: 20, centered: true })
    const bb = shapeBoundingBox(s)
    expect(bb.min[2]).toBeCloseTo(-10, 1)
    expect(bb.max[2]).toBeCloseTo(10, 1)
  })
})

// ── BREP 精确性验证：导出 STEP 含精确曲面 ──

describe('BREP primitives: STEP export has precise surfaces', () => {
  it('boxBrep: underlying solid exports as ADVANCED_FACE with PLANE', async () => {
    // BREP 函数内部用 primitiveToBrepSolid 构造实体，我们直接验证实体导出
    const result = primitiveToBrepSolid(kernel, 'box', { width: 20, depth: 20, height: 20, centered: true })
    try {
      const step = brepSolidToStep(kernel, result.solid)
      expect(step).toContain('ADVANCED_FACE')
      expect(step).toContain('PLANE')
      expect(step).not.toContain('POLYGONAL_FACE')
    } finally {
      kernel.release(result.solid)
    }
  })

  it('cylinderBrep: underlying solid has CYLINDRICAL_SURFACE', async () => {
    const result = primitiveToBrepSolid(kernel, 'cylinder', { radius: 10, height: 20 })
    try {
      const step = brepSolidToStep(kernel, result.solid)
      expect(step).toContain('CYLINDRICAL_SURFACE')
      expect(step).not.toContain('POLYGONAL_FACE')
    } finally {
      kernel.release(result.solid)
    }
  })

  it('coneBrep: underlying solid has CONICAL_SURFACE', async () => {
    const result = primitiveToBrepSolid(kernel, 'cone', { radiusBottom: 10, radiusTop: 0, height: 20 })
    try {
      const step = brepSolidToStep(kernel, result.solid)
      expect(step).toContain('CONICAL_SURFACE')
      expect(step).not.toContain('POLYGONAL_FACE')
    } finally {
      kernel.release(result.solid)
    }
  })

  it('sphereBrep: underlying solid has SPHERICAL_SURFACE', async () => {
    const result = primitiveToBrepSolid(kernel, 'sphere', { radius: 10 })
    try {
      const step = brepSolidToStep(kernel, result.solid)
      expect(step).toContain('SPHERICAL_SURFACE')
      expect(step).not.toContain('POLYGONAL_FACE')
    } finally {
      kernel.release(result.solid)
    }
  })
})

// ── BREP vs mesh 等价性对比 ──

describe('BREP vs mesh: geometry equivalence', () => {
  it('box: BREP and mesh have same bounding box', async () => {
    const brepShape = await cad.boxBrep({ width: 20, depth: 20, height: 20, centered: true })
    const meshShape = cad.box({ width: 20, depth: 20, height: 20, centered: true })
    const brepBB = shapeBoundingBox(brepShape)
    const meshBB = shapeBoundingBox(meshShape)

    expect(brepBB.max[0] - brepBB.min[0]).toBeCloseTo(meshBB.max[0] - meshBB.min[0], 1)
    expect(brepBB.max[1] - brepBB.min[1]).toBeCloseTo(meshBB.max[1] - meshBB.min[1], 1)
    expect(brepBB.max[2] - brepBB.min[2]).toBeCloseTo(meshBB.max[2] - meshBB.min[2], 1)
  })

  it('cylinder: BREP and mesh have same bounding box', async () => {
    const brepShape = await cad.cylinderBrep({ radius: 10, height: 20 })
    const meshShape = cad.cylinder({ radius: 10, height: 20 })
    const brepBB = shapeBoundingBox(brepShape)
    const meshBB = shapeBoundingBox(meshShape)

    expect(brepBB.max[0] - brepBB.min[0]).toBeCloseTo(meshBB.max[0] - meshBB.min[0], 1)
    expect(brepBB.max[2] - brepBB.min[2]).toBeCloseTo(meshBB.max[2] - meshBB.min[2], 1)
  })

  it('wedge: BREP and mesh have same bounding box', async () => {
    const brepShape = await cad.wedgeBrep({ width: 20, height: 10, angle: 60, length: 50 })
    const meshShape = cad.wedge({ width: 20, height: 10, angle: 60, length: 50 })
    const brepBB = shapeBoundingBox(brepShape)
    const meshBB = shapeBoundingBox(meshShape)

    expect(brepBB.max[0] - brepBB.min[0]).toBeCloseTo(meshBB.max[0] - meshBB.min[0], 0)
    expect(brepBB.max[1] - brepBB.min[1]).toBeCloseTo(meshBB.max[1] - meshBB.min[1], 0)
    expect(brepBB.max[2] - brepBB.min[2]).toBeCloseTo(meshBB.max[2] - meshBB.min[2], 0)
  })
})

// ── 向后兼容：size 数字形式仍可用 ──

describe('primitiveToBrepSolid: backward compat with size number', () => {
  it('cube with size=20 (number) works', () => {
    const result = primitiveToBrepSolid(kernel, 'cube', 20)
    try {
      const bb = kernel.getBoundingBox(result.solid, false)
      expect(bb.xmax - bb.xmin).toBeCloseTo(20, 1)
      expect(bb.ymax - bb.ymin).toBeCloseTo(20, 1)
      expect(bb.zmax - bb.zmin).toBeCloseTo(20, 1)
    } finally {
      kernel.release(result.solid)
    }
  })

  it('box with full params object (width/depth/height) works', () => {
    const result = primitiveToBrepSolid(kernel, 'box', { width: 30, depth: 30, height: 30, centered: true })
    try {
      const bb = kernel.getBoundingBox(result.solid, false)
      expect(bb.xmax - bb.xmin).toBeCloseTo(30, 1)
    } finally {
      kernel.release(result.solid)
    }
  })

  it('cylinder with params object { radius: 5, height: 15 } works', () => {
    const result = primitiveToBrepSolid(kernel, 'cylinder', { radius: 5, height: 15 })
    try {
      const bb = kernel.getBoundingBox(result.solid, false)
      expect(bb.xmax - bb.xmin).toBeCloseTo(10, 1) // diameter
      expect(bb.zmax - bb.zmin).toBeCloseTo(15, 1) // height
    } finally {
      kernel.release(result.solid)
    }
  })

  it('cone with params object { radiusBottom: 8, radiusTop: 3, height: 12 } works', () => {
    const result = primitiveToBrepSolid(kernel, 'cone', { radiusBottom: 8, radiusTop: 3, height: 12 })
    try {
      const bb = kernel.getBoundingBox(result.solid, false)
      expect(bb.xmax - bb.xmin).toBeCloseTo(16, 1) // base diameter
      expect(bb.zmax - bb.zmin).toBeCloseTo(12, 1) // height
    } finally {
      kernel.release(result.solid)
    }
  })

  it('cube with center offset via params', () => {
    const result = primitiveToBrepSolid(kernel, 'box', { width: 10, depth: 10, height: 10, centered: true, at: [50, 0, 0] })
    try {
      const bb = kernel.getBoundingBox(result.solid, false)
      expect(bb.xmin).toBeCloseTo(45, 1)
      expect(bb.xmax).toBeCloseTo(55, 1)
    } finally {
      kernel.release(result.solid)
    }
  })

  it('sphere with params object { radius: 7 } works', () => {
    const result = primitiveToBrepSolid(kernel, 'sphere', { radius: 7 })
    try {
      const bb = kernel.getBoundingBox(result.solid, false)
      expect(bb.xmax - bb.xmin).toBeCloseTo(14, 1) // diameter
    } finally {
      kernel.release(result.solid)
    }
  })
})
