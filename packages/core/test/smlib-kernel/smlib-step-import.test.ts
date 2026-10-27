/**
 * @vitest-environment node
 *
 * smlib-kernel/smlib-step-import — STEP(AP203) 平面+直线 MVP 导入验证
 *
 * 验证：STEP 文本经纯 TS Part21 解析器还原拓扑，再用现有 smlib 桥重建为
 * **真 B-rep 实体**（逐面建线段 → SmApiCreatePlanarFaces → merge → stitch → heal）。
 * 判据是几何等价（体积守恒、面数合理、可再导出为合法 STEP），而非“没抛错”。
 *
 * 覆盖：
 *   1) 原生 box → exportStep → importStep → 体积 ≈ 6000、面数 = 6、可再导出。
 *   2) STL 导入体（12 三角面）→ exportStep → importStep → 体积 ≈ 6000、面数 = 12。
 *   3) 非 Part21 文本（无 DATA 段）显式报错，不返回空壳。
 *
 * Run: npx vitest run test/smlib-kernel/smlib-step-import.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { __resetEngineRegistriesForTests, getActiveBrepEngineId } from '../../src/brep/engine/registry'
import { registerSmlibBrepEngine, SMLIB_BREP_ENGINE_ID } from '../../src/brep/engine/adapters/smlib'
import { createSmlibPrimitives, disposeSmlib, type SmlibPrimitives } from '../../src/smlib-kernel/smlibKernel'
import { exportStl } from '../../src/api/export-stl'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { asPartName } from '../../src/identity'
import type { Shape } from '../../src/mesh/types'
import type { BrepHandle } from '../../src/brep/engine/types'

let kernel!: SmlibPrimitives

function hostPorts(): HostPorts {
  return { events: { emit: () => undefined }, hostEnv: 'node' } as HostPorts
}
async function shapeOf(code: string, part: string): Promise<Shape> {
  __resetEngineRegistriesForTests()
  await registerSmlibBrepEngine()
  const runtime = new CadRuntime(hostPorts(), 'brep', { cad: createApiNamespaceWithEditorOps() })
  const result = await runtime.execute(code)
  if (result.failedAt) throw new Error(`exec failed: ${result.failedAt.message}`)
  const s = result.outputs.get(asPartName(part))
  if (!s) throw new Error(`no output for ${part}`)
  return s as Shape
}
function countEntities(step: string, type: string): number {
  const re = new RegExp(`^#\\d+\\s*=\\s*${type}\\s*\\(`, 'gm')
  return (step.match(re) || []).length
}
function validateRefs(step: string): number[] {
  const defined = new Set<number>()
  for (const m of step.matchAll(/#(\d+)\s*=/g)) defined.add(Number(m[1]))
  const dangling: number[] = []
  for (const m of step.matchAll(/#(\d+)/g)) {
    const id = Number(m[1])
    if (!defined.has(id)) dangling.push(id)
  }
  return dangling
}

beforeAll(async () => {
  __resetEngineRegistriesForTests()
  await registerSmlibBrepEngine()
  expect(getActiveBrepEngineId()).toBe(SMLIB_BREP_ENGINE_ID)
  kernel = await createSmlibPrimitives()
}, 120000)

afterAll(() => {
  disposeSmlib()
  __resetEngineRegistriesForTests()
})

describe('smlib importStep — AP203 平面+直线 MVP', () => {
  it('原生 box → exportStep → importStep → 体积≈6000 且可再导出', () => {
    const box = kernel.makeBox(10, 20, 30) as unknown as BrepHandle
    const step = kernel.exportStep(box)

    const solid = kernel.importStep(step) as BrepHandle
    expect(solid).toBeTruthy()

    const vol = kernel.getVolume(solid)
    expect(vol).toBeGreaterThan(0)
    expect(vol).toBeCloseTo(6000, 0)

    const faces = kernel.getSubShapes(solid, 'face')
    expect(faces.length).toBe(6) // 原生 box = 6 平面面，重建后仍为 6 片

    // 可再导出为合法 AP203（往返一致性）
    const step2 = kernel.exportStep(solid)
    expect(step2.startsWith('ISO-10303-21;')).toBe(true)
    expect(validateRefs(step2)).toHaveLength(0)
    expect(countEntities(step2, 'ADVANCED_FACE')).toBe(6)
    expect(countEntities(step2, 'MANIFOLD_SOLID_BREP')).toBe(1)
  })

  it('STL 导入体（12 三角面）→ exportStep → importStep → 体积≈6000', async () => {
    const boxShape = await shapeOf('let part0 = cad.box(10, 20, 30)\n', 'part0')
    const bytes = exportStl(boxShape) as Uint8Array
    const stlSolid = kernel.importStl(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    ) as BrepHandle
    const step = kernel.exportStep(stlSolid)

    const solid = kernel.importStep(step) as BrepHandle
    expect(solid).toBeTruthy()
    expect(kernel.getVolume(solid)).toBeCloseTo(6000, 0)
    // 12 个三角面重建
    expect(kernel.getSubShapes(solid, 'face').length).toBe(12)
  })

  it('非 Part21 文本（无 DATA 段）显式报错，不返回空壳', () => {
    expect(() => kernel.importStep('this is not a step file')).toThrow(/importStep failed: SM status/)
  })
})
