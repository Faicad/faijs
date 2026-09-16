/**
 * M6.1 edge-anchor e2e (.fai.js, BREP-only) — `cad.edgeRef(shape, N)` → EdgeTopoRef
 *
 * 验证「序号选边」端到端可用：`cad.edgeRef` 在内核现场把第 N 条边解析成
 * 相邻两面的 role 对（EdgeTopoRef），直接喂给 `cad.chamfer` / `cad.fillet`。
 * 这是 FCStd 移植 `PartDesign::Fillet` / `Chamfer`（FreeCAD 只给 `EdgeN`）的锚点。
 *
 * 数值断言用 20³ 中心立方体：任一条棱倒角 `width=1` 都削掉 ½·w²·L = 10
 * （与 packages/tests/faijs/chamfer/chamfer.test.ts 的 T-A4 同口径），
 * 故断言与「第 N 条边具体是哪条」无关，只依赖序号解析本身。
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

function solidOf(result: ExecutionResult, partName: PartName): BrepHandle {
  const solid = result.brepChain.solidCache.get(partName) as BrepHandle | undefined
  if (!solid) throw new Error('no BREP solid')
  return solid
}

function volumeOf(result: ExecutionResult, partName: PartName): number {
  const kernel = result.brepChain.kernel as BrepEngineApi
  return kernel.getVolume(solidOf(result, partName))
}

function faceCountOf(result: ExecutionResult, partName: PartName): number {
  const kernel = result.brepChain.kernel as BrepEngineApi
  return kernel.getSubShapes(solidOf(result, partName), 'face').length
}

describe('cad.edgeRef e2e (BREP/OCCT)', () => {
  let runtime: CadRuntime

  beforeEach(() => {
    runtime = createRuntime(createNodePorts(), 'brep')
  })

  afterEach(() => {
    runtime.dispose()
  })

  it('resolves edge 1 of a box and chamfers it (face 6→7, removed volume 10)', async () => {
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.chamfer(part0, { edges: [cad.edgeRef(part0, 1)], type: 'equal', width: 1 })
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
    expect(faceCountOf(result, asPartName('part1'))).toBe(7)
    expect(8000 - volumeOf(result, asPartName('part1'))).toBeCloseTo(10, 6)
  })

  it('resolves the last edge ordinal (12) of a box', async () => {
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.chamfer(part0, { edges: [cad.edgeRef(part0, 12)], type: 'equal', width: 1 })
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
    expect(faceCountOf(result, asPartName('part1'))).toBe(7)
    expect(8000 - volumeOf(result, asPartName('part1'))).toBeCloseTo(10, 6)
  })

  it('feeds cad.fillet from an edge anchor', async () => {
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.fillet(part0, { edges: [cad.edgeRef(part0, 1)], radius: 2 })
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
    expect(faceCountOf(result, asPartName('part1'))).toBe(7)
    // rounded corner removes ¼-circle of material: (1 − π/4)·r²·L
    expect(8000 - volumeOf(result, asPartName('part1'))).toBeCloseTo((1 - Math.PI / 4) * 4 * 20, 6)
  })

  it('chamfers several anchored edges in one call', async () => {
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.chamfer(part0, { edges: [cad.edgeRef(part0, 1), cad.edgeRef(part0, 2)], type: 'equal', width: 1 })
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
    // two parallel edges of the cube → 6 + 2 chamfer faces
    expect(faceCountOf(result, asPartName('part1'))).toBe(8)
  })

  it('fails explicitly when the edge ordinal is out of range', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.chamfer(part0, { edges: [cad.edgeRef(part0, 999)], type: 'equal', width: 1 })
    `
    try {
      const result = await runtime.execute(code, { topology: 'auto' })
      expect(result.failedAt).toBeDefined()
      // naming-layer convention: the code rides on failedAt.code, the message is prose
      expect(result.failedAt!.code).toBe('E_TOPO_NOT_FOUND')
      expect(result.failedAt!.message).toMatch(/out of range \[1, 12\]/)
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('rejects a non-positive edge ordinal', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.chamfer(part0, { edges: [cad.edgeRef(part0, 0)], type: 'equal', width: 1 })
    `
    try {
      const result = await runtime.execute(code, { topology: 'auto' })
      expect(result.failedAt).toBeDefined()
      expect(result.failedAt!.code).toBe('E_TOPO_NOT_FOUND')
      expect(result.failedAt!.message).toMatch(/edgeOrdinal must be an integer >= 1/)
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
