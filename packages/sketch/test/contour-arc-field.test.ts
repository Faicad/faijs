/**
 * G6-2b 留档（2026-10-06，NO_CONTOUR「求解漂移」子桶 43 条的首桶取点 HC-SR04 Sketch001）：
 *
 * 复测定性：43 条不是求解漂移——Sketch001 线段端点求解前后漂移为 0。
 * 真正根因与 G6-2 的 circle 修复（2c518d86）同族：**arc 的半径/角度字段
 * 也在投影边界两侧拼写分裂** —— FCStd 形态（`radius`/`startAngle`/
 * `endAngle`，带 x1/y1/x2/y2 端点）vs canonical 形态（`r`/`a0`/`a1`+`ccw`，
 * **无端点字段**）。`contour.ts::segEnds` 的 arc 分支只读 FCStd 拼写 ⇒
 * codegen 发射的 arc 端点为 undefined（NaN 链接）⇒ 求解收敛仍报
 * E_SKETCHC_NO_CONTOUR。转换期环判别器（sketch-loop-topology.ts）用自己的
 * `g.r`/`g.a0` 读取，同一 sketch 被判可参数化——判据再次分裂。
 *
 * 本文件钉住：两种拼写的 arc 都要参与链化成环；端点缺失时由圆心/半径/角度
 * 静态计算；FCStd 形态携带的显式端点优先。
 */
import { describe, it, expect } from 'vitest'
import { extractContours } from '../src/contour.js'

// HC-SR04 Sketch001 的原样几何（canonical arc：r/a0/a1/ccw，无端点字段）
const CANON_SKETCH001 = [
  { kind: 'line', x1: 0, y1: 4.24, x2: -1, y2: 4.24 },
  { kind: 'line', x1: -2, y1: 3.24, x2: -2, y2: 1.48 },
  { kind: 'line', x1: -2.2, y1: 1.28, x2: -2.2, y2: 0.64 },
  { kind: 'line', x1: 0, y1: 4.24, x2: 0, y2: 0.64 },
  { kind: 'arc', cx: -1, cy: 3.24, r: 1, a0: 1.570796326795, a1: 3.14159265359, ccw: true },
  { kind: 'arc', cx: -2.2, cy: 1.48, r: 0.2, a0: 4.712388980385, a1: 6.28318530718, ccw: true },
  { kind: 'line', x1: -2.2, y1: 0.64, x2: 0, y2: 0.64 },
] as never[]

describe('segEnds arc 字段双拼写（G6-2b 留档）', () => {
  it('canonical arc（r/a0/a1，无端点字段）→ 端点静态计算，Sketch001 原样成 1 环', () => {
    const cs = extractContours(CANON_SKETCH001)
    expect(cs).toHaveLength(1)
    expect(cs[0].closed).toBe(true)
    expect(cs[0].segments).toHaveLength(7)
  })

  it('FCStd arc（radius/startAngle/endAngle + 显式端点）→ 仍正常成环', () => {
    // 与 canonical 版同一几何，端点由圆心/半径/角度预计算后显式携带
    const cs = extractContours([
      { kind: 'line', x1: 0, y1: 4.24, x2: -1, y2: 4.24 },
      { kind: 'line', x1: -2, y1: 3.24, x2: -2, y2: 1.48 },
      { kind: 'line', x1: -2.2, y1: 1.28, x2: -2.2, y2: 0.64 },
      { kind: 'line', x1: 0, y1: 4.24, x2: 0, y2: 0.64 },
      { kind: 'arc', cx: -1, cy: 3.24, radius: 1, startAngle: 1.570796326795, endAngle: 3.14159265359, x1: -1, y1: 4.24, x2: -2, y2: 3.24 },
      { kind: 'arc', cx: -2.2, cy: 1.48, radius: 0.2, startAngle: 4.712388980385, endAngle: 6.28318530718, x1: -2.2, y1: 1.28, x2: -2.0, y2: 1.48 },
      { kind: 'line', x1: -2.2, y1: 0.64, x2: 0, y2: 0.64 },
    ] as never)
    expect(cs).toHaveLength(1)
    expect(cs[0].closed).toBe(true)
  })

  it('半径/角度字段缺失 → 该段不进池（不产 NaN 链）', () => {
    const cs = extractContours([
      { kind: 'arc', cx: 0, cy: 0 } as never, // 无任何半径/角度
      { kind: 'line', x1: 0, y1: 0, x2: 1, y2: 0 } as never,
    ])
    expect(cs).toHaveLength(0)
  })

  it('r 圆 + canonical arc 混合（G6-2 + G6-2b 双修复叠加）', () => {
    const cs = extractContours([
      { kind: 'circle', cx: 10, cy: 10, r: 0.5 } as never,
      ...CANON_SKETCH001,
    ])
    expect(cs).toHaveLength(2) // 圆自闭合 1 环 + Sketch001 1 环
  })
})
