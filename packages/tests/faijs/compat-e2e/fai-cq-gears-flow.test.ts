/**
 * fai_cq_gears through the compat boundary — the guard for "the browser side
 * can consume a real published gear library".
 *
 * Why this file exists: `@faicad/gear-lib-demo` (the former demo-side gear
 * library) was deleted on 2026-09-21; the demo's `gear-demo` example now has to
 * run a real gear library. `@faicad/fai-cq-gears` is that library, and it is
 * **fully async** — every factory does `await getGearKernel()` and returns
 * `Promise<Result<BrepHandle, string>>`. That shape is what the compat bridge
 * must be able to adopt, so this file is the acceptance gate for both halves of
 * the switch:
 *
 *   ① the async product is adopted into a faijs Shape on the BREP chain
 *      (not a promise leaking out of the statement);
 *   ② the downstream cad op keeps the BREP chain (no degrade to mesh);
 *   ③ STEP export carries ADVANCED_FACE (exact geometry, not faceting);
 *   ④ mesh mode rejects loudly (E_MESH_UNSUPPORTED — brep-only compat op).
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { asPartName } from '@faicad/faijs/identity'
import { hasBrep, isShape } from '@faicad/faijs/shape'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import type { CadRuntime } from '@faicad/faijs/cad-runtime/runtime'
import type { Shape } from '@faicad/faijs/mesh/types'
import * as gears from '@faicad/fai-cq-gears'
import { yieldWorkerRpc } from '../_support/worker-yield.js'

/** The script the demo `gear-demo` example runs (kept in sync by assertion). */
export const SCRIPT = [
  "import * as gears from '@faicad/fai-cq-gears'",
  'let g1 = gears.spurGear({ module: 2, teeth_number: 24, width: 8 })',
  'let g2 = gears.spurGear({ module: 2, teeth_number: 12, width: 8 })',
  'let m1 = cad.translate(g2, { offset: [36, 0, 0] })',
  'let u1 = cad.union(g1, m1)',
].join('\n')

let runtime: CadRuntime
let result: Awaited<ReturnType<CadRuntime['execute']>>

beforeAll(async () => {
  await registerOcctBrepEngine()
  runtime = createRuntime(createNodePorts(), 'auto')
  runtime.registerLib('gears', gears as never, {
    autoLift: true,
    packageName: '@faicad/fai-cq-gears',
  })
  result = await runtime.execute(SCRIPT)
}, 240000)

function shapeOf(part: string): Shape {
  const v = result.outputs.get(asPartName(part))
  if (!v) throw new Error(`no output shape '${part}'`)
  return v as Shape
}

describe('@faicad/fai-cq-gears through the compat boundary', () => {
  it('① async factory product is adopted into a BREP Shape (not a promise)', async () => {
    expect(result.failedAt).toBeUndefined()
    const g1 = shapeOf('g1')
    expect(isShape(g1)).toBe(true)
    expect(hasBrep(g1)).toBe(true)
    expect(g1.positions.length).toBeGreaterThan(0)
    await yieldWorkerRpc()
  })

  it('② the downstream cad.union keeps the BREP chain', async () => {
    const u1 = shapeOf('u1')
    expect(hasBrep(u1)).toBe(true)
    await yieldWorkerRpc()
  })

  it('③ STEP export carries ADVANCED_FACE (exact geometry)', async () => {
    const entry = result.brepSolids?.get(asPartName('u1'))
    expect(entry).toBeDefined()
    const step = entry!.kernel.exportStep(entry!.solid)
    expect(step).toContain('ADVANCED_FACE')
    expect(step).not.toContain('POLY_FACE')
    await yieldWorkerRpc()
  })

  it('④ mesh mode rejects loudly: E_MESH_UNSUPPORTED, no fallback', async () => {
    const meshRuntime = createRuntime(createNodePorts(), 'mesh')
    meshRuntime.registerLib('gears', gears as never, {
      autoLift: true,
      packageName: '@faicad/fai-cq-gears',
    })
    const meshResult = await meshRuntime.execute(SCRIPT)
    expect(meshResult.failedAt).toBeDefined()
    expect(String(meshResult.failedAt?.message ?? '')).toMatch(/E_MESH_UNSUPPORTED/)
    meshRuntime.dispose()
    await yieldWorkerRpc()
  })
})
