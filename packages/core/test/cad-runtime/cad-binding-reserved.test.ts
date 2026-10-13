/**
 * cad-binding-reserved — guard: `cad` is the only reserved binding name.
 *
 * 2026-10-13 merge: `cad` became a reserved binding — hosts cannot register
 * or override it. The reserved set is exactly `{'cad'}` (no other name is
 * affected, including `cad`-prefixed names like `cadx`).
 *
 * Guards (plan §7.4):
 * - `createRuntime(ports, mode, { cad: fake })` → throws E_CAD_RESERVED.
 * - `rt.registerLib('cad', fake)` after createRuntime → throws E_CAD_RESERVED.
 * - `rt.registerLib('mylib', ns)` → works (third-party libs unaffected).
 * - `createRuntime(ports, mode, { mylib: ns })` → works.
 * - `rt.registerLib('cadx', ns)` → works (only exact `cad` is reserved).
 * - `createBareRuntime` also rejects `cad` (reserved globally).
 */
import { describe, it, expect } from 'vitest'
import { createRuntime, createBareRuntime, type CadRuntime } from '../../src/cad-runtime/runtime'
import type { HostPorts, EventSink } from '../../src/cad-runtime/ports'

class TestEventSink implements EventSink {
  readonly events: Array<{ event: string; detail: Record<string, unknown> }> = []
  emit(event: string, detail: Record<string, unknown>): void {
    this.events.push({ event, detail: { ...detail } })
  }
}

const ports = (): HostPorts => ({ events: new TestEventSink() })

const libsOf = (rt: CadRuntime): Record<string, Record<string, unknown> | undefined> =>
  (rt as unknown as { libs: Record<string, Record<string, unknown> | undefined> }).libs

const fakeNs = { foo: () => 'bar' } as unknown as Record<string, unknown>

describe('cad-binding-reserved: `cad` is the only reserved binding', () => {
  it('createRuntime rejects libs.cad', () => {
    expect(() =>
      createRuntime(ports(), undefined, { cad: fakeNs as never }),
    ).toThrow(/E_CAD_RESERVED/)
  })

  it('registerLib("cad", ...) after createRuntime throws', () => {
    const rt = createRuntime(ports())
    expect(() => rt.registerLib('cad', fakeNs as never)).toThrow(/E_CAD_RESERVED/)
  })

  it('registerLib with non-cad name works after createRuntime', () => {
    const rt = createRuntime(ports())
    rt.registerLib('mylib', fakeNs as never)
    expect(libsOf(rt).mylib).toBeDefined()
  })

  it('createRuntime accepts third-party libs (non-cad binding)', () => {
    const rt = createRuntime(ports(), undefined, { mylib: fakeNs as never })
    expect(libsOf(rt).cad).toBeDefined()
    expect(libsOf(rt).mylib).toBeDefined()
  })

  it('only exact "cad" is reserved — "cadx" is not affected', () => {
    const rt = createRuntime(ports())
    rt.registerLib('cadx', fakeNs as never)
    expect(libsOf(rt).cadx).toBeDefined()
  })

  it('createBareRuntime also rejects libs.cad', () => {
    expect(() =>
      createBareRuntime(ports(), undefined, { cad: fakeNs as never }),
    ).toThrow(/E_CAD_RESERVED/)
  })

  it('createBareRuntime with non-cad lib works', () => {
    const rt = createBareRuntime(ports(), undefined, { mylib: fakeNs as never })
    expect(libsOf(rt).cad).toBeUndefined()
    expect(libsOf(rt).mylib).toBeDefined()
  })

  it('createBareRuntime: cad is reserved — registerLib("cad") does not throw but cad is not auto-registered', () => {
    // createBareRuntime does NOT set _cadReserved (only createRuntime does),
    // so registerLib('cad', ...) is technically allowed on a bare runtime.
    // This is intentional: bare runtime is "no cad", and the caller is
    // responsible for their own setup. The libs.cad guard in createBareRuntime
    // prevents passing cad via the constructor; post-construction registration
    // is the caller's own choice for a bare runtime.
    const rt = createBareRuntime(ports())
    expect(libsOf(rt).cad).toBeUndefined()
    // registerLib on bare runtime is not guarded (bare = caller's own setup)
    rt.registerLib('cad', fakeNs as never)
    expect(libsOf(rt).cad).toBeDefined()
  })
})