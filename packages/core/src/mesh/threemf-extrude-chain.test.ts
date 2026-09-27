/**
 * 3MF load → fai_extrude chain (planeDistance).
 *
 * PARKED with `describe.skip` (2026-09-27): faijs `importFile` does not yet
 * support the 3mf format. Its STL fallback silently returns an *empty* mesh for
 * a 3mf archive (zip bytes are not binary STL; the triangle-count sanity check
 * yields zero facets), so `cad.load({ format: '3mf' })` "succeeds" with
 * positions/indices of length 0, and a subsequent `fai_extrude` on that part
 * fails with `E_OP_FAILED: No valid geometry to extrude`.
 *
 * This is the reproducible evidence (created 2026-09-27 while investigating the
 * Cube334.3mf extrude chain):
 *
 *   const part0 = cad.load({ key, format: '3mf' })          // succeeds, EMPTY mesh
 *   const part1 = cad.fai_extrude(part0, { length: 10, mode: 'centered',
 *     normal: [0,0,1], planeDistance: 17.5 })               // E_OP_FAILED: No valid geometry to extrude
 *
 * 3mf support is a separate follow-up task (new feature, not part of the
 * plane-param semantics change). Once faijs parses 3mf — unzip the archive,
 * read `<vertices>/<triangles>` per object, and bake each build `<item>`
 * transform (ST_Matrix3D, column-major, translation in the last three tokens)
 * into world-space positions so `planeDistance` (a world-plane d value) lines
 * up with the mesh — remove `describe.skip` and this test asserts the chain.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { ExecutionResult } from '../cad-runtime/runtime'
import type { EventSink, AssetResolver } from '../cad-runtime/ports'
import { fileBlobStore } from '../test/blob-store'
import { createEditorRuntime } from '../test-support/editor-ops'

let threemfBuffer: ArrayBuffer

beforeAll(() => {
  const p = fileURLToPath(new URL('../../../fixtures/data/cube334.3mf', import.meta.url))
  const data = readFileSync(p)
  threemfBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
})

class TestEventSink implements EventSink {
  readonly events: Array<{ event: string; detail: Record<string, unknown> }> = []
  emit(event: string, detail: Record<string, unknown>): void {
    this.events.push({ event, detail: { ...detail } })
  }
  clear(): void { this.events.length = 0 }
}

function createTestAssets(): AssetResolver {
  return {
    resolveByKey: async (key: string) => {
      const bytes = fileBlobStore.get(key)
      if (!bytes) throw new Error(`test: asset key not found: ${key}`)
      return { bytes, format: undefined }
    },
    resolveFile: async (path: string) => {
      const fs = await import('node:fs/promises')
      const buf = await fs.readFile(path)
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    },
    resolveUrl: async (url: string) => {
      const res = await fetch(url)
      return res.arrayBuffer()
    },
  }
}

describe.skip('3mf load → fai_extrude chain (planeDistance)', () => {
  it('load cube334.3mf (non-empty mesh) then fai_extrude with planeDistance succeeds', async () => {
    fileBlobStore.clear()
    const bufferKey = fileBlobStore.put(threemfBuffer)
    const code = [
      `const part0 = cad.load({ key: ${JSON.stringify(bufferKey)}, format: '3mf' })`,
      `const part1 = cad.fai_extrude(part0, { length: 10, mode: 'centered', normal: [0, 0, 1], planeDistance: 17.5 })`,
    ].join('\n')

    const runtime = createEditorRuntime(
      { events: new TestEventSink(), assets: createTestAssets() },
      'auto',
    )
    const result = (await runtime.execute(code)) as ExecutionResult

    expect(result.failedAt).toBeUndefined()

    // cube334.3mf: two boxes (z∈[-15,5] and z∈[10,20]) + build translation
    // (128,128,15) → world bbox z∈[0,35], planeDistance 17.5 cuts the lower box.
    const part0 = (result.outputs ?? []).find(([k]) => k === 'part0')?.[1] as
      | { positions?: ArrayBuffer; indices?: ArrayBuffer }
      | undefined
    expect(part0).toBeTruthy()
    expect(part0?.positions?.byteLength ?? 0, '3mf load must produce geometry').toBeGreaterThan(0)
    expect(part0?.indices?.byteLength ?? 0).toBeGreaterThan(0)
  })
})
