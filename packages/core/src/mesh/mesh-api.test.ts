/**
 * mesh API 单元测试
 *
 * 验证 mesh 的每个 API 正确包装了底层纯函数。
 * P1 阶段：mesh 是薄包装层，行为与底层函数完全一致。
 *
 * 注意：布尔/分割/钻孔/拉伸操作依赖 Web Worker（csg-worker），
 * 在 node 环境下不可用。这些操作的几何正确性由现有 E2E 测试覆盖。
 * 此文件只测试不依赖 Worker 的 API（创建、变换、查询）和 API 契约。
 */

import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { cad } from './index'
import type { Shape } from './types'

// ── 工具函数 ──

function shapeVertexCount(s: Shape): number {
  return s.positions.length / 3
}

function shapeTriangleCount(s: Shape): number {
  return s.indices.length / 3
}

// ── 创建 API ──

describe('mesh-api: primitives', () => {
  it('box: 创建立方体（数值 size）', () => {
    const s = cad.box({ size: 20 })
    expect(shapeVertexCount(s)).toBeGreaterThan(0)
    expect(shapeTriangleCount(s)).toBeGreaterThan(0)

    const bb = cad.boundingBox(s)
    const w = bb.max[0] - bb.min[0]
    expect(w).toBeCloseTo(20, 1)
  })

  it('box: 支持 Vec3 size（非等边）', () => {
    const s = cad.box({ size: [10, 20, 30] })
    const bb = cad.boundingBox(s)
    // BoxGeometry(w, h, d) rotated to Z-up: X=w, Y=d, Z=h (after ROT_Y_TO_Z)
    // After rotation X→Y, Y→Z, Z→X swap... let's just check it's not a cube
    const w = bb.max[0] - bb.min[0]
    const h = bb.max[1] - bb.min[1]
    const d = bb.max[2] - bb.min[2]
    // At least one dimension should differ from 20 (the old default)
    const dims = [w, h, d].sort((a, b) => a - b)
    expect(dims[0]).toBeCloseTo(10, 1)
    expect(dims[1]).toBeCloseTo(20, 1)
    expect(dims[2]).toBeCloseTo(30, 1)
  })

  it('box: 支持 center', () => {
    const s = cad.box({ size: 10, center: [100, 0, 0] })
    const bb = cad.boundingBox(s)
    expect(bb.min[0]).toBeCloseTo(95, 1)
    expect(bb.max[0]).toBeCloseTo(105, 1)
  })

  it('sphere: 创建球体', () => {
    const s = cad.sphere({ radius: 10 })
    expect(shapeVertexCount(s)).toBeGreaterThan(0)

    const bb = cad.boundingBox(s)
    const d = bb.max[0] - bb.min[0]
    expect(d).toBeCloseTo(20, 0) // diameter = 2 * radius
  })

  it('cylinder: 创建圆柱体', () => {
    const s = cad.cylinder({ radius: 5, height: 20 })
    expect(shapeVertexCount(s)).toBeGreaterThan(0)

    const bb = cad.boundingBox(s)
    // Cylinder is Z-up: height along Z, radius in XY
    expect(bb.max[2] - bb.min[2]).toBeCloseTo(20, 1)
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(10, 1)
  })

  it('cone: 创建圆锥体', () => {
    const s = cad.cone({ radiusBottom: 10, radiusTop: 0, height: 20 })
    expect(shapeVertexCount(s)).toBeGreaterThan(0)

    const bb = cad.boundingBox(s)
    expect(bb.max[2] - bb.min[2]).toBeCloseTo(20, 1)
  })

  it('wedge: 创建楔形体', () => {
    const s = cad.wedge({ width: 20, height: 10, angle: 60, length: 50 })
    expect(shapeVertexCount(s)).toBeGreaterThan(0)
    expect(shapeTriangleCount(s)).toBeGreaterThan(0)
  })

  it.skip('svgExtrude: 从 SVG 创建几何（需要 DOMParser）', () => {
    // SVGLoader.parse 需要 DOMParser，仅在 jsdom 环境可用
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect x="10" y="10" width="80" height="80"/></svg>'
    const s = cad.svgExtrude({ svg, depth: 5, targetLongSide: 100, naturalWidth: 100, naturalHeight: 100 })
    expect(shapeVertexCount(s)).toBeGreaterThan(0)
    expect(shapeTriangleCount(s)).toBeGreaterThan(0)
  })
})

// ── 变换 API ──

describe('mesh-api: transform', () => {
  it('translate: 平移几何', () => {
    const s = cad.box({ size: 10 })
    const translated = cad.translate(s, [100, 0, 0])

    const bb = cad.boundingBox(translated)
    expect(bb.min[0]).toBeCloseTo(95, 1)
    expect(bb.max[0]).toBeCloseTo(105, 1)

    // 原始不受影响（不可变）
    const origBb = cad.boundingBox(s)
    expect(origBb.min[0]).toBeCloseTo(-5, 1)
  })

  it('rotate: 旋转几何', () => {
    const s = cad.box({ size: 10 })
    const rotated = cad.rotate(s, [90, 0, 0])

    // 旋转后仍然是立方体，包围盒不变
    const bb = cad.boundingBox(rotated)
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(10, 1)
  })

  it('rotate: 带 pivot 旋转', () => {
    const s = cad.box({ size: 10, center: [0, 0, 0] })
    const rotated = cad.rotate(s, [0, 0, 90], [100, 0, 0])

    // 围绕 (100,0,0) 旋转 90° → 原本在 (5,0,0) 的点变到 (100,5,0)
    const bb = cad.boundingBox(rotated)
    expect(bb.min[0]).toBeCloseTo(95, 0)
    expect(bb.max[0]).toBeCloseTo(105, 0)
  })

  it('scale: 缩放几何', () => {
    const s = cad.box({ size: 10 })
    const scaled = cad.scale(s, 2)

    const bb = cad.boundingBox(scaled)
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(20, 1)
  })

  it('scale: 支持 Vec3 factor', () => {
    const s = cad.box({ size: 10 })
    const scaled = cad.scale(s, [2, 3, 4])

    const bb = cad.boundingBox(scaled)
    const dims = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]].sort((a, b) => a - b)
    expect(dims[0]).toBeCloseTo(20, 1)
    expect(dims[1]).toBeCloseTo(30, 1)
    expect(dims[2]).toBeCloseTo(40, 1)
  })

  it('transformMatrix: 用 Matrix4 变换', () => {
    const s = cad.box({ size: 10 })
    const matrix = new THREE.Matrix4().makeTranslation(50, 0, 0)
    const transformed = cad.transformMatrix(s, matrix)

    const bb = cad.boundingBox(transformed)
    expect(bb.min[0]).toBeCloseTo(45, 1)
  })
})

// ── 查询 API ──

describe('mesh-api: query', () => {
  it('boundingBox: 计算包围盒', () => {
    const s = cad.box({ size: 20 })
    const bb = cad.boundingBox(s)
    expect(bb.min[0]).toBeCloseTo(-10, 1)
    expect(bb.max[0]).toBeCloseTo(10, 1)
  })

  it('bboxCenter: 计算包围盒中心', () => {
    const s = cad.box({ size: 20, center: [100, 0, 0] })
    const center = cad.bboxCenter(s)
    expect(center[0]).toBeCloseTo(100, 1)
  })

  it('volume: 计算立方体体积', () => {
    const s = cad.box({ size: 20 })
    const vol = cad.volume(s)
    expect(vol).toBeCloseTo(8000, 0) // 20^3 = 8000
  })

  it('volume: 计算球体体积（近似）', () => {
    const s = cad.sphere({ radius: 10 })
    const vol = cad.volume(s)
    const expected = (4 / 3) * Math.PI * 1000 // 4/3 * π * r³
    // 球体网格是近似的，允许 5% 误差
    expect(vol).toBeCloseTo(expected, -2) // 精确到百位
  })

  it('faceAt: 查找面', () => {
    const s = cad.box({ size: 20 })
    // 在顶面中心找面
    const face = cad.faceAt(s, { point: [0, 0, 10], normal: [0, 0, 1] })
    expect(face).not.toBeNull()
    expect(face!.normal[2]).toBeCloseTo(1, 1) // 法向接近 +Z
    expect(face!.area).toBeGreaterThan(0)
  })

  it('faceAt: 无法匹配时返回最佳候选', () => {
    const s = cad.box({ size: 20 })
    const face = cad.faceAt(s, { point: [100, 100, 100] })
    // 仍然返回最近的面（即使距离很远）
    expect(face).not.toBeNull()
  })
})

// ── 不可变性 ──

describe('mesh-api: immutability', () => {
  it('translate 不修改输入', () => {
    const s = cad.box({ size: 10 })
    const original = new Float32Array(s.positions)
    cad.translate(s, [100, 0, 0])
    expect(Array.from(s.positions)).toEqual(Array.from(original))
  })

  it('scale 不修改输入', () => {
    const s = cad.box({ size: 10 })
    const original = new Float32Array(s.positions)
    cad.scale(s, 2)
    expect(Array.from(s.positions)).toEqual(Array.from(original))
  })

  it('rotate 不修改输入', () => {
    const s = cad.box({ size: 10 })
    const original = new Float32Array(s.positions)
    cad.rotate(s, [45, 30, 60])
    expect(Array.from(s.positions)).toEqual(Array.from(original))
  })
})

// ── API 契约 ──

describe('mesh-api: API contract', () => {
  it('cad 对象包含所有设计文档 §5.2 中定义的创建 API', () => {
    expect(typeof cad.box).toBe('function')
    expect(typeof cad.sphere).toBe('function')
    expect(typeof cad.cylinder).toBe('function')
    expect(typeof cad.cone).toBe('function')
    expect(typeof cad.wedge).toBe('function')
    expect(typeof cad.text).toBe('function')
    expect(typeof cad.screw).toBe('function')
    expect(typeof cad.svgExtrude).toBe('function')
  })

  it('cad 对象包含所有变换 API', () => {
    expect(typeof cad.translate).toBe('function')
    expect(typeof cad.rotate).toBe('function')
    expect(typeof cad.scale).toBe('function')
  })

  it('cad 对象包含所有布尔 API', () => {
    expect(typeof cad.union).toBe('function')
    expect(typeof cad.subtract).toBe('function')
    expect(typeof cad.intersect).toBe('function')
  })

  it('cad 对象包含所有分割 API', () => {
    expect(typeof cad.fai_split).toBe('function')
    expect(typeof cad.dovetailSplit).toBe('function')
    expect(typeof cad.dowelSplit).toBe('function')
    expect(typeof cad.tenonSplit).toBe('function')
  })

  it('cad 对象包含钻孔/拉伸/雕刻 API', () => {
    expect(typeof cad.fai_drill).toBe('function')
    expect(typeof cad.fai_extrude).toBe('function')
    expect(typeof cad.engrave).toBe('function')
    expect(typeof cad.knurl).toBe('function')
  })

  it('cad 对象包含查询 API', () => {
    expect(typeof cad.boundingBox).toBe('function')
    expect(typeof cad.bboxCenter).toBe('function')
    expect(typeof cad.volume).toBe('function')
    expect(typeof cad.faceAt).toBe('function')
  })

  it('cad 对象包含 IO API', () => {
    expect(typeof cad.load).toBe('function')
  })

  it('Shape 类型包含 positions 和 indices', () => {
    const s = cad.box({ size: 10 })
    expect(s.positions).toBeInstanceOf(Float32Array)
    expect(s.indices).toBeInstanceOf(Uint32Array)
    expect(s.positions.length).toBeGreaterThan(0)
    expect(s.indices.length).toBeGreaterThan(0)
  })
})

// ── Worker 依赖测试（skip：需要浏览器环境）──

describe.skip('mesh-api: boolean (requires Worker)', () => {
  it('union: 两个立方体并集', async () => {
    const a = cad.box({ size: 20 })
    const b = cad.translate(cad.box({ size: 20 }), [10, 0, 0])
    const result = await cad.union(a, b)

    expect(shapeTriangleCount(result)).toBeGreaterThan(0)
    const vol = cad.volume(result)
    expect(vol).toBeGreaterThan(7000)
    expect(vol).toBeLessThan(16000)
  })

  it('subtract: 立方体减球体', async () => {
    const box = cad.box({ size: 20 })
    const sph = cad.sphere({ radius: 5 })
    const result = await cad.subtract(box, sph)

    const vol = cad.volume(result)
    expect(vol).toBeLessThan(cad.volume(box))
  })

  it('intersect: 两个立方体交集', async () => {
    const a = cad.box({ size: 20 })
    const b = cad.translate(cad.box({ size: 20 }), [10, 0, 0])
    const result = await cad.intersect(a, b)

    const vol = cad.volume(result)
    expect(vol).toBeCloseTo(4000, -2)
  })
})

describe.skip('mesh-api: split (requires Worker)', () => {
  it('split: 平面分割立方体', async () => {
    const s = cad.box({ size: 20 })
    const result = await cad.fai_split(s, { normal: [0, 0, 1], offset: 0 })

    expect(result.front.positions.length).toBeGreaterThan(0)
    expect(result.back.positions.length).toBeGreaterThan(0)
  })
})

describe.skip('mesh-api: drill (requires Worker)', () => {
  it('drill: 在立方体上钻孔', async () => {
    const box = cad.box({ size: 20 })
    const result = await cad.fai_drill(box, {
      diameter: 5,
      type: 'through',
      position: [0, 0, 10],
      direction: [0, 0, -1],
      faceNormal: [0, 0, 1],
    })

    expect(cad.volume(result)).toBeLessThan(cad.volume(box))
  })
})

describe.skip('mesh-api: extrude (requires Worker)', () => {
  it('extrude: 拉伸立方体中段', async () => {
    const box = cad.box({ size: 20 })
    const result = await cad.fai_extrude(box, {
      normal: [0, 0, 1],
      originOffset: 0,
      length: 10,
      mode: 'centered',
    })

    expect(cad.volume(result)).toBeGreaterThan(cad.volume(box))
  })
})
