/**
 * @vitest-environment node
 *
 * D1 (2026-09-19) — `createRuntime` carries the `cad` namespace as the default
 * lib; the pure-engine `createRuntime` from `cad-runtime/runtime` does not.
 *
 * Why this is a test and not a smoke script: D1 is the published contract that
 * lets a host ignore the (now deleted) root facade — "get a runtime, get cad".
 * A guarantee that ships in `@faicad/faijs` must be guarded in CI, and this
 * check needs no corpus, no WASM and no kernel, so nothing justifies it living
 * outside the suite. It replaces `scripts/smoke-cad-builtin.ts`.
 *
 * GOTCHA: `CadRuntime.libs` is private. There is no public accessor, so the
 * registration is read through a cast (the same way `defaultNs` was verified
 * before this test existed). If a public accessor is added, prefer it.
 */
import { describe, it, expect } from 'vitest';
import { createRuntime } from './createRuntimeWithCad';
import { createRuntime as createRuntimeCore, type CadRuntime } from './runtime';
import type { HostPorts, EventSink } from './ports';

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

  it('pure-engine createRuntime stays cad-free (D1 is optional, not forced)', () => {
    const rt = createRuntimeCore(ports());
    expect(libsOf(rt).cad).toBeUndefined();
  });
});
