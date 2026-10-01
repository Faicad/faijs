/**
 * api/load-multipart.test.ts — `cad.load` 单零件收敛（§5.4）运行时 e2e。
 *
 * 覆盖（mesh 路径，多-object 3MF）：
 * - 单 object 3MF：结果不携带 multiPartCounts（无降级）。
 * - 多 object 3MF：load 只取第一个零件，ExecutionResult.multiPartCounts 记录
 *   part → 原文件零件数（宿主据此弹「该文件包含 N 个零件，仅加载第一个」）。
 *
 * 走 `createEditorRuntime`（挂载含 `load` 的完整 cad 命名空间），模式 = mesh
 * （3MF 走 importFile，无需 OCCT 内核）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import type { HostPorts } from '../cad-runtime/ports'
import { createEditorRuntime } from '../test-support/editor-ops'
import { zipSync, strToU8 } from 'fflate'
import { asPartName } from '../identity'
import { __resetEngineRegistriesForTests } from '../brep/engine/registry'
import { registerOcctBrepEngine } from '../brep/engine/adapters/occt'

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

describe('cad.load single-part convergence (§5.4) — mesh 3MF', () => {
  it('single-object 3MF → no multiPartCounts (no downgrade)', async () => {
    const runtime = createEditorRuntime(meshPorts(1), 'mesh')
    const result = await runtime.execute('let a = await cad.load({ key: \'k\', format: \'3mf\' })')
    expect(result.failedAt).toBeUndefined()
    expect(result.multiPartCounts).toBeUndefined()
  })

  it('multi-object 3MF → first part only + multiPartCounts[a] = N', async () => {
    const runtime = createEditorRuntime(meshPorts(3), 'mesh')
    const result = await runtime.execute('let a = await cad.load({ key: \'k\', format: \'3mf\' })')
    expect(result.failedAt).toBeUndefined()
    expect(result.multiPartCounts).toBeDefined()
    expect(result.multiPartCounts!.get(asPartName('a'))).toBe(3)
    // 结果 mesh 只含第一个零件（4 顶点）
    const entry = result.outputs.get(asPartName('a'))
    expect(entry).toBeDefined()
    expect((entry as { positions: ArrayLike<number> }).positions.length).toBe(4 * 3)
  })
})

describe('cad.load multi-solid STEP single-part convergence (§5.4) — BREP', () => {
  beforeEach(() => {
    __resetEngineRegistriesForTests()
  })

  it('multi-solid STEP → first solid only + multiPartCounts[a] = N (downgrade warning)', async () => {
    await registerOcctBrepEngine()
    const stepBuf = readFileSync(
      new URL('../../../fixtures/data/test-model.step', import.meta.url),
    ).buffer
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
      `let a = await cad.load({ path: 'fixtures/test-model.step', format: 'step' })\nlet r = a`,
    )
    expect(result.failedAt).toBeUndefined()
    expect(result.multiPartCounts).toBeDefined()
    expect(result.multiPartCounts!.get(asPartName('a'))).toBe(2)
    // 降级取第一个：产物是单一 solid（非多 solid 聚合/compound）
    const solidEntry = result.brepSolids?.get(asPartName('a'))
    expect(solidEntry, 'BREP load lands in brepSolids').toBeDefined()
    expect(solidEntry!.kernel.getVolume(solidEntry!.solid)).toBeGreaterThan(0)
  })
})