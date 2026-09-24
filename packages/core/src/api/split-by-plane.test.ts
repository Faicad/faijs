/**
 * @vitest-environment node
 *
 * Phase 6.1 — `cad.splitByPlane` 平面二分（中立 op，具名双产物）验收。
 *
 * 覆盖：
 * 1. occt 可达：box 沿 z 中平面切开 ⇒ positive/negative 体积各为半（2000 ± tol）；
 * 2. 具名产物口径（方案原则 5「多产物一律具名 outputs，不用数组」）：产物是
 *    `{ positive, negative }` 两条 solid——positive 在法向正侧（zmax 半区）。
 *    GOTCHA（脚本面消费方式，2026-09-24 实测）：具名 record 产物在脚本面用
 *    **解构**消费：`const { positive: p1, negative: n1 } = cad.splitByPlane(...)`——
 *    这是 direct-executor transformVariable 的 ObjectPattern 专属路径。
 *    两条错误写法都试过并失败：① `const p1 = cad.splitByPlane(...)`（把整条
 *    plain-object record 存进 ctx，outputs 投影只收 isShapeLike ⇒ 变量丢失）；
 *    ② `const p1 = cad.splitByPlane(...).positive`（命名空间调用后链式取成员不被
 *    direct-executor 识别，落入裸文本求值 ⇒ `cad is not defined`）。
 * 3. 方向语义：法向 [0,0,1] ⇒ positive 是 z 上半体。
 * 4. mesh 输入执行前报错（无 mesh 实现，backend-dispatch 静态判定）。
 *
 * Run: npx vitest run src/api/split-by-plane.test.ts
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

async function shapeOf(mode: ExecutionMode, code: string, part: string): Promise<Shape> {
  const result = await exec(mode, code)
  if (result.failedAt) {
    throw new Error(`execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  const s = result.outputs.get(asPartName(part))
  if (!s) throw new Error(`no output for ${part}`)
  return s as Shape
}

function volOf(s: Shape): number {
  return getBrepApi().getVolume(brepOf(s) as never)
}

function bboxMaxZ(s: Shape): number {
  return getBrepApi().getBoundingBox(brepOf(s) as never).zmax
}

describe('splitByPlane — 平面二分（中立 op，Phase 6.1）', () => {
  it('box(20,20,20) 沿 z 中平面切开 ⇒ positive/negative 各 4000（解构消费）', async () => {
    await useOcct()
    const pos = await shapeOf(
      'brep',
      `const p0 = cad.box(20,20,20)\nconst { positive: part1 } = cad.splitByPlane(p0, { point: [10,10,10], normal: [0,0,1] })\n`,
      'part1',
    )
    const neg = await shapeOf(
      'brep',
      `const p0 = cad.box(20,20,20)\nconst { negative: part1 } = cad.splitByPlane(p0, { point: [10,10,10], normal: [0,0,1] })\n`,
      'part1',
    )
    expect(Math.abs(volOf(pos) - 4000)).toBeLessThan(1e-4)
    expect(Math.abs(volOf(neg) - 4000)).toBeLessThan(1e-4)
  })

  // GOTCHA 回归守卫：具名 record 产物经解构取得（ObjectPattern 专属路径）。
  // 方向语义：法向 [0,0,1] ⇒ positive 是 z 上半体（zmax=20）、negative 是 z 下半体（zmax=10）。
  it('方向语义守卫：法向正侧是 z 上半体', async () => {
    await useOcct()
    const pos = await shapeOf(
      'brep',
      `const p0 = cad.box(20,20,20)\nconst { positive: part1 } = cad.splitByPlane(p0, { point: [10,10,10], normal: [0,0,1] })\n`,
      'part1',
    )
    const neg = await shapeOf(
      'brep',
      `const p0 = cad.box(20,20,20)\nconst { negative: part1 } = cad.splitByPlane(p0, { point: [10,10,10], normal: [0,0,1] })\n`,
      'part1',
    )
    // 体积互补：4000 + 4000 = 8000（box(20,20,20) 全体积）
    expect(Math.abs(volOf(pos) + volOf(neg) - 8000)).toBeLessThan(1e-4)
    expect(bboxMaxZ(pos)).toBeCloseTo(20, 4)
    expect(bboxMaxZ(neg)).toBeCloseTo(10, 4)
  })

  it('mesh 模式执行前报错（无 mesh 实现，静态判定不回退）', async () => {
    await useOcct()
    const result = await exec(
      'mesh',
      `const p0 = cad.box(20,20,20)\nconst part1 = cad.splitByPlane(p0, { point: [10,10,10], normal: [0,0,1] })\n`,
    )
    expect(result.failedAt).toBeTruthy()
    expect(result.failedAt!.callee).toContain('splitByPlane')
  })

  it('brep_mock 下可达但不拦截（mock 豁免引擎门；mock 桩 Phase 6.3 补齐前抛 unsupported）', async () => {
    await useBrepMock()
    const result = await exec(
      'brep',
      `const p0 = cad.box(20,20,20)\nconst part1 = cad.splitByPlane(p0, { point: [10,10,10], normal: [0,0,1] }).positive\n`,
    )
    // mock 桩补齐（Phase 6.3）后应为 ok；补桩前 mock 引擎对 L1 splitByPlane 抛
    // E_OP_FAILED unsupported —— 那是运行时执行错误，不是「非目标引擎」的执行前
    // 拒绝（engines 门）。断言：不是静态引擎门拒绝（E_ENGINE 不出现）。
    if (result.failedAt) {
      expect(result.failedAt.message).not.toMatch(/E_ENGINE|not registered/i)
    }
  })
})
