/**
 * @vitest-environment node
 *
 * Multi-runtime isolation (P2 regression).
 *
 * Root cause: the global backends singleton (runtime-state) is configured by
 * EVERY runtime at construction — the last created instance wins. Creating a
 * second runtime (e.g. a preview mesh runtime) silently hijacked the first
 * one's subsequent executions: dispatch read the wrong mode, statement keys
 * drifted, re-execution went through the mesh slot and the superseded-release
 * path freed the old BREP handle, after which topology rebuilding hit a
 * dangling handle (`meshShape: Invalid shape ID`).
 *
 * Fix: every execution entry (executeIR) re-claims the instance's own global
 * configuration before running. Serial multi-runtime hosts (preview ↔ main)
 * are safe again; concurrent interleaved execution remains out of scope
 * (same serial assumption as setCurrentStmt).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { asPartName } from '../identity'
import { registerOcctBrepEngine } from '../brep/engine/adapters/occt'
import { createRuntime } from '@faicad/faijs'
import { CadRuntime } from './runtime'
import type { EventSink, HostPorts } from './ports'

const BOX = 'const p0 = cad.box(10, 10, 10, { centered: true })'
const TORUS = 'const t0 = cad.torus({ majorRadius: 8, minorRadius: 2 })'

class TestEventSink implements EventSink {
  readonly events: Array<{ event: string; detail: Record<string, unknown> }> = []
  emit(event: string, detail: Record<string, unknown>): void {
    this.events.push({ event, detail: { ...detail } })
  }
  clear(): void { this.events.length = 0 }
}

function createNodePorts(): HostPorts {
  return { events: new TestEventSink() }
}

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

const runtimes: CadRuntime[] = []

function makeRuntime(mode: 'auto' | 'mesh' | 'brep'): CadRuntime {
  const rt = createRuntime(createNodePorts(), mode)
  runtimes.push(rt)
  return rt
}

afterAll(() => {
  for (const rt of runtimes) rt.dispose()
})

describe('P2 — creating another runtime must not hijack an existing one', () => {
  it('re-executing rt1 (auto) after creating rt2 (mesh) still succeeds', async () => {
    const rt1 = makeRuntime('auto')
    const first = await rt1.execute(BOX)
    expect(first.failedAt).toBeUndefined()

    // the hijack point: constructing a second runtime overwrote the global
    // backends (mode 'mesh') BEFORE it ever executed anything
    const rt2 = makeRuntime('mesh')
    const second = await rt1.execute(BOX)
    expect(second.failedAt).toBeUndefined()
    expect(second.outputs.get(asPartName('p0'))).toBeDefined()

    void rt2
  }, 120000)

  it('rt1 keeps executing after rt2 ran and was disposed', async () => {
    const rt1 = makeRuntime('auto')
    const rt2 = makeRuntime('mesh')
    // mesh mode supports cad.box (manifold) — must succeed on its own terms
    const meshRes = await rt2.execute(BOX)
    expect(meshRes.failedAt).toBeUndefined()
    rt2.dispose()

    const back = await rt1.execute(BOX)
    expect(back.failedAt).toBeUndefined()
  }, 120000)

  it('a mesh runtime hitting a brep-only call reports failedAt; rt1 stays unaffected', async () => {
    const rt1 = makeRuntime('auto')
    expect((await rt1.execute(BOX)).failedAt).toBeUndefined()

    const rt2 = makeRuntime('mesh')
    const res = await rt2.execute(TORUS)
    expect(res.failedAt).toBeDefined()
    expect(res.failedAt!.message).toMatch(/E_MESH_UNSUPPORTED|not supported|mesh/i)

    // the failure inside rt2 must not leave rt1 broken
    const back = await rt1.execute(BOX)
    expect(back.failedAt).toBeUndefined()
  }, 120000)
})
