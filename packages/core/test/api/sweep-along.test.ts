/**
 * @vitest-environment node
 *
 * `cad.sweepAlong` 的策略矩阵（P1，2026-11-16）
 *
 * 一次调用要把任意三维脊柱扫对，靠的是**先判脊柱、再选路线**：
 *
 * | 脊柱事实 | 策略 | 实测 /解析值 |
 * |---|---|---|
 * | 单边任意曲线 | `single` | 1.0000 |
 * | 同类型多边、全 G1 | `single` | 1.0000 |
 * | 混合边类型、全 G1 | `segments` | 1.0000 |
 * | 有 G0 折角（同类型） | `miter` | 0.9936–0.9996 |
 * | 首尾重合 | `closed` | 1.0000（环面 = 面积 × 周长） |
 * | 断裂 / 折返 / 退化 / 混合+G0 | 拒 | `E_SPINE_*` |
 *
 * 每条都钉「选中哪个策略」与「体积 /解析值」两个值：只看体积会漏掉「策略选错但
 * 恰好算对」的组合，只看策略会漏掉「选对了但内核没算对」。
 *
 * Run: npx vitest run test/api/sweep-along.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../src/cad-runtime/ports'
import { asPartName } from '../../src/identity'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import type { Shape } from '../../src/mesh/types'
import { __resetEngineRegistriesForTests } from '../../src/brep/engine/registry'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { brepOf } from '../../src/shape'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'
import { analyzeSpine } from '../../src/api/internal/spine-analysis'
import { selectStrategy } from '../../src/api/internal/sweep-strategy'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

const R = 6
const AREA = Math.PI * R * R
const ARC_LEN = (Math.PI / 2) * 10
/** 弧 R10/90° 的弧长（axis +X：0° 在 +Z、90° 在 -Y）。 */
const ARC = 'cad.circleArc([0,-10,0],[1,0,0],10,0*DEGREE,90*DEGREE)'

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

function exec(mode: ExecutionMode, code: string): Promise<ExecutionResult> {
  return new CadRuntime(ports(), mode, { cad: createApiNamespaceWithEditorOps() }).execute(code)
}

const SEC = `cad.sketch({ plane: 'XY', shapes: [{ kind: 'circle', r: ${R}, cx: 0, cy: 0, tag: 's' }], constraints: [] })`

async function volume(code: string, part = 'part2'): Promise<number> {
  const r = await exec('brep', code)
  if (r.failedAt) throw new Error(`failed at ${r.failedAt.callee}: ${r.failedAt.message}`)
  const s = r.outputs.get(asPartName(part)) as Shape | undefined
  if (!s) throw new Error(`no ${part} output`)
  return getBrepApi().getVolume(brepOf(s) as never)
}

/** 建脊柱 → 读事实 → 选策略（与 sweepAlong 内部同一条链）。 */
async function strategyOf(spineExpr: string): Promise<{ strategy: string; reason: string }> {
  const r = await exec('brep', `let sp = ${spineExpr}`)
  if (r.failedAt) throw new Error(`spine build failed: ${r.failedAt.message}`)
  const s = r.outputs.get(asPartName('sp')) as Shape
  const f = analyzeSpine(getBrepApi(), brepOf(s) as never)
  const d = selectStrategy(f, { sectionRadius: R })
  if ('reject' in d) throw new Error(`unexpected reject ${d.reject.code}`)
  return { strategy: d.strategy, reason: d.reason }
}

/** 4 段 / 16 段折线近似同一条 R10 弧。 */
function polyline(steps: number): string {
  const pts: string[] = []
  for (let i = 0; i <= steps; i++) {
    const t = ((90 * i) / steps) * (Math.PI / 180)
    pts.push(`[0,${(-10 + 10 * Math.cos(t)).toFixed(7)},${(10 * Math.sin(t)).toFixed(7)}]`)
  }
  return `cad.wire([${pts.join(',')}])`
}

describe('S 策略矩阵：脊柱事实 → 路线 → 体积', () => {
  it('S1. 单边真弧 → single → 1.0000', async () => {
    expect((await strategyOf(`cad.wireFromEdges([${ARC}])`)).strategy).toBe('single')
    const v = await volume(`let sec = ${SEC}\nlet sp = cad.wireFromEdges([${ARC}])\nlet part2 = cad.sweep(sec, sp)\n`)
    expect(v / (AREA * ARC_LEN)).toBeCloseTo(1, 3)
  })

  it('S2. 折线 4 段 → miter → ≥ 0.99（斜接，不是平移塌陷的 2/π）', async () => {
    expect((await strategyOf(polyline(4))).strategy).toBe('miter')
    const v = await volume(`let sec = ${SEC}\nlet sp = ${polyline(4)}\nlet part2 = cad.sweep(sec, sp)\n`)
    const ratio = v / (AREA * ARC_LEN)
    expect(ratio).toBeGreaterThan(0.99)
    // 旧默认（transformed）在同一条脊柱上是 0.6366 = 2/π —— 差距必须可见。
    expect(ratio).toBeLessThan(1.001)
  })

  it('S3. 折线 16 段 → miter → ≥ 0.995（采样越密越接近解析值）', async () => {
    expect((await strategyOf(polyline(16))).strategy).toBe('miter')
    const v = await volume(`let sec = ${SEC}\nlet sp = ${polyline(16)}\nlet part2 = cad.sweep(sec, sp)\n`)
    expect(v / (AREA * ARC_LEN)).toBeGreaterThan(0.995)
  })

  it('S4. 混合边类型全 G1（弧 + 相切直腿）→ segments → 1.0000', async () => {
    const spine = `cad.wireFromEdges([${ARC},cad.edge([0,-20,0],[0,-20,-10])])`
    expect((await strategyOf(spine)).strategy).toBe('segments')
    const v = await volume(`let sec = ${SEC}\nlet sp = ${spine}\nlet part2 = cad.sweep(sec, sp)\n`)
    expect(v / (AREA * (ARC_LEN + 10))).toBeCloseTo(1, 3)
  })

  it('S5. 闭合整圆 → closed → 环面体积 = 面积 × 周长', async () => {
    const spine = 'cad.wireFromEdges([cad.circleArc([0,0,0],[0,0,1],10,0*DEGREE,360*DEGREE)])'
    expect((await strategyOf(spine)).strategy).toBe('closed')
    const v = await volume(`let sec = ${SEC}\nlet sp = ${spine}\nlet part2 = cad.sweep(sec, sp)\n`)
    expect(v / (AREA * 2 * Math.PI * 10)).toBeCloseTo(1, 2)
  })

  it('S6. 截面没落在路径上（截面在原点、脊柱在 z=90）→ 默认仍精确（autoPlace 默认开）', async () => {
    const v = await volume(
      `let sec = ${SEC}\nlet sp = cad.wire([[0,0,90],[0,50,90]])\nlet part2 = cad.sweep(sec, sp)\n`,
    )
    expect(v / (AREA * 50)).toBeCloseTo(1, 3)
    // 关掉落位就退化成「管留在原点」：体积仍对、位置错 —— 所以落位是默认行为。
    const r = await exec(
      'brep',
      `let sec = ${SEC}\nlet sp = cad.wire([[0,0,90],[0,50,90]])\n` +
        `let part2 = cad.sweep(sec, sp, { autoPlace: false })\n`,
    )
    if (!r.failedAt) {
      const s = r.outputs.get(asPartName('part2')) as Shape
      const b = getBrepApi().getBoundingBox(brepOf(s) as never)
      expect(b.zmax - b.zmin).toBeCloseTo(12, 0) // 管还在原点附近，不在 z=90
    }
  })

  it('S7. 带孔截面：一次调用给出净空心体积（外环 − 内环）', async () => {
    const ring =
      `cad.sketch({ plane: 'XY', shapes: [` +
      `{ kind: 'circle', r: 8, cx: 0, cy: 0, tag: 'o' },` +
      `{ kind: 'circle', r: 4, cx: 0, cy: 0, tag: 'i', mode: 's' }], constraints: [] })`
    const v = await volume(`let sec = ${ring}\nlet sp = cad.wire([[0,0,0],[0,0,30]])\nlet part2 = cad.sweep(sec, sp)\n`)
    expect(v / (Math.PI * (64 - 16) * 30)).toBeCloseTo(1, 3)
  })
})

describe('R 硬拒绝：物理上无解的脊柱在扫之前就失败，且给出可执行的修法', () => {
  async function rejection(spineExpr: string, opts = ''): Promise<{ code?: string; message: string }> {
    const r = await exec(
      'brep',
      `let sec = ${SEC}\nlet sp = ${spineExpr}\nlet part2 = cad.sweep(sec, sp${opts})\n`,
    )
    if (!r.failedAt) throw new Error('expected a rejection, got success')
    return { code: r.failedAt.code, message: String(r.failedAt.message ?? '') }
  }

  it('R1. 断裂脊柱（弧尾 (0,-20,0) 与直腿首 (0,-10,10) 相距 14.14）→ E_SPINE_DISCONTINUOUS', async () => {
    const e = await rejection(
      `cad.wireFromEdges([${ARC},cad.edge([0,-10,10],[0,-20,10])])`,
    )
    expect(e.code).toBe('E_SPINE_DISCONTINUOUS')
    expect(e.message).toMatch(/do not meet/)
    expect(e.message).toMatch(/distance 14\.14/)
  })

  it('R2. 混合边类型 + G0 折角 → E_SPINE_MIXED_CORNER（两条路线都不对，必须拆 G1 段）', async () => {
    // 弧尾 (0,-20,0)、切向 -Z；直腿却沿 -Y 走 ⇒ 90° 折角 + 混合类型。
    const e = await rejection(`cad.wireFromEdges([${ARC},cad.edge([0,-20,0],[0,-30,0])])`)
    expect(e.code).toBe('E_SPINE_MIXED_CORNER')
    expect(e.message).toMatch(/mixes edge kinds/)
    expect(e.message).toMatch(/G0 corner/)
  })

  it('R3. 覆写 strategy 不能绕过硬拒绝（断裂脊柱 + strategy:"single" 仍拒）', async () => {
    const e = await rejection(
      `cad.wireFromEdges([${ARC},cad.edge([0,-10,10],[0,-20,10])])`,
      `, { strategy: 'single' }`,
    )
    expect(e.code).toBe('E_SPINE_DISCONTINUOUS')
  })

  it('R4. 非法体积容差（(0,1) 之外）→ E_SWEEP_TOL_INVALID，不静默夹取', async () => {
    const e = await rejection('cad.wire([[0,0,0],[0,0,20]])', ', { volumeTolerance: 1.5 }')
    expect(e.message).toMatch(/E_SWEEP_TOL_INVALID/)
  })

  it('R5. 强制 segments 走折线：接缝留 V 形缺口，体积掉到 0.89 左右（错误值钉桩）', async () => {
    // 这就是为什么 auto 对有折角的脊柱选 miter 而不是 segments。
    const v = await volume(
      `let sec = ${SEC}\nlet sp = ${polyline(16)}\nlet part2 = cad.sweep(sec, sp, { strategy: 'segments', volumeTolerance: 0.5 })\n`,
    )
    const ratio = v / (AREA * ARC_LEN)
    expect(ratio).toBeGreaterThan(0.85)
    expect(ratio).toBeLessThan(0.93)
  })
})
