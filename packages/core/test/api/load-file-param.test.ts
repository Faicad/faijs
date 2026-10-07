/**
 * `cad.load` 语句形态收敛为 `{ file, unit? }`——
 * - `file` = 用户上传文件名（含后缀），资产寻址 + 格式声明统一载体（assets 按名寻址）；
 * - 格式从 `file` 后缀自判（白名单 stl/3mf → mesh 路径；step/iges/brep → BREP 路径），
 *   宿主不再传 `format`；魔数 sanity 校验（后缀定格式后用文件头校验）；
 * - `unit` 仅 STL 保留（R17：无声明单位，固化进语句行）。
 *
 * 现状（key/path/url 三键 + format）不认识 `file` 参数 → 本文件用例应跑失败
 * （阶段 1 先行失败标准）；load op 落地后转绿。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { createEditorRuntime } from '../support/editor-ops'
import { zipSync, strToU8 } from 'fflate'
import { asPartName } from '../../src/identity'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'

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

/** assets 按文件名（file 参数）寻址——模拟宿主资产库以用户文件名为 key。 */
function portsFor(files: Record<string, ArrayBuffer>): HostPorts {
  return {
    events: { emit: () => undefined },
    assets: {
      resolveByKey: async (key: string) => {
        const bytes = files[key]
        if (!bytes) throw new Error(`[test] no asset for file: ${key}`)
        return { bytes }
      },
      resolveFile: async () => {
        throw new Error('[test] resolveFile should not be used under file-only contract')
      },
      resolveUrl: async () => {
        throw new Error('[test] resolveUrl should not be used under file-only contract')
      },
    },
  } as unknown as HostPorts
}

/** Node Buffer 可能是池化切片的视图（小文件 <8KB 时 .buffer 含偏移/整池），按 byteOffset 正确截取 ArrayBuffer。 */
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

const stlBuf = toArrayBuffer(
  readFileSync(new URL('../../../fixtures/data/cube-10x5x5.stl', import.meta.url)),
)
const threemfBuf = toArrayBuffer(
  readFileSync(new URL('../../../fixtures/data/cube334.3mf', import.meta.url)),
)
const stepBuf = toArrayBuffer(
  readFileSync(new URL('../../../fixtures/data/test-model.step', import.meta.url)),
)

describe('cad.load file 参数面 + 后缀自判（P8 §4.2/§4.3）— mesh 路径', () => {
  it('STL：file 后缀 .stl → mesh 路径成功，无需 format', async () => {
    const runtime = createEditorRuntime(portsFor({ 'cube-10x5x5.stl': stlBuf }), 'mesh')
    const result = await runtime.execute('let a = await cad.load({ file: \'cube-10x5x5.stl\' })')
    expect(result.failedAt).toBeUndefined()
    const entry = result.outputs.get(asPartName('a'))
    expect(entry).toBeDefined()
    expect((entry as { positions: ArrayLike<number> }).positions.length).toBeGreaterThan(0)
  })

  it('3MF：file 后缀 .3mf → mesh 路径成功（无 format）', async () => {
    const runtime = createEditorRuntime(portsFor({ 'cube334.3mf': threemfBuf }), 'mesh')
    const result = await runtime.execute('let a = await cad.load({ file: \'cube334.3mf\' })')
    expect(result.failedAt).toBeUndefined()
    expect(result.outputs.get(asPartName('a'))).toBeDefined()
  })

  it('多对象 3MF → CompoundShape（children = 声明序）+ importModels（P0 契约）', async () => {
    const runtime = createEditorRuntime(portsFor({ 'multi.3mf': threemfBytes(3, 10) }), 'mesh')
    const result = await runtime.execute('let a = await cad.load({ file: \'multi.3mf\' })')
    expect(result.failedAt).toBeUndefined()
    // 多零件不再折叠：multiPartCounts 不再登记
    expect(result.multiPartCounts).toBeUndefined()
    // 返回 CompoundShape：children = 3 个零件（声明序）
    const entry = result.outputs.get(asPartName('a'))
    expect(entry).toBeDefined()
    expect((entry as { kind?: string }).kind).toBe('compound')
    const children = (entry as { children: ArrayLike<{ positions: ArrayLike<number> }> }).children
    expect(children).toHaveLength(3)
    // importModels 登记零件身份（index 与 children 一一对应）
    expect(result.importModels).toBeDefined()
    const model = result.importModels!.get(asPartName('a'))
    expect(model).toBeDefined()
    expect(model!.format).toBe('3mf')
    expect(model!.parts).toHaveLength(3)
    expect(model!.parts.map((p) => p.index)).toEqual([0, 1, 2])
  })

  it('STL：unit 参数保留（R17 固化进语句行）', async () => {
    const runtime = createEditorRuntime(portsFor({ 'cube-10x5x5.stl': stlBuf }), 'mesh')
    const result = await runtime.execute(
      'let a = await cad.load({ file: \'cube-10x5x5.stl\', unit: \'mm\' })',
    )
    expect(result.failedAt).toBeUndefined()
    expect(result.outputs.get(asPartName('a'))).toBeDefined()
  })

  it('后缀白名单外 → 报错（不猜格式）', async () => {
    const runtime = createEditorRuntime(portsFor({ 'box.xyz': stlBuf }), 'mesh')
    const result = await runtime.execute('let a = await cad.load({ file: \'box.xyz\' })')
    expect(result.failedAt).toBeDefined()
  })

  it('魔数 sanity：后缀 .3mf 但字节非 3MF 头 → 报错（后缀定格式后校验文件头）', async () => {
    const runtime = createEditorRuntime(portsFor({ 'fake.3mf': stlBuf }), 'mesh')
    const result = await runtime.execute('let a = await cad.load({ file: \'fake.3mf\' })')
    expect(result.failedAt).toBeDefined()
  })
})

describe('cad.load file 参数面 — BREP 路径', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })

  it('STEP：file 后缀 .step → BREP 路径成功（无 format/path）', async () => {
    await registerOcctBrepEngine()
    // 单 solid 文件（P0 后多 solid 走 compound，见下方多零件用例）
    const singleStepBuf = toArrayBuffer(
      readFileSync(new URL('../../../fixtures/data/box_boss.step', import.meta.url)),
    )
    const runtime = createEditorRuntime(portsFor({ 'box_boss.step': singleStepBuf }), 'brep')
    const result = await runtime.execute('let a = await cad.load({ file: \'box_boss.step\' })')
    expect(result.failedAt).toBeUndefined()
    const solidEntry = result.brepSolids?.get(asPartName('a'))
    expect(solidEntry, 'BREP load lands in brepSolids').toBeDefined()
  })

  it('多 solid STEP → CompoundShape（children = 声明序）+ importModels（P0 契约）', async () => {
    await registerOcctBrepEngine()
    const runtime = createEditorRuntime(portsFor({ 'test-model.step': stepBuf }), 'brep')
    const result = await runtime.execute('let a = await cad.load({ file: \'test-model.step\' })')
    expect(result.failedAt).toBeUndefined()
    // 多零件不再折叠：multiPartCounts 不再登记
    expect(result.multiPartCounts).toBeUndefined()
    // 返回 CompoundShape：children = 全部零件（2 个 solid）
    const entry = result.outputs.get(asPartName('a'))
    expect(entry).toBeDefined()
    expect((entry as { kind?: string }).kind).toBe('compound')
    const children = (entry as { children: ArrayLike<unknown> }).children
    expect(children).toHaveLength(2)
    // importModels 登记零件身份 + 装配结构
    expect(result.importModels).toBeDefined()
    const model = result.importModels!.get(asPartName('a'))
    expect(model).toBeDefined()
    expect(model!.format).toBe('step')
    expect(model!.parts).toHaveLength(2)
    expect(model!.parts.map((p) => p.index)).toEqual([0, 1])
    expect(model!.parts.every((p) => p.name.length > 0)).toBe(true)
  })
})
