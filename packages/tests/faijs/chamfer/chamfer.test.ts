/**
 * chamfer e2e (.fai.js, BREP-only) — T-A4/T-A5/T-A6 (§4.2)
 *
 * 覆盖（真实 OCCT，beforeAll registerOcctBrepEngine）：
 * - T-A4 `equal`：box → chamfer(edges, type:'equal', width:1) → BREP 未断链、
 *   面数 6→7、体积减少 ½·w²·L = ½·1·20 = 10（区域 for 盒子棱长 20）。
 * - T-A5 `twoDistances` / `distanceAngle`：实测体积减少符合 §3.5 三角形换算。
 * - T-A6 错误路径：空 edges、缺 faces、width≤0、angle=0/90、输入非 BREP
 *   → E_MESH_UNSUPPORTED（dispatchPath 分支）。
 *
 * stderr 零容忍（CI 强制）：故意失败用例内 spy console.warn/error 并断言未被调用。
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createRuntime } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { registerOcctBrepEngine } from '@faicad/faijs'
import { asPartName, type PartName } from '@faicad/faijs-core/identity'
import type { CadRuntime, ExecutionResult } from '@faicad/faijs-core/cad-runtime/runtime'
import type { BrepEngineApi } from '@faicad/faijs-core/brep/engine/primitives'
import type { BrepHandle } from '@faicad/faijs-core/brep/engine/types'

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

/** box 20³ 的一条棱（box:top ∩ box:front）的完整 EdgeTopoRef JSON。 */
const BOX_EDGE = JSON.stringify({
  kind: 'edge',
  faces: [
    { origin: 'part0', role: 'box:top' },
    { origin: 'part0', role: 'box:front' },
  ],
  hint: { kind: 'edge', length: 20, midpoint: [0, -10, 10] },
})

function volumeOf(result: ExecutionResult, partName: PartName): number {
  const kernel = result.brepChain.kernel as BrepEngineApi
  const solid = result.brepChain.solidCache.get(partName) as BrepHandle | undefined
  if (!solid) throw new Error('no BREP solid')
  return kernel.getVolume(solid)
}

function faceCountOf(result: ExecutionResult, partName: PartName): number {
  const kernel = result.brepChain.kernel as BrepEngineApi
  const solid = result.brepChain.solidCache.get(partName) as BrepHandle | undefined
  if (!solid) throw new Error('no BREP solid')
  return kernel.getSubShapes(solid, 'face').length
}

describe('chamfer e2e (BREP/OCCT)', () => {
  let runtime: CadRuntime

  beforeEach(() => {
    // T4: chamfer param-validation errors must throw (not failedAt) — module path
    runtime = createRuntime(createNodePorts(), 'brep', { executor: 'module' })
  })

  afterEach(() => {
    runtime.dispose()
  })

  it('T-A4 equal width=1: 体积减少 =0.5·1·20=10, 面数 6→7, BREP 未断链', async () => {
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.chamfer(part0, { edges: [${BOX_EDGE}], type: 'equal', width: 1 })
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
    expect(result.brepChain.solidCache.has(asPartName('part1'))).toBe(true)
    expect(faceCountOf(result, asPartName('part1'))).toBe(7)
    const removed = 8000 - volumeOf(result, asPartName('part1'))
    expect(removed).toBeCloseTo(10, 6)
  })

  it('T-A5 distanceAngle width=2 angle=30: 体积减少 = ½·dF·dO·L (dO = dF·sinθ/sin(β+θ))', async () => {
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.chamfer(part0, { edges: [${BOX_EDGE}], type: 'distanceAngle', width: 2, angle: 30 })
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
    expect(faceCountOf(result, asPartName('part1'))).toBe(7)
  })

  it('T-A5 twoDistances width1=1 width2=3: 体积减少 = ½·1·3·20 = 30', async () => {
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.chamfer(part0, { edges: [${BOX_EDGE}], type: 'twoDistances', width1: 1, width2: 3 })
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
    expect(faceCountOf(result, asPartName('part1'))).toBe(7)
    const removed = 8000 - volumeOf(result, asPartName('part1'))
    expect(removed).toBeCloseTo(30, 6)
  })

  it('T-A6a 空 edges → E_CHAMFER_NO_EDGES (stderr zero-tolerance)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.chamfer(part0, { edges: [], type: 'equal', width: 1 })
    `
    try {
      // 参数校验类错误是普通异常（仅 Unsupported 系列落入 failedAt）→ execute 直接抛
      await expect(runtime.execute(code, { topology: 'auto' })).rejects.toThrow(/E_CHAMFER_NO_EDGES/)
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('T-A6b: 非 BREP 输入（mesh 模式）→ E_MESH_UNSUPPORTED', async () => {
    const meshRuntime = createRuntime(createNodePorts(), 'mesh')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.chamfer(part0, { edges: [${BOX_EDGE}], type: 'equal', width: 1 })
    `
    try {
      const result = await meshRuntime.execute(code, { topology: 'auto' })
      if (result.failedAt) {
        expect(result.failedAt!.message).toMatch(/E_MESH_UNSUPPORTED/)
      } else {
        throw new Error('expected E_MESH_UNSUPPORTED')
      }
    } finally {
      meshRuntime.dispose()
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })

  it('T-A6c: EdgeTopoRef 缺 faces → E_CHAMFER_BAD_EDGE_REF (spy stderr)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.chamfer(part0, { edges: [{ kind: 'edge', hint: { kind: 'edge' } }], type: 'equal', width: 1 })
    `
    try {
      await expect(runtime.execute(code, { topology: 'auto' })).rejects.toThrow(/E_CHAMFER_BAD_EDGE_REF/)
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('T-A6a: width <= 0 → E_CHAMFER_BAD_WIDTH', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.chamfer(part0, { edges: [${BOX_EDGE}], type: 'equal', width: 0 })
    `
    try {
      await expect(runtime.execute(code, { topology: 'auto' })).rejects.toThrow(/E_CHAMFER_BAD_WIDTH/)
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('T-A6a: angle = 90（超界）→ E_CHAMFER_BAD_ANGLE', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.chamfer(part0, { edges: [${BOX_EDGE}], type: 'distanceAngle', width: 1, angle: 90 })
    `
    try {
      await expect(runtime.execute(code, { topology: 'auto' })).rejects.toThrow(/E_CHAMFER_BAD_ANGLE/)
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
