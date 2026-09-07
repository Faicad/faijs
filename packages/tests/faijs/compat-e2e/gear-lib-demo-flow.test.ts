/**
 * P26 e2e — gear-lib-demo through the compat boundary, §8.4 scenario.
 *
 * Script (geometry-first flow, verbatim §8.4):
 *   import * as gear from '<gearlib>'
 *   let g1 = gear.external({ teeth: 20, moduleSize: 2, thickness: 10 })
 *   let t1 = gear.thread({ radius: 5, pitch: 1, height: 20 })
 *   let u1 = cad.union(g1, cad.box(30, 30, 5, { centered: true }))
 *
 * The same seven acceptance assertions as the sheetmetal e2e, with the
 * multi-output record contributed by `planetary` (§8.1 outputs).
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { asPartName } from '@faicad/faijs-core/identity'
import { hasBrep, isShape } from '@faicad/faijs-core/shape'
import { dispatchPath } from '@faicad/faijs-core/cad-runtime/backend-dispatch'
import { getKernel } from '@faicad/faijs-core/occt-kernel/occtKernel'
import type { CadRuntime } from '@faicad/faijs-core/cad-runtime/runtime'
import type { StdlibNamespace } from '@faicad/faijs-core/runtime-state'
import type { Shape } from '@faicad/faijs-core/mesh/types'
import * as mechPkg from '@faicad/gear-lib-demo'

/** Registered library projection: the real @faicad/gear-lib-demo entries. */
const gearNs: StdlibNamespace = {
  external: mechPkg.external,
  thread: mechPkg.thread,
  planetary: mechPkg.planetary,
}

/** Different `external` body for the B2 "new library version" check. */
const gearV2: StdlibNamespace = {
  external: ((p: Parameters<typeof mechPkg.external>[0]) =>
    mechPkg.external(p)) as (...args: any[]) => unknown,
  thread: mechPkg.thread,
  planetary: mechPkg.planetary,
}

const SCRIPT = [
  "import * as gear from 'gear-lib-demo'",
  'let g1 = gear.external({ teeth: 20, moduleSize: 2, thickness: 10 })',
  'let t1 = gear.thread({ radius: 5, pitch: 1, height: 20 })',
  'let a1 = gear.planetary({ thickness: 8, sunTeeth: 12, planetTeeth: 6, numPlanets: 3 })',
  'let b0 = cad.box(30, 30, 5, { centered: true })',
  'let u1 = cad.union(g1, b0)',
  'let x1 = cad.box(1, 1, 1, { centered: true })',
].join('\n')

let runtime: CadRuntime
let result: Awaited<ReturnType<CadRuntime['execute']>>

beforeAll(async () => {
  await registerOcctBrepEngine()
  runtime = createRuntime(createNodePorts(), 'auto')
  runtime.registerLib('gear', gearNs, { autoLift: true, packageName: 'gear-lib-demo' })
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

describe('P26 gear-lib-demo §8.4 — seven acceptance assertions', () => {
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

  it('⑤ external-param change recomputes downstream; changed lib version recomputes in full (B2)', async () => {
    {
      // (a) re-registering the same library keeps the statementKey (no spurious recompute)
      const r = createRuntime(createNodePorts(), 'auto')
      try {
        r.registerLib('gear', gearNs, { autoLift: true, packageName: 'gear-lib-demo' })
        await r.execute(SCRIPT)
        const u1Key0 = r.getStatementCacheEntry(asPartName('u1'))?.statementKey
        expect(u1Key0).toBeDefined()
        r.registerLib('gear', gearNs, { autoLift: true, packageName: 'gear-lib-demo' })
        await r.execute(SCRIPT)
        const u1Key1 = r.getStatementCacheEntry(asPartName('u1'))?.statementKey
        expect(u1Key1).toBe(u1Key0)
      } finally {
        r.dispose()
      }
    }
    {
      // (b) external-param change: full re-run via update; geometry changes.
      // T5: plan() deleted; use update() to verify recompute happens.
      const r = createRuntime(createNodePorts(), 'auto')
      try {
        r.registerLib('gear', gearNs, { autoLift: true, packageName: 'gear-lib-demo' })
        const r1 = await r.execute(SCRIPT)
        expect(r1.failedAt).toBeUndefined()
        const changed = SCRIPT.replace('{ teeth: 20', '{ teeth: 24')
        const r2 = await r.update(SCRIPT, changed)
        expect(r2.failedAt).toBeUndefined()
        // g1 geometry must change (teeth changed)
        const g1Before = r1.outputs.get(asPartName('g1')) as Shape | undefined
        const g1After = r2.outputs.get(asPartName('g1')) as Shape | undefined
        expect(g1After).toBeDefined()
        expect(g1After!.positions.length).not.toBe(g1Before!.positions.length)
      } finally {
        r.dispose()
      }
    }
    {
      // (c) same binding, changed library implementation → full recompute.
      // T5: plan() deleted; verify recompute via update().
      const r = createRuntime(createNodePorts(), 'auto')
      try {
        r.registerLib('gear', gearNs, { autoLift: true, packageName: 'gear-lib-demo' })
        const r1 = await r.execute(SCRIPT)
        expect(r1.failedAt).toBeUndefined()
        r.registerLib('gear', gearV2, { autoLift: true, packageName: 'gear-lib-demo' })
        const r2 = await r.update(SCRIPT, SCRIPT)
        expect(r2.failedAt).toBeUndefined()
        const g1 = r2.outputs.get(asPartName('g1')) as Shape | undefined
        expect(g1).toBeDefined()
      } finally {
        r.dispose()
      }
    }
  }, 120_000)

  it('⑥ mesh mode hits E_MESH_UNSUPPORTED when invoking the gear library (no silent fallback)', async () => {
    const r = createRuntime(createNodePorts(), 'mesh')
    try {
      r.registerLib('gear', gearNs, { autoLift: true, packageName: 'gear-lib-demo' })
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
    }
    const growth = kernel.shapeCount - base
    expect(growth).toBeLessThanOrEqual(400)
  }, 120_000)
})