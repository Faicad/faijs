/**
 * define-op — dual-path declaration decorator tests (D-face contract).
 *
 *
 * Coverage:
 * - ② construction-time validation (at least one implementation)
 * - dispatchPath bidirectional matrix (mode × implementation set × chain state)
 * - ④ defineOp integration: mode selects the implementation automatically
 * - capability routing (D5)
 * - auto-collection of geometry inputs (args.filter(isGeometryInput)) and
 *   automatic product wrapping (solid / fromHandle / fromBrep)
 * - multi-product outputs (scheme C, split shape)
 * - ③ assertLibConforms strict assembly validation
 */

import { describe, it, expect, vi } from 'vitest'
import { configureBackends, CONTRACT_VERSION, BrepUnsupportedError, MeshUnsupportedError, type Backends } from './runtime-state'
import { defineOp, assertLibConforms, DUAL_OP_META } from './define-op'
import { solid, fromBrep, isShape, hasBrep, brepOf } from './shape'
import { dispatchPath } from './cad-runtime/backend-dispatch'
import { OpError } from './api/internal/result-unwrap'
import type { Shape } from './mesh/types'
import type { BrepHandle } from './brep/engine/types'

// ── helpers ──

function cubeMesh(size: number): Shape {
  const s = size / 2
  const positions = new Float32Array([
    -s, -s, -s, s, -s, -s, s, s, -s, -s, s, -s,
    -s, -s, s, s, -s, s, s, s, s, -s, s, s,
  ])
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
  ])
  return { positions, indices }
}

function makeBackends(
  mode: 'auto' | 'brep' | 'mesh',
  caps?: { evolution?: boolean },
  kernelBrep?: unknown,
): Backends {
  return {
    contractVersion: CONTRACT_VERSION,
    config: { mode, brepCapabilities: caps },
    kernel: { brep: kernelBrep ?? null, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends
}

const noop = (): undefined => undefined
const brepOfChain = (solid: Shape): Shape => fromBrep(solid, { solid: 1 as unknown as BrepHandle })
const onChain = brepOfChain(cubeMesh(5))
const offChain = solid(cubeMesh(5))

// ── ② construction-time validation ──

describe('defineOp: construction-time validation (②)', () => {
  it('accepts all three legal shapes (mesh-only / brep-only / dual)', () => {
    expect(() => defineOp({ mesh: () => cubeMesh(10) })).not.toThrow()
    expect(() => defineOp({ brep: () => 1 as unknown as BrepHandle })).not.toThrow()
    expect(() => defineOp({ mesh: () => cubeMesh(10), brep: () => 1 as unknown as BrepHandle })).not.toThrow()
  })

  it('rejects empty implementation sets and non-function implementations', () => {
    expect(() => defineOp({} as never)).toThrow(/at least one implementation/)
    expect(() => defineOp({ mesh: 42 } as never)).toThrow(/mesh must be a function/)
    expect(() => defineOp({ mesh: () => cubeMesh(10), brep: 42 } as never)).toThrow(/brep must be a function/)
  })

  it('attaches dual-op metadata to the wrapped function (K5: function info is data)', () => {
    const op = defineOp({ mesh: () => cubeMesh(10) })
    expect((op as { [DUAL_OP_META]?: { kind: string } })[DUAL_OP_META]?.kind).toBe('dual-op')
  })
})

// ── dispatchPath bidirectional matrix (engine-internal API) ──

describe('dispatchPath: bidirectional matrix (mode × impls × chain state)', () => {
  it("mode='mesh': mesh-only → mesh; brep-only → MeshUnsupportedError; dual → mesh", () => {
    configureBackends(makeBackends('mesh'))
    expect(dispatchPath([offChain], { mesh: noop })).toBe('mesh')
    expect(() => dispatchPath([onChain], { brep: noop })).toThrow(MeshUnsupportedError)
    expect(dispatchPath([onChain], { mesh: noop, brep: noop })).toBe('mesh')
  })

  it("mode='brep': mesh-only → BrepUnsupportedError; off-chain input → error; on-chain → brep", () => {
    configureBackends(makeBackends('brep'))
    expect(() => dispatchPath([onChain], { mesh: noop })).toThrow(BrepUnsupportedError)
    expect(() => dispatchPath([offChain], { mesh: noop, brep: noop })).toThrow(BrepUnsupportedError)
    expect(dispatchPath([onChain], { mesh: noop, brep: noop })).toBe('brep')
    expect(dispatchPath([onChain], { brep: noop })).toBe('brep')
  })

  it("mode='auto': brep-first when on chain; mesh fallback; brep-only off-chain → MeshUnsupportedError", () => {
    configureBackends(makeBackends('auto'))
    expect(dispatchPath([onChain], { mesh: noop, brep: noop })).toBe('brep')
    expect(dispatchPath([offChain], { mesh: noop, brep: noop })).toBe('mesh')
    expect(dispatchPath([offChain], { mesh: noop })).toBe('mesh')
    expect(dispatchPath([onChain], { brep: noop })).toBe('brep')
    expect(() => dispatchPath([offChain], { brep: noop })).toThrow(MeshUnsupportedError)
  })

  it('capability routing (D5): missing capability degrades in auto, errors in brep, brep-only has no mesh to fall back to', () => {
    configureBackends(makeBackends('auto', {}))
    expect(dispatchPath([onChain], { mesh: noop, brep: noop }, 'evolution')).toBe('mesh')
    expect(() => dispatchPath([onChain], { brep: noop }, 'evolution')).toThrow(MeshUnsupportedError)
    configureBackends(makeBackends('brep', {}))
    expect(() => dispatchPath([onChain], { mesh: noop, brep: noop }, 'evolution')).toThrow(BrepUnsupportedError)
    configureBackends(makeBackends('auto', { evolution: true }))
    expect(dispatchPath([onChain], { mesh: noop, brep: noop }, 'evolution')).toBe('brep')
  })
})

// ── ④ defineOp integration: mode auto-selects the implementation ──

describe('defineOp: mode auto-selects the implementation (④)', () => {
  it('auto + on-chain input → brep; auto + off-chain input → mesh', async () => {
    const meshSpy = vi.fn((_input: Shape, _params: { diameter?: number }) => cubeMesh(10))
    const brepSpy = vi.fn((input: Shape, _params: { diameter?: number }) => fromBrep(input, { solid: 2 as unknown as BrepHandle }))
    const op = defineOp({ mesh: meshSpy, brep: brepSpy })

    configureBackends(makeBackends('auto'))
    await op(onChain, { diameter: 5 })
    expect(meshSpy).not.toHaveBeenCalled()
    expect(brepSpy).toHaveBeenCalledWith(onChain, { diameter: 5 })

    meshSpy.mockClear()
    brepSpy.mockClear()
    await op(offChain, { diameter: 5 })
    expect(brepSpy).not.toHaveBeenCalled()
    expect(meshSpy).toHaveBeenCalledWith(offChain, { diameter: 5 })
  })

  it("mode='mesh' + brep-only → MeshUnsupportedError; mode='brep' + mesh-only → BrepUnsupportedError", async () => {
    const brepOnly = defineOp({ brep: (input: Shape) => fromBrep(input, { solid: 2 as unknown as BrepHandle }) })
    const meshOnly = defineOp({ mesh: (_input: Shape) => cubeMesh(10) })

    configureBackends(makeBackends('mesh'))
    await expect(brepOnly(onChain)).rejects.toThrow(MeshUnsupportedError)
    await expect(meshOnly(onChain)).resolves.toBeTruthy()

    configureBackends(makeBackends('brep'))
    await expect(meshOnly(onChain)).rejects.toThrow(BrepUnsupportedError)
    await expect(brepOnly(onChain)).resolves.toBeTruthy()
  })

  it('raw brep product (bare handle) → fromHandle: tessellated + BREP slot registered', async () => {
    const fakeKernel = { meshShape: () => ({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }) }
    configureBackends(makeBackends('auto', undefined, fakeKernel))
    const op = defineOp({ mesh: () => cubeMesh(10), brep: () => 42 as unknown as BrepHandle })
    const result = await op()
    expect(isShape(result)).toBe(true)
    expect(hasBrep(result as Shape)).toBe(true)
    expect(brepOf(result as Shape)).toBe(42)
  })

  it('raw mesh product (MeshData) → solid(): shape registered, no BREP slot', async () => {
    configureBackends(makeBackends('auto'))
    const op = defineOp({ mesh: () => cubeMesh(10) })
    const result = await op()
    expect(isShape(result)).toBe(true)
    expect(hasBrep(result as Shape)).toBe(false)
  })

  it('already-wrapped products pass through unchanged', async () => {
    configureBackends(makeBackends('auto'))
    const wrapped = fromBrep(cubeMesh(5), { solid: 7 as unknown as BrepHandle })
    const op = defineOp({ mesh: () => cubeMesh(10), brep: () => wrapped })
    const result = await op()
    expect(result).toBe(wrapped)
  })

  // ── 兼容性回归：裸 ManifoldMeshData 作为几何输入（host 直接经 geoToManifoldMesh 传入）──
  it('raw ManifoldMeshData (non-constructor positions/indices) → mesh path in auto mode', async () => {
    configureBackends(makeBackends('auto'))
    const meshSpy = vi.fn((_input: Shape, _params: Record<string, unknown>) => cubeMesh(10))
    const brepSpy = vi.fn(() => {
      throw new Error('[compat] raw mesh input must never reach the BREP path')
    })
    const op = defineOp({ mesh: meshSpy, brep: brepSpy })

    // 裸 mesh 数据：与 geoToManifoldMesh 输出同构，未经过 solid() 身份登记
    const rawMesh = cubeMesh(5)
    expect(isShape(rawMesh)).toBe(false)

    const result = await op(rawMesh, {})
    expect(meshSpy).toHaveBeenCalledTimes(1)
    expect(meshSpy).toHaveBeenCalledWith(rawMesh, {})
    expect(brepSpy).not.toHaveBeenCalled()
    expect(isShape(result)).toBe(true)
    expect(hasBrep(result as Shape)).toBe(false)
  })
})

// ── multi-product outputs (scheme C, split shape) ──

describe('defineOp: multi-product outputs (scheme C)', () => {
  it('brep path wraps each named key via fromHandle; mesh path wraps each via solid', async () => {
    const fakeKernel = { meshShape: () => ({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }) }
    configureBackends(makeBackends('auto', undefined, fakeKernel))
    const op = defineOp({
      mesh: (_input: Shape) => ({ front: cubeMesh(5), back: cubeMesh(3) }),
      brep: (_input: Shape) => ({ front: 11 as unknown as BrepHandle, back: 12 as unknown as BrepHandle }),
      outputs: ['front', 'back'],
    })

    const br = (await op(onChain)) as Record<string, Shape>
    expect(hasBrep(br.front)).toBe(true)
    expect(hasBrep(br.back)).toBe(true)
    expect(brepOf(br.front)).toBe(11)
    expect(brepOf(br.back)).toBe(12)

    const mr = (await op(offChain)) as Record<string, Shape>
    expect(isShape(mr.front)).toBe(true)
    expect(hasBrep(mr.front)).toBe(false)
    expect(isShape(mr.back)).toBe(true)
    expect(hasBrep(mr.back)).toBe(false)
  })
})

// ── ③ assertLibConforms strict assembly validation ──

describe('assertLibConforms: strict assembly validation (③)', () => {
  it('a library exporting dual-ops must carry a matching contractVersion', () => {
    const dual = defineOp({ mesh: () => cubeMesh(10) })
    expect(() => assertLibConforms({ dual })).toThrow(/contractVersion/)
    expect(() => assertLibConforms({ dual, contractVersion: 1 })).toThrow(/contractVersion/)
    expect(() => assertLibConforms({ dual, contractVersion: CONTRACT_VERSION })).not.toThrow()
  })

  it('structural validation: dual-op with no valid implementation / non-function members throws', () => {
    const badMesh = Object.assign(() => cubeMesh(10), {
      [DUAL_OP_META]: { kind: 'dual-op', mesh: 42, brep: undefined, capabilities: undefined, outputs: undefined },
    })
    const badBrep = Object.assign(() => cubeMesh(10), {
      [DUAL_OP_META]: { kind: 'dual-op', mesh: () => cubeMesh(10), brep: 'nope', capabilities: undefined, outputs: undefined },
    })
    expect(() => assertLibConforms({ badMesh, contractVersion: CONTRACT_VERSION })).toThrow(/any implementation/)
    expect(() => assertLibConforms({ badBrep, contractVersion: CONTRACT_VERSION })).toThrow(/brep/)
  })

  it('brep-only dual-op is valid (D1b)', () => {
    const brepOnly = defineOp({ brep: () => 1 as unknown as BrepHandle })
    expect(() => assertLibConforms({ brepOnly, contractVersion: CONTRACT_VERSION })).not.toThrow()
  })

  it('invalid capabilities / outputs declarations throw', () => {
    const badCaps = Object.assign(() => cubeMesh(10), {
      [DUAL_OP_META]: { kind: 'dual-op', mesh: () => cubeMesh(10), brep: undefined, capabilities: 'evolution', outputs: undefined },
    })
    const badOutputs = Object.assign(() => cubeMesh(10), {
      [DUAL_OP_META]: { kind: 'dual-op', mesh: () => cubeMesh(10), brep: undefined, capabilities: undefined, outputs: [1, 2] },
    })
    expect(() => assertLibConforms({ badCaps, contractVersion: CONTRACT_VERSION })).toThrow(/capabilities/)
    expect(() => assertLibConforms({ badOutputs, contractVersion: CONTRACT_VERSION })).toThrow(/outputs/)
  })

  it('L3 metadata (D2): schema is carried and type-validated', () => {
    const cleaned = defineOp({ mesh: () => cubeMesh(10), schema: { size: 'number | [n,n,n]' } })
    const m1 = (cleaned as { [DUAL_OP_META]?: { schema?: unknown } })[DUAL_OP_META]
    expect(m1?.schema).toEqual({ size: 'number | [n,n,n]' })
    expect(() => assertLibConforms({ cleaned, contractVersion: CONTRACT_VERSION })).not.toThrow()
  })

  it('L3 metadata (D2): invalid schema shape throws at assemble time', () => {
    const badSchema = Object.assign(() => cubeMesh(10), {
      [DUAL_OP_META]: { kind: 'dual-op', mesh: () => cubeMesh(10), brep: undefined, schema: { size: 42 } },
    })
    expect(() => assertLibConforms({ badSchema, contractVersion: CONTRACT_VERSION })).toThrow(/schema/)
  })

  it('plain libraries (no dual-ops) are untouched, even without contractVersion', () => {
    expect(() => assertLibConforms({ plain: () => 1, data: { a: 1 } })).not.toThrow()
  })
})

// ── defineOp 边界契约回归（集成验证 2 处修复） ──

describe('defineOp: brep data-product passthrough (wrapBrepOne)', () => {
  it('plain data record (no __occtWasm) passes through untouched, never tessellated as a handle', async () => {
    // 若透传分支失效而误走 fromHandle，throwing kernel 会立即暴露（不再静默崩溃于
    // OcctError: meshShape: Invalid shape ID 0）。
    const throwingKernel = {
      meshShape: () => {
        throw new Error('must not tessellate a data record')
      },
    }
    configureBackends(makeBackends('auto', undefined, throwingKernel))
    const record = { partId: 7, bends: [1, 2, 3], name: 'sheet-part' }
    const op = defineOp({ brep: () => record as unknown as Shape })
    const result = await op()
    expect(result).toBe(record) // 原对象透传
    expect(isShape(result as Shape)).toBe(false)
    expect(hasBrep(result as Shape)).toBe(false)
  })

  it('__occtWasm-tagged handle object still tessellates via fromHandle (discriminant leaf)', async () => {
    const fakeKernel = { meshShape: () => ({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }) }
    configureBackends(makeBackends('auto', undefined, fakeKernel))
    const handleObj = { __occtWasm: true, type: 'solid', id: 42 }
    const op = defineOp({ brep: () => handleObj as unknown as Shape })
    const result = await op()
    expect(isShape(result as Shape)).toBe(true)
    expect(hasBrep(result as Shape)).toBe(true)
    // fromHandle 的 { solid: handle } 原样登记——对象路径 brepOf 返回句柄对象本身
    expect(brepOf(result as Shape)).toBe(handleObj)
  })
})

describe('defineOp: OpError rethrow (runImpl)', () => {
  it('impl-thrown OpError propagates unchanged (same instance), not re-wrapped by toOpError', async () => {
    configureBackends(makeBackends('auto'))
    const opError = new OpError('mech.fuse', 'E_BAD_INPUT', '[faijs/compat] mech.fuse: E_BAD_INPUT: nope')
    const op = defineOp({ brep: () => { throw opError } })
    await expect(op()).rejects.toBe(opError)
  })

  it('plain impl exceptions are normalized into a plain Error (bug propagation), never OpError', async () => {
    configureBackends(makeBackends('auto'))
    const op = defineOp({ brep: () => { throw new Error('boom') } })
    await expect(op()).rejects.toThrow('[faijs/op]')
    await expect(op()).rejects.not.toBeInstanceOf(OpError)
  })
})
