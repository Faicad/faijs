/**
 * @vitest-environment node
 *
 * Text BREP 操作单元测试
 *
 * 测试内容：
 * 1. textBlueprints 产出有效 OCCT wire
 * 2. textToSolid 产出有效 OCCT solid
 * 3. STEP 导出含 ADVANCED_FACE + PLANE
 * 4. 多字符文字 fuse 集成测试
 * 5. 字体加载测试
 *
 * 运行：npx vitest run src/brep/text/textBlueprints.test.ts
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
import type { OcctKernel } from 'occt-wasm'
import { setupTestFont } from './fontTestHelper'
import { textBlueprints, textToSolid } from './textBlueprints'
import { solidToShape } from '../brep-ops'

let kernel: OcctKernel

beforeAll(async () => {
  await initOcctWasm()
  kernel = getKernel()
  // 注入 fs 字体加载器并加载默认字体
  await setupTestFont()
}, 120000)

describe('textBlueprints', () => {
  it('should produce wires from ASCII text', () => {
    const wires = textBlueprints(kernel, 'A', { fontSize: 16 })
    expect(wires.length).toBeGreaterThan(0)
    for (const w of wires) kernel.release(w)
  })

  it('should produce wires from multi-character text', () => {
    const wires = textBlueprints(kernel, 'Hello', { fontSize: 16 })
    expect(wires.length).toBeGreaterThan(0)
    for (const w of wires) kernel.release(w)
  })

  it('should produce wires from digits', () => {
    const wires = textBlueprints(kernel, '123', { fontSize: 16 })
    expect(wires.length).toBeGreaterThan(0)
    for (const w of wires) kernel.release(w)
  })
})

describe('textToSolid', () => {
  it('should produce a valid solid from text', () => {
    const solid = textToSolid(kernel, 'A', { fontSize: 16, depth: 2 })
    expect(solid).toBeDefined()

    const shape = solidToShape(kernel, solid)
    expect(shape.positions.length).toBeGreaterThan(0)
    expect(shape.indices.length).toBeGreaterThan(0)

    kernel.release(solid)
  })

  it('should produce STEP with ADVANCED_FACE and PLANE', () => {
    const solid = textToSolid(kernel, 'B', { fontSize: 20, depth: 3 })
    const step = kernel.exportStep(solid)
    expect(step).toContain('ADVANCED_FACE')
    expect(step).toContain('PLANE')

    kernel.release(solid)
  })

  it('should produce valid solid from multi-character text', () => {
    const solid = textToSolid(kernel, 'AB', { fontSize: 16, depth: 2 })
    expect(solid).toBeDefined()

    const shape = solidToShape(kernel, solid)
    expect(shape.positions.length).toBeGreaterThan(0)

    const step = kernel.exportStep(solid)
    expect(step).toContain('ADVANCED_FACE')

    kernel.release(solid)
  })
})

describe('fontRegistry', () => {
  it('should load and retrieve font', async () => {
    const { getFont } = await import('./fontRegistry')
    const font = getFont('default')
    expect(font).toBeDefined()
    expect(font?.charToGlyph).toBeDefined()
  })

  it('should return undefined for unregistered font', async () => {
    const { getFont } = await import('./fontRegistry')
    const font = getFont('nonexistent')
    expect(font).toBeUndefined()
  })
})
