/**
 * gear — raw `Result` contract + script-level adoption tests (P24).
 *
 * Covers the C1/C3 fixture after §8.1:
 *  - raw factories return `Result` (never throw): ok carries the raw solid,
 *    err carries the validation code (no more module-level error throwing).
 *  - `planetary` returns the structured `{ sun, planets, ring }` record with
 *    the static `outputs` annotation (outbound adoption point).
 *  - through `registerLib(…, { autoLift: true })` the boundary adopts the raw
 *    handles into faijs Shapes (Shape + hasBrep).
 *  - mesh mode → E_MESH_UNSUPPORTED (brep-only, no fallback).
 *
 * Host timing (§6.4): build the runtime first, warm it up (one box statement;
 * `registerOcctBrepEngine()` has bound the vendored kernel), then use the lib.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine, isOk } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { hasBrep, isShape } from '@faicad/faijs/shape'
import { asPartName } from '@faicad/faijs/identity'
import type { Shape } from '@faicad/faijs/mesh/types'
import * as gear from './gear'
import { createEditorRuntime } from '../../../_support/editor-runtime'

let runtime: ReturnType<typeof createRuntime>

beforeAll(async () => {
  await registerOcctBrepEngine()
  runtime = createEditorRuntime(createNodePorts(), 'auto')
  // warm the shared occt kernel + dispatch state; the produced shape is
  // intentionally discarded (the execute() call itself is the warm-up)
  const warm = await runtime.execute('let a = cad.box(1, 1, 1, { centered: true })')
  expect(warm.failedAt).toBeUndefined()
}, 120000)

describe('gear raw Result contract (§8.1)', () => {
  it('external returns a Result whose ok value is a faijs Shape (core payload)', async () => {
    const r = await gear.external({ teeth: 24, moduleSize: 2, thickness: 8, bore: 8 })
    expect(isOk(r)).toBe(true)
    const v = (r as { ok: true; value: Shape }).value
    expect(v).toBeDefined()
    expect(isShape(v)).toBe(true) // core dual-op Shape (2026-09-25 core-decouple: vendored gears deleted)
  })

  it('internal returns an Ok ring solid', async () => {
    const r = await gear.internal({ teeth: 48, moduleSize: 2, thickness: 8 })
    expect(isOk(r)).toBe(true)
    expect((r as { ok: true; value: unknown }).value).toBeDefined()
  })

  it('planetary returns the { sun, planets, ring } record with outputs', async () => {
    const r = await gear.planetary({ thickness: 8, sunTeeth: 12, planetTeeth: 6, numPlanets: 3 })
    expect(isOk(r)).toBe(true)
    const v = (r as { ok: true; value: { sun: unknown; planets: unknown[]; ring: unknown } }).value
    expect(v.sun).toBeDefined()
    expect(Array.isArray(v.planets)).toBe(true)
    expect(v.planets.length).toBeGreaterThanOrEqual(3)
    expect(v.ring).toBeDefined()
    const outputs = (gear.planetary as unknown as { outputs?: string[] }).outputs
    expect(outputs).toEqual(['planets', 'ring', 'sun'])
  })

  it('thread returns Ok with the thread-ridge solid', async () => {
    const r = await gear.thread({ radius: 10, pitch: 2, height: 12 })
    expect(isOk(r)).toBe(true)
    expect((r as { ok: true; value: unknown }).value).toBeDefined()
  })

  it('invalid inputs return Err (never throw): thickness / bore / thread radius', async () => {
    const t = await gear.external({ teeth: 24, moduleSize: 2, thickness: 0 })
    expect(isOk(t)).toBe(false)
    expect((t as { error: { code?: string } }).error.code).toBe('GEAR_THICKNESS_NONPOSITIVE')
    const b = await gear.external({ teeth: 24, moduleSize: 2, thickness: 8, bore: 100 })
    expect((b as { error: { code?: string } }).error.code).toBe('GEAR_BORE_TOO_LARGE')
    const th = await gear.thread({ radius: 0, pitch: 1, height: 12 })
    expect(isOk(th)).toBe(false)
    expect((th as { error: { code?: string } }).error.code).toBe('THREAD_INVALID_RADIUS')
  })
})

describe('gear through registerLib({ autoLift: true })', () => {
  it('script `gear.external(...)` yields a faijs Shape with a brep slot', async () => {
    const rt = createEditorRuntime(createNodePorts(), 'auto')
    try {
      rt.registerLib('gear', gear as never, { autoLift: true, packageName: 'test-fixture-lib' } as never)
      const res = await rt.execute([
        "import * as gear from 'test-fixture-lib'",
        'let g = gear.external({ teeth: 24, moduleSize: 2, thickness: 8, bore: 8 })',
      ].join('\n'))
      expect(res.failedAt).toBeUndefined()
      const g = res.outputs.get(asPartName('g')) as Shape | undefined
      expect(g).toBeDefined()
      expect(hasBrep(g!)).toBe(true)
    } finally {
      rt.dispose()
    }
  })

  it('mesh mode → E_MESH_UNSUPPORTED (no silent mesh fallback)', async () => {
    const meshRt = createEditorRuntime(createNodePorts(), 'mesh')
    try {
      meshRt.registerLib('gear', gear as never, { autoLift: true, packageName: 'test-fixture-lib' } as never)
      const res = await meshRt.execute([
        "import * as gear from 'test-fixture-lib'",
        'let g0 = gear.external({ teeth: 24, moduleSize: 2, thickness: 8, bore: 8 })',
      ].join('\n'))
      expect(res.failedAt).toBeDefined()
      expect(res.failedAt!.message).toMatch(/E_MESH_UNSUPPORTED|not supported/i)
    } finally {
      meshRt.dispose()
    }
  })
})
