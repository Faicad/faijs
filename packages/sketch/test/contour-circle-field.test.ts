/**
 * G6-2 留档（2026-10-06，NO_CONTOUR 桶 67 条的首桶取点 HC-SR04）：
 *
 * circle 半径字段在投影边界两侧拼写不同 —— FCStd 规范模型是 `radius`
 * （`project.ts:170`），canonical 约束模型是 `r`（`canonical.ts:42`）。
 * `extractContours` 的自闭合分支只认 `g.radius`，codegen 以 canonical
 * 形态发射的圆（`{kind:'circle', r}`）被静默丢弃（`undefined > 0` 为
 * false）⇒ 求解收敛却报 E_SKETCHC_NO_CONTOUR。环拓扑判别器
 * （`sketch-loop-topology.ts:77`）用自己的 `g.r` 检查，同一 sketch 在
 * 转换期被判可参数化、在运行期构面失败——两个判据必须一致。
 *
 * 本文件钉住：两种拼写的圆都要自闭合成环；构造圆仍然排除。
 */
import { describe, it, expect } from 'vitest'
import { extractContours } from '../src/contour.js'

describe('extractContours: circle radius 字段双拼写（G6-2 留档）', () => {
  it('FCStd 拼写 radius → 1 个自闭合环', () => {
    const cs = extractContours([{ kind: 'circle', cx: 4.4, cy: 1.6, radius: 0.2 } as never])
    expect(cs).toHaveLength(1)
    expect(cs[0].closed).toBe(true)
    expect(cs[0].segments).toHaveLength(1)
    expect(cs[0].segments[0]).toMatchObject({ kind: 'arc', radius: 0.2 })
  })

  it('canonical 拼写 r（codegen 发射形态，HC-SR04 Sketch008 现场）→ 1 个自闭合环', () => {
    const cs = extractContours([{ kind: 'circle', cx: 4.4, cy: 1.6, r: 0.2 } as never])
    expect(cs).toHaveLength(1)
    expect(cs[0].closed).toBe(true)
  })

  it('半径 0 或缺失 → 不成环（不回归为假环）', () => {
    expect(extractContours([{ kind: 'circle', cx: 0, cy: 0, r: 0 } as never])).toHaveLength(0)
    expect(extractContours([{ kind: 'circle', cx: 0, cy: 0 } as never])).toHaveLength(0)
    expect(extractContours([{ kind: 'circle', cx: 0, cy: 0, radius: 0 } as never])).toHaveLength(0)
  })

  it('构造圆两种拼写都排除（参考几何不是轮廓）', () => {
    expect(
      extractContours([
        { kind: 'circle', cx: 0, cy: 0, r: 5, construction: true } as never,
        { kind: 'circle', cx: 5, cy: 5, radius: 2, construction: true } as never,
      ]),
    ).toHaveLength(0)
  })

  it('混合 sketch：r 圆 + 独立线段 — 圆环独立存在，不受开链影响', () => {
    const cs = extractContours([
      { kind: 'circle', cx: 4.4, cy: 1.6, r: 0.2 } as never,
      { kind: 'line', x1: 0, y1: 0, x2: 1, y2: 0 } as never, // 开链，会被丢弃
    ])
    expect(cs).toHaveLength(1)
    expect(cs[0].segments[0]).toMatchObject({ kind: 'arc', radius: 0.2 })
  })
})
