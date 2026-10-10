/**
 * solidMesh raw guard test — when tessellateSolidGrouped returns a non-string,
 * meshShape must throw a contextual [brepkit-kernel] error instead of letting
 * JSON.parse(undefined) throw the engine-specific "JSON Parse error: Unexpected
 * identifier \"undefined\"" (observed on a real iOS device, 2026-10-10) which
 * toOpFailure then wraps into an unlocatable E_OP_FAILED.
 *
 * Uses setBrepkitWasmInitFn to inject a stub kernel, so this suite does NOT
 * depend on the optional brepkit-wasm runtime package — the invariant is guarded
 * even in environments where the real wasm is absent.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createBrepkitPrimitives, disposeBrepkit, type BrepkitPrimitives } from '../../src/brepkit-kernel/brepkitKernel'
import { setBrepkitWasmInitFn } from '../../src/brepkit-kernel/brepkitWasm'
import type { BrepHandle } from '../../src/brep/engine/types'

describe('solidMesh raw non-string guard', () => {
  let api!: BrepkitPrimitives

  beforeAll(async () => {
    // Only tessellateSolidGrouped is reached before the guard throws:
    // resolveKind defaults an untagged handle to solid, then solidMesh calls
    // kernel.tessellateSolidGrouped — nothing else touches the stub.
    const stubKernel = { tessellateSolidGrouped: () => undefined }
    setBrepkitWasmInitFn(() => Promise.resolve(stubKernel))
    api = await createBrepkitPrimitives()
  })

  afterAll(() => {
    disposeBrepkit()
    setBrepkitWasmInitFn(null)
  })

  it('tessellateSolidGrouped returns undefined → throws contextual [brepkit-kernel] error (not JSON.parse)', () => {
    expect(() => api.meshShape(0 as BrepHandle, { linearDeflection: 0.1 })).toThrow(/\[brepkit-kernel\] tessellateSolidGrouped/)
  })

  it('error carries handle + param context so a device-side failure is locatable', () => {
    let message = ''
    try {
      api.meshShape(7 as BrepHandle, { linearDeflection: 0.25, angularDeflection: 0.5 })
    } catch (e) {
      message = String((e as Error).message)
    }
    expect(message).toContain('tessellateSolidGrouped(7')
    expect(message).toContain('deflection=0.25')
    expect(message).toContain('angular=0.5')
    expect(message).toContain('undefined')
  })
})
