/**
 * load-brep/load-brep-text.test.ts — CASCADE BREP 文本（.brep）加载契约。
 *
 * 背景：load op 把 .brep 归入 BREP 路径，但 XCAF（STEPCAFControl_Reader）只读
 * STEP 语法，读不了 BREP 文本（"Line 3: unexpected TYPE"）。faijs 有原生读取
 * 实现 kernel.fromBREP（importBrepToMesh），load op 应对 .brep 走该路径——
 * 单 solid、无装配树，产物与 STEP 单零件同构（fromBrep + solid 句柄）。
 *
 * 验证点：
 * - cad.load({ file: 'Motor-c.brep' }) 成功（不抛 load failed）；
 * - 产物 mesh 非空（positions/indices > 0），单位刻度 mm（OCCT BREP 约定）；
 * - importModel.format 登记为 'brep'（不是 'step'）。
 *
 * Run: npx vitest run faijs/load-brep/load-brep-text.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { fileURLToPath } from 'node:url'
import { registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { createEditorRuntime } from '../_support/editor-runtime'
import { asPartName } from '@faicad/faijs/identity'
import type { ExecutionResult } from '@faicad/faijs/cad-runtime/runtime'

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/data', import.meta.url))

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

describe('load op — CASCADE BREP 文本（.brep）', () => {
  it('Motor-c.brep → fromBREP 路径成功，mesh 非空，format 登记 brep', async () => {
    const rt = createEditorRuntime(createNodePorts({ assetsDir: FIXTURES_DIR }), 'brep')
    const result: ExecutionResult = await rt.execute("let a = await cad.load({ file: 'Motor-c.brep' })")
    expect(result.failedAt, JSON.stringify(result.error)).toBeUndefined()

    // 产物终端存在且 mesh 非空
    expect(result.outputs.has(asPartName('a')), 'outputs 必须含 a').toBe(true)
    const shape = result.outputs.get(asPartName('a'))
    expect(shape, 'a 的 mesh 必须存在').toBeDefined()
    expect((shape as { positions: Float32Array }).positions.length).toBeGreaterThan(0)
    expect((shape as { indices: Uint32Array }).indices.length).toBeGreaterThan(0)

    // importModel：format 必须为 brep（不是 step——宿主要按文件类型登记）
    const model = result.importModels?.get(asPartName('a'))
    expect(model, 'importModels 必须登记 a').toBeDefined()
    expect(model!.format).toBe('brep')
    expect(model!.parts).toHaveLength(1)
    expect(model!.parts[0]!.name).toBe('Motor-c.brep')
  })
})
