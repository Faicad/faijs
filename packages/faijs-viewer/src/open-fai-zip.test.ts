/**
 * `openFaiZip` e2e test — builds a minimal in-memory `.fai.zip` via
 * `@faicad/faijs/io/fai-zip` (`writeContainer`), then opens it through the
 * viewer's public API and asserts structured meshes come back non-empty.
 *
 * Runs in Node (vitest): `openFaiZip` validates the three wasm urls (v1
 * contract) even though they are not fetched here; the engine falls back to
 * core's local occt/manifold auto-load, so a real box mesh is produced.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { writeContainer, createManifest } from '@faicad/faijs/io/fai-zip'
import { openFaiZip } from './open-fai-zip'

// The three v1 wasm urls are mandatory. In a browser host these would be real
// deployment URLs; in a Node test they are validated but not fetched, and the
// engine executes against locally-bundled occt/manifold wasm instead.
const WASM = {
  occtUrl: 'http://localhost:0/wasm/occt-wasm.wasm',
  manifoldUrl: 'http://localhost:0/wasm/manifold.wasm',
  brepkitUrl: 'http://localhost:0/wasm/brepkit_wasm_bg.wasm',
}

/** A single-model container whose active script is `cad.box(10, 20, 30)`. */
function makeBoxContainer(): Uint8Array {
  const entryPath = 'model/box.fai.js'
  const manifest = createManifest({
    models: [{ id: 'box', entry: entryPath }],
    active: 'box',
    meta: { source: { file: 'minimal.FCStd', programVersion: '0.0.0', schemaVersion: 0 } },
  })
  const { bytes } = writeContainer({
    models: manifest.models,
    active: manifest.active,
    meta: { source: { file: 'minimal.FCStd', programVersion: '0.0.0', schemaVersion: 0 } },
    modules: { [entryPath]: 'let g = cad.box(10, 20, 30)\n' },
    dataMembers: {},
    files: {},
    assets: {},
  })
  return bytes
}

describe('openFaiZip (e2e, node + local engines)', () => {
  beforeAll(async () => {
    // Best-effort warm: some CI bases may already have the occt singleton up.
  })

  it('executes the active model and returns tessellated meshes', async () => {
    const bytes = makeBoxContainer()
    const result = await openFaiZip(bytes, { wasm: WASM })

    expect(result.error).toBeUndefined()
    expect(result.modelId).toBe('box')
    expect(result.meshes.length).toBeGreaterThan(0)
    for (const mesh of result.meshes) {
      expect(mesh.positions.length).toBeGreaterThan(0)
      expect(mesh.indices.length).toBeGreaterThan(0)
      expect(mesh.indices.length % 3).toBe(0)
    }
  })

  it('throws E_WASM_URL when one of the three urls is empty (contract violation)', async () => {
    const bytes = makeBoxContainer()
    await expect(
      openFaiZip(bytes, { wasm: { occtUrl: '', manifoldUrl: 'x', brepkitUrl: 'y' } }),
    ).rejects.toThrow(/occtUrl/)
  })

  it('surfaces E_CONTAINER when the bytes are not a valid .fai.zip', async () => {
    const result = await openFaiZip(new Uint8Array([1, 2, 3]), { wasm: WASM })
    expect(result.error?.code).toBe('E_CONTAINER')
  })

  it('surfaces E_EXECUTION when the active model fails at runtime', async () => {
    const entryPath = 'model/broken.fai.js'
    const manifest = createManifest({ models: [{ id: 'broken', entry: entryPath }], active: 'broken' })
    // GOTCHA: an entry that `import`s an absent module does NOT fail—the runtime
    // tolerates it (resolves to an empty import) and still runs to a mesh. To
    // reliably abort a model in a regression test, force a statement-level throw.
    const { bytes } = writeContainer({
      models: manifest.models,
      active: manifest.active,
      // The entry script throws on first statement, so execution stops with a
      // failed op rather than producing any grid-shaped output.
      modules: { [entryPath]: 'throw new Error("boom")\nlet g = cad.box(10, 20, 30)\n' },
      dataMembers: {},
      files: {},
      assets: {},
    })
    const result = await openFaiZip(bytes, { wasm: WASM })
    expect(result.error?.code).toBe('E_EXECUTION')
  })

  it('renders a cad.sketch model (sketch library merged into the cad namespace)', async () => {
    // Real FreeCAD-converted containers call `cad.sketch` / `cad.draw`, which
    // are not core ops. `openFaiZip` must merge the sketch+draw namespaces and
    // auto-install the planegcs solver under Node, otherwise a sketch container
    // fails with `cad.sketch is not a function`. This regression pins that
    // wiring. `cad.sketch` is brep-only, so the executed face is tessellated
    // through the local occt chain in this Node runner.
    const entryPath = 'model/plate.fai.js'
    const moduleSource = [
      'let plate = cad.sketch({',
      "  plane: 'XY',",
      "  shapes: [ { kind: 'rect', w: 100, d: 60, tag: 'g0' } ],",
      '})',
      'let body = cad.extrude(plate, 20)\n',
    ].join('\n')
    const { bytes } = writeContainer({
      models: [{ id: 'plate', entry: entryPath }],
      active: 'plate',
      modules: { [entryPath]: moduleSource },
      dataMembers: {},
      files: {},
      assets: {},
    })

    const result = await openFaiZip(bytes, { wasm: WASM })

    expect(result.error).toBeUndefined()
    expect(result.meshes.length).toBeGreaterThan(0)
    for (const mesh of result.meshes) {
      expect(mesh.positions.length).toBeGreaterThan(0)
      expect(mesh.indices.length).toBeGreaterThan(0)
    }
  })
})

// ── preset faijs-extra surface (draw removed) + dynamic third-party libraries ──

/** A single-model container whose active script imports `@faicad/faijs-gears`. */
function makeGearsContainer(): Uint8Array {
  const entryPath = 'model/gear.fai.js'
  const { bytes } = writeContainer({
    models: [{ id: 'gear', entry: entryPath }],
    active: 'gear',
    modules: {
      [entryPath]: [
        "import * as gears from '@faicad/faijs-gears'",
        'let g = gears.spurGear({ module: 2, teeth_number: 12, width: 8 })',
      ].join('\n'),
    },
    dataMembers: {},
    files: {},
    assets: {},
  })
  return bytes
}

describe('openFaiZip — preset faijs-extra surface (draw removed)', () => {
  it('executes an editor-op model (cad.copy) without any import statement', async () => {
    const entryPath = 'model/copy.fai.js'
    const { bytes } = writeContainer({
      models: [{ id: 'copy', entry: entryPath }],
      active: 'copy',
      modules: { [entryPath]: 'let a = cad.box(10, 20, 30)\nlet b = cad.copy(a)\n' },
      dataMembers: {},
      files: {},
      assets: {},
    })

    const result = await openFaiZip(bytes, { wasm: WASM })
    expect(result.error).toBeUndefined()
    expect(result.meshes.length).toBeGreaterThan(0)
  })

  it('recognises the B-group creator cad.text (its param validation runs)', async () => {
    const entryPath = 'model/text-ref.fai.js'
    const { bytes } = writeContainer({
      models: [{ id: 'text', entry: entryPath }],
      active: 'text',
      modules: { [entryPath]: "let t = cad.text({ text: '', size: 1, depth: 1 })\n" },
      dataMembers: {},
      files: {},
      assets: {},
    })

    const result = await openFaiZip(bytes, { wasm: WASM })
    // An unknown callee would surface as "not a function"; reaching the
    // library's own parameter validation proves the symbol was registered.
    expect(result.error?.code).toBe('E_EXECUTION')
    expect(result.error?.message).toMatch(/\[extra\/text\]/)
  })

  it('fails a cad.draw call as an unknown callee (draw no longer preset)', async () => {
    const entryPath = 'model/draw.fai.js'
    const { bytes } = writeContainer({
      models: [{ id: 'draw', entry: entryPath }],
      active: 'draw',
      modules: { [entryPath]: 'cad.draw("dummy")\n' },
      dataMembers: {},
      files: {},
      assets: {},
    })

    const result = await openFaiZip(bytes, { wasm: WASM })
    expect(result.error?.code).toBe('E_EXECUTION')
    expect(result.error?.message).toMatch(/cad\.draw/)
  })
})

describe('openFaiZip — dynamic third-party libraries (libs)', () => {
  it('rejects a non-@faicad library as a structured E_EXECUTION', async () => {
    const entryPath = 'model/stranger.fai.js'
    const { bytes } = writeContainer({
      models: [{ id: 'stranger', entry: entryPath }],
      active: 'stranger',
      modules: {
        [entryPath]: [
          "import * as x from '@suspicious/not-faicad'",
          'let a = cad.box(10, 20, 30)',
        ].join('\n'),
      },
      dataMembers: {},
      files: {},
      assets: {},
    })

    const result = await openFaiZip(bytes, { wasm: WASM })
    expect(result.error?.code).toBe('E_EXECUTION')
    expect(result.error?.message).toMatch(/scoped @faicad/)
  })

  it('fails with an unbound namespace when libs.enabled === false', async () => {
    const bytes = makeGearsContainer()
    const result = await openFaiZip(bytes, { wasm: WASM, libs: { enabled: false } })
    expect(result.error?.code).toBe('E_EXECUTION')
  })

  it('loads an installed @faicad library by default (no whitelist needed) and tessellates its output', async () => {
    const bytes = makeGearsContainer()
    const result = await openFaiZip(bytes, { wasm: WASM })
    expect(result.error).toBeUndefined()
    expect(result.meshes.length).toBeGreaterThan(0)
  })
})