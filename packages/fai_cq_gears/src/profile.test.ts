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
import { gearGeometryForClass, toothFaceGrids, segmentPoints, TOOTH_SEGMENTS, type SpurGearGeometry } from './profile'
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
      // CrossedHelical→crossed、Worm→worm。三者的齿廓公式不同（内/外齿、端面模数），不可混用。
      const geom = gearGeometryForClass(c.class, c.args)

      // manifest `derived_missing` 非空的类（如 Worm 无 twist_angle/rb/rr/tau）
      // 缺少完整派生量，通用断言不适用（worm-basic/2threads 由 worm_gear.test.ts 锁定）
      if (c.derived_missing && c.derived_missing.length > 0) {
        it.skip('派生几何量与 Python 一致（部分派生量缺失，见 derived_missing）', () => {})
      } else {
        it('派生几何量与 Python 一致', () => {
          // Worm 已被上面的 derived_missing 分支排除，此处必为 Spur 族几何
          const g = geom as SpurGearGeometry
          const d = c.derived!
          expect(g.twistAngle).toBeCloseTo(d.twist_angle, 12)
          expect(g.r0).toBeCloseTo(d.r0, 12)
          expect(g.ra).toBeCloseTo(d.ra, 12)
          expect(g.rd).toBeCloseTo(d.rd, 12)
          expect(g.rb).toBeCloseTo(d.rb, 12)
          expect(g.rr).toBeCloseTo(d.rr, 12)
          expect(g.tau).toBeCloseTo(d.tau, 12)
        })
      }

      for (const seg of TOOTH_SEGMENTS) {
        it(`齿廓点集 ${seg} 与 Python 逐点一致`, () => {
          const key = `t_${seg}_pts` as keyof NonNullable<ReferenceCase['profile']>
          expectPointsClose(segmentPoints(geom, seg), toVec3(c.profile![key] as number[][]), seg)
        })
      }

      // Python 侧点阵提取报错的类（tooth_face_grids_error）无参考点阵可对比
      if (c.tooth_face_grids_error || !c.tooth_face_grids) {
        it.skip('齿面点阵（rows × cols）与 Python 逐点一致（参考侧提取失败）', () => {})
      } else {
        it('齿面点阵（rows × cols）与 Python 逐点一致', () => {
          // 有 tooth_face_grids 参考数据的必为 Spur 族（Worm 侧提取报错，走上面分支）
          const grids = toothFaceGrids(geom as SpurGearGeometry)
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
      }
    })
  }
})
