/**
 * 回归（对照）：OCCT 装配（web 同构）下 STL 走 BREP 路径同样全链路可用。
 *
 * load.ts 的修复（2026-10-17）对两个引擎同构生效：OCCT L1 面同样有 `importStl`，
 * STL 从 mesh 路径改走 BREP 路径后，web 端 STL 的圆角/钻孔/分割一并恢复。
 * 装配与 web worker 同构：OCCT BREP 引擎 + brepkit mesh 后端（weld 原语）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { createEditorRuntime } from '../support/editor-ops'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { registerBrepkitMeshEngine } from '../../src/brep/engine/adapters/brepkit'
import { disposeBrepkit } from '../../src/brepkit-kernel/brepkitKernel'
import { resetBrepkitWasm } from '../../src/brepkit-kernel/brepkitWasm'

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

const stlPath = fileURLToPath(new URL('../../../fixtures/data/cube-10x5x5.stl', import.meta.url))

function stlPorts(): HostPorts {
  const bytes = toArrayBuffer(readFileSync(stlPath))
  return {
    events: { emit: () => undefined },
    assets: {
      resolveByKey: async () => ({ bytes }),
      resolveFile: async () => bytes,
      resolveUrl: async () => bytes,
    },
  } as unknown as HostPorts
}

describe('occt(web 同构): STL 走 BREP 路径后特征操作可用', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    disposeBrepkit()
    resetBrepkitWasm()
    await registerOcctBrepEngine()
    await registerBrepkitMeshEngine()
  })
  afterAll(() => disposeBrepkit())

  it('load cube.stl → naming.source = brep；全部边有邻接面', async () => {
    const runtime = createEditorRuntime(stlPorts(), 'auto')
    const base = await runtime.execute(`let part0 = cad.load({ file: 'cube-10x5x5.stl' })`)
    expect(base.failedAt, `load failed: ${JSON.stringify(base.failedAt)}`).toBeUndefined()
    const naming = base.naming?.get('part0' as never)
    expect(naming).toBeDefined()
    expect(naming!.source).toBe('brep')
    const nullFaces = naming!.edgeNaming.filter((e) => e.faces === null)
    expect(nullFaces, `null-faces edges: ${JSON.stringify(nullFaces)}`).toHaveLength(0)
  })

  it('fai_drill / fai_split：BREP 路径成功（不再 E_MESH_SOLID_UNSUPPORTED）', async () => {
    const runtime = createEditorRuntime(stlPorts(), 'auto')
    const d = await runtime.execute(
      `let part0 = cad.load({ file: 'cube-10x5x5.stl' })\n` +
        `let part1 = cad.fai_drill(part0, { diameter: 2, depth: 0, position: [0, 0, 5], direction: "normal", faceNormal: [0, 0, 1], holeType: "simple" })\n`,
    )
    expect(d.failedAt, `drill failed: ${JSON.stringify(d.failedAt)}`).toBeUndefined()

    const s = await runtime.execute(
      `let part0 = cad.load({ file: 'cube-10x5x5.stl' })\n` +
        `let { front, back } = cad.fai_split(part0, { cutMode: 'plane', normal: [0, 0, 1], offset: 0 })\n`,
    )
    expect(s.failedAt, `split failed: ${JSON.stringify(s.failedAt)}`).toBeUndefined()
  })
})
