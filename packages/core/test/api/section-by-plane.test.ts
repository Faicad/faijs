/**
 * @vitest-environment node
 *
 * Phase 6.2 — `cad.sectionByPlane`（手写中立 op，1D compound 产物）验收。
 *
 * 覆盖：
 * 1. 可达 + 产物是 1D 曲线（kind:'curve'，Phase 3 判别位）；
 * 2. 几何正确：box 沿 z=5 横截 → 截面线包围盒 = box 的 XY 范围、Z 压平在 5；
 * 3. L1 wireframe 对产物出非空点列（1D 显示口径，不做伪三角化）；
 * 4. 平面不与体相交时显式报错（原则 9：不返回假空产物）。
 *
 * Run: npx vitest run src/api/section-by-plane.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import { __resetEngineRegistriesForTests, getBrepEngine } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { configureBackends } from '../../src/runtime-state'
import { fromBrep, brepOf, isCurveShape } from '../../src/shape'
import { solidToShape } from '../../src/brep/brep-ops'
import type { Shape } from '../../src/mesh/types'
import type { BrepHandle } from '../../src/brep/engine/types'
import { sectionByPlane } from '../../src/api/section-by-plane'

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

describe('cad.sectionByPlane (Phase 6.2)', () => {
  it('returns a 1D curve shape (kind:curve) carrying a BREP compound handle', async () => {
    const box = box10()
    const sec = (await sectionByPlane(box, { point: [0, 0, 5], normal: [0, 0, 1] })) as Shape
    expect(isCurveShape(sec)).toBe(true)
    expect(brepOf(sec)).toBeDefined()
  })

  it('section of a box at z=5 has XY bounds of the box and Z flattened to 5', async () => {
    const kernel = getBrepApi()
    const box = box10()
    const sec = (await sectionByPlane(box, { point: [0, 0, 5], normal: [0, 0, 1] })) as Shape
    const bb = kernel.getBoundingBox(brepOf(sec) as BrepHandle)
    expect(bb.xmin).toBeCloseTo(0, 3)
    expect(bb.xmax).toBeCloseTo(10, 3)
    expect(bb.ymin).toBeCloseTo(0, 3)
    expect(bb.ymax).toBeCloseTo(10, 3)
    expect(bb.zmin).toBeCloseTo(5, 3)
    expect(bb.zmax).toBeCloseTo(5, 3)
  })

  it('L1 wireframe supplies a non-empty point list for display', async () => {
    const box = box10()
    const sec = (await sectionByPlane(box, { point: [0, 0, 5], normal: [0, 0, 1] })) as Shape
    const wf = getBrepApi().wireframe(brepOf(sec) as BrepHandle)
    expect(wf.points.length).toBeGreaterThan(0)
    expect(Number.isFinite(wf.points[0])).toBe(true)
  })

  it('errors explicitly when the plane misses the shape', async () => {
    const box = box10()
    await expect(
      sectionByPlane(box, { point: [0, 0, 50], normal: [0, 0, 1] }),
    ).rejects.toThrow(/E_SECTION_BY_PLANE_NO_INTERSECTION/)
  })
})
