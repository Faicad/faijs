/**
 * profile — 齿廓数学层与 Python 的一致性（cq_gears `SpurGear.__init__` 的移植验证）
 *
 * 这是**最便宜、最灵敏**的一致性信号：只要渐开线 / 齿根圆弧 / 旋转矩阵三个里有
 * 任何一个写错，齿廓点就会立刻对不上（1e-9 级），而不需要等到建面出体积才发现问题。
 *
 * 顺带钉死一个反直觉的事实：cq 的 `pts @ rotation_matrix(axis, +alpha)` 是**行向量左乘**，
 * 实际旋转 −alpha（`math.ts` 顶部有说明）。这个测试就是那条结论的证据。
 */

import { describe, expect, it } from 'vitest'
import { loadManifest, type ReferenceCase } from './fixtures'
import { gearGeometryForClass, toothFaceGrids, segmentPoints, TOOTH_SEGMENTS } from './profile'
import type { Vec3 } from './math'

function toVec3(rows: number[][]): Vec3[] {
  return rows.map((r) => ({ x: r[0], y: r[1], z: r[2] }))
}

function expectPointsClose(actual: Vec3[], expected: Vec3[], label: string) {
  expect(actual.length, `${label}: 点数不同`).toBe(expected.length)
  let worst = 0
  for (let i = 0; i < actual.length; i++) {
    worst = Math.max(
      worst,
      Math.abs(actual[i].x - expected[i].x),
      Math.abs(actual[i].y - expected[i].y),
      Math.abs(actual[i].z - expected[i].z),
    )
  }
  expect(worst, `${label}: 最大坐标偏差 ${worst.toExponential(3)}`).toBeLessThan(1e-9)
}

const gearCases = (): ReferenceCase[] =>
  loadManifest().cases.filter((c) => c.profile && !c.error)

describe('齿轮齿廓数学 vs cq_gears', () => {
  for (const c of gearCases()) {
    describe(c.id, () => {
      // 按 manifest 的 class 分派：Spur/Herringbone→spur、Ring/HerringboneRing→ring、
      // CrossedHelical→crossed。三者的齿廓公式不同（内/外齿、端面模数），不可混用。
      const geom = gearGeometryForClass(c.class, c.args)

      it('派生几何量与 Python 一致', () => {
        const d = c.derived!
        expect(geom.twistAngle).toBeCloseTo(d.twist_angle, 12)
        expect(geom.r0).toBeCloseTo(d.r0, 12)
        expect(geom.ra).toBeCloseTo(d.ra, 12)
        expect(geom.rd).toBeCloseTo(d.rd, 12)
        expect(geom.rb).toBeCloseTo(d.rb, 12)
        expect(geom.rr).toBeCloseTo(d.rr, 12)
        expect(geom.tau).toBeCloseTo(d.tau, 12)
      })

      for (const seg of TOOTH_SEGMENTS) {
        it(`齿廓点集 ${seg} 与 Python 逐点一致`, () => {
          const key = `t_${seg}_pts` as keyof NonNullable<ReferenceCase['profile']>
          expectPointsClose(segmentPoints(geom, seg), toVec3(c.profile![key] as number[][]), seg)
        })
      }

      it('齿面点阵（rows × cols）与 Python 逐点一致', () => {
        const grids = toothFaceGrids(geom)
        const refs = c.tooth_face_grids!
        expect(grids.length).toBe(refs.length)
        for (let i = 0; i < grids.length; i++) {
          const g = grids[i]
          const ref = refs[i]
          expect(g.segment).toBe(ref.name)
          expect(g.rows, `${ref.name}: rows`).toBe(ref.rows)
          expect(g.cols, `${ref.name}: cols`).toBe(ref.cols)
          expectPointsClose(
            g.points.flat(),
            toVec3(ref.points),
            `${ref.name} 点阵`,
          )
        }
      })
    })
  }
})
