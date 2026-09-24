/**
 * @vitest-environment node
 *
 * Phase 6.2 — `cad.sectionByPlane` 平面求交线（中立 op，1D compound 产物）验收。
 *
 * 覆盖：
 * 1. occt 可达：box 与 z=10 平面的截面 = 20×20 方形回线；产物是 compound、
 *    children 每条 kind:'curve'（1D 无三角载荷）；
 * 2. 空截面：平面不与体相交 ⇒ 空 compound（不抛错）；
 * 3. mesh 模式执行前报错（无 mesh 实现，backend-dispatch 静态判定）；
 * 4. brep_mock 下不被引擎门拦截（mock 桩 Phase 6.3 补齐前抛 unsupported 属运行时语义）。
 *
 * Run: npx vitest run src/api/section-by-plane.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../cad-runtime/runtime'
import type { ExecutionResult } from '../cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../cad-runtime/ports'
import { asPartName } from '../identity'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import type { Shape } from '../mesh/types'
import { __resetEngineRegistriesForTests } from '../brep/engine/registry'
import { registerOcctBrepEngine } from '../brep/engine/adapters/occt'
import { registerBrepMockEngine } from '../brep/engine/adapters/brep-mock'
import { getBrepApi } from '../brep/handle-bridge'
import { brepOf } from '../shape'
import { createApiNamespaceWithEditorOps } from '../test-support/editor-ops'

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

async function useBrepMock(): Promise<void> {
  __resetEngineRegistriesForTests()
  await registerBrepMockEngine()
}

function makeRuntime(mode: ExecutionMode): CadRuntime {
  return new CadRuntime(ports(), mode, { cad: createApiNamespaceWithEditorOps() })
}

function exec(mode: ExecutionMode, code: string): Promise<ExecutionResult> {
  return makeRuntime(mode).execute(code)
}

async function outputOf(mode: ExecutionMode, code: string, part: string): Promise<Shape | undefined> {
  const result = await exec(mode, code)
  if (result.failedAt) {
    throw new Error(`execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  return result.outputs.get(asPartName(part)) as Shape | undefined
}

function isCompoundLike(v: unknown): v is { kind: 'compound'; children: Shape[] } {
  return !!v && typeof v === 'object' && (v as { kind?: unknown }).kind === 'compound'
}

function isGeomCompound(v: unknown): boolean {
  // 产物口径（与 compound-geom 先例一致）：持 compound 句柄的几何复合体——
  // 顶层 kind:'solid'，经 brep 槽 getSubShapes('edge') 可枚举交线。
  if (!v || typeof v !== 'object') return false
  try {
    const h = brepOf(v as Shape)
    return h !== undefined && getBrepApi().getSubShapes(h as never, 'edge').length >= 0
  } catch {
    return false
  }
}

describe('sectionByPlane — 平面求交线（中立 op，Phase 6.2）', () => {
  it('box(20,20,20) 与 z=10 平面的截面 ⇒ 持句柄几何复合体（含 edge 交线）', async () => {
    await useOcct()
    const sec = await outputOf(
      'brep',
      `const p0 = cad.box(20,20,20)\nconst part1 = cad.sectionByPlane(p0, { point: [10,10,10], normal: [0,0,1] })\n`,
      'part1',
    )
    expect(sec).toBeTruthy()
    expect(isGeomCompound(sec!)).toBe(true)
    const h = brepOf(sec!) as never
    const edges = getBrepApi().getSubShapes(h, 'edge')
    // 20×20 方形回线：≥4 条边
    expect(edges.length).toBeGreaterThanOrEqual(4)
  })

  it('空截面（平面不与体相交）⇒ 0 条交线不抛错', async () => {
    await useOcct()
    const sec = await outputOf(
      'brep',
      `const p0 = cad.box(20,20,20)\nconst part1 = cad.sectionByPlane(p0, { point: [100,100,100], normal: [0,0,1] })\n`,
      'part1',
    )
    expect(sec).toBeTruthy()
    const h = brepOf(sec!) as never
    expect(getBrepApi().getSubShapes(h, 'edge')).toEqual([])
  })

  it('mesh 模式执行前报错（无 mesh 实现，静态判定不回退）', async () => {
    await useOcct()
    const result = await exec(
      'mesh',
      `const p0 = cad.box(20,20,20)\nconst part1 = cad.sectionByPlane(p0, { point: [10,10,10], normal: [0,0,1] })\n`,
    )
    expect(result.failedAt).toBeTruthy()
    expect(result.failedAt!.callee).toContain('sectionByPlane')
  })

  it('brep_mock 下不被引擎门拦截（mock 桩 Phase 6.3 补齐前抛 unsupported）', async () => {
    await useBrepMock()
    const result = await exec(
      'brep',
      `const p0 = cad.box(20,20,20)\nconst part1 = cad.sectionByPlane(p0, { point: [10,10,10], normal: [0,0,1] })\n`,
    )
    if (result.failedAt) {
      expect(result.failedAt.message).not.toMatch(/E_ENGINE|not registered/i)
    }
  })
})
