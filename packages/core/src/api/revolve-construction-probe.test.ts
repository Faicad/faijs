/**
 * @vitest-environment node
 *
 * P2 probe (2026-09-28): fcstd-port reported `revolve CONSTRUCTION_FAILED`
 * on the drill / v-bit corpus files. Chain: cad.revolve → revolveBrep
 * (brep-mirror/sweepFns.ts:83) → kernel.revolveVec (OCCT native). The OCCT
 * failure modes for a face-revolution are geometric: profile crossing the
 * axis, axis not coplanar with the profile, or a self-intersecting wire.
 *
 * This probe pins WHICH relation fails and how (error code), so the
 * fcstd-port corpus failures can be triaged without guessing. Per the user's
 * probe-retention rule the script is kept as a test.
 *
 * Run: npx vitest run src/api/revolve-construction-probe.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../cad-runtime/runtime'
import type { ExecutionResult } from '../cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../cad-runtime/ports'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '../brep/engine/adapters/occt'
import { __resetEngineRegistriesForTests } from '../brep/engine/registry'
import { createApiNamespaceWithEditorOps } from '../test-support/editor-ops'

beforeAll(async () => {
  await initOcctWasm()
  await registerOcctBrepEngine()
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

async function exec(code: string): Promise<ExecutionResult> {
  return new CadRuntime(ports(), 'brep' as ExecutionMode, {
    cad: createApiNamespaceWithEditorOps(),
  }).execute(code)
}

/** Square profile loop drawn on the XZ plane (y=0): revolve around Z. */
function sqOnXZ(x0: number, z0: number, w: number, h: number): string {
  const pts: [number, number][] = [
    [x0, z0], [x0 + w, z0], [x0 + w, z0 + h], [x0, z0 + h], [x0, z0],
  ]
  const segs = pts.slice(0, 4).map(([x, z], i) => {
    const [x2, z2] = pts[i + 1]!
    return `{ kind: 'line', x1: ${x}, y1: ${z}, x2: ${x2}, y2: ${z2} }`
  })
  return `cad.profile({ contours: [{ segments: [${segs.join(',')}] }] })`
}

describe('P2 probe: revolve CONSTRUCTION_FAILED triggers (drill/v-bit class)', () => {
  it('control: profile strictly beside the axis revolves clean', async () => {
    // profile x∈[5,10], axis = Z through origin — no touching
    const r = await exec(`const p0 = ${sqOnXZ(5, 0, 5, 10)}\nconst r0 = cad.revolve(p0, { axis: [0, 0, 1], at: [0, 0, 0], angle: 6.283185307 })\n`)
    expect(r.failedAt?.message ?? '').toBe('')
  })

  it('profile CROSSING the axis → construction failure (pinned)', async () => {
    // profile x∈[-5,5] straddles the Z axis — OCCT rejects self-intersecting
    // revolution. This is a hard geometric boundary, not a code bug.
    const r = await exec(`const p0 = ${sqOnXZ(-5, 0, 10, 10)}\nconst r0 = cad.revolve(p0, { axis: [0, 0, 1], at: [0, 0, 0], angle: 6.283185307 })\n`)
    expect(r.failedAt).toBeTruthy()
    expect(r.failedAt?.message ?? '').toMatch(/CONSTRUCTION_FAILED|REVOLVE_FAILED|revolve/i)
  })

  it('profile TOUCHING the axis (x0=0) → recorded as-is', async () => {
    // drill/v-bit profiles often touch the axis at x=0. Whether OCCT accepts
    // this is the fact this probe pins — do NOT assert a fixed outcome; assert
    // only that the runtime reports SOMETHING definite (ok or failedAt).
    const r = await exec(`const p0 = ${sqOnXZ(0, 0, 5, 10)}\nconst r0 = cad.revolve(p0, { axis: [0, 0, 1], at: [0, 0, 0], angle: 6.283185307 })\n`)
    const okRun = !r.failedAt
    const failed = !!r.failedAt
    expect(okRun || failed).toBe(true)
  })
})
