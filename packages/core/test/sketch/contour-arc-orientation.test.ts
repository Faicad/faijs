/**
 * 弧方向 carry-through（2026-10-21，weapp 混合链真几何验证暴露）：
 *   canonical CW 弧（`ccw:false`，如端侧三点画弧的"经过点在上方"情形）经
 *   toFreeCadGeoms → extractContours 后，轮廓段必须仍是 `ccw:false`。
 *   旧行为：project.ts 不带 ccw 扩展字段、contour.ts 硬编码 ccw:true →
 *   CW 弧在挤出/扫掠路径被画成同一端点的逆时针镜像（用户画的凸弧拉伸成凹弧）。
 *   修复：project.ts 把 ccw 作为内部扩展字段传入 Fcstd，contour.ts 优先读它。
 */
import { describe, expect, it } from 'vitest'
import { extractContours, type ContourSeg } from '../../src/sketch/contour.js'
import { toFreeCadGeoms } from '../../src/sketch/project.js'

// 上凸半圆：起点 (20,0) 终点 (30,0) 经过 (25,5)。圆心 (25,0) r=5。
// canonical：a0=π（起点角） a1=0（终点角） ccw=false（经过点角 π/2 在 CCW(π→2π) 外）。
// 变量不标注类型：端点字段（x1/y1/x2/y2）是 canonical 弧之外的携带字段，
// 非字面量赋给 SketchGeom[] 参数时结构化兼容（多余属性不报错）。
const cwArc = {
  kind: 'arc', cx: 25, cy: 0, r: 5, a0: Math.PI, a1: 0, ccw: false,
  x1: 20, y1: 0, x2: 30, y2: 0,
} as const

const ccwArc = {
  kind: 'arc', cx: 25, cy: 0, r: 5, a0: 0, a1: Math.PI, ccw: true,
  x1: 30, y1: 0, x2: 20, y2: 0,
} as const

describe('arc orientation carry-through (2026-10-21)', () => {
  it('toFreeCadGeoms：canonical ccw 以内部扩展字段传入 Fcstd 弧', () => {
    const out = toFreeCadGeoms([cwArc])
    const arc = out[0] as { kind: 'arc'; ccw?: boolean }
    expect(arc.kind).toBe('arc')
    expect(arc.ccw).toBe(false)
    const out2 = toFreeCadGeoms([ccwArc])
    expect((out2[0] as { ccw?: boolean }).ccw).toBe(true)
  })

  it('extractContours：CW 弧（ccw:false）轮廓段保持 ccw:false，且端点顺序不变', () => {
    const fc = toFreeCadGeoms([cwArc])
    const cs = extractContours([...fc, { kind: 'line', x1: 30, y1: 0, x2: 0, y2: 0 }, { kind: 'line', x1: 0, y1: 0, x2: 20, y2: 0 }] as never[])
    expect(cs).toHaveLength(1)
    const arcSeg = cs[0]!.segments.find((s) => s.kind === 'arc') as Extract<ContourSeg, { kind: 'arc' }>
    expect(arcSeg.kind).toBe('arc')
    expect(arcSeg.ccw).toBe(false)
    // 端点顺序跟随 canonical 起点→终点（前段 (20,0) 接弧起点）。
    expect(arcSeg.x1).toBeCloseTo(20, 6)
    expect(arcSeg.y1).toBeCloseTo(0, 6)
    expect(arcSeg.x2).toBeCloseTo(30, 6)
    expect(arcSeg.y2).toBeCloseTo(0, 6)
  })

  it('extractContours：CCW 弧（ccw:true）保持 ccw:true', () => {
    const fc = toFreeCadGeoms([ccwArc])
    const cs = extractContours([...fc, { kind: 'line', x1: 30, y1: 0, x2: 0, y2: 0 }, { kind: 'line', x1: 0, y1: 0, x2: 20, y2: 0 }] as never[])
    expect(cs).toHaveLength(1)
    const arcSeg = cs[0]!.segments.find((s) => s.kind === 'arc') as Extract<ContourSeg, { kind: 'arc' }>
    expect(arcSeg.ccw).toBe(true)
  })

  it('FCStd 导入路径（无 ccw 扩展字段）保持历史默认 ccw:true', () => {
    const cs = extractContours([
      { kind: 'arc', cx: 25, cy: 0, radius: 5, startAngle: Math.PI, endAngle: 0, x1: 20, y1: 0, x2: 30, y2: 0 },
      { kind: 'line', x1: 30, y1: 0, x2: 0, y2: 0 },
      { kind: 'line', x1: 0, y1: 0, x2: 20, y2: 0 },
    ] as never[])
    expect(cs).toHaveLength(1)
    const arcSeg = cs[0]!.segments.find((s) => s.kind === 'arc') as Extract<ContourSeg, { kind: 'arc' }>
    expect(arcSeg.ccw).toBe(true)
  })
})
