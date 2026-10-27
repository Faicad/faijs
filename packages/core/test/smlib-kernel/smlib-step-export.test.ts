/**
 * @vitest-environment node
 *
 * smlib-kernel/smlib-step-export — STEP(AP203) 导出验证
 *
 * 实现已从 TS 迁入 smlib C++（`SmApiExportStepEx`，复刻 brepkit
 * `crates/io/src/step/writer.rs`）：解析曲面写成原生 STEP 实体
 * （PLANE / CYLINDRICAL_SURFACE / CONICAL_SURFACE / SPHERICAL_SURFACE /
 * TOROIDAL_SURFACE），曲线写成 LINE / CIRCLE / ELLIPSE。
 *
 * 覆盖：
 *   1) 原生 box → 合法 AP203，拓扑自洽（引用闭合、实体计数一致）。
 *   2) HEADER 使用 AP203 schema `CONFIG_CONTROL_DESIGN`。
 *   3) 原生圆柱（含非平面侧面）→ 成功导出并写出圆柱/圆锥曲面
 *      （不再抛错、不静默丢几何）。
 *   4) 集成：box → exportStl → importStl（真 B-rep，三角化）→ exportStep 仍合法。
 *
 * Run: npx vitest run test/smlib-kernel/smlib-step-export.test.ts
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

/** 解析 STEP 文本，校验所有 #id 引用都存在；返回定义实体 id 集合与悬空引用。 */
function validateStepReferences(step: string): { defined: Set<number>; dangling: number[] } {
  const defined = new Set<number>()
  for (const m of step.matchAll(/#(\d+)\s*=/g)) defined.add(Number(m[1]))
  const dangling: number[] = []
  for (const m of step.matchAll(/#(\d+)/g)) {
    const id = Number(m[1])
    if (!defined.has(id)) dangling.push(id)
  }
  return { defined, dangling }
}
function countEntities(step: string, type: string): number {
  const re = new RegExp(`^#\\d+\\s*=\\s*${type}\\s*\\(`, 'gm')
  return (step.match(re) || []).length
}
/** 返回每条 ADVANCED_FACE 引用的 face_geometry（PLANE / CYLINDRICAL_SURFACE…）#id。 */
function advancedFaceSurfaceRefs(step: string): number[] {
  const refs: number[] = []
  for (const line of step.split('\n')) {
    if (!/^#\d+\s*=\s*ADVANCED_FACE\(/.test(line)) continue
    const ids = [...line.matchAll(/#(\d+)/g)].map((m) => Number(m[1]))
    if (ids.length > 0) refs.push(ids[ids.length - 1])
  }
  return refs
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

describe('smlib exportStep — AP203', () => {
  it('原生 box 导出为合法 AP203 且拓扑自洽', () => {
    const box = kernel.makeBox(10, 20, 30) as unknown as BrepHandle
    const faces = kernel.getSubShapes(box, 'face')
    expect(faces.length).toBe(6)
    for (const f of faces) expect(kernel.surfaceType(f as BrepHandle)).toBe('plane')

    const step = kernel.exportStep(box)
    expect(typeof step).toBe('string')

    // 1) 文件框架合法
    expect(step.startsWith('ISO-10303-21;')).toBe(true)
    expect(step.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true)

    // 2) 拓扑自洽：所有 #id 引用都有定义
    const { dangling, defined } = validateStepReferences(step)
    expect(dangling, `dangling refs: ${dangling.slice(0, 10).join(',')}`).toHaveLength(0)

    // 3) 每个 ADVANCED_FACE 引用的曲面实体都已定义
    const surfRefs = advancedFaceSurfaceRefs(step)
    expect(surfRefs.length).toBe(faces.length)
    for (const ref of surfRefs) expect(defined.has(ref), `ADVANCED_FACE 引用了未定义的曲面 #${ref}`).toBe(true)

    // 4) 实体计数与 box 几何一致
    expect(countEntities(step, 'PLANE')).toBe(6)
    expect(countEntities(step, 'ADVANCED_FACE')).toBe(6)
    expect(countEntities(step, 'CLOSED_SHELL')).toBe(1)
    expect(countEntities(step, 'MANIFOLD_SOLID_BREP')).toBe(1)
    // 立方体 12 条直边 → 12 个 LINE（顶点/边去重）
    expect(countEntities(step, 'LINE')).toBe(12)
    // 8 个唯一顶点 → 8 个 VERTEX_POINT（坐标去重）
    expect(countEntities(step, 'VERTEX_POINT')).toBe(8)
    // 标准脚手架
    expect(countEntities(step, 'ADVANCED_BREP_SHAPE_REPRESENTATION')).toBe(1)
  })

  it('HEADER 使用 AP203 schema（CONFIG_CONTROL_DESIGN）', () => {
    const box = kernel.makeBox(10, 20, 30) as unknown as BrepHandle
    const step = kernel.exportStep(box)
    expect(step).toContain("FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'))")
    expect(step).toContain('HEADER;')
  })

  it('含非平面侧面的圆柱可导出圆柱/圆锥曲面（不静默丢几何）', () => {
    const cyl = kernel.makeCylinder(10, 20) as unknown as BrepHandle
    const faces = kernel.getSubShapes(cyl, 'face')
    expect(faces.some((f) => kernel.surfaceType(f as BrepHandle) !== 'plane')).toBe(true)

    const step = kernel.exportStep(cyl)
    expect(step.startsWith('ISO-10303-21;')).toBe(true)
    expect(validateStepReferences(step).dangling).toHaveLength(0)
    // smlib 把等径圆柱侧面归为 cone；导出侧对零半角写 CYLINDRICAL_SURFACE
    expect(
      countEntities(step, 'CYLINDRICAL_SURFACE') + countEntities(step, 'CONICAL_SURFACE'),
    ).toBeGreaterThanOrEqual(1)
    // 每个面都写成了 ADVANCED_FACE（没有面被静默丢弃）
    expect(countEntities(step, 'ADVANCED_FACE')).toBe(faces.length)
  })

  it('集成：box → exportStl → importStl（真 B-rep）→ exportStep 仍合法 AP203', async () => {
    const boxShape = await shapeOf('let part0 = cad.box(10, 20, 30)\n', 'part0')
    const bytes = exportStl(boxShape) as Uint8Array
    const solid = kernel.importStl(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    ) as BrepHandle

    const step = kernel.exportStep(solid)
    expect(step.startsWith('ISO-10303-21;')).toBe(true)
    expect(step.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true)

    const { dangling, defined } = validateStepReferences(step)
    expect(dangling).toHaveLength(0)
    const surfRefs = advancedFaceSurfaceRefs(step)
    expect(surfRefs.length).toBeGreaterThan(0)
    for (const ref of surfRefs) expect(defined.has(ref)).toBe(true)

    // 三角化 box = 12 个三角面，共面 PLANE 去重为 6，唯一边 18（12 棱 + 6 对角），顶点 8
    expect(countEntities(step, 'ADVANCED_FACE')).toBe(12)
    expect(countEntities(step, 'PLANE')).toBe(6)
    expect(countEntities(step, 'LINE')).toBe(18)
    expect(countEntities(step, 'VERTEX_POINT')).toBe(8)
    expect(countEntities(step, 'CLOSED_SHELL')).toBe(1)
    expect(countEntities(step, 'MANIFOLD_SOLID_BREP')).toBe(1)
  })
})
