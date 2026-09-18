/**
 * faceRef unit tests — 面序号 → FaceTopoRef（BREP 现场枚举 + role 血统反查）
 *
 * GOTCHA（阶段 A 标定，extrude-upto-face 方案 §5-A）：faceRef 序号 1 起，
 * 与 FreeCAD `FaceN` 同序（TopExp::MapShapes + IndexedMap 枚举，与 edgeRef
 * 同源已记档）；faceNormal 的 ordinal 是 0 起——两者差 1，勿混用。
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from '../cad-runtime/runtime'
import type { HostPorts } from '../cad-runtime/ports'
import { createApiNamespace } from './api-namespace'
import { asPartName } from '../identity'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import type { Shape } from '../mesh/types'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

async function runCode(code: string, part: string): Promise<Shape> {
  const rt = new CadRuntime(defaultPorts(), 'brep', { cad: createApiNamespace() })
  const result = await rt.execute(code)
  if (result.failedAt) {
    throw new Error(`execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  const shape = result.outputs.get(asPartName(part))
  if (!shape) throw new Error(`no output ${part}`)
  return shape
}

describe('faceRef', () => {
  it('resolves face 1 of a box with role lineage and a plane hint', async () => {
    // box 的面序数在 OCCT 现场枚举下稳定：face 1 必有 origin/role 血统
    const shape = await runCode(`let part0 = cad.box(10, 20, 30)\n`, 'part0')
    const { faceRef } = await import('./face-ref')
    const ref = faceRef(shape, 1)
    expect(ref.kind).toBe('face')
    expect(ref.origin.length).toBeGreaterThan(0)
    expect(ref.role.length).toBeGreaterThan(0)
    expect(ref.hint.kind).toBe('face')
    expect(ref.hint.surfaceType).toBe('plane')
  })

  it('out-of-range ordinal → E_TOPO_NOT_FOUND', async () => {
    const shape = await runCode(`let part0 = cad.box(10, 20, 30)\n`, 'part0')
    const { faceRef } = await import('./face-ref')
    const { TopoRefError } = await import('../topology/naming')
    expect(() => faceRef(shape, 0)).toThrow(TopoRefError) // 0 起 → 非法（GOTCHA：1 起）
    // GOTCHA：TopoRefError 的错误码在 code 属性，message 不含错误码
    try {
      faceRef(shape, 999)
      expect.unreachable('should throw')
    } catch (e) {
      expect(e).toBeInstanceOf(TopoRefError)
      expect((e as { code: string }).code).toBe('E_TOPO_NOT_FOUND')
    }
  })

  it('ordinal 0 → E_TOPO_NOT_FOUND (1-based GOTCHA, unlike faceNormal 0-based)', async () => {
    const shape = await runCode(`let part0 = cad.box(10, 20, 30)\n`, 'part0')
    const { faceRef } = await import('./face-ref')
    expect(() => faceRef(shape, 0)).toThrow(/must be an integer >= 1/)
  })
})
