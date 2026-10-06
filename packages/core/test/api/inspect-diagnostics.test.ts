/**
 * @vitest-environment node
 *
 * §5.5 第 2 条（2026-09-25 改写）：inspect* 诊断族随 brepjs 剥离收口——
 * inspectMassProps 自有化为 core 直连（getVolume/getSurfaceArea/getCenterOfMass，
 * 中立 L1 测量面，双引擎可跑）；inspectInterference / inspectAllInterferences /
 * inspectCurvatureAtMid / inspectCurvature 为 L2 平台面（occt-wasm 无 L1 等价），
 * 按 §5.5 第 2 条裁定删除（未平铺未公开）。
 *
 * 覆盖：
 * 1. occt 可达：inspectMassProps 返回真实数值/纯数据（体积 1000 / 质心 (5,5,5)，
 *    面积 600——box(10,10,10) 六面）；
 * 2. brep_mock 豁免引擎门（D11-3）：mock 下不被引擎身份静态拒绝（selfhost 后
 *    无 assertEngineFor，直接走引擎查询；mock 有 getVolume/getCenterOfMass/getSurfaceArea）。
 *
 * Run: npx vitest run src/api/inspect-diagnostics.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../src/cad-runtime/ports'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { registerBrepMockEngine } from '../../src/brep/engine/adapters/brep-mock'
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

describe('inspectMassProps（§5.5 第 2 条自有化：core 直连，中立 L1 测量面）', () => {
  it('occt：box(10,10,10) 体积 1000 / 面积 600 / 质心 (5,5,5)', async () => {
    await useOcct()
    const vol = await execViaNs<{ volume: number; area: number; centerOfMass: { x: number; y: number; z: number } }>(
      async (cad) => {
        const p0 = await cad.box(10, 10, 10)
        return cad.inspectMassProps(p0) as { volume: number; area: number; centerOfMass: { x: number; y: number; z: number } }
      },
    )
    expect(vol.volume).toBeCloseTo(1000, 4)
    expect(vol.area).toBeCloseTo(600, 4)
    // §5.5 第 2 条：自有化后 centerOfMass 是 {x,y,z} 对象（core getCenterOfMass 形态）。
    expect(vol.centerOfMass.x).toBeCloseTo(5, 4)
    expect(vol.centerOfMass.y).toBeCloseTo(5, 4)
    expect(vol.centerOfMass.z).toBeCloseTo(5, 4)
  })

  // D11-3：brep_mock 豁免引擎门——不因引擎身份被拦（selfhost 后无 assertEngineFor；
  // mock 引擎有 getVolume/getCenterOfMass/getSurfaceArea，调用属运行时语义）。
  it('brep_mock 下不被引擎门拦截（D11-3 豁免）', async () => {
    await useBrepMock()
    const result = await exec(
      'brep',
      `const p0 = cad.box(10,10,10)\nconst m = cad.inspectMassProps(p0)\nconst part1 = cad.box(1,1,1)\n`,
    )
    if (result.failedAt) {
      expect(result.failedAt.message).not.toMatch(/E_ENGINE|not registered/i)
    }
  })
})

/** 直接在 occt 引擎下经 cad 命名空间执行回调（查询 op 返回纯数据的取值通路）。
 *  GOTCHA：直调命名空间不经 CadRuntime，须自行 configureBackends（同
 *  scripts/__probe-split-by-plane.mts 的初始化次序：先注册引擎取 primitives，再配置）。
 *  cad 命名空间取的是 index-signature 类型 ⇒ 调用结果推断为 unknown，调用方须
 *  以泛型显式标注返回值类型。 */
async function execViaNs<T>(fn: (cad: Record<string, (...a: unknown[]) => unknown>) => T | Promise<T>): Promise<T> {
  await useOcct()
  const { getBrepEngine } = await import('../../src/brep/engine/registry')
  const { configureBackends } = await import('../../src/runtime-state')
  const prim = (await getBrepEngine()).primitives
  configureBackends({
    contractVersion: 1,
    config: { mode: 'brep', brepCapabilities: { directEdit: true }, brepEngineId: 'occt' },
    kernel: { brep: prim, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => {} },
  })
  const { createApiNamespaceWithEditorOps: ns } = await import('../support/editor-ops')
  const cad = ns() as unknown as Record<string, (...a: unknown[]) => unknown>
  return fn(cad)
}
