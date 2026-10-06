/**
 * faceRef unit tests — 面序号 → FaceTopoRef（BREP 现场枚举 + role 血统反查）
 *
 * GOTCHA（阶段 A 标定，extrude-upto-face 方案 §5-A）：faceRef 序号 1 起，
 * 与 FreeCAD `FaceN` 同序（TopExp::MapShapes + IndexedMap 枚举，与 edgeRef
 * 同源已记档）；faceNormal 的 ordinal 是 0 起——两者差 1，勿混用。
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { asPartName } from '../../src/identity'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import type { Shape } from '../../src/mesh/types'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

function defaultPorts(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

async function runCode(code: string, part: string): Promise<Shape> {
  const rt = new CadRuntime(defaultPorts(), 'brep', { cad: createApiNamespaceWithEditorOps() })
  const result = await rt.execute(code)
  if (result.failedAt) {
    throw new Error(`execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  const shape = result.outputs.get(asPartName(part))
  if (!shape) throw new Error(`no output ${part}`)
  return shape as Shape
}

describe('faceRef', () => {
  it('resolves face 1 of a box with role lineage and a plane hint', async () => {
    // box 的面序数在 OCCT 现场枚举下稳定：face 1 必有 origin/role 血统
    const shape = await runCode(`let part0 = cad.box(10, 20, 30)\n`, 'part0')
    const { faceRef } = await import('../../src/api/face-ref')
    const ref = faceRef(shape, 1)
    expect(ref.kind).toBe('face')
    expect(ref.origin.length).toBeGreaterThan(0)
    expect(ref.role.length).toBeGreaterThan(0)
    expect(ref.hint.kind).toBe('face')
    expect(ref.hint.surfaceType).toBe('plane')
  })

  it('out-of-range ordinal → E_TOPO_NOT_FOUND', async () => {
    const shape = await runCode(`let part0 = cad.box(10, 20, 30)\n`, 'part0')
    const { faceRef } = await import('../../src/api/face-ref')
    const { TopoRefError } = await import('../../src/topology/naming')
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
    const { faceRef } = await import('../../src/api/face-ref')
    expect(() => faceRef(shape, 0)).toThrow(/must be an integer >= 1/)
  })

  it('mesh path → E_TOPO_MESH_UNSUPPORTED（Phase 1.9 GOTCHA：曾是裸 Error）', async () => {
    // Phase 1.9（D6/§3）：mesh 路径不支持拓扑引用——静态判定、显式抛带码错误，
    // 不静默降级。GOTCHA：此前这里抛的是不带 code 的裸 Error，消费方无法按码分支。
    // 用无 BREP 句柄的纯 mesh Shape（solid() 直造、不经 fromBrep）触发 mesh 分支。
    const { solid } = await import('../../src/shape')
    const meshShape = solid({} as never)
    const { faceRef } = await import('../../src/api/face-ref')
    const { edgeRef } = await import('../../src/api/edge-ref')
    const { TopoRefError } = await import('../../src/topology/naming')
    for (const fn of [faceRef, edgeRef]) {
      try {
        fn(meshShape, 1)
        expect.unreachable('should throw')
      } catch (e) {
        expect(e).toBeInstanceOf(TopoRefError)
        expect((e as { code: string }).code).toBe('E_TOPO_MESH_UNSUPPORTED')
      }
    }
  })
})
