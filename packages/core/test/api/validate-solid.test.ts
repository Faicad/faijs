/**
 * @vitest-environment node
 *
 * validateSolid 验收（阶段 2 / I1，2026-11-14）
 *
 * 覆盖：
 * V1. 干净实体（box 10×10×10）→ watertight、nonmanifold=0、boundary=0、vol=1000、box size 精确；
 * V2. 多输入链式 union（5 个相交 box）→ 能出报告（这正是 case8 出 368 条非流形边的形态）；
 * V3. 面（profile 产物）→ watertight=false 且 boundary_edges>0（2D 网格必然有边界边）；
 * V4. 空网格 → 抛 E_VALIDATE_NOT_TESSELATED；
 * V5. 无 BREP 句柄的 mesh-only 形状 → 抛 E_VALIDATE_NO_BREP；
 * V6. 脚本面 `cad.validateSolid(part)` 可调用（注册进 cad 命名空间）。
 *
 * Run: npx vitest run test/api/validate-solid.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../src/cad-runtime/ports'
import { asPartName } from '../../src/identity'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import type { Shape } from '../../src/mesh/types'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { validateSolid } from '../../src/api/validate-solid'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

async function useOcct(): Promise<void> {
  __resetEngineRegistriesForTests()
  await registerOcctBrepEngine()
}

async function exec(mode: ExecutionMode, code: string): Promise<ExecutionResult> {
  return new CadRuntime(ports(), mode, { cad: createApiNamespaceWithEditorOps() }).execute(code)
}

async function shapeOf(mode: ExecutionMode, code: string, part: string): Promise<Shape> {
  const result = await exec(mode, code)
  if (result.failedAt) {
    throw new Error(`execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  const s = result.outputs.get(asPartName(part))
  if (!s) throw new Error(`no output for ${part}`)
  return s as Shape
}

describe('validateSolid', () => {
  it('V1. 干净实体 box 10×10×10 → watertight / 0 非流形 / 0 边界 / vol 1000 / bbox 精确', async () => {
    await useOcct()
    const s = await shapeOf('brep', 'let part0 = cad.box(10,10,10)\n', 'part0')
    const r = validateSolid(s)
    expect(r.watertight).toBe(true)
    expect(r.nonmanifold_edges).toBe(0)
    expect(r.boundary_edges).toBe(0)
    expect(Math.abs(r.volume_mm3 - 1000)).toBeLessThan(0.01)
    expect(r.box.size[0]).toBeCloseTo(10, 6)
    expect(r.box.size[1]).toBeCloseTo(10, 6)
    expect(r.box.size[2]).toBeCloseTo(10, 6)
    expect(r.degenerate_faces).toBe(0)
    expect(r.triangles).toBeGreaterThan(0)
    expect(r.edge_count).toBe(12)
  })

  it('V2. 5 个相交 box 链式 union → 能出报告（水密与否如实给出）', async () => {
    await useOcct()
    const s = await shapeOf(
      'brep',
      `let part0 = cad.box(10,10,10)
let part1 = cad.translate(part0, [5,0,0])
let part2 = cad.translate(part0, [10,0,0])
let part3 = cad.translate(part0, [15,0,0])
let part4 = cad.translate(part0, [20,0,0])
let part5 = cad.union(part0, part1, part2, part3, part4)
`,
      'part5',
    )
    const r = validateSolid(s)
    expect(r.triangles).toBeGreaterThan(0)
    // 5 个 10×10×10 盒子按 5mm 步距排开，理论并集体积 = 30×10×10 = 3000。
    // 2026-11-14 实测：链式 fuse 只给出 2000（= 只覆盖 0..20，第 5 个盒子丢失），
    // 这是 I2「多输入 union 改走 fuseAll」要修的现象本身，故此处只锁下限、不锁精确值。
    expect(r.volume_mm3).toBeGreaterThanOrEqual(2000)
    expect(r.nonmanifold_edges).toBeGreaterThanOrEqual(0)
    expect(typeof r.watertight).toBe('boolean')
  })

  it('V3. 面（profile 产物）→ watertight=false 且 boundary_edges>0', async () => {
    await useOcct()
    const s = await shapeOf(
      'brep',
      `let part0 = cad.wire([[0,0,0],[10,0,0],[10,10,0],[0,10,0]], { closed: true })
let part1 = cad.faceFromWire(part0)
`,
      'part1',
    )
    const r = validateSolid(s)
    expect(r.watertight).toBe(false)
    expect(r.boundary_edges).toBeGreaterThan(0)
    expect(r.triangles).toBeGreaterThan(0)
  })

  it('V4. 空网格 → E_VALIDATE_NOT_TESSELATED', async () => {
    await useOcct()
    const s = await shapeOf('brep', 'let part0 = cad.wire([[0,0,0],[10,0,0]])\n', 'part0')
    expect(() => validateSolid(s)).toThrow(/E_VALIDATE_NOT_TESSELATED/)
  })

  it('V5. 无 BREP 句柄的 mesh-only 形状 → E_VALIDATE_NO_BREP', () => {
    const meshOnly = { positions: new Float32Array([0, 0, 0]), indices: new Uint32Array([0, 0, 0]) } as unknown as Shape
    expect(() => validateSolid(meshOnly)).toThrow(/E_VALIDATE_NO_BREP/)
  })

  it('V6. 脚本面 cad.validateSolid(part) 可调用（已注册进 cad 命名空间）', async () => {
    await useOcct()
    const result = await exec(
      'brep',
      `let part0 = cad.box(10,10,10)
let part1 = cad.validateSolid(part0)
`,
    )
    expect(result.failedAt).toBeUndefined()
  })
})
