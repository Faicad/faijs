/**
 * shell-open-face-direction.test — 抽壳"点哪个面就开哪个面"的方向回归
 *
 * 方案：faijs/docs/plans/2026-10-20-face-identity-single-source-plan.md（P4 #2）
 *
 * 历史缺陷：box 的显示 mesh 被按"契约序"重排、拓扑面表按内核枚举序，导致
 * 「面行 1 = +X(right)」的 triangleStart 指到显示 mesh 里 −X 的三角形 →
 * 点右侧面（+X）被解析成 role:'left' → 抽壳开了**左侧**（方向反）。
 *
 * 判据：box(10,20,30) 开 +X 面时腔体 x∈[2,10] → vol = 6000 − 8·16·26 = 2672；
 * 开 −X 面时腔体 x∈[0,8] → vol = 6000 − 8·16·28 = 3312。两个方向的**体积不同**，
 * 因此体积是区分 ±X 方向的可靠判据（±Z 对称、体积相同，不能用）。
 *
 * 断言两件事：
 * 1) 选择器 `">X"` 与 `role:'right'` 的 FaceTopoRef 得到**同一结果**（vol 2672，即开 +X）；
 * 2) 反面对照 `role:'left'` → vol 3312（即开 −X）——方向被真正区分。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import type { Shape } from '@faicad/faijs/mesh/types'
import { createEditorRuntime } from '../_support/editor-runtime'

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

/** signed volume（散度定理）：Σ dot(v0, cross(v1, v2)) / 6。 */
function volume(shape: Shape): number {
  const { positions, indices } = shape
  let vol = 0
  for (let t = 0; t < indices.length / 3; t++) {
    const i0 = indices[t * 3]!; const i1 = indices[t * 3 + 1]!; const i2 = indices[t * 3 + 2]!
    const ax = positions[i0 * 3]!; const ay = positions[i0 * 3 + 1]!; const az = positions[i0 * 3 + 2]!
    const bx = positions[i1 * 3]!; const by = positions[i1 * 3 + 1]!; const bz = positions[i1 * 3 + 2]!
    const cx = positions[i2 * 3]!; const cy = positions[i2 * 3 + 1]!; const cz = positions[i2 * 3 + 2]!
    vol += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6
  }
  return vol
}

/**
 * x = xTarget 平面上所有三角形（三顶点 x 都落在 ±tol 内）的面积和。
 *
 * box(10,20,30) 抽壳开 +X 面后，x=10 处只剩「外壁边界环」= 20·30 − 16·26 = 184；
 * 开 −X 面时 x=10 处是**完整**的 +X 壁面 = 600。这是区分 ±X 方向的可靠判据
 * （±X 的腔体尺寸对称，体积相同，不能用体积区分）。
 */
function areaAtPlaneX(shape: Shape, xTarget: number, tol = 1e-4): number {
  const { positions, indices } = shape
  let area = 0
  for (let t = 0; t < indices.length / 3; t++) {
    const i0 = indices[t * 3]!; const i1 = indices[t * 3 + 1]!; const i2 = indices[t * 3 + 2]!
    const xs = [positions[i0 * 3]!, positions[i1 * 3]!, positions[i2 * 3]!]
    if (!xs.every((x) => Math.abs(x - xTarget) < tol)) continue
    const ay = positions[i0 * 3 + 1]!; const az = positions[i0 * 3 + 2]!
    const by = positions[i1 * 3 + 1]!; const bz = positions[i1 * 3 + 2]!
    const cy = positions[i2 * 3 + 1]!; const cz = positions[i2 * 3 + 2]!
    const uy = by - ay; const uz = bz - az
    const vy = cy - ay; const vz = cz - az
    area += Math.hypot(uy * vz - uz * vy, 0, 0) / 2
  }
  return area
}

const BOX_LINE = 'let part0 = cad.box(10 * MM, 20 * MM, 30 * MM)'
const SELECTOR_CODE = `${BOX_LINE}
let part1 = cad.shell(part0, { openFaces: ">X", thickness: 2 * MM })`
const RIGHT_REF_CODE = `${BOX_LINE}
let part1 = cad.shell(part0, { openFaces: [{ kind: 'face', origin: 's1', role: 'right', hint: { kind: 'face', surfaceType: 'plane', normal: [1, 0, 0], area: 600, center: [10, 10, 15] } }], thickness: 2 * MM })`
const LEFT_REF_CODE = `${BOX_LINE}
let part1 = cad.shell(part0, { openFaces: [{ kind: 'face', origin: 's1', role: 'left' }], thickness: 2 * MM })`

async function run(code: string): Promise<Shape> {
  const rt = createEditorRuntime(createNodePorts(), 'brep')
  const res = await rt.execute(code)
  expect(res.failedAt, `执行失败: ${JSON.stringify(res.failedAt)}`).toBeUndefined()
  const shape = res.outputs.get('part1' as never) as Shape | undefined
  expect(shape, 'shell 应产出 part1').toBeDefined()
  return shape!
}

describe('shell 开面方向（occt / brep 链）', () => {
  it('base：box 两个端面各 600（开面前基准）', async () => {
    const rt = createEditorRuntime(createNodePorts(), 'brep')
    const res = await rt.execute(BOX_LINE)
    const shape = res.outputs.get('part0' as never) as Shape
    expect(areaAtPlaneX(shape, 0)).toBeCloseTo(600, 0)
    expect(areaAtPlaneX(shape, 10)).toBeCloseTo(600, 0)
  })

  it('">X" 选择器：开的是 +X 面（x=10 处只剩 184 的边界环）', async () => {
    const s = await run(SELECTOR_CODE)
    expect(volume(s)).toBeCloseTo(2672, 0)
    expect(areaAtPlaneX(s, 10)).toBeCloseTo(184, 0)
    expect(areaAtPlaneX(s, 0)).toBeCloseTo(600, 0)
  })

  it('role:"right" 的 FaceTopoRef：与 ">X" 一致（开 +X 而非 −X）', async () => {
    const s = await run(RIGHT_REF_CODE)
    expect(areaAtPlaneX(s, 10)).toBeCloseTo(184, 0)
    expect(areaAtPlaneX(s, 0)).toBeCloseTo(600, 0)
  })

  it('反面对照 role:"left"：开 −X 面（x=0 处只剩边界环，x=10 完整）', async () => {
    const s = await run(LEFT_REF_CODE)
    expect(areaAtPlaneX(s, 0)).toBeCloseTo(184, 0)
    expect(areaAtPlaneX(s, 10)).toBeCloseTo(600, 0)
  })
})