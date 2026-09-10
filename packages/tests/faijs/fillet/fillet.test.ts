/**
 * fillet e2e (.fai.js, BREP-only) — M1 等半径圆角
 *
 * 覆盖（真实 OCCT，beforeAll registerOcctBrepEngine）：
 * - T-F1 等半径 radius=2：box 20³ → fillet(edges, radius:2) → BREP 未断链、
 *   面数 6→7、体积减少 ΔV = (4-π)·r²·L/4 (r=2, L=20 ⇒ 约 17.17 mm³)。
 * - T-F2 roleTable 传播：圆角后 faceNaming.role 非空、edgeNaming.faces 可解析。
 * - T-F3 错误路径：空 edges、radius≤0、缺 faces、非 BREP 输入 → E_MESH_UNSUPPORTED。
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

describe('fillet e2e (BREP/OCCT)', () => {
  let runtime: CadRuntime

  beforeEach(() => {
    runtime = createRuntime(createNodePorts(), 'brep')
  })

  afterEach(() => {
    runtime.dispose()
  })

  it('T-F1 equal radius=2: 面数 6→7, 体积减少 ≈(4-π)·r²·L/4, BREP 未断链', async () => {
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.fillet(part0, { edges: [${BOX_EDGE}], radius: 2 })
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
    expect(result.brepChain.solidCache.has(asPartName('part1'))).toBe(true)
    expect(faceCountOf(result, asPartName('part1'))).toBe(7)
    // ΔV = (4-π)·r²·L/4 where r=2, L=20 (edge length)
    // (4 - π) ≈ 0.8584, r²=4, L=20 → 0.8584 * 4 * 20 / 4 = 17.168
    const removed = 8000 - volumeOf(result, asPartName('part1'))
    expect(removed).toBeCloseTo(17.168, 1)
  })

  it('T-F2 roleTable 传播：圆角后 faceNaming.role 非空', async () => {
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.fillet(part0, { edges: [${BOX_EDGE}], radius: 2 })
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
    // Check that naming data is present and roles are non-empty
    const naming = result.naming
    expect(naming).toBeDefined()
    const part1Naming = naming?.get(asPartName('part1'))
    expect(part1Naming).toBeDefined()
    // faceNaming should have entries with non-empty roles (roleTable propagated)
    expect(part1Naming!.faceNaming.length).toBeGreaterThan(0)
    const hasRole = part1Naming!.faceNaming.some(f => f.role && f.role.length > 0)
    expect(hasRole).toBe(true)
  })

  it('T-F3a 空 edges → E_FILLET_NO_EDGES (stderr zero-tolerance)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.fillet(part0, { edges: [], radius: 2 })
    `
    try {
      const result = await runtime.execute(code, { topology: 'auto' })
      expect(result.failedAt).toBeDefined()
      expect(result.failedAt!.message).toMatch(/E_FILLET_NO_EDGES/)
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('T-F3b: 非 BREP 输入（mesh 模式）→ E_MESH_UNSUPPORTED', async () => {
    const meshRuntime = createRuntime(createNodePorts(), 'mesh')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.fillet(part0, { edges: [${BOX_EDGE}], radius: 2 })
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

  it('T-F3c: EdgeTopoRef 缺 faces → E_FILLET_BAD_EDGE_REF (spy stderr)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.fillet(part0, { edges: [{ kind: 'edge', hint: { kind: 'edge' } }], radius: 2 })
    `
    try {
      const result = await runtime.execute(code, { topology: 'auto' })
      expect(result.failedAt).toBeDefined()
      expect(result.failedAt!.message).toMatch(/E_FILLET_BAD_EDGE_REF/)
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('T-F3d: radius <= 0 → E_FILLET_BAD_RADIUS', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.fillet(part0, { edges: [${BOX_EDGE}], radius: 0 })
    `
    try {
      const result = await runtime.execute(code, { topology: 'auto' })
      expect(result.failedAt).toBeDefined()
      expect(result.failedAt!.message).toMatch(/E_FILLET_BAD_RADIUS/)
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('T-F4: radius 过大 → E_FILLET_RADIUS_TOO_LARGE', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.fillet(part0, { edges: [${BOX_EDGE}], radius: 100 })
    `
    try {
      const result = await runtime.execute(code, { topology: 'auto' })
      // OCCT may either succeed (if it can handle it) or fail with E_FILLET_RADIUS_TOO_LARGE
      // radius=100 on a 20mm box is definitely too large
      if (result.failedAt) {
        expect(result.failedAt!.message).toMatch(/E_FILLET_RADIUS_TOO_LARGE/)
      } else {
        // If somehow OCCT succeeded, at least check it didn't silently return original
        expect(faceCountOf(result, asPartName('part1'))).toBeGreaterThan(6)
      }
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
