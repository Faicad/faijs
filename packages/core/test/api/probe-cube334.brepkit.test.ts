/** 临时探针：用用户真实 Cube334.step 看 brepkit 加载后 topology/naming 结构。 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { createEditorRuntime } from '../support/editor-ops'
import { asPartName } from '../../src/identity'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerBrepkitBrepEngine } from '../../src/brep/engine/adapters/brepkit'
import { disposeBrepkit } from '../../src/brepkit-kernel/brepkitKernel'
import { resetBrepkitWasm } from '../../src/brepkit-kernel/brepkitWasm'

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

describe('PROBE Cube334', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    disposeBrepkit()
    resetBrepkitWasm()
    await registerBrepkitBrepEngine()
  })
  afterAll(() => disposeBrepkit())

  it('dump', async () => {
    const bytes = toArrayBuffer(readFileSync('C:/Users/yuan_/Downloads/Cube334.step'))
    const ports = {
      events: { emit: () => undefined },
      assets: {
        resolveByKey: async () => ({ bytes }),
        resolveFile: async () => bytes,
        resolveUrl: async () => bytes,
      },
    } as unknown as HostPorts
    const runtime = createEditorRuntime(ports, 'brep')
    const r = await runtime.execute(`let part0 = await cad.load({ file: 'Cube334.step' })`)
    console.log('failedAt:', r.failedAt)
    console.log('terminals:', (r.terminals ?? []).map((t) => String(t.id)))
    console.log('outputs keys:', [...r.outputs.keys()].map(String))
    console.log('topology keys:', [...(r.topology?.keys() ?? [])].map(String))
    console.log('naming keys:', [...(r.naming?.keys() ?? [])].map(String))
    for (const [k, naming] of r.naming ?? []) {
      const edges = naming.edgeNaming
      const withFaces = edges.filter((e) => e.faces !== null).length
      console.log(`naming[${String(k)}]: source=${naming.source} faces=${naming.faceNaming.length} edges=${edges.length} edgesWithFaces=${withFaces}`)
      console.log('  ALL edges:', JSON.stringify(edges))
    }
    // topology data.edges 的 faceStart/faceCount
    const topo = r.topology?.get('part0' as never)
    if (topo) {
      console.log('topo.data.edges:', JSON.stringify((topo.data as { edges: unknown[] }).edges))
      console.log('topo.proxy.edgeFaceRows:', JSON.stringify((topo.data as { proxy?: { edgeFaceRows?: unknown } }).proxy?.edgeFaceRows))
    }
    // importModels
    console.log('importModels keys:', [...(r.importModels?.keys() ?? [])].map(String))
    for (const [k, im] of r.importModels ?? []) {
      console.log(`  importModels[${String(k)}]: parts=${im.parts.length}`, im.parts.map((p: { index: number; name: string }) => `${p.index}:${p.name}`))
    }
    expect(true).toBe(true)
  })
})
