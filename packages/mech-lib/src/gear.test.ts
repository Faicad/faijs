/**
 * gear — raw `Result` contract + script-level adoption tests (P24).
 *
 * Covers the C1/C3 fixture after §8.1:
 *  - raw factories return `Result` (never throw): ok carries the raw solid,
 *    err carries the validation code (no more module-level error throwing).
 *  - `planetary` returns the structured `{ sun, planets, ring }` record with
 *    the static `geometryFields` annotation (outbound adoption point).
 *  - through `registerLib(…, { compat: true })` the boundary adopts the raw
 *    handles into faijs Shapes (Shape + hasBrep).
 *  - mesh mode → E_MESH_UNSUPPORTED (brep-only, no fallback).
 *
 * Host timing (§6.4): build the runtime first, warm it up (one box statement;
 * `registerOcctBrepEngine()` has bound the vendored kernel), then use the lib.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine, isOk } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs-core/node'
import { hasBrep } from '@faicad/faijs-core/shape'
import { asPartName } from '@faicad/faijs-core/identity'
import type { Shape } from '@faicad/faijs-core/mesh/types'
import * as gear from './gear'

let runtime: ReturnType<typeof createRuntime>

beforeAll(async () => {
  await registerOcctBrepEngine()
  runtime = createRuntime(createNodePorts(), 'auto')
  // warm the shared occt kernel + dispatch state; the produced shape is
  // intentionally discarded (the execute() call itself is the warm-up)
  const warm = await runtime.execute('let a = cad.box({ size: [1, 1, 1] })')
  expect(warm.failedAt).toBeUndefined()
}, 120000)

describe('gear raw Result contract (§8.1)', () => {
  it('external returns a Result whose ok value is the raw gear solid', () => {
    const r = gear.external({ teeth: 24, moduleSize: 2, thickness: 8, bore: 8 })
    expect(isOk(r)).toBe(true)
    const v = (r as { ok: true; value: { wrapped?: unknown } }).value
    expect(v).toBeDefined()
    expect(v.wrapped).toBeDefined() // raw handle, not a faijs Shape yet
  })

  it('internal returns an Ok ring solid', () => {
    const r = gear.internal({ teeth: 48, moduleSize: 2, thickness: 8 })
    expect(isOk(r)).toBe(true)
    expect((r as { ok: true; value: unknown }).value).toBeDefined()
  })

  it('planetary returns the { sun, planets, ring } record with geometryFields', () => {
    const r = gear.planetary({ thickness: 8, sunTeeth: 12, planetTeeth: 6, numPlanets: 3 })
    expect(isOk(r)).toBe(true)
    const v = (r as { ok: true; value: { sun: unknown; planets: unknown[]; ring: unknown } }).value
    expect(v.sun).toBeDefined()
    expect(Array.isArray(v.planets)).toBe(true)
    expect(v.planets.length).toBeGreaterThanOrEqual(3)
    expect(v.ring).toBeDefined()
    const gf = (gear.planetary as unknown as { geometryFields?: string[] }).geometryFields
    expect(gf).toEqual(['planets', 'ring', 'sun'])
  })

  it('thread returns Ok with the thread-ridge solid', () => {
    const r = gear.thread({ radius: 10, pitch: 2, height: 12 })
    expect(isOk(r)).toBe(true)
    expect((r as { ok: true; value: unknown }).value).toBeDefined()
  })

  it('invalid inputs return Err (never throw): thickness / bore / thread radius', () => {
    const t = gear.external({ teeth: 24, moduleSize: 2, thickness: 0 })
    expect(isOk(t)).toBe(false)
    expect((t as { error: { code?: string } }).error.code).toBe('GEAR_THICKNESS_NONPOSITIVE')
    const b = gear.external({ teeth: 24, moduleSize: 2, thickness: 8, bore: 100 })
    expect((b as { error: { code?: string } }).error.code).toBe('GEAR_BORE_TOO_LARGE')
    const th = gear.thread({ radius: 0, pitch: 1, height: 12 })
    expect(isOk(th)).toBe(false)
    expect((th as { error: { code?: string } }).error.code).toBe('THREAD_INVALID_RADIUS')
  })
})

describe('gear through registerLib({ compat: true })', () => {
  it('script `gear.external(...)` yields a faijs Shape with a brep slot', async () => {
    const rt = createRuntime(createNodePorts(), 'auto')
    try {
      rt.registerLib('gear', gear as never, { compat: true } as never)
      const res = await rt.execute([
        "import * as gear from 'gear-lib'",
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
    const meshRt = createRuntime(createNodePorts(), 'mesh')
    try {
      meshRt.registerLib('gear', gear as never, { compat: true } as never)
      const res = await meshRt.execute([
        "import * as gear from 'gear-lib'",
        'let g0 = gear.external({ teeth: 24, moduleSize: 2, thickness: 8, bore: 8 })',
      ].join('\n'))
      expect(res.failedAt).toBeDefined()
      expect(res.failedAt!.message).toMatch(/E_MESH_UNSUPPORTED|not supported/i)
    } finally {
      meshRt.dispose()
    }
  })
})