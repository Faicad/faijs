/**
 * curve-arc-engines — `cad.circleArc` / `cad.tangentArc` 的双引擎几何契约（**实测**）
 *
 * 钉住两条 2026-11-17 落地的规则：
 *
 * 1. **圆弧角度基准是全仓唯一的**：`u` = 世界 +X 在圆面内的投影（法向与 +X 近乎平行时退
 *    +Y），`v = n̂ × u`。op 内部「先建 → 量 → 纠」，所以**参数起点恒为 startAngle 对应的
 *    点**，与引擎内部约定无关。修之前实测：`circleArc([0,0,10],[0,1,0],10,0,90)` 在 occt 上
 *    从 (0,0,0) 走到 (10,0,10)、在 smlib 上从 (10,0,10) 走到 (0,0,0) —— 同一条弧、方向相反。
 *    后果不是"看着别扭"：在弧后再接一条切向直段，拼出的 wire 边不首尾相接，smlib 会**静默**
 *    扫出空体（V=0 而 `getLength` 照样 17.808），错误最后以 `fuse`／体积对账的名义出现在别处。
 *    B 用例就是这条症状的回归。
 *
 * 2. **`tangentArc` 不再依赖 occt 原生**：圆心由中立几何解出（切向定方向、等距定位置），
 *    再走 L1 `makeArcEdge`（三点弧）⇒ occt / smlib 同解同向。
 *
 * 观察方式：A/C 段**直调 op**（`src/api/curve-sketch`）再读内核句柄 —— smlib 的
 * `getSubShapes(face)` 仍是 P1 未实现，脚本直出 `kind:'curve'` 产物会在 runtime 的
 * topology 收集阶段抛 `[smlib-kernel] getSubShapes(face): not implemented`，与弧本身无关。
 * B 段仍走脚本 + runtime（产物是实体，smlib 侧完全支持）。
 *
 * Run: npx vitest run test/api/curve-arc-engines.test.ts
 */
import { describe, it, expect } from 'vitest'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { HostPorts } from '../../src/cad-runtime/ports'
import { asPartName } from '../../src/identity'
import { __resetEngineRegistriesForTests, getActiveBrepEngineId, getActiveBrepEngine } from '../../src/brep/engine/registry'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { registerSmlibBrepEngine } from '../../src/brep/engine/adapters/smlib'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { brepOf } from '../../src/shape'
import type { BrepHandle } from '../../src/brep/engine/types'
import { circleArc, tangentArc } from '../../src/api/curve-sketch'
import { createEditorRuntime } from '../support/editor-ops'

type Vec3 = [number, number, number]
type EngineName = 'occt' | 'smlib'

const ENGINES: EngineName[] = ['occt', 'smlib']
const DEG = Math.PI / 180

function createNodePorts(): HostPorts {
  return { events: { emit: () => undefined } }
}

async function activate(engine: EngineName): Promise<void> {
  __resetEngineRegistriesForTests()
  if (engine === 'occt') await registerOcctBrepEngine()
  else await registerSmlibBrepEngine()
  expect(getActiveBrepEngineId()).toBe(engine)
  // 直调 op 需要后端起底座（runtime 自己会配，直调不会）
  const brep = await getActiveBrepEngine()
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'auto', brepEngineId: engine },
    kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends)
}

/** 走完整运行时（产物是实体的用例用这条：smlib 只支持"有面的"产物）。 */
async function runOn(engine: EngineName, script: string): Promise<ExecutionResult> {
  await activate(engine)
  return createEditorRuntime(createNodePorts(), 'brep').execute(script)
}

/** 在内核上直调 op 并就地读句柄（不经过 runtime 的 topology 收集）。op 返回 Promise ⇒ 必须 await。 */
async function readArc<T>(
  engine: EngineName,
  fn: (h: BrepHandle) => T,
  build: () => unknown | Promise<unknown>,
): Promise<T> {
  await activate(engine)
  const shape = await build()
  const h = brepOf(shape as never) as BrepHandle
  return fn(h)
}

async function arcEndsOf(engine: EngineName, c: ArcCase): Promise<[Vec3, Vec3]> {
  return readArc(
    engine,
    (h) => {
      const api = getBrepApi()
      const p = api.curveParameters(h)
      const f = api.curvePointAtParam(h, p.first)
      const l = api.curvePointAtParam(h, p.last)
      return [
        [f.x, f.y, f.z],
        [l.x, l.y, l.z],
      ] as [Vec3, Vec3]
    },
    () => circleArc(c.center, c.normal, c.radius, c.a0, c.a1),
  )
}

async function arcLengthOf(engine: EngineName, build: () => unknown): Promise<number> {
  return readArc(engine, (h) => getBrepApi().curveLength(h), build)
}

async function arcTangentAtStart(engine: EngineName, build: () => unknown): Promise<Vec3> {
  return readArc(
    engine,
    (h) => {
      const api = getBrepApi()
      const t = api.curveTangent(h, api.curveParameters(h).first)
      return [t.x, t.y, t.z] as Vec3
    },
    build,
  )
}

async function errorOfBuild(engine: EngineName, build: () => unknown | Promise<unknown>): Promise<string> {
  await activate(engine)
  try {
    await build()
    return ''
  } catch (e) {
    return String((e as Error)?.message ?? e)
  }
}

/** `part2` 的体积。 */
function volumeOf(r: ExecutionResult): number {
  expect(r.failedAt, `unexpected failure: ${String(r.failedAt?.message ?? '')}`).toBeUndefined()
  const e = r.brepSolids?.get(asPartName('part2'))
  expect(e).toBeDefined()
  return e!.kernel.getVolume(e!.solid) as number
}

interface ArcCase {
  label: string
  center: Vec3
  normal: Vec3
  radius: number
  a0: number
  a1: number
}

/** 覆盖三个轴向的法向 + 对称/非对称跨度（非对称跨度是"基准真的被归一"的关键证据）。 */
const ARC_CASES: ArcCase[] = [
  { label: 'n=+Z 0..90', center: [0, 0, 0], normal: [0, 0, 1], radius: 10, a0: 0, a1: 90 },
  { label: 'n=+Y 0..90（S9 原案）', center: [0, 0, 10], normal: [0, 1, 0], radius: 10, a0: 0, a1: 90 },
  { label: 'n=+Y 0..30（非对称）', center: [0, 0, 0], normal: [0, 1, 0], radius: 10, a0: 0, a1: 30 },
  { label: 'n=+Y -90..90', center: [0, 0, 0], normal: [0, 1, 0], radius: 6, a0: -90, a1: 90 },
  { label: 'n=+X 0..90（退用 +Y 基准）', center: [0, -10, 0], normal: [1, 0, 0], radius: 10, a0: 0, a1: 90 },
  { label: 'n=(1,1,1) 20..200（跨 180°）', center: [1, 2, 3], normal: [1, 1, 1], radius: 4, a0: 20, a1: 200 },
]

/**
 * 圆弧角度基准的解析点（测试侧独立实现，**故意不复用 op 里那份**：
 * 用例要当独立尺子，不能拿被测代码算自己的期望值）。
 */
function expectedPoint(center: Vec3, normal: Vec3, radius: number, thetaDeg: number): Vec3 {
  const len = Math.hypot(normal[0], normal[1], normal[2])
  const n: Vec3 = [normal[0] / len, normal[1] / len, normal[2] / len]
  const ref: Vec3 = Math.abs(n[0]) < 0.999 ? [1, 0, 0] : [0, 1, 0]
  const d = ref[0] * n[0] + ref[1] * n[1] + ref[2] * n[2]
  const proj: Vec3 = [ref[0] - n[0] * d, ref[1] - n[1] * d, ref[2] - n[2] * d]
  const pl = Math.hypot(proj[0], proj[1], proj[2])
  const u: Vec3 = [proj[0] / pl, proj[1] / pl, proj[2] / pl]
  const v: Vec3 = [
    n[1] * u[2] - n[2] * u[1],
    n[2] * u[0] - n[0] * u[2],
    n[0] * u[1] - n[1] * u[0],
  ]
  const th = thetaDeg * DEG
  const c = Math.cos(th)
  const s = Math.sin(th)
  return [
    center[0] + radius * (c * u[0] + s * v[0]),
    center[1] + radius * (c * u[1] + s * v[1]),
    center[2] + radius * (c * u[2] + s * v[2]),
  ]
}

function near(a: Vec3, b: Vec3, tol: number): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= tol
}

function fmt(p: Vec3): string {
  return `(${p.map((x) => x.toFixed(6)).join(',')})`
}

describe('cad.circleArc — 角度基准与参数方向：两引擎给出同一条弧、同一方向', () => {
  for (const ec of ENGINES) {
    for (const c of ARC_CASES) {
      it(`${ec} · ${c.label}：参数起点 = a0 点、参数终点 = a1 点`, async () => {
        const [first, last] = await arcEndsOf(ec, c)
        const p0 = expectedPoint(c.center, c.normal, c.radius, c.a0)
        const p1 = expectedPoint(c.center, c.normal, c.radius, c.a1)
        const tol = 1e-6 * c.radius
        expect(near(first, p0, tol), `first=${fmt(first)} expected=${fmt(p0)}`).toBe(true)
        expect(near(last, p1, tol), `last=${fmt(last)} expected=${fmt(p1)}`).toBe(true)
      })
    }

    it(`${ec} · 弧长 = r × 跨度（几何不是"补弧"）`, async () => {
      for (const c of ARC_CASES) {
        const len = await arcLengthOf(ec, () => circleArc(c.center, c.normal, c.radius, c.a0, c.a1))
        const expected = c.radius * Math.abs(c.a1 - c.a0) * DEG
        expect(Math.abs(len - expected) / expected, `${c.label}: len=${len} expected=${expected}`).toBeLessThan(1e-6)
      }
    })
  }

  it('两引擎逐点一致（跨引擎对拍）', async () => {
    for (const c of ARC_CASES) {
      const a = await arcEndsOf('occt', c)
      const b = await arcEndsOf('smlib', c)
      const tol = 1e-6 * c.radius
      expect(near(a[0], b[0], tol), `${c.label}: occt=${fmt(a[0])} smlib=${fmt(b[0])}`).toBe(true)
      expect(near(a[1], b[1], tol), `${c.label}: occt=${fmt(a[1])} smlib=${fmt(b[1])}`).toBe(true)
    }
  })

  it('闭合边（0→360）照旧可用：弧长 = 2πr（接缝位置随引擎，几何无差别）', async () => {
    for (const ec of ENGINES) {
      const len = await arcLengthOf(ec, () => circleArc([0, 0, 0], [0, 0, 1], 5, 0, 360))
      expect(Math.abs(len - 2 * Math.PI * 5)).toBeLessThan(1e-6)
    }
  })

  it('跨度超过一整圈 → E_CIRCLEARC_SPAN（裁剪圆边表达不了多圈）', async () => {
    for (const ec of ENGINES) {
      const msg = await errorOfBuild(ec, () => circleArc([0, 0, 0], [0, 0, 1], 5, 0, 720))
      expect(msg).toMatch(/E_CIRCLEARC_SPAN/)
    }
  })
})

const RECT4 = `cad.sketch({ shapes:[{kind:'rect', cx:0, cy:0, w:4, d:4}], constraints:[], plane:'XY' })`

describe('用户症状回归：弧 + 切向直段拼成 wire 后不再"静默空体"', () => {
  // 弧 = circleArc([0,0,10],[0,1,0],10,0,90)；按新契约它的终点是 (0,0,0)、末端切向 −X，
  // 所以直腿从 (0,0,0) 沿 −X 出发正好 G1。修之前 occt 的弧是从 (0,0,0) 走到 (10,0,10)，
  // 接腿必须"按引擎各写一份"（旧 S9 注释里就写着这句）—— 现在一份就够，两引擎都通。
  const ARC = 'cad.circleArc([0,0,10],[0,1,0],10,0,90)'
  const SPINE = `cad.wireFromEdges([${ARC}, cad.edge([0,0,0],[-10,0,0])])`
  const ARC_LEN = 10 * (Math.PI / 2)
  const EXPECT = 16 * (ARC_LEN + 10)

  for (const ec of ENGINES) {
    it(`${ec} · 混合边 G1（弧 + 相切直腿）→ 体积 = 净面积 × 总长，且不为 0`, async () => {
      const r = await runOn(
        ec,
        `let s = ${RECT4}\nlet sp = ${SPINE}\nlet part2 = cad.sweep(s, sp, { strict: false })\n`,
      )
      const v = volumeOf(r)
      expect(v, `volume=${v} expected≈${EXPECT}（空体意味着 wire 没首尾相接）`).toBeGreaterThan(0)
      expect(Math.abs(v - EXPECT) / EXPECT).toBeLessThan(0.01)
    })
  }
})

describe('cad.tangentArc — 中立几何（切向定方向 + 等距定位置），两引擎同解', () => {
  /** 半圆：start=(0,0,0)、切向 +X、end=(0,10,0) ⇒ 圆心 (0,5,0)、r=5、弧长 5π。 */
  const semi = () => tangentArc([0, 0, 0], [1, 0, 0], [0, 10, 0])
  /** 非对称：同起点切向，终点 (5,5,0) ⇒ 圆心 (0,5,0)、r=5、四分之一弧长 5π/2。 */
  const quarter = () => tangentArc([0, 0, 0], [1, 0, 0], [5, 5, 0])

  for (const ec of ENGINES) {
    it(`${ec} · 半圆：起点/终点精确，弧长 = 5π`, async () => {
      const ends = await readArc(
        ec,
        (h) => {
          const api = getBrepApi()
          const p = api.curveParameters(h)
          const f = api.curvePointAtParam(h, p.first)
          const l = api.curvePointAtParam(h, p.last)
          return [
            [f.x, f.y, f.z],
            [l.x, l.y, l.z],
          ] as [Vec3, Vec3]
        },
        semi,
      )
      expect(near(ends[0], [0, 0, 0], 1e-6), `first=${fmt(ends[0])}`).toBe(true)
      expect(near(ends[1], [0, 10, 0], 1e-6), `last=${fmt(ends[1])}`).toBe(true)
      const len = await arcLengthOf(ec, semi)
      expect(Math.abs(len - 5 * Math.PI), `len=${len}`).toBeLessThan(1e-6)
    })

    it(`${ec} · 四分之一弧：终点精确、弧长 = 5π/2`, async () => {
      const ends = await readArc(
        ec,
        (h) => {
          const api = getBrepApi()
          const p = api.curveParameters(h)
          const f = api.curvePointAtParam(h, p.first)
          const l = api.curvePointAtParam(h, p.last)
          return [
            [f.x, f.y, f.z],
            [l.x, l.y, l.z],
          ] as [Vec3, Vec3]
        },
        quarter,
      )
      expect(near(ends[0], [0, 0, 0], 1e-6), `first=${fmt(ends[0])}`).toBe(true)
      expect(near(ends[1], [5, 5, 0], 1e-6), `last=${fmt(ends[1])}`).toBe(true)
      const len = await arcLengthOf(ec, quarter)
      expect(Math.abs(len - (5 * Math.PI) / 2), `len=${len}`).toBeLessThan(1e-6)
    })

    it(`${ec} · 起点切向 = 入参切向（对齐且同向）`, async () => {
      const t = await arcTangentAtStart(ec, quarter)
      const len = Math.hypot(t[0], t[1], t[2])
      expect(len).toBeGreaterThan(0)
      expect(t[0] / len).toBeCloseTo(1, 6)
      expect(Math.abs(t[1] / len)).toBeLessThan(1e-6)
    })

    it(`${ec} · 非法入参：起点=终点 / 切向∥弦`, async () => {
      const a = await errorOfBuild(ec, () => tangentArc([0, 0, 0], [1, 0, 0], [0, 0, 0]))
      expect(a).toMatch(/E_TANGENTARC_DEGENERATE/)
      const b = await errorOfBuild(ec, () => tangentArc([0, 0, 0], [1, 0, 0], [10, 0, 0]))
      expect(b).toMatch(/E_TANGENTARC_COLLINEAR/)
    })
  }

  it('smlib · 可作为扫掠脊柱（能力不再停在 occt）', async () => {
    const r = await runOn(
      'smlib',
      `let s = ${RECT4}\nlet arc = cad.tangentArc([0,0,0],[1,0,0],[0,10,0])\n` +
      `let sp = cad.wireFromEdges([arc])\nlet part2 = cad.sweep(s, sp, { strict: false })\n`,
    )
    const v = volumeOf(r)
    const expected = 16 * 5 * Math.PI
    expect(Math.abs(v - expected) / expected, `volume=${v} expected≈${expected}`).toBeLessThan(0.01)
  })
})
