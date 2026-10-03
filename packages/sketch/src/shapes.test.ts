/**
 * shapes — 语义图元展开/写回的纯几何测试（不经 wasm、不经宿主）。
 *
 * 覆盖三类不变量：
 * 1. **展开确定**：几何条数、tag 规则、形状自带约束的种类与顺序；
 * 2. **与既有实现的等价**：`rect` 的展开 == 3d_editor 既有矩形命令（4 线 + 4 重合 +
 *    底/顶水平 + 右/左垂直，见 sketch-draft.ts 的 makeRectangle）；
 * 3. **写回闭环**：`dragShapeHandle(shape, handle, to)` 改写形状参数后，`shapeHandles`
 *    报告的手柄位置随之跟上（拖哪个手柄 = 改哪个参数）。
 */
import { describe, it, expect } from 'vitest'
import {
  arcSweep,
  clampedUniformKnots,
  dragShapeHandle,
  expandShapes,
  handleForGeomControl,
  nextShapeTag,
  rectCorners,
  regularPolygonVertices,
  shapeHandles,
  SketchShapeError,
  slotOutline,
  trapezoidCorners,
  type SketchShape,
} from './shapes.js'
import type { SketchConstraint } from './canonical.js'

/** 断言回调抛出的 SketchShapeError 的错误码。 */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(SketchShapeError)
    expect((error as SketchShapeError).code).toBe(code)
    return
  }
  throw new Error(`expected ${code}, but nothing was thrown`)
}

describe('expandShapes — tag 规则', () => {
  it('罐头形状的派生 tag 是 <形状名>.<下标>，编号不复用', () => {
    const e = expandShapes([{ kind: 'rect', tag: 'g0', w: 10, d: 20 }])
    expect(e.geoms.map((g) => g.tag)).toEqual(['g0.0', 'g0.1', 'g0.2', 'g0.3'])
    expect(e.nextTag).toBe(1)
    expect(e.spans).toHaveLength(1)
    expect(e.spans[0]).toMatchObject({ kind: 'rect', tag: 'g0', start: 0, count: 4 })
  })

  it('没给 tag 时自动分配 g<N>（N = 既有最大编号 + 1）', () => {
    const e = expandShapes([
      { kind: 'rect', tag: 'g3', w: 10, d: 10 },
      { kind: 'circle', r: 2 },
    ])
    expect(e.spans[1]!.tag).toBe('g4')
    expect(e.geoms[4]!.tag).toBe('g4.0')
    expect(e.nextTag).toBe(5)
  })

  it('显式 tag 出现在后面也不影响前面的自动编号（编号与顺序无关）', () => {
    const e = expandShapes([
      { kind: 'circle', r: 1 },
      { kind: 'rect', tag: 'g9', w: 1, d: 1 },
    ])
    // 自动分配必须避开 g9（否则 g9 的那几个 geom 会和自动名撞车）。
    expect(e.spans[0]!.tag).toBe('g10')
    expect(e.spans[1]!.tag).toBe('g9')
  })

  it('画笔图元的 tag 就是它自己那个 geom', () => {
    const e = expandShapes([{ kind: 'line', tag: 'base', from: [0, 0], to: [1, 1] }])
    expect(e.geoms.map((g) => g.tag)).toEqual(['base'])
  })

  it('nextShapeTag 只看形状名，不复用已删除的编号', () => {
    expect(nextShapeTag([{ kind: 'rect', tag: 'g0', w: 1, d: 1 }])).toBe('g1')
    expect(nextShapeTag([{ kind: 'rect', tag: 'g7', w: 1, d: 1 }])).toBe('g8')
    expect(nextShapeTag([])).toBe('g1')
  })
})

describe('expandShapes — rect 与 3d_editor 既有矩形命令等价', () => {
  it('4 条线 + 4 个角重合 + 底/顶水平 + 右/左垂直（顺序一致）', () => {
    const e = expandShapes([{ kind: 'rect', tag: 'g3', w: 10, d: 20, cx: 5, cy: -5 }])
    expect(e.geoms.map((g) => g.kind)).toEqual(['line', 'line', 'line', 'line'])
    // 角点：左下 → 右下 → 右上 → 左上（平移到中心 (5,-5)）
    expect(e.geoms.map((g) => [g.kind === 'line' ? g.x1 : NaN, g.kind === 'line' ? g.y1 : NaN])).toEqual([
      [0, -15], [10, -15], [10, 5], [0, 5],
    ])
    expect(e.constraints).toEqual([
      { kind: 'coincident', a: { tag: 'g3.0', at: 'end' }, b: { tag: 'g3.1', at: 'start' } },
      { kind: 'coincident', a: { tag: 'g3.1', at: 'end' }, b: { tag: 'g3.2', at: 'start' } },
      { kind: 'coincident', a: { tag: 'g3.2', at: 'end' }, b: { tag: 'g3.3', at: 'start' } },
      { kind: 'coincident', a: { tag: 'g3.3', at: 'end' }, b: { tag: 'g3.0', at: 'start' } },
      { kind: 'horizontal', of: { tag: 'g3.0' } },
      { kind: 'horizontal', of: { tag: 'g3.2' } },
      { kind: 'vertical', of: { tag: 'g3.1' } },
      { kind: 'vertical', of: { tag: 'g3.3' } },
    ])
  })

  it('rectCorners 返回左下起、逆时针的四角', () => {
    expect(rectCorners(4, 2, 1, 1)).toEqual([[-1, 0], [3, 0], [3, 2], [-1, 2]])
  })
})

describe('expandShapes — 其余罐头形状', () => {
  it('circle：1 个 circle geom、无自带约束', () => {
    const e = expandShapes([{ kind: 'circle', r: 3, cx: 1, cy: 2 }])
    expect(e.geoms).toEqual([{ tag: 'g1.0', kind: 'circle', cx: 1, cy: 2, r: 3 }])
    expect(e.constraints).toEqual([])
  })

  it('ellipse：带 angle 时写入 angle（缺省不写）', () => {
    expect(expandShapes([{ kind: 'ellipse', rx: 4, ry: 2 }]).geoms[0]).toMatchObject({ kind: 'ellipse' })
    expect(expandShapes([{ kind: 'ellipse', rx: 4, ry: 2 }]).geoms[0]).not.toHaveProperty('angle')
    expect(expandShapes([{ kind: 'ellipse', rx: 4, ry: 2, angle: Math.PI / 6 }]).geoms[0])
      .toMatchObject({ angle: Math.PI / 6 })
  })

  it('polygon：n 条线 + n 个角重合 + (n-1) 条等长，顶点都在外接圆上', () => {
    const e = expandShapes([{ kind: 'polygon', n: 5, r: 10, cx: 1, cy: -1, angle: 0.3 }])
    expect(e.geoms).toHaveLength(5)
    const verts = e.geoms.map((g) => {
      if (g.kind !== 'line') throw new Error('polygon must expand to lines')
      return [g.x1, g.y1] as const
    })
    for (const [x, y] of verts) {
      expect(Math.hypot(x - 1, y + 1)).toBeCloseTo(10, 9)
    }
    const coincidents = e.constraints.filter((c) => c.kind === 'coincident')
    const equals = e.constraints.filter((c) => c.kind === 'equal')
    expect(coincidents).toHaveLength(5)
    expect(equals).toHaveLength(4)
  })

  it('regularPolygonVertices(π/2, ccw=false) 与 CadQuery 的 sin/cos 约定逐点一致', () => {
    // CadQuery `Sketch.regularPolygon(r, n)`：首顶点在 +Y，顺时针。
    const r = 3
    const n = 5
    const mine = regularPolygonVertices(r, n, Math.PI / 2, false)
    const cadquery = Array.from({ length: n }, (_, i) => {
      const a = (i * 2 * Math.PI) / n
      return [r * Math.sin(a), r * Math.cos(a)] as const
    })
    expect(mine).toHaveLength(n)
    for (let i = 0; i < n; i++) {
      expect(mine[i]![0]).toBeCloseTo(cadquery[i]![0], 12)
      expect(mine[i]![1]).toBeCloseTo(cadquery[i]![1], 12)
    }
    // 默认（ccw）：首顶点在 angle 方向
    expect(regularPolygonVertices(1, 4, 0)[0]![0]).toBeCloseTo(1, 12)
    expect(regularPolygonVertices(1, 4, 0)[0]![1]).toBeCloseTo(0, 12)
    expect(regularPolygonVertices(1, 4, Math.PI / 2)[0]![1]).toBeCloseTo(1, 12)
  })

  it('slot：两条直边 + 两个半圆，总长 = w + d、总高 = d', () => {
    const e = expandShapes([{ kind: 'slot', w: 8, d: 4, cx: 2, cy: 2 }])
    expect(e.geoms.map((g) => g.kind)).toEqual(['line', 'arc', 'line', 'arc'])
    const o = slotOutline(8, 4, 2, 2)
    expect(o.bottom).toEqual([[2 - 4, 0], [2 + 4, 0]])
    expect(o.rightArc).toMatchObject({ c: [6, 2], r: 2 })
    // 端部半圆的最远点 = 中心 ± (w/2 + r)
    expect(o.rightArc.c[0] + o.rightArc.r).toBeCloseTo(2 + 4 + 2, 12)
    const radii = e.constraints.filter((c) => c.kind === 'radius')
    expect(radii).toEqual([
      { kind: 'radius', of: { tag: 'g1.1' }, value: 2 },
      { kind: 'radius', of: { tag: 'g1.3' }, value: 2 },
    ])
  })

  it('trapezoid：底宽/高/两个底角（弧度），a2 缺省等于 a1', () => {
    const e = expandShapes([{ kind: 'trapezoid', w: 10, h: 5, a1: Math.PI / 4 }])
    expect(e.geoms).toHaveLength(4)
    const c = trapezoidCorners(10, 5, Math.PI / 4, Math.PI / 4)
    // tan(π/4) 带浮点误差 → 逐坐标用 closeTo 比较。
    const expected: [number, number][] = [[-5, -2.5], [5, -2.5], [0, 2.5], [0, 2.5]]
    for (let i = 0; i < 4; i++) {
      expect(c[i]![0]).toBeCloseTo(expected[i]![0], 9)
      expect(c[i]![1]).toBeCloseTo(expected[i]![1], 9)
    }
    for (const g of e.geoms) {
      if (g.kind !== 'line') throw new Error('trapezoid expands to lines')
      expect(Number.isNaN(g.x1 + g.y1)).toBe(false)
    }
    const angles = e.constraints.filter((c2) => c2.kind === 'angle')
    // 两个底角用显式 `at` 挑方向：planegcs 的 l2l_angle_pppp 值是
    // **dir(b) − dir(a) 的有向差**（实测见 shapes-solve.test.ts 的探针），
    // 所以"内角 = a1/a2"必须把两条线的方向挑出来：
    //   左下角：底边正向(+X) → 左腰向上（几何按 tl→bl 存，取 at:'end' 反向）
    //   右下角：右腰向上（几何按 br→tr 存，正向即向上）→ 底边反向(−X)
    expect(angles).toEqual([
      { kind: 'angle', a: { tag: 'g1.0', at: 'start' }, b: { tag: 'g1.3', at: 'end' }, value: Math.PI / 4 },
      { kind: 'angle', a: { tag: 'g1.1', at: 'start' }, b: { tag: 'g1.0', at: 'end' }, value: Math.PI / 4 },
    ])
  })

  it('roundedRect：4 直边 + 4 圆角弧，4 条 radius 钉住圆角半径', () => {
    const e = expandShapes([{ kind: 'roundedRect', w: 20, d: 10, r: 2 }])
    expect(e.geoms.map((g) => g.kind)).toEqual([
      'line', 'arc', 'line', 'arc', 'line', 'arc', 'line', 'arc',
    ])
    const arcs = e.geoms.filter((g) => g.kind === 'arc')
    for (const a of arcs) {
      if (a.kind !== 'arc') throw new Error('narrowing')
      expect(a.r).toBeCloseTo(2, 12)
      expect(Math.abs(a.a1 - a.a0)).toBeCloseTo(Math.PI / 2, 12)
      expect(a.ccw).toBe(true)
    }
    expect(e.constraints.filter((c) => c.kind === 'radius')).toHaveLength(4)
    expect(e.constraints.filter((c) => c.kind === 'horizontal')).toHaveLength(2)
    expect(e.constraints.filter((c) => c.kind === 'vertical')).toHaveLength(2)
  })
})

describe('expandShapes — 画笔图元与 close', () => {
  it('line/arc/point 直通', () => {
    const e = expandShapes([
      { kind: 'line', tag: 'a', from: [0, 0], to: [10, 0] },
      { kind: 'arc', tag: 'b', cx: 0, cy: 0, r: 5, a0: 0, a1: Math.PI / 2 },
      { kind: 'point', tag: 'p', x: 1, y: 2 },
    ])
    expect(e.geoms.map((g) => g.kind)).toEqual(['line', 'arc', 'point'])
    expect(e.geoms[1]).toMatchObject({ cx: 0, cy: 0, r: 5, a0: 0, a1: Math.PI / 2 })
  })

  it('bspline：控制点 + 钳位均匀节点（长度 = 点数 + 次数 + 1）', () => {
    const e = expandShapes([{ kind: 'bspline', tag: 'sp', pts: [[0, 0], [1, 2], [3, 3]] }])
    const g = e.geoms[0]!
    if (g.kind !== 'bspline') throw new Error('expected bspline')
    expect(g.degree).toBe(2)
    expect(g.poles).toEqual([{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 3, y: 3 }])
    expect(g.knots).toEqual(clampedUniformKnots(3, 2))
    expect(g.knots).toHaveLength(3 + 2 + 1)
  })

  it('close：未闭合的链补一条回到链首的直线', () => {
    const e = expandShapes([
      { kind: 'line', tag: 'a', from: [0, 0], to: [10, 0] },
      { kind: 'line', tag: 'b', from: [10, 0], to: [10, 5] },
      { kind: 'close' },
    ])
    expect(e.geoms).toHaveLength(3)
    expect(e.geoms[2]).toMatchObject({ kind: 'line', x1: 10, y1: 5, x2: 0, y2: 0 })
    expect(e.spans[2]).toMatchObject({ kind: 'close', count: 1 })
  })

  it('close：链首尾本来就重合时不再补边', () => {
    const e = expandShapes([
      { kind: 'line', tag: 'a', from: [0, 0], to: [10, 0] },
      { kind: 'line', tag: 'b', from: [10, 0], to: [0, 0] },
      { kind: 'close' },
    ])
    expect(e.geoms).toHaveLength(2)
    expect(e.spans[2]).toMatchObject({ kind: 'close', count: 0 })
  })

  it('close.ref：回收到指定形状的起点（只算到它为止）', () => {
    const e = expandShapes([
      { kind: 'line', tag: 'a', from: [0, 0], to: [10, 0] },
      { kind: 'line', tag: 'b', from: [10, 0], to: [10, 5] },
      { kind: 'line', tag: 'c', from: [10, 5], to: [20, 5] },
      { kind: 'close', ref: 'a' },
    ])
    // 回到 a 的起点 (0,0)，但这会跨过 b —— 语义就是"闭合到 a 起点"，几何照写。
    expect(e.geoms[3]).toMatchObject({ kind: 'line', x1: 20, y1: 5, x2: 0, y2: 0 })
  })

  it('close 没有链 / ref 指向非画笔形状 → 显式报错', () => {
    expectCode(() => expandShapes([{ kind: 'close' }]), 'E_SKETCHC_CLOSE_NO_CHAIN')
    expectCode(
      () => expandShapes([
        { kind: 'rect', tag: 'r', w: 1, d: 1 },
        { kind: 'close', ref: 'r' },
      ]),
      'E_SKETCHC_CLOSE_BAD_REF',
    )
  })

  it('close 只收"紧跟其前"的连续画笔链（中间隔着罐头形状就断开）', () => {
    expectCode(
      () => expandShapes([
        { kind: 'line', tag: 'a', from: [0, 0], to: [1, 0] },
        { kind: 'circle', tag: 'c', r: 1 },
        { kind: 'close' },
      ]),
      'E_SKETCHC_CLOSE_NO_CHAIN',
    )
  })
})

describe('expandShapes — 模式与校验', () => {
  it("mode 'c' 与 construction:true 等价（打上 construction 标记）", () => {
    const byMode = expandShapes([{ kind: 'circle', r: 1, mode: 'c' }])
    const byFlag = expandShapes([{ kind: 'circle', r: 1, construction: true }])
    expect(byMode.geoms[0]).toMatchObject({ construction: true })
    expect(byMode.geoms).toEqual(byFlag.geoms)
  })

  it("mode 's' 记入 subtractRanges（孔的几何身份由轮廓包含关系决定）", () => {
    const e = expandShapes([
      { kind: 'rect', tag: 'r', w: 10, d: 10 },
      { kind: 'circle', tag: 'h', r: 2, mode: 's' },
    ])
    expect(e.subtractRanges).toEqual([{ index: 1, start: 4, count: 1 }])
  })

  it("mode 'i' / 'r' 第一版显式报错（不静默降级）", () => {
    expectCode(() => expandShapes([{ kind: 'rect', w: 1, d: 1, mode: 'i' }]), 'E_SKETCHC_UNSUPPORTED_MODE')
    expectCode(() => expandShapes([{ kind: 'rect', w: 1, d: 1, mode: 'r' }]), 'E_SKETCHC_UNSUPPORTED_MODE')
  })

  it('单条边声明 subtract → 显式报错（它不是区域）', () => {
    expectCode(
      () => expandShapes([{ kind: 'line', from: [0, 0], to: [1, 0], mode: 's' }]),
      'E_SKETCHC_SHAPE_MODE_NOT_APPLICABLE',
    )
  })

  it('非法参数 → E_SKETCHC_SHAPE_BAD_PARAM', () => {
    expectCode(() => expandShapes([{ kind: 'rect', w: 0, d: 1 }]), 'E_SKETCHC_SHAPE_BAD_PARAM')
    expectCode(() => expandShapes([{ kind: 'circle', r: -1 }]), 'E_SKETCHC_SHAPE_BAD_PARAM')
    expectCode(() => expandShapes([{ kind: 'polygon', n: 2, r: 1 }]), 'E_SKETCHC_SHAPE_BAD_PARAM')
    expectCode(
      () => expandShapes([{ kind: 'roundedRect', w: 4, d: 4, r: 3 }]),
      'E_SKETCHC_SHAPE_BAD_PARAM',
    )
    expectCode(
      () => expandShapes([{ kind: 'trapezoid', w: 1, h: 1, a1: 0 }]),
      'E_SKETCHC_SHAPE_BAD_PARAM',
    )
    expectCode(() => expandShapes([{ kind: 'bspline', pts: [[0, 0]] }]), 'E_SKETCHC_SHAPE_BAD_PARAM')
  })
})

describe('shapeHandles — 手柄清单', () => {
  it('rect：四角 + 四边中点 + 中心（角顺序同展开，左下起逆时针）', () => {
    const h = shapeHandles({ kind: 'rect', w: 10, d: 10 })
    expect(h.map((x) => x.kind)).toEqual([
      'corner', 'corner', 'corner', 'corner', 'edge', 'edge', 'edge', 'edge', 'center',
    ])
    expect(h[0]!.point).toEqual([-5, -5])
    expect(h[1]!.point).toEqual([5, -5])
    expect(h[2]!.point).toEqual([5, 5])
    expect(h[3]!.point).toEqual([-5, 5])
    expect(h[4]!.point).toEqual([0, -5])
    expect(h[8]!.point).toEqual([0, 0])
  })

  it('circle / ellipse / polygon / line / arc / point 的布局', () => {
    expect(shapeHandles({ kind: 'circle', r: 3, cx: 1, cy: 2 }).map((h) => h.kind))
      .toEqual(['center', 'radius'])
    expect(shapeHandles({ kind: 'ellipse', rx: 4, ry: 2 }).map((h) => h.kind))
      .toEqual(['center', 'radius', 'radius'])
    expect(shapeHandles({ kind: 'polygon', n: 5, r: 2 }).map((h) => h.kind))
      .toEqual(['center', 'vertex', 'vertex', 'vertex', 'vertex', 'vertex'])
    expect(shapeHandles({ kind: 'line', from: [0, 0], to: [4, 0] }).map((h) => h.kind))
      .toEqual(['start', 'end', 'mid'])
    expect(shapeHandles({ kind: 'arc', cx: 0, cy: 0, r: 1, a0: 0, a1: Math.PI / 2 }).map((h) => h.kind))
      .toEqual(['center', 'start', 'end', 'mid'])
    // 弧的中点落在弧上（角度 = 扫掠一半）
    const arcHandles = shapeHandles({ kind: 'arc', cx: 0, cy: 0, r: 1, a0: 0, a1: Math.PI / 2 })
    expect(arcHandles[3]!.point[0]).toBeCloseTo(Math.cos(Math.PI / 4), 12)
    expect(arcHandles[3]!.point[1]).toBeCloseTo(Math.sin(Math.PI / 4), 12)
    expect(shapeHandles({ kind: 'point', x: 1, y: 1 }).map((h) => h.kind)).toEqual(['start'])
    expect(shapeHandles({ kind: 'close' })).toEqual([])
  })

  it('slot / roundedRect / trapezoid 只有中心手柄（v1 只支持平移）', () => {
    expect(shapeHandles({ kind: 'slot', w: 4, d: 2 })).toEqual([{ point: [0, 0], kind: 'center' }])
    expect(shapeHandles({ kind: 'roundedRect', w: 4, d: 2, r: 0.5 }))
      .toEqual([{ point: [0, 0], kind: 'center' }])
    expect(shapeHandles({ kind: 'trapezoid', w: 4, h: 2, a1: 1 }))
      .toEqual([{ point: [0, 0], kind: 'center' }])
  })
})

describe('dragShapeHandle — 拖拽写回', () => {
  it('拖矩形的角 → 对角不动、这一角跟手（仍是矩形）', () => {
    // 角 0 = 左下 (-5,-5)；对角 = 角 2 = (5,5)
    const out = dragShapeHandle({ kind: 'rect', w: 10, d: 10 }, 0, [-5, -10])
    expect(out).toMatchObject({ kind: 'rect', w: 10, d: 15, cx: 0, cy: -2.5 })
  })

  it('拖矩形的边 → 那条边跟手、对边不动', () => {
    // 边 0 = 底边中点 (0,-5) → 拖到 y=-10：顶边 (y=5) 不动
    expect(dragShapeHandle({ kind: 'rect', w: 10, d: 10 }, 4, [0, -10]))
      .toMatchObject({ kind: 'rect', w: 10, d: 15, cx: 0, cy: -2.5 })
    // 边 1 = 右边中点 (5,0) → 拖到 x=12：左边 (x=-5) 不动
    expect(dragShapeHandle({ kind: 'rect', w: 10, d: 10 }, 5, [12, 0]))
      .toMatchObject({ kind: 'rect', w: 17, d: 10, cx: 3.5, cy: 0 })
  })

  it('拖中心 → 整体平移', () => {
    expect(dragShapeHandle({ kind: 'rect', w: 10, d: 10 }, 8, [3, 4]))
      .toMatchObject({ kind: 'rect', w: 10, d: 10, cx: 3, cy: 4 })
    expect(dragShapeHandle({ kind: 'slot', w: 4, d: 2 }, 0, [1, 1]))
      .toMatchObject({ kind: 'slot', w: 4, d: 2, cx: 1, cy: 1 })
  })

  it('拖圆的半径手柄 → 半径变、圆心不动', () => {
    expect(dragShapeHandle({ kind: 'circle', cx: 1, cy: 1, r: 4 }, 1, [8, 1]))
      .toMatchObject({ kind: 'circle', cx: 1, cy: 1, r: 7 })
    expectCode(
      () => dragShapeHandle({ kind: 'circle', cx: 1, cy: 1, r: 4 }, 1, [1, 1]),
      'E_SKETCHC_SHAPE_BAD_PARAM',
    )
  })

  it('拖正多边形的顶点 → 半径与首顶点角跟着变，边数不变', () => {
    const out = dragShapeHandle({ kind: 'polygon', n: 4, r: 10, angle: 0 }, 1, [0, 20])
    expect(out).toMatchObject({ kind: 'polygon', n: 4 })
    const p = out as Extract<SketchShape, { kind: 'polygon' }>
    expect(p.r).toBeCloseTo(20, 9)
    expect(p.angle).toBeCloseTo(Math.PI / 2, 9)
  })

  it('拖弧的中点手柄 → 只改半径（两端角度不动）', () => {
    // 中点手柄在 45° 方向；拖到 (2,0) → 半径变 2，两端角度保持。
    const out = dragShapeHandle({ kind: 'arc', cx: 0, cy: 0, r: 1, a0: 0, a1: Math.PI / 2 }, 3, [2, 0])
    expect(out).toMatchObject({ kind: 'arc', a0: 0, a1: Math.PI / 2 })
    expect((out as Extract<SketchShape, { kind: 'arc' }>).r).toBeCloseTo(2, 12)
    // 拖到圆心 = 退化 → 显式报错
    expectCode(
      () => dragShapeHandle({ kind: 'arc', cx: 0, cy: 0, r: 1, a0: 0, a1: Math.PI / 2 }, 3, [0, 0]),
      'E_SKETCHC_SHAPE_BAD_PARAM',
    )
  })

  it('拖成退化几何 → E_SKETCHC_SHAPE_BAD_PARAM；手柄越界 → EDIT_MISMATCH', () => {
    expectCode(
      () => dragShapeHandle({ kind: 'rect', w: 10, d: 10 }, 0, [5, 5]),
      'E_SKETCHC_SHAPE_BAD_PARAM',
    )
    expectCode(
      () => dragShapeHandle({ kind: 'circle', r: 1 }, 9, [0, 0]),
      'E_SKETCHC_SHAPE_EDIT_MISMATCH',
    )
  })
})

describe('handleForGeomControl — 派生几何控制点 → 形状手柄', () => {
  it('rect：第 k 条线的 start/end 是角 k / 角 k+1，mid 是边 k', () => {
    const rect: SketchShape = { kind: 'rect', w: 10, d: 10 }
    expect(handleForGeomControl(rect, 0, 'start')).toBe(0)
    expect(handleForGeomControl(rect, 0, 'end')).toBe(1)
    expect(handleForGeomControl(rect, 0, 'mid')).toBe(4)
    expect(handleForGeomControl(rect, 3, 'end')).toBe(0)
  })

  it('polygon：第 i 条线的 start/end 是顶点 i / i+1；mid 不支持', () => {
    const polygon: SketchShape = { kind: 'polygon', n: 5, r: 2 }
    expect(handleForGeomControl(polygon, 1, 'start')).toBe(2)
    expect(handleForGeomControl(polygon, 4, 'end')).toBe(1)
    expectCode(() => handleForGeomControl(polygon, 1, 'mid'), 'E_SKETCHC_SHAPE_EDIT_UNSUPPORTED')
  })

  it('line / arc / point / circle 与自身手柄一一对应', () => {
    expect(handleForGeomControl({ kind: 'line', from: [0, 0], to: [1, 1] }, 0, 'start')).toBe(0)
    expect(handleForGeomControl({ kind: 'line', from: [0, 0], to: [1, 1] }, 0, 'mid')).toBe(2)
    expect(handleForGeomControl({ kind: 'arc', cx: 0, cy: 0, r: 1, a0: 0, a1: 1 }, 0, 'mid')).toBe(3)
    expect(handleForGeomControl({ kind: 'point', x: 0, y: 0 }, 0, 'start')).toBe(0)
    expect(handleForGeomControl({ kind: 'circle', r: 1 }, 0, 'center')).toBe(0)
    expect(handleForGeomControl({ kind: 'circle', r: 1 }, 0, 'radius')).toBe(1)
  })

  it('拖不动的形状/控制点 → 显式报不支持（不静默变形）', () => {
    expectCode(
      () => handleForGeomControl({ kind: 'slot', w: 4, d: 2 }, 0, 'mid'),
      'E_SKETCHC_SHAPE_EDIT_UNSUPPORTED',
    )
    expectCode(
      () => handleForGeomControl({ kind: 'roundedRect', w: 4, d: 2, r: 0.5 }, 1, 'center'),
      'E_SKETCHC_SHAPE_EDIT_UNSUPPORTED',
    )
    expectCode(
      () => handleForGeomControl({ kind: 'trapezoid', w: 4, h: 2, a1: 1 }, 0, 'corner' as never),
      'E_SKETCHC_SHAPE_EDIT_UNSUPPORTED',
    )
    expectCode(
      () => handleForGeomControl({ kind: 'bspline', pts: [[0, 0], [1, 1]] }, 0, 'start'),
      'E_SKETCHC_SHAPE_EDIT_UNSUPPORTED',
    )
  })
})

describe('拖拽 ↔ 展开闭环（每个可拖手柄都能落到展开结果上）', () => {
  const CASES: SketchShape[] = [
    { kind: 'rect', tag: 'r', w: 12, d: 7, cx: 3, cy: -2 },
    { kind: 'circle', tag: 'c', r: 3, cx: 1, cy: 1 },
    { kind: 'ellipse', tag: 'e', rx: 4, ry: 2, cx: -1, cy: 2, angle: 0.4 },
    { kind: 'polygon', tag: 'p', n: 6, r: 5, cx: 2, cy: 2, angle: 0.2 },
    { kind: 'roundedRect', tag: 'rr', w: 12, d: 8, r: 1.5 },
    { kind: 'slot', tag: 's', w: 6, d: 3 },
    { kind: 'line', tag: 'l', from: [0, 0], to: [3, 4] },
    { kind: 'arc', tag: 'a', cx: 0, cy: 0, r: 2, a0: 0, a1: 1, ccw: true },
    { kind: 'point', tag: 'pt', x: 1, y: 1 },
    { kind: 'bspline', tag: 'sp', pts: [[0, 0], [1, 1], [2, 0]] },
  ]

  for (const shape of CASES) {
    it(`${shape.kind}：每个手柄都能拖、拖完还能展开（tag 不变）`, () => {
      const before = expandShapes([shape])
      const handles = shapeHandles(shape)
      expect(handles.length).toBeGreaterThan(0)
      for (let i = 0; i < handles.length; i++) {
        // 平移式拖拽：把手柄整体挪 (1, 2)，退化风险最小。
        const to: [number, number] = [handles[i]!.point[0] + 1, handles[i]!.point[1] + 2]
        const dragged = dragShapeHandle(shape, i, to)
        const after = expandShapes([dragged])
        expect(after.geoms.map((g) => g.tag)).toEqual(before.geoms.map((g) => g.tag))
        expect(after.geoms).toHaveLength(before.geoms.length)
      }
    })
  }

  it('参数精确闭环：rect/circle/line 拖回原值得到原几何', () => {
    for (const shape of [
      { kind: 'rect', tag: 'r', w: 12, d: 7, cx: 3, cy: -2 },
      { kind: 'circle', tag: 'c', r: 3, cx: 1, cy: 1 },
      { kind: 'line', tag: 'l', from: [0, 0], to: [3, 4] },
    ] as SketchShape[]) {
      const before = expandShapes([shape])
      const handles = shapeHandles(shape)
      const centerIndex = handles.length - 1
      const at = handles[centerIndex]!.point
      const dragged = dragShapeHandle(shape, centerIndex, at)
      expect(dragged).toEqual(shape)
      expect(expandShapes([dragged]).geoms).toEqual(before.geoms)
    }
  })
})

describe('expandShapes — 综合：矩形 + 画笔链 + 闭合 + 减孔', () => {
  it('展开顺序、owners 与 subtractRanges 自洽', () => {
    const shapes: SketchShape[] = [
      { kind: 'rect', tag: 'g0', w: 100, d: 60 },
      { kind: 'line', tag: 'g4', from: [110, 0], to: [130, 30] },
      { kind: 'close' },
      { kind: 'circle', tag: 'hole', r: 10, cx: 30, cy: 20, mode: 's' },
    ]
    const e = expandShapes(shapes)
    expect(e.geoms.map((g) => g.tag)).toEqual([
      'g0.0', 'g0.1', 'g0.2', 'g0.3', 'g4', 'g5', 'hole.0',
    ])
    expect(e.spans.map((s) => s.kind)).toEqual(['rect', 'line', 'close', 'circle'])
    expect(e.owners).toEqual([0, 0, 0, 0, 1, 2, 3])
    expect(e.subtractRanges).toEqual([{ index: 3, start: 6, count: 1 }])
    // 用户约束写的是派生 tag（与 §3.2 示例同形）
    const userConstraint: SketchConstraint = { kind: 'length', of: { tag: 'g4' }, value: 40 }
    expect(e.geoms.some((g) => g.tag === (userConstraint.of as { tag: string }).tag)).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// arcSweep — 弧扫角规则的唯一实现（2026-10-03 从 3d_editor 的 `arcSpan` 收归库面）
// ────────────────────────────────────────────────────────────────────────────
//
// 这组用例把 3d_editor `sketch-draft.ts` 原 `arcSpan` 的全部边界搬过来，防"收归之后
// 语义悄悄变了"。宿主采样折线、core `adapt.ts` 建弧、cadquery 三点弧三处共用这一条规则。

describe('arcSweep — 有符号扫角（方向由 ccw 决定，与 adapt.ts 同解）', () => {
  it('ccw 显式：逆时针为正、顺时针为负，绝对值同', () => {
    expect(arcSweep(0, Math.PI / 2, true)).toBeCloseTo(Math.PI / 2, 12)
    expect(arcSweep(0, Math.PI / 2, false)).toBeCloseTo(-3 * Math.PI / 2, 12)
  })

  it('ccw 缺省按 a1 > a0 推断（canonical 的既有约定）', () => {
    expect(arcSweep(0, Math.PI / 2, undefined)).toBeCloseTo(Math.PI / 2, 12)
    expect(arcSweep(Math.PI / 2, 0, undefined)).toBeCloseTo(-Math.PI / 2, 12)
  })

  it('a0 === a1 视为整圆：扫角 ±2π（不能退化成 0）', () => {
    // 这就是"不许用 % 归一化"的原因：`x % x === 0` 会把整圆消成退化线段。
    expect(Math.abs(arcSweep(1, 1, true))).toBeCloseTo(2 * Math.PI, 12)
    expect(Math.abs(arcSweep(1, 1, false))).toBeCloseTo(2 * Math.PI, 12)
  })

  it('跨 2π 回绕仍取同一侧：CW 短弧不被算成 CCW 补角长弧', () => {
    // GOTCHA（sketch-arc-ccw-gotcha）：0.1 → -0.1 的 CW 弧是 0.2 rad 短弧，
    // 不是 6.08 rad 的长弧。判定只看 ccw，不看差值符号。
    const short = arcSweep(0.1, -0.1, false)
    expect(short).toBeCloseTo(-0.2, 12)
    // 同样的两端点、方向给成 CCW → 补角长弧
    expect(arcSweep(0.1, -0.1, true)).toBeCloseTo(2 * Math.PI - 0.2, 12)
    // 逆时针跨 2π 回绕（a1 < a0）同样要绕回来，不是负扫角
    expect(arcSweep(0, -Math.PI / 2, true)).toBeCloseTo(3 * Math.PI / 2, 12)
  })

  it('绝对值恒落在 (0, 2π]', () => {
    for (const [a0, a1] of [[0, 7 * Math.PI], [3, 3 - 5 * Math.PI], [-1, 9], [2, 2.0000001]] as const) {
      for (const ccw of [true, false]) {
        const s = Math.abs(arcSweep(a0, a1, ccw))
        expect(s).toBeGreaterThan(0)
        expect(s).toBeLessThanOrEqual(2 * Math.PI + 1e-12)
      }
    }
  })
})
