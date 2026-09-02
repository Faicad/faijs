/**
 * @vitest-environment node
 *
 * Thread BREP 操作单元测试
 *
 * 测试内容：
 * 1. threadBrep 产出有效 OCCT solid
 * 2. STEP 导出含 ADVANCED_FACE（非 POLYGONAL_FACE）
 * 3. 外螺纹 + fuse 集成测试
 * 4. 内螺纹 + cut 集成测试
 * 5. 参数校验
 *
 * 运行：npx vitest run src/brep/brepjs-mirror/threadFns.test.ts
 */

// ─── OCCT stdout 噪声过滤 ───
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
import { initOcctWasm, getKernel } from '../../occt-kernel/occtKernel'
import type { BrepEngineApi } from '../../brep/engine/primitives'
import { threadBrep } from './threadFns'
import { solidToShape } from '../../brep/brep-ops'
import { getSolidBoundingBox } from '../../brep/brep-utils'

let kernel: BrepEngineApi

beforeAll(async () => {
  await initOcctWasm()
  kernel = getKernel() as unknown as BrepEngineApi
}, 120000)

describe('threadBrep', () => {
  it('should produce a valid OCCT solid (external thread)', () => {
    const thread = threadBrep(kernel, {
      radius: 6,
      pitch: 2.5,
      height: 7.5,
    })

    // 验证句柄有效
    expect(thread).toBeDefined()

    // 验证可以三角化
    const shape = solidToShape(kernel, thread)
    expect(shape.positions.length).toBeGreaterThan(0)
    expect(shape.indices.length).toBeGreaterThan(0)

    // 验证包围盒在合理范围内
    const bbox = getSolidBoundingBox(kernel, thread)
    expect(bbox.max[2] - bbox.min[2]).toBeGreaterThan(5) // height ~7.5
    expect(bbox.max[2] - bbox.min[2]).toBeLessThan(10)

    kernel.release(thread)
  })

  it('should produce a valid OCCT solid (internal thread)', () => {
    const thread = threadBrep(kernel, {
      radius: 3,
      pitch: 1,
      height: 6,
      inward: true,
    })

    expect(thread).toBeDefined()

    const shape = solidToShape(kernel, thread)
    expect(shape.positions.length).toBeGreaterThan(0)
    expect(shape.indices.length).toBeGreaterThan(0)

    kernel.release(thread)
  })

  it('should produce STEP with ADVANCED_FACE (not POLYGONAL_FACE)', () => {
    const thread = threadBrep(kernel, {
      radius: 5,
      pitch: 2,
      height: 4,
    })

    const step = kernel.exportStep(thread)
    expect(step).toContain('ADVANCED_FACE')
    expect(step).not.toContain('POLYGONAL_FACE')

    kernel.release(thread)
  })

  it('should fuse with a cylinder (external thread assembly)', { timeout: 30000 }, () => {
    // 螺杆
    const rod = kernel.makeCylinder(6, 10)
    // 螺纹
    const thread = threadBrep(kernel, {
      radius: 6,
      pitch: 2.5,
      height: 7.5,
    })

    // fuse
    const result = kernel.fuse(rod, thread)
    expect(result).toBeDefined()

    // 验证 STEP
    const step = kernel.exportStep(result)
    expect(step).toContain('ADVANCED_FACE')

    kernel.release(rod)
    kernel.release(thread)
    kernel.release(result)
  })

  it('should cut from a block (internal thread assembly)', { timeout: 30000 }, () => {
    // 底孔
    const block = kernel.makeBoxFromCorners(
      { x: 0, y: 0, z: 0 },
      { x: 20, y: 20, z: 20 },
    )
    const hole = kernel.makeCylinder(3, 20)
    const bored = kernel.cut(block, hole)

    // 内螺纹
    const thread = threadBrep(kernel, {
      radius: 3,
      pitch: 1,
      height: 15,
      inward: true,
    })

    // cut
    const result = kernel.cut(bored, thread)
    expect(result).toBeDefined()

    // 验证 STEP
    const step = kernel.exportStep(result)
    expect(step).toContain('ADVANCED_FACE')

    kernel.release(block)
    kernel.release(hole)
    kernel.release(bored)
    kernel.release(thread)
    kernel.release(result)
  })

  it('should support trapezoidal teeth (crest > 0)', () => {
    const thread = threadBrep(kernel, {
      radius: 6,
      pitch: 2.5,
      height: 5,
      crest: 0.18 * 2.5, // Acme/trapezoidal
    })

    expect(thread).toBeDefined()

    const shape = solidToShape(kernel, thread)
    expect(shape.positions.length).toBeGreaterThan(0)

    const step = kernel.exportStep(thread)
    expect(step).toContain('ADVANCED_FACE')

    kernel.release(thread)
  })

  it('should support left-handed thread', () => {
    const thread = threadBrep(kernel, {
      radius: 6,
      pitch: 2.5,
      height: 5,
      lefthand: true,
    })

    expect(thread).toBeDefined()

    const shape = solidToShape(kernel, thread)
    expect(shape.positions.length).toBeGreaterThan(0)

    kernel.release(thread)
  })

  // ── 参数校验 ──

  it('should reject invalid radius', () => {
    expect(() => threadBrep(kernel, { radius: -1, pitch: 2, height: 5 }))
      .toThrow('radius must be > 0')
  })

  it('should reject invalid pitch', () => {
    expect(() => threadBrep(kernel, { radius: 6, pitch: 0, height: 5 }))
      .toThrow('pitch must be > 0')
  })

  it('should reject invalid height', () => {
    expect(() => threadBrep(kernel, { radius: 6, pitch: 2, height: -1 }))
      .toThrow('height must be > 0')
  })

  it('should reject invalid crest', () => {
    expect(() => threadBrep(kernel, { radius: 6, pitch: 2, height: 5, crest: 10 }))
      .toThrow('crest must be >= 0')
  })

  it('should reject too few sectionsPerTurn', () => {
    expect(() => threadBrep(kernel, { radius: 6, pitch: 2, height: 5, sectionsPerTurn: 2 }))
      .toThrow('sectionsPerTurn must be >= 3')
  })
})
