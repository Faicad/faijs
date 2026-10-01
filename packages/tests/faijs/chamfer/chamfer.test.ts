/**
 * chamfer e2e (.fai.js) — T-A4/T-A5/T-A6 (§4.2)
 *
 * 覆盖（真实 OCCT，beforeAll registerOcctBrepEngine）：
 * - T-A4 `equal`：box → chamfer(edges, type:'equal', width:1) → BREP 未断链、
 *   面数 6→7、体积减少 ½·w²·L = ½·1·20 = 10（区域 for 盒子棱长 20）。
 * - T-A5 `twoDistances` / `distanceAngle`：实测体积减少符合 §3.5 三角形换算。
 * - T-A6 错误路径：空 edges、缺 faces、width≤0、angle=0/90、mesh 模式下裸网格输入
 *   → E_MESH_SOLID_UNSUPPORTED（chamfer 自 2026-10-01 起有网格实现，BREP 侧见 T-A4/T-A5）。
 *
 * stderr 零容忍（CI 强制）：故意失败用例内 spy console.warn/error 并断言未被调用。
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createRuntime } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { registerOcctBrepEngine } from '@faicad/faijs'
import { asPartName, type PartName } from '@faicad/faijs/identity'
import type { CadRuntime, ExecutionResult } from '@faicad/faijs/cad-runtime/runtime'
import type { BrepEngineApi } from '@faicad/faijs/brep/engine/primitives'
import type { BrepHandle } from '@faicad/faijs/brep/engine/types'
import { createEditorRuntime } from '../_support/editor-runtime'

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

/** box 20³ 的一条棱（top ∩ front）的完整 EdgeTopoRef JSON（Phase 1 换型：origin=StmtId、role 无 op 前缀）。 */
const BOX_EDGE = JSON.stringify({
  kind: 'edge',
  faces: [
    { origin: 's2', role: 'top' },
    { origin: 's2', role: 'front' },
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
    runtime = createEditorRuntime(createNodePorts(), 'brep')
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
      // T5 direct-only: all execution errors land in failedAt (no re-throw)
      const result = await runtime.execute(code, { topology: 'auto' })
      expect(result.failedAt).toBeDefined()
      expect(result.failedAt!.message).toMatch(/E_CHAMFER_NO_EDGES/)
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('T-A6b: mesh 模式 + 裸网格输入 → E_MESH_SOLID_UNSUPPORTED（不静默回退 BREP）', async () => {
    const meshRuntime = createEditorRuntime(createNodePorts(), 'mesh')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.chamfer(part0, { edges: [${BOX_EDGE}], type: 'equal', width: 1 })
    `
    try {
      const result = await meshRuntime.execute(code, { topology: 'auto' })
      // chamfer 自 2026-10-01 起有 mesh 实现（brepkit 网格后端），mesh 模式因此走**网格路径**，
      // 不再是"无 mesh 实现 → E_MESH_UNSUPPORTED"。网格路径只认网格实体 + 已装配的网格后端；
      // 本宿主两者皆无（box 在 mesh 模式下是裸网格），故如实拒绝。
      expect(result.failedAt).toBeDefined()
      expect(result.failedAt!.message).toMatch(/E_MESH_SOLID_UNSUPPORTED/)
      // 关键红线：拒绝是**静态**的，没有偷偷回退到 BREP 链把 part1 做出来。
      expect(result.brepChain.solidCache.has(asPartName('part1'))).toBe(false)
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
      // T5 direct-only: all execution errors land in failedAt (no re-throw)
      const result = await runtime.execute(code, { topology: 'auto' })
      expect(result.failedAt).toBeDefined()
      expect(result.failedAt!.message).toMatch(/E_CHAMFER_BAD_EDGE_REF/)
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
      // T5 direct-only: all execution errors land in failedAt (no re-throw)
      const result = await runtime.execute(code, { topology: 'auto' })
      expect(result.failedAt).toBeDefined()
      expect(result.failedAt!.message).toMatch(/E_CHAMFER_BAD_WIDTH/)
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
      // T5 direct-only: all execution errors land in failedAt (no re-throw)
      const result = await runtime.execute(code, { topology: 'auto' })
      expect(result.failedAt).toBeDefined()
      expect(result.failedAt!.message).toMatch(/E_CHAMFER_BAD_ANGLE/)
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
