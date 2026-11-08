/**
 * @vitest-environment node
 *
 * deferred-tess（'defer' 三角化时机）直呼单元测试——历史 L1 缺口补账：
 * `BREP_LAZY_TESS` / `isDeferredTessShape` / `materializeTessellation`。
 *
 * 物化契约（`src/brep/deferred-tess.ts`）：用**创建时记录的参数**调
 * `kernel.meshShape`（拓扑 mesh 与显示 mesh 同源红线），结果写回 positions/
 * indices + `BREP_TESS` 槽，删除 `BREP_LAZY_TESS`（幂等）；无描述符 no-op。
 */
import { describe, expect, it } from 'vitest'
import { BREP_LAZY_TESS, BREP_TESS, type Shape } from '../../src/mesh/types'
import {
  isDeferredTessShape,
  materializeTessellation,
  type BrepLazyTessDescriptor,
} from '../../src/brep/deferred-tess'
import type { BrepEngineApi } from '../../src/brep/engine/primitives'
import type { BrepHandle } from '../../src/brep/engine/types'

let meshShapeCalls: { solid: BrepHandle; linearDeflection: number; angularDeflection: number }[] = []

/** stub 内核：meshShape 记录入参并返回固定网格（1 个三角形）。 */
function stubKernel(): BrepEngineApi {
  return {
    meshShape: (solid: BrepHandle, opts: { linearDeflection: number; angularDeflection: number }) => {
      meshShapeCalls.push({ solid, ...opts })
      return {
        positions: new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
        normals: new Float64Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        vertexCount: 3,
        triangleCount: 1,
        // faceGroups 是三元组（startVertex, vertexCount, faceIndex）——顶点数口径，
        // 物化时 /3 折算成三角形（与 eager 路径 primitives.ts 同款）
        faceGroups: new Int32Array([0, 3, 1]),
        faceCount: 1,
      }
    },
  } as unknown as BrepEngineApi
}

function lazyShape(desc: Partial<BrepLazyTessDescriptor> = {}): Shape {
  const s = {
    positions: new Float32Array(0),
    indices: new Uint32Array(0),
    normals: new Float32Array(0),
  } as unknown as Shape
  const kernel = stubKernel()
  const rec = s as unknown as Record<symbol, unknown>
  rec[BREP_LAZY_TESS] = { kernel, solid: 1 as BrepHandle, linearDeflection: 0.1, angularDeflection: 0.5, ...desc }
  return s
}

describe('deferred-tess 直呼（BREP_LAZY_TESS 描述符协议）', () => {
  it('isDeferredTessShape：带描述符 true，裸 shape false', () => {
    expect(isDeferredTessShape(lazyShape())).toBe(true)
    const bare = { positions: new Float32Array(0), indices: new Uint32Array(0) } as unknown as Shape
    expect(isDeferredTessShape(bare)).toBe(false)
  })

  it('materializeTessellation：用创建时记录的参数调 kernel.meshShape，写回 + 挂 BREP_TESS', () => {
    meshShapeCalls = []
    const s = lazyShape({ linearDeflection: 0.25, angularDeflection: 0.75, primitiveOp: 'box' })
    const out = materializeTessellation(s)
    expect(out).toBeDefined()
    expect(meshShapeCalls).toEqual([
      { solid: 1, linearDeflection: 0.25, angularDeflection: 0.75 },
    ])
    // 写回 positions/indices + BREP_TESS 槽 + faceRanges（primitiveOp 基本体白名单）
    expect(s.positions.length).toBe(9)
    expect(s.faceRanges).toEqual([{ start: 0, count: 1 }])
    const rec = s as unknown as Record<symbol, unknown>
    expect(rec[BREP_TESS]).toBeDefined()
    expect(rec[BREP_LAZY_TESS]).toBeUndefined()
    // 幂等：已物化的 shape 再调 no-op
    expect(materializeTessellation(s)).toBeUndefined()
  })

  it('materializeTessellation：非基本体不挂 faceRanges；无描述符 no-op', () => {
    meshShapeCalls = []
    const s = lazyShape({ primitiveOp: undefined })
    const out = materializeTessellation(s)
    expect(out).toBeDefined()
    expect(s.faceRanges).toBeUndefined()
    const bare = { positions: new Float32Array(0), indices: new Uint32Array(0) } as unknown as Shape
    expect(materializeTessellation(bare)).toBeUndefined()
  })
})
