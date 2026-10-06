/**
 * api/load-multipart.test.ts — `cad.load` 多零件契约（P0，方案
 * 2026-10-06-step-3mf-multipart-import-plan.md §5.3/§5.4/§5.5）运行时 e2e。
 *
 * 覆盖（mesh 路径，多-object 3MF）：
 * - 单 object 3MF：单零件（无 compound、无 multiPartCounts、importModels.parts 长度 1）。
 * - 多 object 3MF：全部零件以 compound 返回（children = 声明序），
 *   `multiPartCounts` 退役（不再登记降级），`importModels.parts` 登记身份。
 *
 * 覆盖（BREP 路径，多-solid STEP）：
 * - 多 solid STEP：compound（children 各带 BREP solid）+ importModels（含装配树），
 *   不再只取第一个零件。
 *
 * 走 `createEditorRuntime`（挂载含 `load` 的完整 cad 命名空间）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { createEditorRuntime } from '../support/editor-ops'
import { zipSync, strToU8 } from 'fflate'
import { asPartName } from '../../src/identity'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'

/** Node Buffer 可能是池化切片的视图（小文件 <8KB 时 .buffer 含偏移/整池），按 byteOffset 正确截取 ArrayBuffer。 */
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

/** Multi-object 3MF: `n` boxes in `<build>` declaration order, each sized `size`. */
function multiObjectXml(n: number, size: number): string {
  const objects = Array.from(
    { length: n },
    (_, i) => `<object id="${i + 1}" type="model">
      <mesh>
        <vertices>
          <vertex x="${i * size}" y="0" z="0"/>
          <vertex x="${i * size + size}" y="0" z="0"/>
          <vertex x="0" y="${size}" z="0"/>
          <vertex x="0" y="0" z="${size}"/>
        </vertices>
        <triangles>
          <triangle v1="0" v2="1" v3="2"/>
          <triangle v1="0" v2="2" v3="3"/>
        </triangles>
      </mesh>
    </object>`,
  ).join('')
  const items = Array.from(
    { length: n },
    (_, i) => `<item objectid="${i + 1}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>`,
  ).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>${objects}</resources>
  <build>${items}</build>
</model>`
}

function threemfBytes(n: number, size: number): ArrayBuffer {
  const zip = zipSync({ '3D/3dmodel.model': strToU8(multiObjectXml(n, size)) })
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer
}

function meshPorts(n: number): HostPorts {
  const bytes = threemfBytes(n, 10)
  return {
    events: { emit: () => undefined },
    assets: {
      resolveByKey: async () => ({ bytes }),
      resolveFile: async () => bytes,
      resolveUrl: async () => bytes,
    },
  } as unknown as HostPorts
}

describe('cad.load multi-part contract (P0) — mesh 3MF', () => {
  it('single-object 3MF → single part, no multiPartCounts', async () => {
    const runtime = createEditorRuntime(meshPorts(1), 'mesh')
    const result = await runtime.execute('let a = await cad.load({ file: \'k.3mf\' })')
    expect(result.failedAt).toBeUndefined()
    expect(result.multiPartCounts).toBeUndefined()
    const entry = result.outputs.get(asPartName('a'))
    expect((entry as { kind?: string }).kind).toBe('solid')
    // importModels 登记：parts 长度 1
    expect(result.importModels).toBeDefined()
    expect(result.importModels!.get(asPartName('a'))!.parts).toHaveLength(1)
  })

  it('multi-object 3MF → compound of all parts + importModels, no downgrade', async () => {
    const runtime = createEditorRuntime(meshPorts(3), 'mesh')
    const result = await runtime.execute('let a = await cad.load({ file: \'k.3mf\' })')
    expect(result.failedAt).toBeUndefined()
    // multiPartCounts 退役：不再登记降级
    expect(result.multiPartCounts).toBeUndefined()
    // compound：children = 声明序全部零件
    const entry = result.outputs.get(asPartName('a'))
    expect(entry).toBeDefined()
    expect((entry as { kind?: string }).kind).toBe('compound')
    const children = (entry as { children: ArrayLike<{ positions: ArrayLike<number> }> }).children
    expect(children).toHaveLength(3)
    // importModels 登记身份（index 与 children 一一对应）
    const model = result.importModels!.get(asPartName('a'))
    expect(model).toBeDefined()
    expect(model!.format).toBe('3mf')
    expect(model!.parts).toHaveLength(3)
    expect(model!.parts.map((p) => p.index)).toEqual([0, 1, 2])
  })
})

describe('cad.load multi-solid STEP multi-part contract (P0) — BREP', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })

  it('multi-solid STEP → compound of all parts + importModels (with assembly)', async () => {
    await registerOcctBrepEngine()
    const stepBuf = toArrayBuffer(
      readFileSync(new URL('../../../fixtures/data/test-model.step', import.meta.url)),
    )
    const ports: HostPorts = {
      events: { emit: () => undefined },
      assets: {
        resolveByKey: async () => ({ bytes: stepBuf }),
        resolveFile: async () => stepBuf,
        resolveUrl: async () => stepBuf,
      },
    }
    const runtime = createEditorRuntime(ports, 'brep')
    const result = await runtime.execute(
      `let a = await cad.load({ file: 'test-model.step' })\nlet r = a`,
    )
    expect(result.failedAt).toBeUndefined()
    expect(result.multiPartCounts).toBeUndefined()
    // compound：children = 全部 solid 零件
    const entry = result.outputs.get(asPartName('a'))
    expect(entry).toBeDefined()
    expect((entry as { kind?: string }).kind).toBe('compound')
    const children = (entry as { children: ArrayLike<unknown> }).children
    expect(children).toHaveLength(2)
    // importModels 登记零件身份 + 装配结构
    const model = result.importModels!.get(asPartName('a'))
    expect(model).toBeDefined()
    expect(model!.format).toBe('step')
    expect(model!.parts).toHaveLength(2)
    expect(model!.parts.every((p) => p.name.length > 0)).toBe(true)
  })
})
