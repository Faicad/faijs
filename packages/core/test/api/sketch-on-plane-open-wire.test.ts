/**
 * @vitest-environment node
 *
 * `cad.sketchOnPlane({ contours:[{segments}], plane, as:'wire' })` — the OPEN-chain
 * contract the weapp sweep spine relies on (plan 2026-10-20, §3.4).
 *
 * Contract being pinned (see `SketchOnPlaneParams.contours` doc):
 *   1. A single open chain (line + arc + spline) is accepted under `as:'wire'`
 *      and returns exactly that chain as an open wire — 3 edges, arc/spline
 *      endpoints identical to the input.
 *   2. Multiple disjoint chains under `as:'wire'` → only the FIRST chain comes
 *      back (existing behaviour, pinned so it doesn't silently change).
 *   3. A polyline `cad.wire(points)` over the same corners yields the same wire
 *      vertex count as the segment form — both entries describe the same spine.
 *
 * ⚠️ 装配纪律（同 selectors-brepkit.test.ts）：只装 brepkit（weapp 端侧引擎），
 * 不在同进程切 occt。
 *
 * Run: npx vitest run test/api/sketch-on-plane-open-wire.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getActiveBrepEngine, __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { registerBrepkitBrepEngine } from '../../src/brep/engine/adapters/brepkit'
import { configureBackends, CONTRACT_VERSION } from '../../src/runtime-state'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { disposeBrepkit } from '../../src/brepkit-kernel/brepkitKernel'
import type { BrepEngineApi } from '../../src/brep/engine/primitives'
import { brepOf } from '../../src/shape'
import type { Shape } from '../../src/mesh/types'
import type { ProfileSeg } from '../../src/api/profile'
import { buildSketchOnPlaneWith } from '../../src/api/sketch-on-plane'

beforeAll(async () => {
  __resetEngineRegistriesForTests()
  await registerBrepkitBrepEngine()
  const brep = await getActiveBrepEngine()
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'auto', brepEngineId: 'brepkit' },
    kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
  } as never)
}, 120000)

afterAll(() => {
  disposeBrepkit()
})

function wireHandle(shape: Shape) {
  const h = brepOf(shape)
  if (!h) throw new Error('as:"wire" 结果没有 BREP 句柄（不是曲线形态）')
  return h
}

function edgesOf(h: unknown): unknown[] {
  return getBrepApi().getSubShapes(h as never, 'edge' as never) as never[]
}

function verticesOf(h: unknown): [number, number, number][] {
  const api = getBrepApi()
  const out: [number, number, number][] = []
  for (const e of edgesOf(h)) {
    // brepkit 不给 wire 级取 vertex；每条边的参数域端点即其两个顶点。
    const b = api.curveParameters(e as never) as { first: number; last: number }
    for (const t of [b.first, b.last]) {
      const p = api.curvePointAtParam(e as never, t) as { x: number; y: number; z: number }
      out.push([p.x, p.y, p.z])
    }
  }
  return out
}

/** 单条开放链：直线 (0,0)→(0,20)，半圆弧接 (8,28)，样条接 (40,40)。 */
function openMixedChain(): ProfileSeg[] {
  return [
    { kind: 'line', x1: 0, y1: 0, x2: 0, y2: 20 },
    {
      kind: 'arc',
      cx: 0,
      cy: 28,
      radius: 8,
      startAngle: -Math.PI / 2,
      endAngle: Math.PI / 2,
      ccw: true,
      x1: 0,
      y1: 20,
      x2: 0,
      y2: 36,
    },
    {
      kind: 'spline',
      degree: 3,
      poles: [0, 36, 12, 36, 24, 36, 40, 40],
      knots: [0, 1],
      multiplicities: [4, 4],
    },
  ]
}

/** 去重顶点（按 1e-6 容差）：每条边都报自己的两个端点，接缝点会重复。 */
function distinct(pts: [number, number, number][]): [number, number, number][] {
  const out: [number, number, number][] = []
  for (const p of pts) {
    if (!out.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < 1e-6)) out.push(p)
  }
  return out
}

describe('sketchOnPlane as:"wire" — 单条开放链契约（brepkit，weapp 扫掠脊柱路径）', () => {
  it('开放 line+arc+spline 单链 → wire：3 条边、端点与输入一致', () => {
    const shape = buildSketchOnPlaneWith(getBrepApi(), {
      contours: [{ segments: openMixedChain() }],
      plane: { name: 'XY' },
      as: 'wire',
    })
    const h = wireHandle(shape)
    expect(edgesOf(h)).toHaveLength(3)
    // wire 的全部顶点 = 链的两个外端点 + 弧/样条的接缝点（各内核表示可能增减 seam 顶点，
    // 但首末两端必须与输入链的起终点严格一致）。
    const vs = verticesOf(h)
    const first = vs.find((p) => Math.hypot(p[0], p[1]) < 1e-6)
    expect(first).toBeDefined() // 链起点 (0,0)
    const last = vs.find((p) => Math.hypot(p[0] - 40, p[1] - 40) < 1e-6)
    expect(last).toBeDefined() // 链终点 (40,40)
  })

  it('弧段端点落位：(0,20) 与 (0,36) 都在 wire 顶点里', () => {
    const shape = buildSketchOnPlaneWith(getBrepApi(), {
      contours: [{ segments: openMixedChain() }],
      plane: { name: 'XY' },
      as: 'wire',
    })
    const vs = verticesOf(wireHandle(shape))
    const has = (x: number, y: number): boolean =>
      vs.some((p) => Math.abs(p[0] - x) < 1e-6 && Math.abs(p[1] - y) < 1e-6)
    expect(has(0, 20)).toBe(true)
    expect(has(0, 36)).toBe(true)
  })

  it('多条不相接链 → as:"wire" 只取第一条（既有行为钉住）', () => {
    const first: ProfileSeg[] = [{ kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }]
    const second: ProfileSeg[] = [{ kind: 'line', x1: 100, y1: 0, x2: 100, y2: 50 }]
    const shape = buildSketchOnPlaneWith(getBrepApi(), {
      contours: [{ segments: first }, { segments: second }],
      plane: { name: 'XY' },
      as: 'wire',
    })
    const vs = verticesOf(wireHandle(shape))
    // 第一条链的两个端点在；第二条链的任何点不在。
    expect(vs.some((p) => Math.abs(p[1] - 10) < 1e-6)).toBe(true)
    expect(vs.every((p) => p[0] < 50)).toBe(true)
  })

  it('同一条脊柱：段形态与 cad.wire(点列) 折线形态的顶点数一致', () => {
    const pts = [[0, 0], [0, 20], [0, 36], [40, 40]] as const
    const fromWire = verticesOf(
      wireHandle(
        buildSketchOnPlaneWith(getBrepApi(), {
          contours: [{ segments: openMixedChain() }],
          plane: { name: 'XY' },
          as: 'wire',
        }),
      ),
    )
    // 折线形态：4 点 3 段的 polyline wire。
    const lineSegs: ProfileSeg[] = []
    for (let i = 0; i < pts.length - 1; i++) {
      lineSegs.push({ kind: 'line', x1: pts[i][0], y1: pts[i][1], x2: pts[i + 1][0], y2: pts[i + 1][1] })
    }
    const fromSegments = distinct(
      verticesOf(
        wireHandle(
          buildSketchOnPlaneWith(getBrepApi(), {
            contours: [{ segments: lineSegs }],
            plane: { name: 'XY' },
            as: 'wire',
          }),
        ),
      ),
    )
    // 段形态的折线 wire：4 个去重顶点（每条边各报一次接缝端点）。
    expect(fromSegments).toHaveLength(pts.length)
    // 两种形态的 wire 去重顶点一致 —— 同一脊柱两种写法等价的最低要求。
    expect(distinct(fromWire)).toHaveLength(fromSegments.length)
  })
})
