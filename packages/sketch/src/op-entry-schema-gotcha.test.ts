/**
 * GOTCHA 留档（2026-09-28，fcstd-port P2-1 定性，见 docs/analysis/fcstd-sketch-unsupported-geom.md）：
 *
 * `cad.sketch` op 入口的 canonical schema 比求解链的真实消费能力**窄**：
 * - `assertSketchParams` 只要求 geoms 非空数组（op.ts:79）；
 * - `toFreeCadGeoms`（project.ts:168）对 kind `point` / `ellipse` / `bspline`
 *   直接抛 `E_SKETCHC_UNSUPPORTED_GEOM` —— 但下游 `contour.ts`（bspline 采样、
 *   ellipse 64 弦）与 `planegcs-backend.ts`（point standalone）其实都已有消费路径。
 * 即：ellipse/bspline 到达 op 入口即被拒，不是求解器能力不足，是入口 schema 窄。
 *
 * 空 geoms 则由 `assertSketchParams` 抛 `E_SKETCHC_NO_GEOMS` —— fcstd 端
 * 全 construction / 全被裁剪的草图若不加绕行，运行时就是这个错。
 *
 * 本测试钉住这两个入口行为；若未来放开 ellipse/bspline，应改写断言而非删除。
 */
import { describe, it, expect } from 'vitest'
import { assertSketchParams } from './op.js'
import { toFreeCadGeoms } from './project.js'
import type { SketchGeom } from './canonical.js'

describe('GOTCHA: cad.sketch op entry schema is narrower than the solver chain', () => {
  it('E_SKETCHC_NO_GEOMS: empty geoms rejected at assertSketchParams', () => {
    expect(() => assertSketchParams({ geoms: [] })).toThrow(/E_SKETCHC_NO_GEOMS/)
    expect(() => assertSketchParams({})).toThrow(/E_SKETCHC_NO_GEOMS/)
  })

  it('ellipse is now ACCEPTED at toFreeCadGeoms (reopened 2026-09-28; see ellipse-sketch-e2e.test.ts)', () => {
    // GOTCHA history: ellipse used to be rejected here with
    // E_SKETCHC_UNSUPPORTED_GEOM although contour.ts:178 and
    // planegcs-backend.ts:218 already consumed it — the op-entry schema was
    // narrower than the solver chain. The rejection is now lifted; the
    // round-trip and contour behavior are pinned in ellipse-sketch-e2e.test.ts.
    const geoms = [{
      kind: 'ellipse',
      cx: 0, cy: 0,
      rx: 10, ry: 5, angle: 0,
    }] as unknown as SketchGeom[]
    const out = toFreeCadGeoms(geoms)
    expect(out[0]!.kind).toBe('ellipse')
  })

  it('point is now ACCEPTED at toFreeCadGeoms (reopened 2026-09-28)', () => {
    // planegcs-backend pushes/pulls standalone points; contours skip them.
    const out = toFreeCadGeoms([{ kind: 'point', x: 1, y: 2 } as unknown as SketchGeom])
    expect(out[0]!.kind).toBe('point')
  })

  it('E_SKETCHC_UNSUPPORTED_GEOM: bspline rejected at toFreeCadGeoms although contour.ts samples it', () => {
    const geoms = [{
      kind: 'bspline',
      poles: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }],
      knots: [0, 0, 0, 1, 1, 1],
      degree: 2,
      periodic: false,
      construction: false,
    }] as unknown as SketchGeom[]
    expect(() => toFreeCadGeoms(geoms)).toThrow(/E_SKETCHC_UNSUPPORTED_GEOM/)
    expect(() => toFreeCadGeoms(geoms)).toThrow(/bspline/)
  })

  it('line/circle/arc pass the entry (first-release supported kinds)', () => {
    const geoms: SketchGeom[] = [
      { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      { kind: 'circle', cx: 5, cy: 5, r: 2 },
    ]
    const out = toFreeCadGeoms(geoms)
    expect(out.map((g) => g.kind)).toEqual(['line', 'circle'])
  })
})
