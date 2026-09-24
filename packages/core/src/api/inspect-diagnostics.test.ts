/**
 * @vitest-environment node
 *
 * Phase 7 待裁决 4（方案 §7.1 建议 4）——occt 独占诊断族进脚本面（inspect* 命名）验收。
 *
 * 覆盖（方案 §6 验收总门「每个新增平台 op 各两条测试」）：
 * 1. occt 可达：inspectMassProps / inspectInterference / inspectAllInterferences /
 *    inspectCurvatureAtMid 返回真实数值/纯数据（不是空洞 toBeTruthy）；
 * 2. 非目标引擎执行前报错（D11-4：assertEngineFor 在触碰内核前抛）——brepkit 下
 *    inspectMassProps 静态拒绝；
 * 3. brep_mock 豁免引擎门（D11-3）：mock 下不因引擎身份被拦（mock 无 vendored
 *    借入链路，语义失败属运行时，非引擎门拒绝）。
 *
 * GOTCHA（生成器改名投影，2026-09-24）：脚本面名 inspect* 与 vendored 导出名
 * checkInterference / measureCurvatureAt(Mid) / measureVolumeProps 解耦——renderQuery 按
 * source 的 exportName 导入、按 name 声明；U7 反向护栏按 exportName 回查基线。
 * 命名不走 measure*：与中立量（volume/area/length）形成误导性双轨（§7.1 建议 4.3）。
 *
 * Run: npx vitest run src/api/inspect-diagnostics.test.ts
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
import { registerBrepkitBrepEngine } from '../brep/engine/adapters/brepkit'
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

async function useBrepkit(): Promise<void> {
  __resetEngineRegistriesForTests()
  await registerBrepkitBrepEngine()
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

async function shapeOf(mode: ExecutionMode, code: string, part: string): Promise<Shape> {
  const result = await exec(mode, code)
  if (result.failedAt) {
    throw new Error(`execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  const s = result.outputs.get(asPartName(part))
  if (!s) throw new Error(`no output for ${part}`)
  return s as Shape
}

describe('inspect* — occt 独占诊断族（Phase 7 待裁决 4）', () => {
  it('inspectMassProps：box(10,10,10) 体积 1000 / 质心 (5,5,5)', async () => {
    await useOcct()
    const vol = await execViaNs<{ volume: number; centerOfMass: [number, number, number] }>(async (cad) => {
      const p0 = await cad.box(10, 10, 10)
      return cad.inspectMassProps(p0) as { volume: number; centerOfMass: [number, number, number] }
    })
    expect(vol.volume).toBeCloseTo(1000, 4)
    // GOTCHA（vendored PhysicalProps 语义，2026-09-24 实测）：centerOfMass 是
    // [x, y, z] 元组（Vec3），不是 {x,y,z} 对象——对象式读法得到 undefined。
    expect(vol.centerOfMass[0]).toBeCloseTo(5, 4)
    expect(vol.centerOfMass[1]).toBeCloseTo(5, 4)
    expect(vol.centerOfMass[2]).toBeCloseTo(5, 4)
  })

  it('inspectInterference：两相交 box 报干涉；相距远的两 box 不干涉', async () => {
    const hit = await execViaNs<{ hasInterference: boolean; minDistance: number }>(async (cad) => {
      const a = await cad.box(10, 10, 10)
      const b = await cad.translate(a, 5, 0, 0)
      return cad.inspectInterference(a, b) as { hasInterference: boolean; minDistance: number }
    })
    expect(hit.hasInterference).toBe(true)

    const miss = await execViaNs<{ hasInterference: boolean; minDistance: number }>(async (cad) => {
      const a = await cad.box(10, 10, 10)
      const b = await cad.translate(a, 100, 0, 0)
      return cad.inspectInterference(a, b) as { hasInterference: boolean; minDistance: number }
    })
    expect(miss.hasInterference).toBe(false)
    expect(miss.minDistance).toBeGreaterThan(50)
  })

  it('inspectAllInterferences：三体一组（两两相交 + 一远）报 3 对中的相交对', async () => {
    const pairs = await execViaNs<Array<{ i: number; j: number }>>(async (cad) => {
      const a = await cad.box(10, 10, 10)
      const b = await cad.translate(a, 5, 0, 0)
      const c = await cad.translate(a, 200, 0, 0)
      return cad.inspectAllInterferences([a, b, c]) as Array<{ i: number; j: number }>
    })
    // (a,b) 相交、(a,c)/(b,c) 不相交 ⇒ 恰 1 对
    expect(pairs).toHaveLength(1)
    expect(pairs[0]!.i).toBe(0)
    expect(pairs[0]!.j).toBe(1)
  })

  it('inspectCurvatureAtMid：平面 sketch 面中点曲率为 0', async () => {
    const curv = await execViaNs<{ mean: number; gaussian: number }>(async (cad) => {
      // GOTCHA（vendored 曲率语义，2026-09-24 实测）：measureCurvatureAtMid 输入是
      // Face（uvBounds 对 solid 报 `uvBounds: TopoDS::Face`）——传实体直接失败。
      // 脚本面可造的面是 cad.sketch 产物（平面 face）⇒ 平面曲率 mean/gaussian = 0。
      const f = await cad.sketch({
        contours: [{ segments: [
          { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
          { kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 },
          { kind: 'line', x1: 10, y1: 10, x2: 0, y2: 10 },
          { kind: 'line', x1: 0, y1: 10, x2: 0, y2: 0 },
        ] }],
      })
      return cad.inspectCurvatureAtMid(f) as { mean: number; gaussian: number }
    })
    expect(Math.abs(curv.mean)).toBeLessThan(1e-9)
    expect(Math.abs(curv.gaussian)).toBeLessThan(1e-9)
  })

  // D11-4：非目标引擎执行前报错（assertEngineFor 在触碰内核前抛，不落到 vendored）。
  it('brepkit 下执行前报错（D11-4 静态引擎门）', async () => {
    await useBrepkit()
    const result = await exec(
      'brep',
      `const p0 = cad.box(10,10,10)\nconst m = cad.inspectMassProps(p0)\nconst part1 = cad.box(1,1,1)\n`,
    )
    expect(result.failedAt).toBeTruthy()
    expect(result.failedAt!.message).toMatch(/inspectMassProps/)
  })

  // D11-3：brep_mock 豁免引擎门——不因引擎身份被拦（mock 下 vendored 借入链路
  // 不可用属运行时语义，不是 E_ENGINE 静态拒绝）。
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
 *  以泛型显式标注返回值类型（VolumeProps / InterferenceResult / CurvatureResult）。 */
async function execViaNs<T>(fn: (cad: Record<string, (...a: unknown[]) => unknown>) => T | Promise<T>): Promise<T> {
  await useOcct()
  const { getBrepEngine } = await import('../brep/engine/registry')
  const { configureBackends } = await import('../runtime-state')
  const prim = (await getBrepEngine()).primitives
  configureBackends({
    contractVersion: 1,
    // GOTCHA（configureBackends 能力声明语义，2026-09-24 实测）：brepCapabilities
    // 是「当前引擎声明了哪些能力」的运行时账本——传 {} ⇒ directEdit 门 op 全拒；
    // evolution 必须是**数组**（engineCapabilitySet 逐项迭代），传 true 抛
    // "boolean true is not iterable"。Backends 类型还要求 texture/assets/events
    // 字段（探针脚本 .mts 绕过类型检查无感；测试内 ts 严格校验须补全）。
    config: { mode: 'brep', brepCapabilities: { directEdit: true }, brepEngineId: 'occt' },
    kernel: { brep: prim, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => {} },
  })
  const { createApiNamespaceWithEditorOps } = await import('../test-support/editor-ops')
  const cad = createApiNamespaceWithEditorOps() as unknown as Record<string, (...a: unknown[]) => unknown>
  return fn(cad)
}
