/**
 * shapes — 求解器 + BREP 层的验证（occt + planegcs）。
 *
 * 四件事在这里钉死：
 * 1. **初值即解**：`expandShapes` 展开出来的约束，与它自己展开出来的几何必须自洽
 *    ——不扰动地求解一次，几何不该动（形状的角值/约束写错，这里立刻红）；
 * 2. **形状语义真的被约束保证**：扰动初值再求解，看结构是否被拉回来（只比"初值本来
 *    就对"的几何是测不出约束的）；
 * 3. **底层约束语义探针**：`l2l_angle_ll` 是有向差、`at:'end'` 反转线方向、圆弧
 *    `radius` 当前无效（缺 `arc_rules`）——形状展开依赖这些约定，测出来而不是猜；
 * 4. **实测 DOF**：每个罐头形状解完报多少剩余自由度，是这里测出来的数字（计划文档
 *    的 DOF 列以这里为准）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { initOcctWasm } from '@faicad/faijs/occt-kernel/occtKernel'
import { registerOcctBrepEngine } from '@faicad/faijs/brep/engine/adapters/occt'
import { getBrepEngine } from '@faicad/faijs/brep/engine/registry'
import { getBrepApi } from '@faicad/faijs/brep/handle-bridge'
import { configureBackends, CONTRACT_VERSION } from '@faicad/faijs/runtime-state'
import { brepOf } from '@faicad/faijs/shape'
import { dualOpMetaOf } from '@faicad/faijs/sdk'
import { expandShapes, rectCorners, type SketchShape } from '../src/shapes.js'
import { assertSketchParams, sketch, installSketchSolver, uninstallSketchSolver } from '../src/op.js'
import { solveSketch } from '../src/solve.js'
import { createNodePlanegcsSolver } from '../src/node.js'
import type { SketchSolver } from '../src/solver.js'
import type { SketchConstraint, SketchGeom } from '../src/canonical.js'

let solver: SketchSolver

beforeAll(async () => {
  await initOcctWasm()
  await registerOcctBrepEngine()
  const brep = (await getBrepEngine()).primitives
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'brep' },
    kernel: { brep, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: undefined,
    cad: undefined,
  } as never)
  solver = await createNodePlanegcsSolver()
  // `cad.sketch` 的 brep 实现从模块级工厂取求解器（宿主注入）；测试直接打 op，
  // 所以必须在这里装上。afterAll 卸载，避免污染同包其它测试文件。
  installSketchSolver(() => Promise.resolve(solver))
}, 120000)

afterAll(() => {
  uninstallSketchSolver()
})

/** op 的 brep 实现（不经运行时接线，直接打 `cad.sketch` 的那段代码）。 */
function runSketchOp(params: Record<string, unknown>) {
  const meta = dualOpMetaOf(sketch as never) as unknown as {
    brep?: (p: Record<string, unknown>) => Promise<unknown>
  }
  if (!meta?.brep) throw new Error('cad.sketch has no brep implementation')
  return meta.brep(params)
}

/** 展开 + 求解，返回解后的几何与 DOF/状态。 */
async function solveShape(shape: SketchShape) {
  const e = expandShapes([shape])
  const outcome = await solveSketch(e.geoms, e.constraints, { solver })
  return { expansion: e, outcome }
}

// ── 几何小工具（只做二维点/线/弧的读取，不重复任何形状数学） ──────────────

type Pt = [number, number]

const dist = (p: Pt, q: Pt): number => Math.hypot(p[0] - q[0], p[1] - q[1])
const deg = (rad: number): number => (rad * 180) / Math.PI

function lineEnds(g: SketchGeom): { a: Pt; b: Pt } {
  if (g.kind !== 'line') throw new Error(`expected a line, got ${g.kind}`)
  return { a: [g.x1, g.y1], b: [g.x2, g.y2] }
}

/** 线段方向角（度，(-180, 180]）。 */
function lineDir(g: SketchGeom): number {
  const l = lineEnds(g)
  return (Math.atan2(l.b[1] - l.a[1], l.b[0] - l.a[0]) * 180) / Math.PI
}

/** 有符号扫掠（与 canonical/shapes 同一规则：方向由 ccw 定，缺省按 a1>a0 推）。 */
function arcSweep(a0: number, a1: number, ccw: boolean | undefined): number {
  const dir = ccw ?? a1 - a0 > 0
  let sweep = dir ? a1 - a0 : a0 - a1
  while (sweep <= 0) sweep += Math.PI * 2
  while (sweep > Math.PI * 2) sweep -= Math.PI * 2
  return dir ? sweep : -sweep
}

/** 弧首/尾点。 */
function arcEnds(g: SketchGeom): { a: Pt; b: Pt } {
  if (g.kind !== 'arc') throw new Error(`expected an arc, got ${g.kind}`)
  return {
    a: [g.cx + g.r * Math.cos(g.a0), g.cy + g.r * Math.sin(g.a0)],
    b: [g.cx + g.r * Math.cos(g.a1), g.cy + g.r * Math.sin(g.a1)],
  }
}

/** 顶点 `v` 处的内角（度，0..180）：两条指向 v 的两边。 */
function interiorAngleDeg(v: Pt, a: Pt, b: Pt): number {
  const v1 = [a[0] - v[0], a[1] - v[1]]
  const v2 = [b[0] - v[0], b[1] - v[1]]
  const dot = v1[0]! * v2[0]! + v1[1]! * v2[1]!
  const cross = v1[0]! * v2[1]! - v1[1]! * v2[0]!
  return Math.abs(deg(Math.atan2(cross, dot)))
}

/** 两条几何是否"同一份"（角度按语义比，不比 a0/a1 的字面量——atan2 会回绕）。 */
function expectSameGeom(got: SketchGeom, want: SketchGeom, prec = 9): void {
  expect(got.kind).toBe(want.kind)
  switch (want.kind) {
    case 'line': {
      const g = lineEnds(got)
      const w = lineEnds(want)
      expect(dist(g.a, w.a)).toBeCloseTo(0, prec)
      expect(dist(g.b, w.b)).toBeCloseTo(0, prec)
      break
    }
    case 'circle':
      if (got.kind !== 'circle') throw new Error('narrowing')
      expect(got.cx).toBeCloseTo(want.cx, prec)
      expect(got.cy).toBeCloseTo(want.cy, prec)
      expect(got.r).toBeCloseTo(want.r, prec)
      break
    case 'arc': {
      if (got.kind !== 'arc') throw new Error('narrowing')
      expect(got.cx).toBeCloseTo(want.cx, prec)
      expect(got.cy).toBeCloseTo(want.cy, prec)
      expect(got.r).toBeCloseTo(want.r, prec)
      const g = arcEnds(got)
      const w = arcEnds(want)
      expect(dist(g.a, w.a)).toBeCloseTo(0, prec)
      expect(dist(g.b, w.b)).toBeCloseTo(0, prec)
      expect(arcSweep(got.a0, got.a1, got.ccw)).toBeCloseTo(arcSweep(want.a0, want.a1, want.ccw), prec)
      break
    }
    case 'ellipse': {
      if (got.kind !== 'ellipse') throw new Error('narrowing')
      expect(got.cx).toBeCloseTo(want.cx, prec)
      expect(got.cy).toBeCloseTo(want.cy, prec)
      expect(got.rx).toBeCloseTo(want.rx, prec)
      expect(got.ry).toBeCloseTo(want.ry, prec)
      break
    }
    case 'point':
      if (got.kind !== 'point') throw new Error('narrowing')
      expect(got.x).toBeCloseTo(want.x, prec)
      expect(got.y).toBeCloseTo(want.y, prec)
      break
    case 'bspline':
      if (got.kind !== 'bspline') throw new Error('narrowing')
      expect(got.poles.length).toBe(want.poles.length)
      break
  }
}

// ────────────────────────────────────────────────────────────────────────────

describe('初值即解：展开出的约束与画出的几何自洽（形状参数写错/角值写错立刻红）', () => {
  const CASES: SketchShape[] = [
    { kind: 'rect', tag: 'r', w: 100, d: 60, cx: 3, cy: -2 },
    { kind: 'roundedRect', tag: 'rr', w: 20, d: 10, r: 2 },
    { kind: 'circle', tag: 'c', r: 10, cx: 1, cy: 2 },
    { kind: 'ellipse', tag: 'e', rx: 10, ry: 5, cx: -1 },
    { kind: 'polygon', tag: 'p3', n: 3, r: 10 },
    { kind: 'polygon', tag: 'p5', n: 5, r: 10 },
    { kind: 'slot', tag: 's', w: 8, d: 4 },
    { kind: 'trapezoid', tag: 't', w: 10, h: 5, a1: Math.PI / 4, a2: Math.PI / 3 },
    { kind: 'line', tag: 'l', from: [0, 0], to: [10, 3] },
    { kind: 'arc', tag: 'a', cx: 0, cy: 0, r: 5, a0: 0, a1: Math.PI / 2 },
    { kind: 'point', tag: 'pt', x: 4, y: 5 },
  ]

  for (const shape of CASES) {
    it(`${shape.kind}${shape.kind === 'polygon' ? `(n=${shape.n})` : ''}：求解不挪动几何`, async () => {
      const { expansion, outcome } = await solveShape(shape)
      expect(outcome.converged).toBe(true)
      expect(outcome.geoms).toHaveLength(expansion.geoms.length)
      expansion.geoms.forEach((want, i) => {
        const got = outcome.geoms[i]!
        expect(got.tag).toBe(want.tag)
        expectSameGeom(got, want)
      })
    })
  }
})

describe('形状自带约束真的生效（扰动初值 → 求解拉回形状语义）', () => {
  it('rect：把角拖散之后求解仍给回一个轴对齐矩形（4 角重合 + 底/顶 H + 左/右 V）', async () => {
    const shape: SketchShape = { kind: 'rect', tag: 'r', w: 100, d: 60 }
    const e = expandShapes([shape])
    // 破坏：把底边的终点往上、往右拽 3/4 mm
    const broken = e.geoms.map((g, i) => {
      if (i !== 0 || g.kind !== 'line') return g
      return { ...g, x2: g.x2 + 3, y2: g.y2 + 4 }
    })
    const outcome = await solveSketch(broken, e.constraints, { solver })
    expect(outcome.converged).toBe(true)
    const [bottom, right, top, left] = outcome.geoms
    const b = lineEnds(bottom!)
    const r = lineEnds(right!)
    const t = lineEnds(top!)
    const l = lineEnds(left!)
    // 底/顶水平、左/右垂直
    expect(b.a[1]).toBeCloseTo(b.b[1], 6)
    expect(t.a[1]).toBeCloseTo(t.b[1], 6)
    expect(l.a[0]).toBeCloseTo(l.b[0], 6)
    expect(r.a[0]).toBeCloseTo(r.b[0], 6)
    // 四个角重合（闭合回路）
    expect(dist(b.b, r.a)).toBeCloseTo(0, 6)
    expect(dist(r.b, t.a)).toBeCloseTo(0, 6)
    expect(dist(t.b, l.a)).toBeCloseTo(0, 6)
    expect(dist(l.b, b.a)).toBeCloseTo(0, 6)
    // 剩下 4 个 DOF = 位置 2 + 长宽 2：约束**不钉尺寸**（与 3d_editor
    // makeRectangle 同款，Fusion 画矩形同理），所以扰动会把长宽带偏——这是设计事实，
    // 不是缺陷：尺寸靠 shapes 参数（初值）+ UI 写回把守。
    expect(outcome.dof).toBe(4)
  })

  it('polygon：扰动一个顶点后求解仍给回正多边形（等长边）', async () => {
    const e = expandShapes([{ kind: 'polygon', tag: 'p', n: 5, r: 10 }])
    const broken = e.geoms.map((g, i) => {
      if (i !== 1 || g.kind !== 'line') return g
      return { ...g, x1: g.x1 * 1.4, y1: g.y1 * 1.4 }
    })
    const outcome = await solveSketch(broken, e.constraints, { solver })
    expect(outcome.converged).toBe(true)
    const lengths = outcome.geoms.map((g) => {
      const l = lineEnds(g)
      return dist(l.a, l.b)
    })
    for (const len of lengths) expect(len).toBeCloseTo(lengths[0]!, 6)
  })

  it('形状 + 调用方约束：五种罐头都必须收敛（不许翻成 conflicting —— 假冲突即回归）', async () => {
    // 这是**真实流程**：形状自带约束 + 用户写的约束一起解，初值与用户约束不一致，
    // 求解器必须把形状挪过去。曾经的候选改动（给圆弧补 push arc_rules）会让这里的
    // slot 变成 conflicting（GCS 打印 RedundantSolving-LevenbergMarquardt，误报），
    // 而该系统明明有解 —— 这条就是那个改动的看门狗。
    const cases: Array<[string, SketchShape, SketchConstraint[]]> = [
      ['rect', { kind: 'rect', tag: 'r', w: 100, d: 60 }, [{ kind: 'length', of: { tag: 'r.0' }, value: 40 }]],
      ['slot', { kind: 'slot', tag: 's', w: 8, d: 4 }, [{ kind: 'length', of: { tag: 's.0' }, value: 5 }]],
      ['roundedRect', { kind: 'roundedRect', tag: 'q', w: 20, d: 10, r: 2 }, [{ kind: 'length', of: { tag: 'q.0' }, value: 8 }]],
      ['trapezoid', { kind: 'trapezoid', tag: 't', w: 10, h: 5, a1: Math.PI / 4 }, [{ kind: 'length', of: { tag: 't.0' }, value: 12 }]],
      ['polygon', { kind: 'polygon', tag: 'p', n: 5, r: 10 }, [{ kind: 'length', of: { tag: 'p.0' }, value: 6 }]],
    ]
    const rows: string[] = []
    for (const [name, shape, extra] of cases) {
      const e = expandShapes([shape])
      const out = await solveSketch(e.geoms, [...e.constraints, ...extra], { solver })
      rows.push(`${name}=${out.converged ? 'ok' : out.status}`)
      expect(out.converged, `${name} 与用户约束合并求解失败：${out.status}`).toBe(true)
    }
    console.log(`[probe] 形状+用户约束: ${rows.join(' ')}`)
  })

  it('slot 约束子集 × 扰动：都不许翻成 conflicting', async () => {
    const e = expandShapes([{ kind: 'slot', tag: 's', w: 8, d: 4 }])
    const nudge = (mm: number): SketchGeom[] => e.geoms.map((g, i) => {
      if (i !== 1 || g.kind !== 'arc') return g
      return { ...g, cx: g.cx + mm, cy: g.cy + mm / 2 }
    })
    const subsets: Record<string, typeof e.constraints> = {
      coincident: e.constraints.filter((c) => c.kind === 'coincident'),
      'coincident+H': e.constraints.filter((c) => c.kind === 'coincident' || c.kind === 'horizontal'),
      'coincident+radius': e.constraints.filter((c) => c.kind === 'coincident' || c.kind === 'radius'),
      'coincident+H+radius': e.constraints,
    }
    const rows: string[] = []
    for (const [name, cons] of Object.entries(subsets)) {
      for (const [label, geoms] of [['未扰动', e.geoms], ['扰动', nudge(0.2)]] as const) {
        const out = await solveSketch(geoms, cons, { solver })
        rows.push(`${name}/${label}=${out.converged ? 'ok' : out.status}`)
        expect(out.converged, `${name} ${label} 失败：${out.status}`).toBe(true)
      }
    }
    console.log(`[probe] slot 约束子集: ${rows.join(' ')}`)
  })

  it('圆弧 radius 约束 + 扰动：各扫掠角（含半圆）都收敛', async () => {
    const rows: string[] = []
    for (const sweepDeg of [90, 150, 180, 270]) {
      const base: SketchGeom[] = [{
        tag: 'a', kind: 'arc', cx: 0, cy: 0, r: 5, a0: 0, a1: (sweepDeg * Math.PI) / 180,
      }]
      const cons = [{ kind: 'radius' as const, of: { tag: 'a' }, value: 5 }]
      const moved = base.map((g) => (g.kind === 'arc' ? { ...g, cx: 0.2, cy: 0.1 } : g))
      const out = await solveSketch(moved, cons, { solver })
      rows.push(`${sweepDeg}°=${out.converged ? 'ok' : out.status}`)
      expect(out.converged, `${sweepDeg}° 失败：${out.status}`).toBe(true)
    }
    console.log(`[probe] 弧扫掠角×扰动: ${rows.join(' ')}`)
  })

  it('slot：结构约束（2 直边水平 + 4 处首尾重合）真的生效', async () => {
    const e = expandShapes([{ kind: 'slot', tag: 's', w: 8, d: 4 }])
    const broken = e.geoms.map((g, i) => {
      if (i !== 1 || g.kind !== 'arc') return g
      return { ...g, cx: g.cx + 0.2, cy: g.cy + 0.1 }
    })
    const outcome = await solveSketch(broken, e.constraints, { solver })
    expect(outcome.converged).toBe(true)
    // 扰动幅度 → 收敛（求解器对"不一致初值"的宽容度）
    const rows: string[] = []
    for (const mm of [0.2, 0.5, 1, 2]) {
      const moved = e.geoms.map((g, i) => (i === 1 && g.kind === 'arc' ? { ...g, cx: g.cx + mm, cy: g.cy + mm / 2 } : g))
      const out = await solveSketch(moved, e.constraints, { solver })
      rows.push(`${mm}mm=${out.converged ? 'ok' : out.status}`)
    }
    console.log(`[probe] slot 弧心扰动: ${rows.join(' ')}`)
    // 两条直边水平（2 条 horizontal 约束）
    const lines = outcome.geoms.filter((g) => g.kind === 'line')
    expect(lines).toHaveLength(2)
    for (const l of lines) {
      const ends = lineEnds(l)
      expect(ends.a[1]).toBeCloseTo(ends.b[1], 6)
    }
    // 闭环（4 处 coincident）：逐条比较**求解器给出的点**。注意弧的"起点"是精确的
    // （回读半径按 |start − centre| 算），而"终点"会被按同一半径投影 —— 后端没 push
    // arc_rules 时两者可能不在同一半径上（见 planegcs-backend 的 GOTCHA 与缺口测试）。
    for (let i = 0; i < 4; i++) {
      const cur = outcome.geoms[i]!
      const next = outcome.geoms[(i + 1) % 4]!
      const end = cur.kind === 'line' ? lineEnds(cur).b : arcEnds(cur).b
      const start = next.kind === 'line' ? lineEnds(next).a : arcEnds(next).a
      const gap = dist(end, start)
      if (i === 0 || i === 2) expect(gap).toBeCloseTo(0, 6) // 弧起点一侧：精确
      else console.log(`[probe] slot 弧终点侧间隙=${gap.toFixed(4)}mm（半径约束对弧无效的后果）`)
    }
    // 弧半径目前**不受约束**（缺口：后端没 push arc_rules，详见 planegcs-backend 的
    // GOTCHA 与下面的缺口测试）。这里只记录实测，不假装它会回到 d/2。
    const arcRs = outcome.geoms
      .filter((g) => g.kind === 'arc')
      .map((g) => (g.kind === 'arc' ? g.r : NaN))
    console.log(`[probe] slot 扰动后弧半径: ${arcRs.map((r) => r.toFixed(4)).join(', ')}（形状参数是 2）`)
    for (const r of arcRs) expect(r).toBeGreaterThan(0)
  })

  it('trapezoid：扰动上边之后求解把两个内角拉回 a1/a2', async () => {
    const a1 = Math.PI / 4
    const a2 = Math.PI / 3
    const e = expandShapes([{ kind: 'trapezoid', tag: 't', w: 10, h: 5, a1, a2 }])
    const broken = e.geoms.map((g, i) => {
      if (i !== 2 || g.kind !== 'line') return g
      return { ...g, x1: g.x1 - 3, x2: g.x2 - 3 }
    })
    const outcome = await solveSketch(broken, e.constraints, { solver })
    expect(outcome.converged).toBe(true)
    // 四个角点由展开顺序决定：g0 = bl→br、g1 = br→tr、g2 = tr→tl、g3 = tl→bl
    const [g0, g1, g2] = outcome.geoms
    const bl = lineEnds(g0!).a
    const br = lineEnds(g0!).b
    const tr = lineEnds(g1!).b
    const tl = lineEnds(g2!).b
    expect(interiorAngleDeg(br, bl, tr)).toBeCloseTo(deg(a2), 4)
    expect(interiorAngleDeg(bl, br, tl)).toBeCloseTo(deg(a1), 4)
    // 底边水平
    expect(lineEnds(g0!).a[1]).toBeCloseTo(lineEnds(g0!).b[1], 6)
  })

  it('roundedRect：扰动直边端点后求解仍给回四段 90° 圆角（直边 H/V + 切点重合）', async () => {
    const e = expandShapes([{ kind: 'roundedRect', tag: 'rr', w: 20, d: 10, r: 2 }])
    const broken = e.geoms.map((g, i) => {
      if (i !== 0 || g.kind !== 'line') return g
      return { ...g, y1: g.y1 - 2 }
    })
    const outcome = await solveSketch(broken, e.constraints, { solver })
    expect(outcome.converged).toBe(true)
    const arcs = outcome.geoms.filter((g) => g.kind === 'arc')
    expect(arcs).toHaveLength(4)
    for (const a of arcs) {
      if (a.kind !== 'arc') throw new Error('narrowing')
      // 扫掠按语义算（a0/a1 的字面量会被 atan2 回绕）
      expect(Math.abs(deg(arcSweep(a.a0, a.a1, a.ccw)))).toBeCloseTo(90, 6)
    }
    // 直边：底/顶水平、左/右垂直
    const [bottom, , right, , top, , left] = outcome.geoms
    expect(lineEnds(bottom!).a[1]).toBeCloseTo(lineEnds(bottom!).b[1], 6)
    expect(lineEnds(top!).a[1]).toBeCloseTo(lineEnds(top!).b[1], 6)
    expect(lineEnds(left!).a[0]).toBeCloseTo(lineEnds(left!).b[0], 6)
    expect(lineEnds(right!).a[0]).toBeCloseTo(lineEnds(right!).b[0], 6)
  })
})

describe('约束语义探针（形状展开依赖的底层约定，测出来而不是猜）', () => {
  /** 角度归一化到 (-180, 180]。 */
  const norm = (d: number): number => {
    let x = d % 360
    if (x > 180) x -= 360
    if (x <= -180) x += 360
    return x
  }

  /** 两条共起点的线：L0 沿 +X，L1 在 `at` 方向。 */
  const twoLines = (at: number): SketchGeom[] => [
    { tag: 'a', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
    {
      tag: 'b', kind: 'line', x1: 0, y1: 0,
      x2: 10 * Math.cos((at * Math.PI) / 180), y2: 10 * Math.sin((at * Math.PI) / 180),
    },
  ]

  const dirOf = (out: { geoms: SketchGeom[] }, tag: string): number => {
    const g = out.geoms.find((x) => x.tag === tag)
    if (!g || g.kind !== 'line') throw new Error(`no line ${tag}`)
    return lineDir(g)
  }

  it('angle（l2l_angle_ll）：值 = dir(b) − dir(a) 的有向差，不取锐角', async () => {
    // L1 初始在 120°。若约定是"有向差 = 值"，target=120 时初值即解；target=60 时
    // 求解器把两线方向差拉到 +60°。若约定是"两线夹角 mod 180"，60 与 120 会互换表现。
    const rows: string[] = []
    for (const target of [60, 120, -120]) {
      const out = await solveSketch(
        twoLines(120),
        [{ kind: 'angle', a: { tag: 'a' }, b: { tag: 'b' }, value: (target * Math.PI) / 180 }],
        { solver },
      )
      expect(out.converged).toBe(true)
      rows.push(`${target}°→δ=${norm(dirOf(out, 'b') - dirOf(out, 'a')).toFixed(1)}°`)
    }
    console.log(`[probe] l2l_angle_ll 实测: ${rows.join('  ')}`)
    expect(rows).toEqual(['60°→δ=60.0°', '120°→δ=120.0°', '-120°→δ=-120.0°'])
  })

  it('angle（l2l_angle_pppp）：at:"end" 反转该线的方向（值仍是 dir(b)−dir(a)）', async () => {
    const out = await solveSketch(
      twoLines(120),
      [{
        kind: 'angle',
        a: { tag: 'a', at: 'start' },
        b: { tag: 'b', at: 'end' },
        value: (60 * Math.PI) / 180,
      }],
      { solver },
    )
    expect(out.converged).toBe(true)
    // b 取 at:'end' → 它的方向被反转（原方向 −180°）；约束是 反转后dir(b) − dir(a) = 60°
    const effective = norm(dirOf(out, 'b') - 180 - dirOf(out, 'a'))
    console.log(`[probe] l2l_angle_pppp(at:end): 反转后 δ=${effective.toFixed(1)}°（原方向 ${dirOf(out, 'b').toFixed(1)}°）`)
    expect(effective).toBeCloseTo(60, 6)
  })

  it('缺口登记：圆弧的 radius 约束当前【无效】（后端未 push arc_rules）', async () => {
    const out = await solveSketch(
      [{ tag: 'a', kind: 'arc', cx: 0, cy: 0, r: 5, a0: 0, a1: Math.PI / 2 }],
      [{ kind: 'radius', of: { tag: 'a' }, value: 2 }],
      { solver },
    )
    const g = out.geoms[0]!
    const r = g.kind === 'arc' ? g.r : NaN
    console.log(`[probe] radius 约束于 arc: converged=${out.converged} status=${out.status} r=${r}（写了 2，实际仍是 5）`)
    expect(out.converged).toBe(true)
    // 为什么：planegcs 里圆弧的 radius 是**参数**，只有 push 了 `arc_rules`
    // （|start−centre| = |end−centre| = radius）才与首尾点耦合；后端过去/现在都没 push，
    // 而回读半径是按首尾点算的 |start − centre| → `arc_radius` 只改了一个没人读的参数。
    // 圆形（circle）走 circle_radius + 直接回读参数，是有效的。
    // 已实测过"补上 arc_rules"的后果（2026-10-03）：半径约束生效了，但 slot（两条 180°
    // 端半圆）+ 调用方约束会被 GCS 误判成 conflicting（该组约束明明有解），
    // 所以先如实登记缺口、不 push。本断言 = 缺口看门狗：后端补 arc_rules 后它会变红。
    expect(r).toBe(5)
  })
})

describe('实测剩余自由度（DOF）', () => {
  const CASES: SketchShape[] = [
    { kind: 'rect', w: 100, d: 60 },
    { kind: 'roundedRect', w: 20, d: 10, r: 2 },
    { kind: 'circle', r: 10 },
    { kind: 'ellipse', rx: 10, ry: 5 },
    { kind: 'polygon', n: 3, r: 10 },
    { kind: 'polygon', n: 5, r: 10 },
    { kind: 'slot', w: 8, d: 4 },
    { kind: 'trapezoid', w: 10, h: 5, a1: 1 },
  ]

  for (const shape of CASES) {
    it(`${shape.kind}${shape.kind === 'polygon' ? `(n=${shape.n})` : ''}：解完收敛，DOF 可读`, async () => {
      const { outcome } = await solveShape(shape)
      expect(outcome.converged).toBe(true)
      expect(outcome.status === 'conflicting' || outcome.status === 'failed').toBe(false)
      // 实测值：DOF 必须可读（-1 = 后端没报）且非负
      expect(outcome.dof).toBeGreaterThanOrEqual(0)
      // 把实测值打出来，作为文档 DOF 列的唯一依据（改约束时这里会立刻变）。
      console.log(`[dof] ${shape.kind}${shape.kind === 'polygon' ? `(n=${shape.n})` : ''} = ${outcome.dof}`)
    })
  }
})

describe('cad.sketch({ shapes }) — 入口与产物', () => {
  it('shapes 入口与 geoms 入口等价（同一矩形 → 同一面积）', async () => {
    const shapes: SketchShape[] = [{ kind: 'rect', tag: 'g0', w: 100, d: 60 }]
    const viaShapes = await runSketchOp({ shapes })
    const area1 = getBrepApi().getSurfaceArea(brepOf(viaShapes as never) as never)
    const viaGeoms = await runSketchOp({
      geoms: expandShapes(shapes).geoms,
      constraints: expandShapes(shapes).constraints,
    })
    const area2 = getBrepApi().getSurfaceArea(brepOf(viaGeoms as never) as never)
    expect(area1).toBeCloseTo(100 * 60, 3)
    expect(area2).toBeCloseTo(area1, 6)
  })

  it("mode:'s' 的圆被矩形包住 → 真的成孔（面积 = 矩形 - 圆）", async () => {
    const shape = await runSketchOp({
      shapes: [
        { kind: 'rect', tag: 'plate', w: 100, d: 60 },
        { kind: 'circle', tag: 'hole', r: 10, cx: 30, cy: 20, mode: 's' },
      ],
    })
    const area = getBrepApi().getSurfaceArea(brepOf(shape as never) as never)
    expect(area).toBeCloseTo(100 * 60 - Math.PI * 100, 1)
  })

  it("mode:'s' 的形状没被任何外轮廓包住 → 显式报 E_SKETCHC_SUBTRACT_NOT_CONTAINED", async () => {
    await expect(runSketchOp({
      shapes: [
        { kind: 'rect', tag: 'plate', w: 10, d: 10 },
        { kind: 'circle', tag: 'hole', r: 1, cx: 100, cy: 100, mode: 's' },
      ],
    })).rejects.toThrow(/E_SKETCHC_SUBTRACT_NOT_CONTAINED/)
  })

  it("as:'wire' → 外环曲线（长度 = 周长）", async () => {
    const shape = await runSketchOp({
      shapes: [{ kind: 'rect', tag: 'g0', w: 100, d: 60 }],
      as: 'wire',
    })
    expect(getBrepApi().getLength(brepOf(shape as never) as never)).toBeCloseTo(2 * (100 + 60), 3)
  })

  it('画笔链 + close：展开成闭合轮廓（三角形面积 = 底×高/2）', async () => {
    const shape = await runSketchOp({
      shapes: [
        { kind: 'line', tag: 'a', from: [0, 0], to: [100, 0] },
        { kind: 'line', tag: 'b', from: [100, 0], to: [0, 60] },
        { kind: 'close' },
      ],
    })
    expect(getBrepApi().getSurfaceArea(brepOf(shape as never) as never)).toBeCloseTo(3000, 3)
  })

  it('shape 自带约束与调用方约束合并求解（length 钉住矩形的一条边）', async () => {
    const shape = await runSketchOp({
      shapes: [{ kind: 'rect', tag: 'g0', w: 100, d: 60 }],
      constraints: [{ kind: 'length', of: { tag: 'g0.0' }, value: 40 }],
    })
    // 底边被钉到 40；高仍由形状把守（60）→ 面积 2400
    expect(getBrepApi().getSurfaceArea(brepOf(shape as never) as never)).toBeCloseTo(40 * 60, 1)
  })
})

describe('assertSketchParams — 两条入口二选一', () => {
  it('shapes 与 geoms 都给 → E_SKETCHC_BOTH_ENTRIES', () => {
    expect(() => assertSketchParams({
      shapes: [{ kind: 'circle', r: 1 }],
      geoms: [{ tag: 'a', kind: 'circle', cx: 0, cy: 0, r: 1 }],
    })).toThrow(/E_SKETCHC_BOTH_ENTRIES/)
  })

  it('一个都不给 / 空数组 → E_SKETCHC_NO_GEOMS', () => {
    expect(() => assertSketchParams({})).toThrow(/E_SKETCHC_NO_GEOMS/)
    expect(() => assertSketchParams({ shapes: [] })).toThrow(/E_SKETCHC_NO_GEOMS/)
    expect(() => assertSketchParams({ geoms: [] })).toThrow(/E_SKETCHC_NO_GEOMS/)
  })

  it('shapes 单独给 → 通过', () => {
    expect(() => assertSketchParams({ shapes: [{ kind: 'circle', r: 1 }] })).not.toThrow()
  })
})

// 未使用的导入守卫：`rectCorners` 是库面导出（宿主画矩形时也要用），这里只做存在性锚点。
void rectCorners
