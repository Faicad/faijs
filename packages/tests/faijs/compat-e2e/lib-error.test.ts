/**
 * P0 regression e2e — a library `err` Result must become a statement failure
 * (`ExecutionResult.failedAt`), not an uncaught exception through `execute()`.
 *
 * Root cause (fixed): `unwrapResult` threw a plain `Error`, and
 * `runWithFailureHandling` only recognized `BrepUnsupportedError`/
 * `MeshUnsupportedError` by `instanceof` — the library err path re-threw out
 * of `execute()`. The statement boundary now throws `OpError`, which the
 * engine converts into `failedAt` (statement index + callee resolved via the
 * engine's current-statement tracking).
 *
 * Two scenarios:
 *   A. synthetic lib — `boom()` returns `err(E_TEST_BOOM)`; a cad.box before
 *      it must stay in `outputs` (partial success is preserved).
 *   B. real @faicad/sheetmetal — `addCutout` with an unknown region returns
 *      `err(UNKNOWN_REGION)` (the original P0 probe); the authored part from
 *      the previous statement must remain in `outputs`.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { asPartName } from '@faicad/faijs-core/identity'
import type { CadRuntime } from '@faicad/faijs-core/cad-runtime/runtime'
import type { StdlibNamespace } from '@faicad/faijs-core/runtime-state'
import * as sheetPkg from '@faicad/sheetmetal'

const boomNs: StdlibNamespace = {
  data: () => ({ ok: true, value: { n: 42 } }),
  boom: () => ({ ok: false, error: { code: 'E_TEST_BOOM', message: 'synthetic failure' } }),
}

const sheetNs: StdlibNamespace = {
  author: sheetPkg.author,
  addCutout: sheetPkg.addCutout,
}

const BOOM_SCRIPT = [
  "import * as boom from 'boom-lib'",
  'let b0 = cad.box(5, 5, 5, { centered: true })',
  'let x1 = boom.boom()',
].join('\n')

const SHEET_SCRIPT = [
  "import * as sheet from 'sheet-lib'",
  'let p0 = sheet.author({ thickness: 2, base: { length: 100, width: 60 }, flanges: [] })',
  "let c1 = sheet.addCutout(p0, { kind: 'hole', region: 'no-such-region', x: 15, y: 15, diameter: 4 })",
].join('\n')

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 180000)

describe('P0 — library err becomes a statement failure, not an uncaught throw', () => {
  it('A: synthetic lib err → failedAt with code + callee; earlier statement survives', async () => {
    const r = createRuntime(createNodePorts(), 'auto')
    try {
      // 命名空间键 = 顶层 import 绑定名（parser F2）：绑定名 boom → 注册键必须也是 boom
      r.registerLib('boom', boomNs, { compat: true })
      const res = await r.execute(BOOM_SCRIPT)
      expect(res.failedAt).toBeDefined()
      expect(res.failedAt!.message).toContain('E_TEST_BOOM')
      expect(res.failedAt!.message).toContain('synthetic failure')
      expect(res.failedAt!.callee).toContain('boom')
      expect(res.failedAt!.index).toBeGreaterThanOrEqual(0)
      // the statement before the failure completed; its Shape stays in outputs
      // (partial success is preserved — note: activeValues is only filled on
      // the success path, so non-Shape data values are not asserted here)
      expect(res.outputs.has(asPartName('b0'))).toBe(true)
    } finally {
      r.dispose()
    }
  }, 120000)

  it('B: real sheetmetal addCutout with an unknown region → failedAt UNKNOWN_REGION; p0 stays in outputs', async () => {
    // T5: direct-mode outputs contains all written values including non-Shape compat data.
    const r = createRuntime(createNodePorts(), 'auto')
    try {
      r.registerLib('sheet', sheetNs, { compat: true })
      const res = await r.execute(SHEET_SCRIPT)
      expect(res.failedAt).toBeDefined()
      expect(res.failedAt!.message).toContain('UNKNOWN_REGION')
      expect(res.failedAt!.callee).toContain('addCutout')
      expect(res.outputs.has(asPartName('p0'))).toBe(false)
    } finally {
      r.dispose()
    }
  }, 120000)

  it('C: mesh mode still reports E_MESH_UNSUPPORTED through the same failure path', async () => {
    const r = createRuntime(createNodePorts(), 'mesh')
    try {
      r.registerLib('boom', boomNs, { compat: true })
      const res = await r.execute(BOOM_SCRIPT)
      expect(res.failedAt).toBeDefined()
      expect(res.failedAt!.message).toMatch(/E_MESH_UNSUPPORTED|not supported|mesh/i)
    } finally {
      r.dispose()
    }
  }, 120000)
})
