/**
 * @vitest-environment node
 *
 * wire / face 的三角载荷与显示载荷（1D Shape 决策的回归基线）
 *
 * 事实（2026-09-24 探针实测，本测试钉死）：
 *   - `meshShape(wire)` 返回 **空三角载荷（positions 0 / indices 0）且不抛错** ——
 *     因此 Phase 3 的 1D 产物可照样走 `solidToShape`（允许空载荷），执行链路无缺口。
 *   - `meshShape(face)` 返回非空三角载荷（方形面 = positions 12 / indices 6），故
 *     `kind` 现跑的「有无三角载荷」语义下，face 报 `'solid'` 是自洽的。
 *   - L1 `wireframe` 对 wire 与 face 都返回点列（`points` / `edgeGroups` 长度 > 0），
 *     线框显示不依赖三角化伪装。
 *
 * 这条测试的存在意义（AGENTS.md 关键验证留档）：后续若有人改 `meshShape` /
 * `wireframe` 行为、或动 `fromBrep` 的空载荷处理，会立刻在此暴露，避免静默
 * 破坏 1D 产物的执行/显示链路。
 *
 * Run: npx vitest run src/brep/engine/wire-1d-payload.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { __resetEngineRegistriesForTests, getBrepEngine } from './registry'
import { registerOcctBrepEngine } from './adapters/occt'
import type { BrepEngineApi } from './primitives'

const V = (x: number, y: number, z: number): { x: number; y: number; z: number } => ({ x, y, z })

let k: BrepEngineApi

beforeAll(async () => {
  __resetEngineRegistriesForTests()
  await registerOcctBrepEngine()
  k = (await getBrepEngine()).primitives
})

describe('1D wire 与 2D face 的载荷（Phase 3 1D 决策基线）', () => {
  it('meshShape(wire) 返回空三角载荷且不抛错', () => {
    const pts = [V(0, 0, 0), V(10, 0, 0), V(10, 10, 0), V(0, 10, 0)]
    const edges = [0, 1, 2, 3].map((i) => k.makeLineEdge(pts[i]!, pts[(i + 1) % 4]!))
    const wire = k.makeWire(edges as never)
    const face = k.makeFace(wire)

    const wm = k.meshShape(wire as never, { linearDeflection: 0.1, angularDeflection: 0.1 })
    const fm = k.meshShape(face as never, { linearDeflection: 0.1, angularDeflection: 0.1 })

    expect(wm.positions.length).toBe(0)
    expect(wm.indices.length).toBe(0)
    expect(fm.positions.length).toBeGreaterThan(0)
    expect(fm.indices.length).toBeGreaterThan(0)
  })

  it('wireframe 对 wire 与 face 都返回点列', () => {
    const pts = [V(0, 0, 0), V(10, 0, 0), V(10, 10, 0), V(0, 10, 0)]
    const edges = [0, 1, 2, 3].map((i) => k.makeLineEdge(pts[i]!, pts[(i + 1) % 4]!))
    const wire = k.makeWire(edges as never)
    const face = k.makeFace(wire)

    const ww = k.wireframe(wire as never, 0.1) as unknown as { points: ArrayLike<number>; edgeGroups: ArrayLike<unknown> }
    const fw = k.wireframe(face as never, 0.1) as unknown as { points: ArrayLike<number>; edgeGroups: ArrayLike<unknown> }

    expect(ww.points.length).toBeGreaterThan(0)
    expect(ww.edgeGroups.length).toBeGreaterThan(0)
    expect(fw.points.length).toBeGreaterThan(0)
    expect(fw.edgeGroups.length).toBeGreaterThan(0)
  })
})
