/**
 * @vitest-environment node
 *
 * Phase 6.1 — `cad.splitByPlane`（手写中立 op，具名 outputs positive/negative）验收。
 *
 * 覆盖：
 * 1. 具名产物形态：`{ positive, negative }` 两半都带 BREP 句柄；
 * 2. 法向分类正确：法向 +Z 时 positive 在平面之上、negative 在下（体积断言）；
 * 3. 体积守恒：两半体积之和 ≈ 原体体积（容差内）；
 * 4. 参数校验执行前报错（非法向量）。
 *
 * GOTCHA（L1 向量形态，同 feature-family）：L1 向量形参是 `{x,y,z}` 对象；
 * op 内已显式转换，元组/非法入参在 op 边界被拒绝，不允许零向量进内核。
 *
 * Run: npx vitest run src/api/split-by-plane.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import { __resetEngineRegistriesForTests, getBrepEngine } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { configureBackends } from '../../src/runtime-state'
import { solidToShape } from '../../src/brep/brep-ops'
import { fromBrep, brepOf } from '../../src/shape'
import type { Shape } from '../../src/mesh/types'
import type { BrepHandle } from '../../src/brep/engine/types'
import { splitByPlane } from '../../src/api/split-by-plane'

beforeAll(async () => {
  await initOcctWasm()
  __resetEngineRegistriesForTests()
  await registerOcctBrepEngine()
  configureBackends({
    contractVersion: 1,
    config: { mode: 'brep', brepCapabilities: { directEdit: true }, brepEngineId: 'occt' },
    kernel: { brep: (await getBrepEngine()).primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: undefined,
    cad: {} as never,
  } as never)
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

function box10(): Shape {
  const kernel = getBrepApi()
  const h = kernel.makeBox(10, 10, 10)
  return fromBrep(solidToShape(kernel, h), { solid: h })
}

describe('cad.splitByPlane (Phase 6.1)', () => {
  it('returns named positive/negative halves, both with BREP handles', async () => {
    const box = box10()
    const halves = (await splitByPlane(box, { point: [0, 0, 5], normal: [0, 0, 1] })) as Record<
      string,
      Shape
    >
    expect(Object.keys(halves).sort()).toEqual(['negative', 'positive'])
    expect(brepOf(halves.positive as Shape)).toBeDefined()
    expect(brepOf(halves.negative as Shape)).toBeDefined()
    expect(halves.positive).not.toBe(halves.negative)
  })

  it('positive is above the plane, negative below; volumes sum to the original', async () => {
    const kernel = getBrepApi()
    const box = box10()
    const volOrig = kernel.getVolume(brepOf(box) as BrepHandle)
    const halves = (await splitByPlane(box, { point: [0, 0, 3], normal: [0, 0, 1] })) as Record<
      string,
      Shape
    >
    const volPos = kernel.getVolume(brepOf(halves.positive as Shape) as BrepHandle)
    const volNeg = kernel.getVolume(brepOf(halves.negative as Shape) as BrepHandle)
    expect(volPos).toBeCloseTo(7 * 10 * 10, 3)
    expect(volNeg).toBeCloseTo(3 * 10 * 10, 3)
    expect(volPos + volNeg).toBeCloseTo(volOrig, 3)
  })

  it('rejects non-finite vectors before reaching the kernel', async () => {
    const box = box10()
    await expect(
      splitByPlane(box, { point: [0, 0, Number.NaN], normal: [0, 0, 1] }),
    ).rejects.toThrow(/E_SPLIT_BY_PLANE_BAD_VEC/)
  })
})
