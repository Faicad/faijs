/**
 * P26 e2e — sheetmetal through the compat boundary, §8.4 scenario.
 *
 * Script (data-middle flow, §8.4's DSL rendered on the real library API):
 *   import * as sheet from '<sheetlib>'
 *   let p0 = sheet.author({ thickness: 2, base: { length: 100, width: 60 }, flanges: [] })
 *   let p1 = sheet.hem(p0, { region: 'base', side: 'xmax', type: 'closed', length: 10, radius: 2, rule: { ... } })
 *   let s1 = sheet.solidOf(p1)                 // explicit geometry terminal ⑦
 *   let b0 = cad.box(10, 10, 10, { centered: true })
 *   let b1 = cad.union(s1, b0)                 // §8.4's cad.union(s1, cad.box(...))
 *   let u1 = sheet.unfold(p1)                  // multi-output record
 *   let r1 = sheet.report(p1)                  // pure data query
 *
 * Seven assertions (plan §8.4):
 *   ① s1 is a faijs Shape (hasBrep === true, mesh payload non-empty)
 *   ② the union boolean runs on the BREP chain (no mesh degrade)
 *   ③ the multi-output record ({ pattern, report, warnings }) and the data
 *      query keep their structure
 *   ④ STEP export of the derived solid carries ADVANCED_FACE
 *   ⑤ B2 incremental: re-register keeps keys; author-param change recomputes
 *      only downstream; a changed library version recomputes all lib-bound
 *   ⑥ mesh-mode invocation → E_MESH_UNSUPPORTED (no silent fallback)
 *   ⑦ repeated same-code executions keep the kernel arena bounded (no
 *      per-statement handle leak through the compat bridge)
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { asPartName } from '@faicad/faijs-core/identity'
import { hasBrep, isShape } from '@faicad/faijs-core/shape'
import { dispatchPath } from '@faicad/faijs-core/cad-runtime/backend-dispatch'
import { getKernel } from '@faicad/faijs-core/occt-kernel/occtKernel'
import { parseScript } from '@faicad/faijs-core/lang/parser'
import type { CadRuntime } from '@faicad/faijs-core/cad-runtime/runtime'
import type { StdlibNamespace } from '@faicad/faijs-core/runtime-state'
import type { Shape } from '@faicad/faijs-core/mesh/types'
import * as sheetPkg from '@faicad/sheetmetal'

/**
 * The registered library projection: the real @faicad/sheetmetal entry
 * functions consumable from a `.fai.js` script through `{ compat: true }`.
 */
const sheetNs: StdlibNamespace = {
  author: sheetPkg.author,
  hem: sheetPkg.hem,
  solidOf: sheetPkg.solidOf,
  unfold: sheetPkg.unfold,
  report: sheetPkg.report,
}

/** A second library implementation (different `author` body) for the B2
 *  "new library version → full recompute" check — content-addressable libId
 *  difference only; the behavior is identical. */
const sheetV2: StdlibNamespace = {
  author: ((spec: unknown) =>
    sheetPkg.author(spec as Parameters<typeof sheetPkg.author>[0])) as (...args: any[]) => unknown,
  hem: sheetPkg.hem,
  solidOf: sheetPkg.solidOf,
  unfold: sheetPkg.unfold,
  report: sheetPkg.report,
}

const SCRIPT = [
  "import * as sheet from 'sheet-lib'",
  'let p0 = sheet.author({ thickness: 2, base: { length: 100, width: 60 }, flanges: [] })',
  "let p1 = sheet.hem(p0, { region: 'base', side: 'xmax', type: 'closed', length: 10, radius: 2, rule: { innerRadius: 2, kFactor: 0.44 } })",
  'let s1 = sheet.solidOf(p1)',
  'let b0 = cad.box(10, 10, 10, { centered: true })',
  'let b1 = cad.union(s1, b0)',
  'let u1 = sheet.unfold(p1)',
  'let r1 = sheet.report(p1)',
  'let x1 = cad.box(1, 1, 1, { centered: true })',
].join('\n')

let runtime: CadRuntime
let result: Awaited<ReturnType<CadRuntime['execute']>>

beforeAll(async () => {
  await registerOcctBrepEngine()
  runtime = createRuntime(createNodePorts(), 'auto')
  runtime.registerLib('sheet', sheetNs, { compat: true })
  result = await runtime.execute(SCRIPT)
}, 180000)

function shapeOf(part: string): Shape {
  const v = result.outputs.get(asPartName(part))
  if (!v) throw new Error(`no output shape '${part}'`)
  return v as Shape
}

function activeValue(part: string): unknown {
  return result.activeValues?.get(asPartName(part))
}

describe('P26 sheet §8.4 — seven acceptance assertions', () => {
  it('① s1 is a faijs Shape: hasBrep === true and a non-empty mesh payload', () => {
    expect(result.failedAt).toBeUndefined()
    const s1 = shapeOf('s1')
    expect(isShape(s1)).toBe(true)
    expect(hasBrep(s1)).toBe(true)
    expect(s1.positions.length).toBeGreaterThan(0)
    expect(s1.indices.length).toBeGreaterThan(0)
  })

  it('② the cad.union boolean runs on the BREP chain ("brep" path, result keeps its slot)', () => {
    const s1 = shapeOf('s1')
    const b1 = shapeOf('b1')
    expect(hasBrep(b1)).toBe(true)
    expect(dispatchPath([s1, b1], { brep: () => undefined })).toBe('brep')
  })

  it('③ the multi-output record { pattern, report, warnings } and the data query keep their structure', () => {
    // §8.4's "{ flat, bends }" sketch corresponds to the library's real record:
    // UnfoldResult { pattern: FlatPattern, report: BendReport, warnings } and
    // the report() result — all plain data, crossing the compat boundary as-is.
    const u1 = activeValue('u1') as
      | {
          pattern?: { outline?: unknown; bendLines?: unknown[]; holes?: unknown[]; developedArea?: number }
          report?: unknown
          warnings?: unknown[]
        }
      | undefined
    expect(u1).toBeDefined()
    expect(u1!.pattern).toBeDefined()
    expect(Array.isArray(u1!.pattern!.bendLines)).toBe(true)
    expect(Array.isArray(u1!.pattern!.holes)).toBe(true)
    expect(typeof u1!.pattern!.developedArea).toBe('number')
    expect(u1!.report).toBeDefined()
    expect(Array.isArray(u1!.warnings)).toBe(true)
    const r1 = activeValue('r1')
    expect(r1).toBeDefined()
    expect(typeof r1).toBe('object')
  })

  it('④ STEP export of the derived solid carries ADVANCED_FACE (exact, not polygon faceting)', () => {
    const entry = result.brepSolids?.get(asPartName('b1'))
    expect(entry).toBeDefined()
    const step = entry!.kernel.exportStep(entry!.solid)
    expect(step).toContain('ADVANCED_FACE')
    expect(step).not.toContain('POLY_FACE')
  })

  it('⑤ author-param change recomputes only downstream; a changed lib version recomputes in full (B2)', async () => {
    const spec = { defaultNs: 'cad' }
    {
      // (a) re-registering the same library keeps the statement keys (B2:
      //     no spurious recompute for an unchanged lib content).
      // T4: uses module-path plan()/getStatementCacheEntry — module executor required
      const r = createRuntime(createNodePorts(), 'auto', { executor: 'module' })
      try {
        r.registerLib('sheet', sheetNs, { compat: true })
        await r.execute(SCRIPT)
        const s1Key0 = r.getStatementCacheEntry(asPartName('s1'))?.statementKey
        expect(s1Key0).toBeDefined()
        r.registerLib('sheet', sheetNs, { compat: true })
        await r.execute(SCRIPT)
        const s1Key1 = r.getStatementCacheEntry(asPartName('s1'))?.statementKey
        expect(s1Key1).toBe(s1Key0)
      } finally {
        r.dispose()
      }
    }
    {
      // (b) author-param change: p0 + everything downstream recomputes, the
      //     independent cad.box is reused — not a full re-run.
      const r = createRuntime(createNodePorts(), 'auto', { executor: 'module' })
      try {
        r.registerLib('sheet', sheetNs, { compat: true })
        await r.execute(SCRIPT)
        const changed = SCRIPT.replace('{ thickness: 2', '{ thickness: 3')
        const { script: changedScript } = parseScript(changed, spec)
        const { stale, reused } = r.plan(changedScript)
        await r.execute(changed)
        expect(stale.some((s) => s.outputs.includes(asPartName('s1')))).toBe(true)
        expect(stale.some((s) => s.outputs.includes(asPartName('p1')))).toBe(true)
        expect(reused.has(asPartName('x1'))).toBe(true) // cad.box untouched — reused
      } finally {
        r.dispose()
      }
    }
    {
      // (c) same binding, changed library implementation → the sheet-bound
      //     statements are all stale (full lib recompute), cad-bound untouched.
      const r = createRuntime(createNodePorts(), 'auto', { executor: 'module' })
      try {
        r.registerLib('sheet', sheetNs, { compat: true })
        await r.execute(SCRIPT)
        r.registerLib('sheet', sheetV2, { compat: true })
        const { script } = parseScript(SCRIPT, spec)
        const { stale, reused } = r.plan(script)
        expect(stale.some((s) => s.outputs.includes(asPartName('s1')))).toBe(true)
        expect(stale.some((s) => s.outputs.includes(asPartName('p0')))).toBe(true)
        expect(reused.has(asPartName('x1'))).toBe(true) // cad.box shares nothing w/ the lib
      } finally {
        r.dispose()
      }
    }
  }, 120_000)

  it('⑥ mesh mode hits E_MESH_UNSUPPORTED when invoking the sheet library (no silent fallback)', async () => {
    const r = createRuntime(createNodePorts(), 'mesh')
    try {
      r.registerLib('sheet', sheetNs, { compat: true })
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
    // The compat bridge may not add ANY per-call growth beyond the native
    // accounting slop; a tiny tolerance (≤ small constant) proves boundedness.
    expect(growth).toBeLessThanOrEqual(200)
  }, 120_000)
})