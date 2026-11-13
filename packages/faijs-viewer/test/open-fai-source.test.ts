/**
 * `openFaiSource` e2e tests — execute a single `.fai.js` script through the
 * viewer's public API without wrapping it in a `.fai.zip` container.
 *
 * Runs in Node (vitest): the two wasm urls are validated by the v1 contract
 * but not fetched; core auto-loads its local occt/manifold wasm, so these are
 * real executions producing real tessellated meshes.
 */

import { describe, it, expect } from 'vitest'
import type { AssetResolver, ProjectLoader } from '@faicad/faijs'
import { assertWasmUrls } from '../src/engine'
import { openFaiSource } from '../src/open-fai-source'

const WASM = {
  occtUrl: 'http://localhost:0/wasm/occt-wasm.wasm',
  manifoldUrl: 'http://localhost:0/wasm/manifold.wasm',
}

const BOX = 'let g = cad.box(10, 20, 30)\n'

function expectTriangleSoup(meshes: Array<{ positions: Float32Array; indices: Uint32Array }>): void {
  expect(meshes.length).toBeGreaterThan(0)
  for (const mesh of meshes) {
    expect(mesh.positions.length).toBeGreaterThan(0)
    expect(mesh.indices.length).toBeGreaterThan(0)
    expect(mesh.indices.length % 3).toBe(0)
  }
}

describe('openFaiSource (e2e, node + local engines)', () => {
  it('executes a bare .fai.js source into tessellated meshes', async () => {
    const result = await openFaiSource(BOX, { wasm: WASM })

    expect(result.error).toBeUndefined()
    // A single script has no container model id; the default module key is
    // exposed as provenance instead.
    expect(result.modelId).toBe('')
    expect(result.sourceFile).toBe('model.fai.js')
    expectTriangleSoup(result.meshes)
  })

  it('accepts the full option surface and host file-resolution capabilities', async () => {
    const projectLoader: ProjectLoader = {
      listModules: () => ['Box.fai.js'],
      readSource: async (key) => (key === 'Box.fai.js' ? BOX : ''),
    }
    const assets: AssetResolver = {
      resolveByKey: async () => ({ bytes: new ArrayBuffer(0), format: 'stl' }),
      resolveFile: async () => new ArrayBuffer(0),
      resolveUrl: async () => new ArrayBuffer(0),
    }

    const result = await openFaiSource(BOX, {
      wasm: WASM,
      entryKey: 'Box.fai.js',
      projectLoader,
      assets,
      mode: 'auto',
      sketch: {},
      libs: { enabled: true },
    })

    expect(result.error).toBeUndefined()
    expect(result.sourceFile).toBe('Box.fai.js')
    expectTriangleSoup(result.meshes)
  })

  it('returns E_SOURCE for an empty or non-string source', async () => {
    expect((await openFaiSource('', { wasm: WASM })).error?.code).toBe('E_SOURCE')
    expect((await openFaiSource('   \n', { wasm: WASM })).error?.code).toBe('E_SOURCE')
    expect((await openFaiSource(null as unknown as string, { wasm: WASM })).error?.code).toBe(
      'E_SOURCE',
    )
  })

  it('throws E_WASM_URL when one of the two urls is empty', async () => {
    await expect(
      openFaiSource(BOX, { wasm: { occtUrl: '', manifoldUrl: 'x' } }),
    ).rejects.toThrow(/occtUrl/)
  })

  it('requires exactly occt + manifold: no brepkit wasm url in the contract', async () => {
    // The viewer never registers a brepkit kernel, so a third url would be a
    // dead field that makes hosts ship a wasm nobody fetches. Pin the shape.
    expect(Object.keys(WASM)).toEqual(['occtUrl', 'manifoldUrl'])
    expect(() => assertWasmUrls(WASM)).not.toThrow()
    const result = await openFaiSource(BOX, { wasm: WASM })
    expect(result.error).toBeUndefined()
    expectTriangleSoup(result.meshes)
  })

  it('surfaces E_EXECUTION when a statement fails', async () => {
    // GOTCHA: an import of an absent module is tolerated by the runtime, so a
    // statement-level throw is the reliable way to abort execution here.
    const result = await openFaiSource('throw new Error("boom")\n' + BOX, { wasm: WASM })
    expect(result.error?.code).toBe('E_EXECUTION')
    expect(result.error?.message).toMatch(/boom/)
  })

  it('surfaces E_NO_GEOMETRY when the script produces no visible shape', async () => {
    const result = await openFaiSource('let x = 1\n', { wasm: WASM })
    expect(result.error?.code).toBe('E_NO_GEOMETRY')
    expect(result.meshes).toHaveLength(0)
  })
})
