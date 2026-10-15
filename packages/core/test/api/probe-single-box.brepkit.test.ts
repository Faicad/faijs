/** 临时探针：单实体 box → exportStep → importStep，看 edgeNaming.faces。 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { createEditorRuntime } from '../support/editor-ops'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerBrepkitBrepEngine } from '../../src/brep/engine/adapters/brepkit'
import { disposeBrepkit } from '../../src/brepkit-kernel/brepkitKernel'
import { resetBrepkitWasm } from '../../src/brepkit-kernel/brepkitWasm'

describe('PROBE single box', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    disposeBrepkit()
    resetBrepkitWasm()
    await registerBrepkitBrepEngine()
  })
  afterAll(() => disposeBrepkit())

  it('dump', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cube-'))
    const stepPath = join(tmp, 'cube.step')
    const ports = {
      events: { emit: () => undefined },
      assets: {
        resolveByKey: async (key: string) => ({ bytes: readBuf(stepPath) }),
        resolveFile: async (f: string) => readBuf(f),
        resolveUrl: async () => readBuf(stepPath),
      },
    } as unknown as HostPorts
    const rt = createEditorRuntime(ports, 'brep')
    // 造一个 box 并导出 step
    const mk = await rt.execute(`let b = cad.box({ x: 10, y: 10, z: 10 })\ncad.exportStep(b, 'cube.step')`)
    console.log('mk failedAt:', mk.failedAt)
    expect(mk.failedAt).toBeUndefined()
    // exportStep 写盘 —— 通过 resolveFile 路径读回
    const bytes = readBuf(stepPath)
    console.log('step bytes:', bytes.byteLength)
    const ports2 = {
      events: { emit: () => undefined },
      assets: {
        resolveByKey: async () => ({ bytes }),
        resolveFile: async () => bytes,
        resolveUrl: async () => bytes,
      },
    } as unknown as HostPorts
    const rt2 = createEditorRuntime(ports2, 'brep')
    const r = await rt2.execute(`let part0 = await cad.load({ file: 'cube.step' })`)
    console.log('load failedAt:', r.failedAt)
    const naming = r.naming?.get('part0' as never)
    if (!naming) { console.log('NO NAMING'); expect(true).toBe(true); return }
    const edges = naming.edgeNaming
    const withFaces = edges.filter((e) => e.faces !== null).length
    console.log(`faces=${naming.faceNaming.length} edges=${edges.length} edgesWithFaces=${withFaces}`)
    console.log('all edges:', JSON.stringify(edges, null, 1))
    expect(true).toBe(true)
  })
})
function readBuf(p: string): ArrayBuffer {
  const b = require('node:fs').readFileSync(p)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
