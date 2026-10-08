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

describe('load op — STEP 强制单位（unit 对所有格式一视同仁）', () => {
  it('box_boss.step（文件声明 mm）+ unit="inch" → 坐标 ×25.4、unit 元数据 = inch、拓扑登记', async () => {
    const rt = createEditorRuntime(createNodePorts({ assetsDir: FIXTURES_DIR }), 'brep')
    const base: ExecutionResult = await rt.execute("let a = await cad.load({ file: 'box_boss.step' })")
    const forced: ExecutionResult = await rt.execute("let b = await cad.load({ file: 'box_boss.step', unit: 'inch' })")
    expect(base.failedAt, JSON.stringify(base.error)).toBeUndefined()
    expect(forced.failedAt, JSON.stringify(forced.error)).toBeUndefined()

    const a = base.outputs.get(asPartName('a')) as { positions: Float32Array }
    const b = forced.outputs.get(asPartName('b')) as { positions: Float32Array }
    expect(a.positions.length).toBeGreaterThan(0)
    expect(b.positions.length).toBeGreaterThan(0)
    // 密度回归守卫：相对 deflection 下与原始同量级（绝对 deflection 会爆炸）
    expect(b.positions.length).toBeLessThan(a.positions.length * 20)

    const box = (p: Float32Array) => {
      const min = [Infinity, Infinity, Infinity]
      const max = [-Infinity, -Infinity, -Infinity]
      for (let i = 0; i < p.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const v = p[i + k]!
          if (v < min[k]!) min[k] = v
          if (v > max[k]!) max[k] = v
        }
      }
      return { min, max }
    }
    const ab = box(a.positions)
    const bb = box(b.positions)
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(bb.min[k]! - ab.min[k]! * 25.4)).toBeLessThan(Math.abs(ab.min[k]! * 25.4) * 1e-3 + 1)
      expect(Math.abs(bb.max[k]! - ab.max[k]! * 25.4)).toBeLessThan(Math.abs(ab.max[k]! * 25.4) * 1e-3 + 1)
    }

    // 元数据 = 强制值 inch；拓扑登记 b（pending → meshShapeCache 复用）
    const model = forced.importModels?.get(asPartName('b'))
    expect(model).toBeDefined()
    expect(model!.format).toBe('step')
    expect(model!.unit).toBe('inch')
    expect(forced.detectedUnits?.get(asPartName('b'))).toBe('inch')
    const topo = forced.topology?.get(asPartName('b'))
    expect(topo, 'topology 必须登记 b').toBeDefined()
    expect(topo!.source).toBe('brep')
  })
})

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

  it('unit 强制设置（所有格式一视同仁）：BREP 文本按 mm 读入，unit="m" → 坐标 ×1000、unit 元数据 = m', async () => {
    const rt = createEditorRuntime(createNodePorts({ assetsDir: FIXTURES_DIR }), 'brep')
    const base: ExecutionResult = await rt.execute("let a = await cad.load({ file: 'Motor-c.brep' })")
    const forced: ExecutionResult = await rt.execute("let b = await cad.load({ file: 'Motor-c.brep', unit: 'm' })")
    expect(base.failedAt, JSON.stringify(base.error)).toBeUndefined()
    expect(forced.failedAt, JSON.stringify(forced.error)).toBeUndefined()

    const a = base.outputs.get(asPartName('a')) as { positions: Float32Array }
    const b = forced.outputs.get(asPartName('b')) as { positions: Float32Array }
    expect(a.positions.length).toBeGreaterThan(0)
    expect(b.positions.length).toBeGreaterThan(0)
    // 密度回归守卫：相对 deflection（×factor）后网格密度应与原始同量级——
    // 绝对 0.1mm deflection 会让 ×1000 模型顶点数爆炸（实测 ~218 倍）。
    // 5.x 倍是角 deflection 未随尺度放宽的合理余量；>20 倍视为回归。
    expect(b.positions.length).toBeLessThan(a.positions.length * 20)
    // 重新三角化（solidToShape）顶点顺序不稳定——用包围盒对比（不受顶点序影响）；
    // Float32 大数值用相对容差（×1000 后 ULP ≈ 1e-4 量级）。
    const box = (p: Float32Array) => {
      const min = [Infinity, Infinity, Infinity]
      const max = [-Infinity, -Infinity, -Infinity]
      for (let i = 0; i < p.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const v = p[i + k]!
          if (v < min[k]!) min[k] = v
          if (v > max[k]!) max[k] = v
        }
      }
      return { min, max }
    }
    const ab = box(a.positions)
    const bb = box(b.positions)
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(bb.min[k]! - ab.min[k]! * 1000)).toBeLessThan(Math.abs(ab.min[k]! * 1000) * 1e-3 + 1)
      expect(Math.abs(bb.max[k]! - ab.max[k]! * 1000)).toBeLessThan(Math.abs(ab.max[k]! * 1000) * 1e-3 + 1)
    }

    // importModel.unit / detected unit 元数据 = 强制值 m
    const model = forced.importModels?.get(asPartName('b'))
    expect(model).toBeDefined()
    expect(model!.unit).toBe('m')
    expect(forced.detectedUnits?.get(asPartName('b'))).toBe('m')

    // 拓扑：单零件强制单位路径应经 pending → meshShapeCache 复用构建出 BREP 拓扑
    // （不二次 meshShape → 不爆炸）；topology 登记 b。
    const topo = forced.topology?.get(asPartName('b'))
    expect(topo, 'topology 必须登记 b').toBeDefined()
    expect(topo!.source).toBe('brep')
  })
})
