/**
 * @vitest-environment node
 *
 * D1 (2026-09-19) — `createRuntime` carries the `cad` namespace as the default
 * lib; `createBareRuntime` does not (pure engine).
 *
 * Facade refactor (2026-10-08): the same-name `createRuntimeWithCad.ts` was
 * deleted; its cad-auto-registration logic moved into `createRuntime` in
 * `cad-runtime/runtime.ts`. The pure-engine variant is now named
 * `createBareRuntime` (also in `runtime.ts`).
 *
 * Why this is a test and not a smoke script: D1 is the published contract that
 * lets a host ignore the root facade — "get a runtime, get cad". A guarantee
 * that ships in `@faicad/faijs` must be guarded in CI, and this check needs no
 * corpus, no WASM and no kernel, so nothing justifies it living outside the
 * suite. It replaces `scripts/smoke-cad-builtin.ts`.
 *
 * GOTCHA: `CadRuntime.libs` is private. There is no public accessor, so the
 * registration is read through a cast (the same way `defaultNs` was verified
 * before this test existed). If a public accessor is added, prefer it.
 */
import { describe, it, expect } from 'vitest';
import { createRuntime, createBareRuntime, type CadRuntime } from '../../src/cad-runtime/runtime';
import type { HostPorts, EventSink } from '../../src/cad-runtime/ports';

class TestEventSink implements EventSink {
  readonly events: Array<{ event: string; detail: Record<string, unknown> }> = [];
  emit(event: string, detail: Record<string, unknown>): void {
    this.events.push({ event, detail: { ...detail } });
  }
}

const ports = (): HostPorts => ({ events: new TestEventSink() });

/** Read the private registration table (see the GOTCHA note above). */
const libsOf = (rt: CadRuntime): Record<string, Record<string, unknown> | undefined> =>
  (rt as unknown as { libs: Record<string, Record<string, unknown> | undefined> }).libs;

describe('D1 — built-in cad namespace', () => {
  it('createRuntime registers a full cad namespace as the default lib', () => {
    const rt = createRuntime(ports());
    expect(rt.defaultNs).toBe('cad');

    const cad = libsOf(rt).cad;
    expect(cad, 'cad registered without host injection').toBeDefined();
    // A namespace, not an empty stub: the documented head of the op surface.
    expect(typeof cad!.box).toBe('function');
    expect(typeof cad!.union).toBe('function');
    expect(typeof cad!.profile).toBe('function');
    expect(typeof cad!.extrude).toBe('function');
    expect(Object.keys(cad!).length).toBeGreaterThan(50);
  });

  it('createBareRuntime stays cad-free (pure engine, D1 is optional, not forced)', () => {
    const rt = createBareRuntime(ports());
    expect(libsOf(rt).cad).toBeUndefined();
  });

  it('createRuntime rejects libs.cad (cad is a reserved binding)', () => {
    const customCad = { box: () => 'custom' } as unknown as Record<string, unknown>;
    expect(() => createRuntime(ports(), undefined, { cad: customCad as never })).toThrow(
      /E_CAD_RESERVED/,
    );
  });

  it('createRuntime accepts third-party libs (non-cad binding)', () => {
    const myLib = { hello: () => 'world' } as unknown as Record<string, unknown>;
    const rt = createRuntime(ports(), undefined, { mylib: myLib as never });
    expect(libsOf(rt).cad).toBeDefined();
    expect(libsOf(rt).mylib).toBeDefined();
  });

  it('registerLib("cad", ...) after createRuntime throws (reserved binding)', () => {
    const rt = createRuntime(ports());
    const fakeCad = { box: () => 'fake' } as unknown as Record<string, unknown>;
    expect(() => rt.registerLib('cad', fakeCad as never)).toThrow(
      /E_CAD_RESERVED/,
    );
  });

  it('registerLib with non-cad name still works after createRuntime', () => {
    const rt = createRuntime(ports());
    const myLib = { foo: () => 42 } as unknown as Record<string, unknown>;
    rt.registerLib('mylib', myLib as never);
    expect(libsOf(rt).mylib).toBeDefined();
  });
});
