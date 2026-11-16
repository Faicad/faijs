/**
 * @vitest-environment node
 *
 * 脊柱事实层（`internal/spine-analysis.ts`）的长期验收（P0，2026-11-16）
 *
 * 为什么单独钉这一层：扫掠该走哪条路只由**脊柱长什么样**决定。策略层、执行器、
 * 判据层都只读这张事实表，任何一处把「事实」量错，后面全是静默几何错误。所以这里
 * 不碰扫掠，只钉「一条脊柱被读成了什么」。
 *
 * 关键口径（都是踩过的坑）：
 * - 角度约定：`cad.circleArc(center, axis, r, a0, a1)` 里 `0°` 落在哪个方向由 axis 决定。
 *   axis = +X 时 0° → center + r·(+Z)、90° → center + r·(−Y)。写错就造出**断裂** wire，
 *   而断裂的 spine 在扫掠里表现为「内核莫名其妙失败」（见 sweep-kernel-behavior K9）。
 * - 切向用数值差分（`numericTangent`），不读内核 `curveTangent`：后者在本仓库的
 *   occt-wasm 绑定上有调用交互缺陷（先读参数再读切向量会让随后的 `sweepFull` 失败）。
 *   代价是精度：弧半径反解到 1e-3 量级（示例里 10.0019），足够做拐角判定与自交预判。
 *
 * Run: npx vitest run test/api/spine-analysis.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { asPartName } from '../../src/identity'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import type { Shape } from '../../src/mesh/types'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { brepOf } from '../../src/shape'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'
import {
  analyzeSpine,
  describeSpine,
  G1_TOL,
  FOLD_TURN,
  type SpineFacts,
} from '../../src/api/internal/spine-analysis'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

const ARC_LEN = (Math.PI / 2) * 10

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

/** 跑一段脚本，返回名为 `sp` 的产物。 */
async function spineOf(code: string): Promise<Shape> {
  const rt = new CadRuntime(ports(), 'brep', { cad: createApiNamespaceWithEditorOps() })
  const r: ExecutionResult = await rt.execute(`${code}\n`)
  if (r.failedAt) throw new Error(`execution failed at ${r.failedAt.callee}: ${r.failedAt.message}`)
  const s = r.outputs.get(asPartName('sp'))
  if (!s) throw new Error('no sp output')
  return s as Shape
}

async function factsOf(code: string): Promise<SpineFacts> {
  const s = await spineOf(code)
  return analyzeSpine(getBrepApi(), brepOf(s) as never)
}

const ARC = 'cad.wireFromEdges([cad.circleArc([0,-10,0],[1,0,0],10,0*DEGREE,90*DEGREE)])'
/**
 * 与 ARC 相切续接的直腿。2026-11-17 起圆弧角度基准是全仓唯一的（`u` = 世界 +X 在圆面内的
 * 投影、`v = n̂×u`），所以 axis=+X / 0°→90° 的弧是 **(0,0,0) → (0,-10,10)**：
 * 起点切向 +Z、末端切向 −Y（旧口径下是 (0,-10,10) → (0,-20,0)，末端切向 −Z）。
 */
const ARC_PLUS_LEG =
  'cad.wireFromEdges([cad.circleArc([0,-10,0],[1,0,0],10,0*DEGREE,90*DEGREE),cad.edge([0,-10,10],[0,-20,10])])'
/** 同一个弧，但直腿从 ARC 的**起点**接出去 ⇒ 与弧尾相距 14.14，是断开的 wire。 */
const ARC_BROKEN =
  'cad.wireFromEdges([cad.circleArc([0,-10,0],[1,0,0],10,0*DEGREE,90*DEGREE),cad.edge([0,0,0],[0,0,10])])'

describe('A 脊柱事实：边、拐角、断裂、闭合', () => {
  it('A1. 单段直线：1 条 line 边、无拐角、长度 = 20', async () => {
    const f = await factsOf('let sp = cad.wire([[0,0,0],[0,0,20]])')
    expect(f.edges).toHaveLength(1)
    expect(f.edges[0]!.kind).toBe('line')
    expect(f.edges[0]!.curveType).toBe('line')
    expect(f.edges[0]!.length).toBeCloseTo(20, 6)
    expect(f.totalLength).toBeCloseTo(20, 6)
    expect(f.corners).toHaveLength(0)
    expect(f.gaps).toHaveLength(0)
    expect(f.closed).toBe(false)
    expect(f.mixed).toBe(false)
    expect(f.degenerate).toHaveLength(0)
  })

  it('A2. 共线两段（G1 接缝）：2 条 line 边、拐角 0、不算混合', async () => {
    const f = await factsOf('let sp = cad.wire([[0,0,0],[0,0,10],[0,0,20]])')
    expect(f.edges).toHaveLength(2)
    expect(f.edges.map((e) => e.kind)).toEqual(['line', 'line'])
    expect(f.corners).toHaveLength(0)
    expect(f.gaps).toHaveLength(0)
    expect(f.mixed).toBe(false)
    expect(f.totalLength).toBeCloseTo(20, 6)
  })

  it('A3. 90° 折线：1 个 G0 拐角，转角 π/2，位置在拐点', async () => {
    const f = await factsOf('let sp = cad.wire([[0,0,0],[0,0,10],[0,10,10]])')
    expect(f.corners).toHaveLength(1)
    const c = f.corners[0]!
    expect(c.index).toBe(1)
    expect(c.turn).toBeCloseTo(Math.PI / 2, 6)
    expect(c.point.x).toBeCloseTo(0, 6)
    expect(c.point.y).toBeCloseTo(0, 6)
    expect(c.point.z).toBeCloseTo(10, 6)
    expect(f.maxTurn).toBeCloseTo(Math.PI / 2, 6)
    expect(f.fold).toBe(false)
  })

  it('A4. 单段真弧：kind=arc、长度 = 弧长、半径反解到 R10（精度 1e-3）', async () => {
    const f = await factsOf(`let sp = ${ARC}`)
    expect(f.edges).toHaveLength(1)
    const e = f.edges[0]!
    expect(e.kind).toBe('arc')
    expect(e.curveType).toBe('circle')
    expect(e.length).toBeCloseTo(ARC_LEN, 4)
    expect(e.radius!).toBeCloseTo(10, 2)
    // 端点走向：0° 在 +Y（基准 u）、90° 在 +Z 的反向（基准 v = n̂×u）⇒ (0,0,0) → (0,-10,10)。
    expect(e.start.y).toBeCloseTo(0, 4)
    expect(e.start.z).toBeCloseTo(0, 4)
    expect(e.end.y).toBeCloseTo(-10, 4)
    expect(e.end.z).toBeCloseTo(10, 4)
  })

  it('A5. 弧 + 相切直腿（真 G1、混合类型）：混合为真、拐角 0、无断裂', async () => {
    const f = await factsOf(`let sp = ${ARC_PLUS_LEG}`)
    expect(f.edges).toHaveLength(2)
    expect(f.edges.map((e) => e.kind)).toEqual(['arc', 'line'])
    expect(f.mixed).toBe(true)
    // 相切 ⇒ 转角在 G1_TOL 之内，不能算拐角（否则策略层会去斜接一个不存在的折角）。
    expect(f.corners).toHaveLength(0)
    expect(f.maxTurn).toBeLessThan(G1_TOL)
    expect(f.gaps).toHaveLength(0)
    expect(f.totalLength).toBeCloseTo(ARC_LEN + 10, 3)
  })

  it('A6. 断开的 wire：gaps 记下来（策略层据此拒绝），且不被当成拐角', async () => {
    const f = await factsOf(`let sp = ${ARC_BROKEN}`)
    expect(f.edges).toHaveLength(2)
    expect(f.gaps).toHaveLength(1)
    expect(f.gaps[0]!.index).toBe(1)
    // 两段端点相距 |(0,-10,10) - (0,0,0)| = 14.142。
    expect(f.gaps[0]!.dist).toBeCloseTo(Math.hypot(10, 10), 6)
    // 断裂处的 90° 切向差仍会被记成 G0 拐角 —— 这是「事实」，判「该不该扫」是策略层的事。
    expect(f.corners).toHaveLength(1)
    expect(f.corners[0]!.turn).toBeCloseTo(Math.PI / 2, 3)
  })

  it('A7. 闭合脊柱（整圆）：closed = true，长度 = 周长', async () => {
    const f = await factsOf(
      'let sp = cad.wireFromEdges([cad.circleArc([0,0,0],[0,0,1],10,0*DEGREE,360*DEGREE)])',
    )
    expect(f.closed).toBe(true)
    expect(f.gaps).toHaveLength(0)
    expect(f.totalLength).toBeCloseTo(2 * Math.PI * 10, 2)
    // 内核可能把整圆切成 1 或 2 条边，两种都不影响「闭合」这个事实。
    expect(f.edges.length).toBeGreaterThanOrEqual(1)
    expect(f.edges.every((e) => e.kind === 'arc')).toBe(true)
  })

  it('A8. 只读：两次分析同一条脊柱给出完全相同的事实（不消耗句柄、不留副作用）', async () => {
    const s = await spineOf(`let sp = ${ARC_PLUS_LEG}`)
    const api = getBrepApi()
    const a = analyzeSpine(api, brepOf(s) as never)
    const b = analyzeSpine(api, brepOf(s) as never)
    expect(b).toEqual(a)
    // 分析之后这条 wire 仍然可用（体积/包围盒照样读得出来）。
    expect(() => api.getBoundingBox(brepOf(s) as never)).not.toThrow()
  })
})

describe('B 事实的诊断串：一行说清脊柱长什么样', () => {
  it('B1. 直脊柱：边数 / 长度 / 边类型 / 无拐角', async () => {
    const f = await factsOf('let sp = cad.wire([[0,0,0],[0,0,20]])')
    const d = describeSpine(f)
    expect(d).toContain('1 edge(s)')
    expect(d).toContain('20.000 long')
    expect(d).toContain('kinds line')
    expect(d).toContain('0 G0 corner(s)')
    expect(d).not.toContain('closed')
  })

  it('B2. 折线：带上最大转角（度）', async () => {
    const f = await factsOf('let sp = cad.wire([[0,0,0],[0,0,10],[0,10,10]])')
    const d = describeSpine(f)
    expect(d).toContain('1 G0 corner(s)')
    expect(d).toMatch(/max 90\.0°/)
  })

  it('B3. 混合 + 闭合都写出来', async () => {
    const f = await factsOf(
      'let sp = cad.wireFromEdges([cad.circleArc([0,0,0],[0,0,1],10,0*DEGREE,180*DEGREE),' +
        'cad.circleArc([0,0,0],[0,0,1],10,180*DEGREE,360*DEGREE)])',
    )
    const d = describeSpine(f)
    expect(d).toContain('kinds arc')
    expect(d).toContain('closed')
  })
})

describe('C 阈值常量本身就是契约', () => {
  it('C1. G1 容差 1e-3 rad（≈0.057°）、折返阈值 175°', () => {
    // 这两个数字是策略层「该不该斜接 / 该不该拒」的分界线，改动等于改判据。
    expect(G1_TOL).toBe(1e-3)
    expect((FOLD_TURN * 180) / Math.PI).toBeCloseTo(175, 9)
  })
})
