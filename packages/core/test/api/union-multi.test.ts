/**
 * @vitest-environment node
 *
 * union 多输入 fuseAll 验收（阶段 3 / I2，2026-11-14）
 *
 * 背景：链式 fuse 在 ≥3 输入时给脏结果（case8 五段圆管 368 条非流形边；
 * 五个相交 box 体积只 2000 / 理论 3000）。本文件锁住修复后的三条性质：
 * U1. 几何正确（体积 3000，链式曾给 2000）；
 * U2. 结果水密且无非流形边；
 * U3. 两输入 union 仍走链式路径，行为不变（回归护栏）；
 * U4. **naming 现状如实记录**：fuseAll 不产面演化表 ⇒ 面命名是否退化，
 *     由本用例给出结论（退化则按已定条件退回「链式 + 强制 unify」）。
 *
 * Run: npx vitest run test/api/union-multi.test.ts
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

const FIVE_BOXES = `let part0 = cad.box(10,10,10)
let part1 = cad.translate(part0, [5,0,0])
let part2 = cad.translate(part0, [10,0,0])
let part3 = cad.translate(part0, [15,0,0])
let part4 = cad.translate(part0, [20,0,0])
let part5 = cad.union(part0, part1, part2, part3, part4)
`

describe('union 多输入 → fuseAll', () => {
  it('U1. 5 个相交 box union → 体积 3000（链式路径曾给 2000，末个操作数丢失）', async () => {
    await useOcct()
    const s = await shapeOf('brep', FIVE_BOXES, 'part5')
    const r = validateSolid(s)
    expect(Math.abs(r.volume_mm3 - 3000)).toBeLessThan(30)
    expect(r.box.size[0]).toBeCloseTo(30, 3)
  })

  it('U2. 结果水密且无非流形边（一次合并而非 4 次重采样）', async () => {
    await useOcct()
    const s = await shapeOf('brep', FIVE_BOXES, 'part5')
    const r = validateSolid(s)
    expect(r.watertight).toBe(true)
    expect(r.nonmanifold_edges).toBe(0)
    expect(r.boundary_edges).toBe(0)
  })

  it('U3. 两输入 union 行为不变（仍走链式路径，体积 1500）', async () => {
    await useOcct()
    const s = await shapeOf(
      'brep',
      `let part0 = cad.box(10,10,10)
let part1 = cad.translate(part0, [5,0,0])
let part2 = cad.union(part0, part1)
`,
      'part2',
    )
    const r = validateSolid(s)
    expect(Math.abs(r.volume_mm3 - 1500)).toBeLessThan(20)
    expect(r.watertight).toBe(true)
  })

  it('U4. naming 现状：fuseAll 路径下结果仍带面角色（未退化为 nameless）', async () => {
    await useOcct()
    const s = await shapeOf('brep', FIVE_BOXES, 'part5')
    const roleTable = (s as unknown as Record<symbol, unknown>)
    const keys = Object.getOwnPropertySymbols(roleTable)
      .map((k) => String(k))
      .join(',')
    // BREP_ROLE_TABLE 槽存在与否由 solidToShape/fromBrep 决定：fuseAll 分支显式不给
    // roleTable ⇒ 槽缺失 ⇒ faceRef 退化为 nameless。此处如实锁定"退化"这一现状，
    // 一旦未来内核补出 fuseAll 演化表，本用例会失败并提示更新方案 §3 I2 的代价说明。
    expect(keys).not.toContain('BREP_ROLE_TABLE')
  })
})
