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
 * Fix: every execution entry (execute) re-claims the instance's own global
 * configuration before running. Serial multi-runtime hosts (preview ↔ main)
 * are safe again.
 *
 * C1 (2026-09-22): concurrent interleaved execution is no longer merely "out of
 * scope" — it is **rejected**. The same process-wide singletons (setCurrentStmt,
 * backends, the kernel) make it unsupportable, and the old behaviour was a silent
 * hijack whose symptom sits far from its cause. `CADRuntime.withExecutionLock`
 * now throws `RuntimeConcurrentError` (E_RUNTIME_CONCURRENT) when a second
 * runtime executes while another one is in flight; same-instance re-entry is
 * allowed (update lands on the same call stack). See the lock's tests below.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { asPartName } from '../identity'
import { registerOcctBrepEngine } from '../brep/engine/adapters/occt'
import { CadRuntime } from './runtime'
import { RuntimeConcurrentError } from './runtime-concurrent-error'
import type { EventSink, HostPorts } from './ports'
import { createEditorRuntime } from '../test-support/editor-ops'

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
  const rt = createEditorRuntime(createNodePorts(), mode)
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

describe('C1 — concurrent multi-runtime execution is rejected, not tolerated', () => {
  it('a second runtime executing while the first is in flight throws E_RUNTIME_CONCURRENT', async () => {
    const rt1 = makeRuntime('mesh')
    const rt2 = makeRuntime('mesh')

    // The lock is taken synchronously, so rt1 holds it as soon as this call returns.
    const inFlight = rt1.execute(BOX)
    // Both rejections are *created* synchronously, with no await in between: the
    // lock is provably still held for each of them. (Awaiting the first rejection
    // before issuing the second would let rt1 finish and release the lock — the
    // second call would then legitimately succeed, making the test timing-dependent.)
    const rejected1 = rt2.execute(BOX)
    const rejected2 = rt2.execute(BOX)
    await expect(rejected1).rejects.toThrow(RuntimeConcurrentError)
    await expect(rejected2).rejects.toThrow(/E_RUNTIME_CONCURRENT/)
    expect((await inFlight).failedAt).toBeUndefined()

    // rt1 released the lock on completion → rt2 runs serially, as before.
    const after = await rt2.execute(BOX)
    expect(after.failedAt).toBeUndefined()
  }, 120000)

  it('the rejected entry point is named, and append/update are guarded too', async () => {
    const rt1 = makeRuntime('mesh')
    const rt2 = makeRuntime('mesh')
    const inFlight = rt1.execute(BOX)
    // Issue all three against the held lock synchronously (see the note above).
    const pAppend = rt2.append(BOX)
    const pUpdate = rt2.update('', BOX)
    const pExecute = rt2.execute(BOX)

    await expect(pAppend).rejects.toThrow(/\bappend\b/)
    await expect(pUpdate).rejects.toThrow(/\bupdate\b/)

    // `.catch(cb)` 的返回类型是 `ExecutionResult | cb 的返回值`（Promise.catch 的签名），
    // 所以这里必须整体收窄到 RuntimeConcurrentError 才能读 code/entry。
    const err = (await pExecute.catch((e: unknown) => e)) as RuntimeConcurrentError
    expect(err).toBeInstanceOf(RuntimeConcurrentError)
    expect(err.code).toBe('E_RUNTIME_CONCURRENT')
    expect(err.entry).toBe('execute')

    expect((await inFlight).failedAt).toBeUndefined()

    // Same-instance re-entry is NOT concurrency: update lands on rt1's own call
    // stack through executeDirectText. A serial rt1 update must not self-reject.
    const upd = await rt1.update(BOX, `${BOX}\nconst p1 = cad.box(5, 5, 5)`)
    expect(upd.failedAt).toBeUndefined()
  }, 120000)

  it('the lock is released even when the in-flight execution fails', async () => {
    const rt1 = makeRuntime('mesh')
    const rt2 = makeRuntime('mesh')

    const inFlight = rt1.execute('throw new Error("boom")')
    await expect(rt2.execute(BOX)).rejects.toThrow(RuntimeConcurrentError)
    const failed = await inFlight
    expect(failed.failedAt).toBeDefined()

    // No leak: rt2 can execute once rt1's failed attempt unwound.
    expect((await rt2.execute(BOX)).failedAt).toBeUndefined()
  }, 120000)
})
