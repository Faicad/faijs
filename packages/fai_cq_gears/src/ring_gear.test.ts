/**
 * ring_gear — RingGear 齿廓数学层与 cq_gears 的一致性
 *
 * 与 `profile.test.ts` 同款思路：最便宜、最灵敏的信号。只要内部齿渐开线 /
 * 齿顶齿根圆弧哪一处写错，点就会立刻对不上（1e-9 级）。
 *
 * 数据来源：`fixtures/reference/manifest.json` 中 `class === 'RingGear'` 且带
 * `profile` / `derived` / `tooth_face_grids` 的用例（由 `gen-reference.py` 生成）。
 */

import { describe, expect, it } from 'vitest'
import { loadManifest, type ReferenceCase } from './fixtures'
import { ringGearGeometry, toothFaceGrids, segmentPoints, TOOTH_SEGMENTS } from './profile'
import type { RingGearParams } from './profile'
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

const ringCases = (): ReferenceCase[] =>
  loadManifest().cases.filter((c) => c.class === 'RingGear' && c.profile && !c.error)

describe('RingGear 齿廓数学 vs cq_gears', () => {
  for (const c of ringCases()) {
    describe(c.id, () => {
      const geom = ringGearGeometry(c.args as never as RingGearParams)

      it('派生几何量（内部齿）与 Python 一致', () => {
        const d = c.derived!
        expect(geom.twistAngle).toBeCloseTo(d.twist_angle, 12)
        expect(geom.r0).toBeCloseTo(d.r0, 12)
        expect(geom.ra).toBeCloseTo(d.ra, 12) // 内部齿：ra < r0
        expect(geom.rd).toBeCloseTo(d.rd, 12) // 内部齿：rd > r0
        expect(geom.rb).toBeCloseTo(d.rb, 12)
        expect(geom.rr).toBeCloseTo(d.rr, 12)
        expect(geom.tau).toBeCloseTo(d.tau, 12)
      })

      for (const seg of TOOTH_SEGMENTS) {
        it(`齿廓点集 ${seg} 与 Python 逐点一致`, () => {
          const key = `t_${seg}_pts` as keyof NonNullable<ReferenceCase['profile']>
          expectPointsClose(
            segmentPoints(geom, seg),
            toVec3(c.profile![key] as number[][]),
            seg,
          )
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
          expectPointsClose(g.points.flat(), toVec3(ref.points), `${ref.name} 点阵`)
        }
      })
    })
  }
})
