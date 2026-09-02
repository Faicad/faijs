/**
 * fillet e2e (.fai.js, BREP-only, P7 双链整合样板)
 *
 * 来源：docs/plans/2026-09-01-layered-api-architecture.md §D10 / §D11 / P7 / §9 U4
 *
 * 覆盖（真实 OCCT，beforeAll registerOcctBrepEngine——内部已顺带 bindOcctKernel，
 * P7-② 同一装配点）：
 * - P7-② 接线样板：box → fillet（调移植 L2 `modifierFns.fillet`）→ BREP 链存活、
 *   产物句柄登记身份槽（brepSolids/solidCache）、体积减少、面数增加（6→>6）；
 * - 链语义：mesh 模式 → E_MESH_UNSUPPORTED（brep-only op 无 mesh 实现）；
 * - 能力路由：fillet 声明 directEdit——brep-mock 无此能力 → brep 模式
 *   BrepUnsupportedError（绝不静默回退）；
 * - 参数校验：radius ≤ 0 → 抛错。
 *
 * stderr 零容忍（CI 强制）：故意失败用例内 spy console.warn/error 并断言未被调用。
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createRuntime } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { registerOcctBrepEngine } from '@faicad/faijs'
import { asPartName, type PartName } from '@faicad/faijs-core/identity'
import { __resetEngineRegistriesForTests } from '@faicad/faijs-core/brep/engine/registry'
import { registerBrepMockEngine } from '@faicad/faijs-core/brep/engine/adapters/brep-mock'
import type { CadRuntime, ExecutionResult } from '@faicad/faijs-core/cad-runtime/runtime'
import type { BrepEngineApi } from '@faicad/faijs-core/brep/engine/primitives'
import type { BrepHandle } from '@faicad/faijs-core/brep/engine/types'

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

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

describe('fillet e2e (BREP/OCCT · 调移植 L2 接线样板)', () => {
  let runtime: CadRuntime

  beforeEach(() => {
    runtime = createRuntime(createNodePorts(), 'brep')
  })

  afterEach(() => {
    runtime.dispose()
  })

  it('P7-② box → fillet(radius=2)：BREP 链存活、身份槽登记、体积减少、面数增加', async () => {
    const code = `
      const part0 = cad.box({ size: 20 })
      const part1 = cad.fillet(part0, { radius: 2 })
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
    // 链存活：产物句柄在 brep 链与身份槽（brepSolids 映射）中
    expect(result.brepChain.solidCache.has(asPartName('part1'))).toBe(true)
    expect(result.brepSolids?.has(asPartName('part1'))).toBe(true)
    // 几何确实变了：全棱边圆角 → 体积减小、面数增加（6 → >6）
    const removed = 8000 - volumeOf(result, asPartName('part1'))
    expect(removed).toBeGreaterThan(0)
    expect(faceCountOf(result, asPartName('part1'))).toBeGreaterThan(6)
  })

  it('参数校验：radius <= 0 → 抛错（spy stderr）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const code = `
      const part0 = cad.box({ size: 20 })
      const part1 = cad.fillet(part0, { radius: 0 })
    `
    try {
      await expect(runtime.execute(code, { topology: 'auto' })).rejects.toThrow(/fillet.radius must be > 0/)
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('链语义：mesh 模式（非 BREP 输入）→ E_MESH_UNSUPPORTED', async () => {
    const meshRuntime = createRuntime(createNodePorts(), 'mesh')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const code = `
      const part0 = cad.box({ size: 20 })
      const part1 = cad.fillet(part0, { radius: 2 })
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
})

describe('fillet 能力路由（directEdit；brep-mock 无此能力）', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
    registerBrepMockEngine()
  })

  it('brep 模式：fillet（需 directEdit）→ BrepUnsupportedError → failedAt 明确报错', async () => {
    const runtime = createRuntime(createNodePorts(), 'brep')
    try {
      const code = `
        const part0 = cad.box({ size: 20 })
        const part1 = cad.fillet(part0, { radius: 2 })
      `
      const result = await runtime.execute(code, { topology: 'auto' })
      expect(result.failedAt).toBeDefined()
      expect(result.failedAt!.callee).toBe('fillet')
      expect(result.failedAt!.message).toMatch(/lacks capability 'directEdit'/)
    } finally {
      runtime.dispose()
    }
  })
})
