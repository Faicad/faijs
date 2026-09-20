/**
 * P26 e2e — gear-lib-demo through the compat boundary, §8.4 scenario.
 *
 * The §8.4 script lives in `./gear-flow-fixture.js` (shared verbatim with the
 * sibling recompute files), and the acceptance set is split across files so no
 * single vitest worker stays busy past birpc's hard-coded 60s `onTaskUpdate`
 * RPC timeout — see the fixture header for the full rationale.
 *
 * This file: the scenario build plus the acceptance assertions that only need
 * the one built result.
 *   ① g1 is a faijs Shape (hasBrep === true, mesh payload non-empty)
 *   ② the cad.union boolean runs on the BREP chain ("brep" path, no degrade)
 *   ③ the planetary multi-output record { sun, planets, ring } keeps structure
 *   ④ STEP export of the union carries ADVANCED_FACE (exact, not faceting)
 *   ⑥ mesh-mode invocation → E_MESH_UNSUPPORTED (no silent fallback)
 *   ⑦ repeated same-code executions keep the kernel arena bounded
 * ⑤ (incremental recompute policy) lives in `gear-lib-demo-recompute.test.ts`
 * and `gear-lib-demo-recompute-lib-change.test.ts`.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { asPartName } from '@faicad/faijs/identity'
import { hasBrep, isShape } from '@faicad/faijs/shape'
import { dispatchPath } from '@faicad/faijs/cad-runtime/backend-dispatch'
import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import type { CadRuntime } from '@faicad/faijs/cad-runtime/runtime'
import type { Shape } from '@faicad/faijs/mesh/types'
import { SCRIPT, bootGearRuntime } from './gear-flow-fixture.js'
import { yieldWorkerRpc } from '../_support/worker-yield.js'

let runtime: CadRuntime
let result: Awaited<ReturnType<CadRuntime['execute']>>

beforeAll(async () => {
  runtime = await bootGearRuntime('auto')
  result = await runtime.execute(SCRIPT)
}, 240000)

function shapeOf(part: string): Shape {
  const v = result.outputs.get(asPartName(part))
  if (!v) throw new Error(`no output shape '${part}'`)
  return v as Shape
}

function activeValue(part: string): unknown {
  return result.activeValues?.get(asPartName(part))
}

describe('P26 gear-lib-demo §8.4 — build, acceptance ①②③④⑥ and kernel arena ⑦', () => {
  it('① g1 is a faijs Shape: hasBrep === true and a non-empty mesh payload', () => {
    expect(result.failedAt).toBeUndefined()
    const g1 = shapeOf('g1')
    expect(isShape(g1)).toBe(true)
    expect(hasBrep(g1)).toBe(true)
    expect(g1.positions.length).toBeGreaterThan(0)
    expect(g1.indices.length).toBeGreaterThan(0)
  })

  it('② the cad.union boolean runs on the BREP chain ("brep" path, result keeps its slot)', () => {
    const g = shapeOf('g1')
    const u1 = shapeOf('u1')
    expect(hasBrep(u1)).toBe(true)
    expect(dispatchPath([g, u1], { brep: () => undefined })).toBe('brep')
  })

  it('③ the planetary multi-output record { sun, planets, ring } keeps its structure', () => {
    const a1 = activeValue('a1') as
      | { sun?: Shape; planets?: unknown[]; ring?: Shape }
      | undefined
    expect(a1).toBeDefined()
    expect(a1!.sun).toBeDefined()
    expect(isShape(a1!.sun as Shape)).toBe(true)
    expect(hasBrep(a1!.sun as Shape)).toBe(true)
    expect(Array.isArray(a1!.planets)).toBe(true)
    expect(a1!.planets!.length).toBe(3)
    expect(a1!.ring).toBeDefined()
  })

  it('④ STEP export of the union carries ADVANCED_FACE (exact, not polygon faceting)', () => {
    const entry = result.brepSolids?.get(asPartName('u1'))
    expect(entry).toBeDefined()
    const step = entry!.kernel.exportStep(entry!.solid)
    expect(step).toContain('ADVANCED_FACE')
    expect(step).not.toContain('POLY_FACE')
  })

  it('⑥ mesh mode hits E_MESH_UNSUPPORTED when invoking the gear library (no silent fallback)', async () => {
    const r = await bootGearRuntime('mesh')
    try {
      const res = await r.execute(SCRIPT)
      expect(res.failedAt).toBeDefined()
      expect(res.failedAt!.message).toMatch(/E_MESH_UNSUPPORTED|not supported|mesh/i)
    } finally {
      r.dispose()
    }
  }, 120_000)

  it('⑦ repeated identical executions keep the kernel arena bounded (no per-statement handle leak)', async () => {
    const kernel = getKernel() as unknown as { shapeCount: number }
    const base = kernel.shapeCount
    for (let i = 0; i < 4; i++) {
      await runtime.execute(SCRIPT) // same code: cache hit, no rebuild
      // Four chained executes are ~40s of synchronous geometry: yield between
      // them so the worker keeps servicing birpc's 60s `onTaskUpdate` window
      // (`faijs/_support/worker-yield.ts`).
      await yieldWorkerRpc()
    }
    const growth = kernel.shapeCount - base
    expect(growth).toBeLessThanOrEqual(400)
  }, 120_000)
})
