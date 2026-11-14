/**
 * @vitest-environment node
 *
 * E3 GOTCHA — `cad.shell`（抽壳）vs `cad.sew`（成壳）语义防回归（方案 2026-11-14 §E3）
 *
 * 直觉命名陷阱（验证留档铁律 §2，固化「错误直觉 + 正确直觉」）：
 * - `cad.shell` 名字带 shell，但它是**抽壳/薄壁**：输入实体、移除选中面等厚偏置，
 *   产物仍是 **solid**（getShapeType === 'solid'，isShell === false）；
 * - 壳构造（面/壳集 → 壳）的正门是 `cad.sew`：产物 isShell === true。
 *
 * 断言走 occt 原生 `getShapeType` / `isShell`（平台 op，TS 直连；脚本面无 getShapeType）。
 *
 * Run: npx vitest run test/api/shell-sew-gotcha.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../src/cad-runtime/ports'
import { initOcctWasm, getOcctKernel } from '../../src/occt-kernel/occtKernel'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { brepOf } from '../../src/shape'
import type { Shape } from '../../src/mesh/types'
import { asPartName } from '../../src/identity'
import { isShell, isFace } from '../../src/api/shape-type'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'

beforeAll(async () => {
  await initOcctWasm()
  await registerOcctBrepEngine()
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

async function exec(code: string): Promise<ExecutionResult> {
  return new CadRuntime(ports(), 'brep' as ExecutionMode, {
    cad: createApiNamespaceWithEditorOps(),
  }).execute(code)
}

async function shapeOf(code: string, part: string): Promise<Shape> {
  const result = await exec(code)
  if (result.failedAt) {
    throw new Error(`execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  const s = result.outputs.get(asPartName(part))
  if (!s) throw new Error(`no output for ${part}`)
  return s as Shape
}

describe('E3 GOTCHA — cad.shell（抽壳）vs cad.sew（成壳）', () => {
  it('cad.shell：名字带 shell，产物是 solid（抽壳/薄壁，不是壳）', async () => {
    const s = await shapeOf(
      `let p = cad.box(20, 20, 20)\n` +
      `let part0 = cad.shell(p, { openFaces: ">Z", thickness: 2 })\n`,
      'part0',
    )
    // GOTCHA 钉死：shell op 产物 getShapeType === 'solid'，isShell === false
    expect(getOcctKernel().getShapeType(brepOf(s) as never)).toBe('solid')
    expect(isShell(s)).toBe(false)
    // 薄壁体有正体积（20³ 减内腔；开顶）
    expect(Math.abs(getBrepApi().getVolume(brepOf(s) as never))).toBeGreaterThan(0)
  })

  it('cad.sew：相邻面缝合 → 壳（壳构造正门，isShell === true）', async () => {
    // 两张相邻面（z=0 方形 + y=0 方形，共享 x 轴上的边）
    const code =
      `const sq = cad.profile({ contours: [{ segments: [\n` +
      `  { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },\n` +
      `  { kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 },\n` +
      `  { kind: 'line', x1: 10, y1: 10, x2: 0, y2: 10 },\n` +
      `  { kind: 'line', x1: 0, y1: 10, x2: 0, y2: 0 },\n` +
      `] }] })\n` +
      `const fz0 = sq\n` +
      `const fy0 = cad.place(sq, { rotation: [0.7071067811865476, 0, 0, 0.7071067811865476] })\n` +
      `const part0 = cad.sew([fz0, fy0])\n`
    const s = await shapeOf(code, 'part0')
    // GOTCHA 钉死：sew 产物是 shell（可能开放），不是 face 也不是 solid
    expect(isShell(s)).toBe(true)
    expect(isFace(s)).toBe(false)
    expect(getOcctKernel().getShapeType(brepOf(s) as never)).toBe('shell')
  })
})
